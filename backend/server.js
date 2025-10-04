// server.js — ESM 版（Render/Node 直接可跑）
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = globalThis.__x5_app || (globalThis.__x5_app = express());

/* ========== ENV ========== */
const PORT = process.env.PORT || 3000;

// 允許的前端來源（多個用逗號），可設為 * 全開
const CORS_ALLOW = (process.env.CORS_ALLOW || "https://www.x5capital.xyz, https://x1ao5.github.io/x5capital")
  .split(",")
  .map(s => s.trim());

const RECEIVING_ADDR     = (process.env.RECEIVING_ADDR || "").toLowerCase(); // 收款地址（可選）
const MIN_CONFIRMATIONS  = Number(process.env.MIN_CONFIRMATIONS ?? 1);       // 最小確認數（目前先不強制）
const ORDER_TTL_MIN      = Number(process.env.ORDER_TTL_MIN ?? 15);          // 訂單有效分鐘
const WEBHOOK_SECRET     = process.env.WEBHOOK_SECRET || "";                 // Alchemy Signing Key（必填）

// 可接受資產（例：NATIVE:eth, ERC20:0xfd08...）
const ACCEPT_TOKENS = (process.env.ACCEPT_TOKENS || "NATIVE:eth, ERC20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9")
  .split(",")
  .map(s => s.trim().toUpperCase());

// 轉 uint/hex raw value -> JS number（足夠應付金額不大的 case）
function toAmount(raw, decimals = 18) {
  if (raw == null) return 0;
  let big;
  if (typeof raw === "string" && raw.startsWith("0x")) {
    big = BigInt(raw);
  } else {
    // 也可能是十進位字串
    big = BigInt(String(raw));
  }
  const denom = 10n ** BigInt(decimals);
  return Number(big) / Number(denom);
}

function sameAddr(a, b) {
  return (a || "").toLowerCase() === (b || "").toLowerCase();
}

// ====== utils: Alchemy 簽章驗證（沿用 raw body）======
function safeVerifyAlchemy(rawBuffer, signature) {
  try {
    if (!WEBHOOK_SECRET || !signature) return false;
    const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
    hmac.update(rawBuffer); // raw buffer
    const digest = hmac.digest("hex");
    return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(digest, "hex"));
  } catch {
    return false;
  }
}

/* 
 * ===== Webhook: Alchemy (Address Activity)
 * ⚠️ 放在任何 app.use(express.json()) 之前，並使用 express.raw 取原始 body
 */
app.post('/webhook/alchemy', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    // 1) 驗簽
    const sig = req.get('X-Alchemy-Signature') || req.get('x-alchemy-signature');
    const raw = req.body; // Buffer
    const ok  = safeVerifyAlchemy(raw, sig);
    if (!ok) {
      console.log('[HOOK] invalid signature');
      return res.status(401).end();
    }

    // 2) 解析 payload
    const payload = JSON.parse(raw.toString('utf8'));
    const acts    = payload?.event?.activity || payload?.event?.activities || [];
    const network = payload?.event?.network || 'ARB_MAINNET';

    // 3) 常數：Arbitrum One USDT
    const USDT     = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
    const USDT_DEC = 6;
    const RECEIVING = (process.env.RECEIVING_ADDR || RECEIVING_ADDR).toLowerCase();

    // 4) 掃活動，抓「打進我們地址的 USDT」
    for (const a of acts) {
      const to      = (a.toAddress || a.to || '').toLowerCase();
      const token   = (a.rawContract?.address || a.contractAddress || '').toLowerCase();
      const txHash  = a.hash || a.txHash || a.transactionHash || '';
      const rawVal  = a.rawValueHex || a.rawValue || a.value || a.erc20TokenAmount || '0x0';

      if (to !== RECEIVING) continue;
      if (token !== USDT)   continue;

      // 轉為 BigInt 最小單位（6 位）
      const onchainVal = typeof rawVal === 'string' && rawVal.startsWith('0x')
        ? BigInt(rawVal)
        : BigInt(String(rawVal));

      // 5) 用金額 + 資產 + 未逾時 pending 來對訂單
      for (const o of orders.values()) {
        if (o.status !== 'pending') continue;
        if (Date.now() > o.expiresAt) continue;
        if ((o.asset || '').toUpperCase() !== 'USDT') continue;

        const wantVal = BigInt(Math.round(Number(o.amount) * 1_000_000)); // USDT 10^6
        if (onchainVal === wantVal) {
          o.status  = 'paid';
          o.txHash  = txHash;
          o.paidAt  = Date.now();
          o.network = network;
          console.log('💰 marked paid', { id: o.id, amount: o.amount, asset: o.asset, txHash });
          break;
        }
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[HOOK] error', e);
    return res.status(500).end();
  }
});

/* ========== CORS 與 Body Parser（放在 webhook 後面） ========== */
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                 // 允許 server-to-server / curl
    if (CORS_ALLOW.includes("*")) return cb(null, true);
    const ok = CORS_ALLOW.some(allow => origin.startsWith(allow));
    return ok ? cb(null, true) : cb(new Error("CORS blocked"));
  }
}));

// 👉 一般 JSON API 用 express.json()
app.use(express.json());

/* ========== In-memory Orders ========== */
const orders = new Map(); // id -> order

const nowMs = () => Date.now();
const ttlMs = () => ORDER_TTL_MIN * 60 * 1000;
const clamp = s => (s || "").toUpperCase();

// 定時把逾時 pending 改為 expired（避免一堆殭屍單）
setInterval(() => {
  const t = nowMs();
  for (const o of orders.values()) {
    if (o.status === "pending" && t > o.expiresAt) o.status = "expired";
  }
}, 30_000);

/* ========== Health ========== */
app.get("/", (_, res) => res.send("x5 backend ok"));

/* ========== 建單 / 查單 / 取消 ========== */
app.post("/orders", (req, res) => {
  const { id, asset, amount } = req.body || {};
  if (!id || !asset || !amount) {
    return res.status(400).json({ error: "id/asset/amount required" });
  }
  if (orders.has(id)) return res.status(400).json({ error: "order exists" });

  const order = {
    id,
    asset: clamp(asset),           // 例：USDT / ETH
    amount: Number(amount),        // 例：1
    status: "pending",
    createdAt: nowMs(),
    expiresAt: nowMs() + ttlMs(),
    txHash: null,
    paidAt: null
  };
  orders.set(id, order);
  console.log("[ORDERS API] POST /orders -> ok", id, order.asset, order.amount);
  res.json(order);
});

app.get("/orders/:id", (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });
  res.json(o);
});

app.post("/orders/:id/cancel", (req, res) => {
  const o = orders.get(req.params.id);
  if (!o) return res.status(404).json({ error: "not found" });
  if (o.status === "pending") o.status = "cancelled";
  res.json(o);
});

/* ========== Start ========== */
app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS  =", ACCEPT_TOKENS.join(", "));
  console.log("MIN_CONF =", MIN_CONFIRMATIONS, "ORDER_TTL_MIN =", ORDER_TTL_MIN);
});
