import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

// ====== ENV ======
const PORT = process.env.PORT || 3000;

// 你的 GitHub Pages 網域（請改成你的，或先暫時用 *）
const CORS_ALLOW = (process.env.CORS_ALLOW || "https://www.x5capital.xyz, https://x1ao5.github.io/x5capital")
  .split(",")
  .map(s => s.trim());

const RECEIVING_ADDR = (process.env.RECEIVING_ADDR || "").toLowerCase(); // 收款地址（必填）
const MIN_CONFIRMATIONS = parseInt(process.env.MIN_CONFIRMATIONS || "1", 10);
const ORDER_TTL_MIN = parseInt(process.env.ORDER_TTL_MIN || "15", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // Alchemy Webhook 的自訂驗證用 token

// 可接受資產（symbol 或 ERC20 地址，全部小寫）
const ACCEPT_TOKENS = (process.env.ACCEPT_TOKENS || "NATIVE:eth, ERC20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9")
  .split(",")
  .map(s => s.trim());

// 預設小數（ETH=18、USDT(arb)=6）
const DEFAULT_DECIMALS = {
  ETH: 18,
  USDT: 6
};

// ====== CORS ======
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ALLOW.includes("*")) return cb(null, true);
    const ok = CORS_ALLOW.some(allow => origin.startsWith(allow));
    return ok ? cb(null, true) : cb(new Error("CORS blocked"));
  }
}));

app.use(express.json({ limit: "1mb" }));

// ====== in-memory 訂單 ======
const orders = new Map(); // id -> order
function nowMs() { return Date.now(); }
function ttlMs() { return ORDER_TTL_MIN * 60 * 1000; }
function clampSymbol(s) { return (s || "").toUpperCase(); }

// 清理過期
setInterval(() => {
  const t = nowMs();
  for (const [id, o] of orders.entries()) {
    if (o.status === "pending" && t > o.expiresAt) {
      o.status = "expired";
    }
  }
}, 30 * 1000);

// ====== Routes ======

// health
app.get("/", (_, res) => res.send("x5 backend ok"));

// 建單
app.post("/orders", (req, res) => {
  const { id, asset, amount } = req.body || {};
  if (!id || !asset || !amount) {
    return res.status(400).json({ error: "id/asset/amount required" });
  }
  if (orders.has(id)) return res.status(400).json({ error: "order exists" });

  const expiresAt = nowMs() + ttlMs();
  const order = {
    id,
    asset: clampSymbol(asset),  // 'USDT' 或 'ETH'
    amount: Number(amount),     // 1
    status: "pending",
    createdAt: nowMs(),
    expiresAt,
    txHash: null,
    paidAt: null
  };
  orders.set(id, order);
  console.log("[ORDERS API] POST /orders -> ok", id, asset, amount);
  res.json(order);
});

// 查單
app.get("/orders/:id", (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });
  res.json(o);
});

// 取消（可選）
app.post("/orders/:id/cancel", (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });
  if (o.status === "pending") o.status = "cancelled";
  res.json(o);
});

// ====== Alchemy Webhook ======
/**
 * Alchemy Address Activity 格式（簡化）
 * req.body: {
 *   event: {
 *     network: "ARB_MAINNET",
 *     activity: [{
 *       fromAddress, toAddress, value, asset (ETH 或 token symbol?), hash, rawContract:{address, decimals, rawValue}, category, confirmations
 *     }]
 *   }
 * }
 */
app.post("/webhook/alchemy", (req, res) => {
  // 簡單 token 驗證（你在 Alchemy 設 URL?token=XXX，這裡比對）
  if (WEBHOOK_SECRET) {
    const token = (req.query.token || "").toString();
    if (token !== WEBHOOK_SECRET) return res.status(401).send("bad token");
  }

  const body = req.body || {};
  const ev = body.event || {};
  const acts = ev.activity || [];
  if (!Array.isArray(acts) || acts.length === 0) {
    return res.status(200).json({ ok: true, msg: "no activity" });
  }

  for (const a of acts) {
    try {
      const to = (a.toAddress || "").toLowerCase();
      if (!to || !RECEIVING_ADDR || to !== RECEIVING_ADDR) continue;

      // 解析資產
      let assetSym = (a.asset || "").toUpperCase();
      let tokenAddr = (a.rawContract?.address || "").toLowerCase();
      let decimals = Number(a.rawContract?.decimals ?? DEFAULT_DECIMALS[assetSym] ?? 18);

      // 決定資產型別是否接受
      let accepted = false;
      for (const item of ACCEPT_TOKENS) {
        const [kind, val] = item.split(":");
        if ((kind || "").toUpperCase() === "NATIVE" && assetSym === (val || "").toUpperCase()) accepted = true;
        if ((kind || "").toUpperCase() === "ERC20" && tokenAddr && tokenAddr === (val || "").toLowerCase()) accepted = true;
      }
      if (!accepted) continue;

      // 數量（units）
      let units = 0n;
      if (a.rawContract?.rawValue) {
        units = BigInt(a.rawContract.rawValue);
      } else if (a.value) {
        units = BigInt(a.value); // 有些事件 value 就是 wei
      }
      const human = Number(units) / Math.pow(10, decimals);

      const conf = Number(a.confirmations || 0);
      const txHash = a.hash;

      console.log("--- activity ---");
      console.log({
        txHash,
        fromAddress: a.fromAddress,
        toAddress: a.toAddress,
        assetSym,
        tokenAddr,
        rawValueHex: a.rawContract?.rawValue || "0x0",
        decInEvt: decimals,
        conf,
        network: ev.network
      });

      // 遍歷 pending 訂單，比對資產 & 金額
      for (const [id, o] of orders.entries()) {
        if (o.status !== "pending") continue;
        if (o.asset !== assetSym) continue;
        if (human + 1e-9 < o.amount) continue; // 需 >= 訂單金額
        if (nowMs() > o.expiresAt) continue;

        if (conf >= MIN_CONFIRMATIONS) {
          o.status = "paid";
          o.txHash = txHash;
          o.paidAt = nowMs();
          console.log(`✅ PAID tx=${txHash} -> order=${id}`);
        } else {
          console.log(`[pending conf] tx=${txHash} conf=${conf}/${MIN_CONFIRMATIONS}`);
        }
      }
    } catch (e) {
      console.error("webhook parse error:", e);
    }
  }

  res.status(200).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS =", ACCEPT_TOKENS.join(", "));
  console.log("MIN_CONF=", MIN_CONFIRMATIONS, "ORDER_TTL_MIN=", ORDER_TTL_MIN);
});