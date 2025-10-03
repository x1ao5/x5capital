// server.js (fixed, ESM only)
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import bodyParser from "body-parser";

dotenv.config();

const app = express();

/* ========= ENV ========= */
const PORT = process.env.PORT || 3000;

// 允許的前端來源（多個用逗號），支援 * 全開
const CORS_ALLOW = (process.env.CORS_ALLOW || "https://www.x5capital.xyz, https://x1ao5.github.io/x5capital")
  .split(",")
  .map(s => s.trim());

const RECEIVING_ADDR = (process.env.RECEIVING_ADDR || "").toLowerCase();  // 必填：收款地址
const MIN_CONFIRMATIONS = Number(process.env.MIN_CONFIRMATIONS ?? 1);     // 最小確認數
const ORDER_TTL_MIN = Number(process.env.ORDER_TTL_MIN ?? 15);            // 訂單有效分鐘數
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";                  // Alchemy Signing Key

// 可接受資產（例如 "NATIVE:eth, ERC20:0xfd086b..."）
// 這裡把每個 entry 轉成「人看得懂的 token 字面」（例：NATIVE 或 USDT）
const ACCEPT_TOKENS = (process.env.ACCEPT_TOKENS || "NATIVE:eth, ERC20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9")
  .split(",")
  .map(s => s.trim().toUpperCase());

// 小數（可自行擴充）
const DEFAULT_DECIMALS = { ETH: 18, USDT: 6 };

/* ========= CORS / Parser ========= */
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (CORS_ALLOW.includes("*")) return cb(null, true);
    const ok = CORS_ALLOW.some(allow => origin.startsWith(allow));
    return ok ? cb(null, true) : cb(new Error("CORS blocked"));
  }
}));

// 一般 API 用 JSON parser
app.use(express.json({ limit: "1mb" }));
// Alchemy webhook 需要「raw body」才能驗簽，專給 /webhook/alchemy 用
app.use("/webhook/alchemy", bodyParser.raw({ type: "*/*" }));

/* ========= In-memory Orders ========= */
const orders = new Map(); // id -> order
const nowMs = () => Date.now();
const ttlMs = () => ORDER_TTL_MIN * 60 * 1000;
const clampSymbol = s => (s || "").toUpperCase();

// 定期把 pending 逾時單改成 expired
setInterval(() => {
  const t = nowMs();
  for (const o of orders.values()) {
    if (o.status === "pending" && t > o.expiresAt) o.status = "expired";
  }
}, 30_000);

/* ========= Routes ========= */

// health
app.get("/", (_, res) => res.send("x5 backend ok"));

// 建單
app.post("/orders", (req, res) => {
  const { id, asset, amount } = req.body || {};
  if (!id || !asset || !amount) {
    return res.status(400).json({ error: "id/asset/amount required" });
  }
  if (orders.has(id)) return res.status(400).json({ error: "order exists" });

  const order = {
    id,
    asset: clampSymbol(asset),    // 例：'USDT' 或 'ETH'
    amount: Number(amount),       // 例：1
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

/* ========= Alchemy Webhook ========= */

function verifyAlchemySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;

  try {
    const h = crypto.createHmac("sha256", secret);
    h.update(rawBody);
    const hex = h.digest("hex");                 // 純 64 位 hex
    const prefixed = `sha256=${hex}`;            // 'sha256=<hex>'

    const sigBuf = Buffer.from(String(signature));
    const a = Buffer.from(prefixed);
    const b = Buffer.from(hex);

    // 兩種格式擇一通過就認證成功
    if (sigBuf.length === a.length && crypto.timingSafeEqual(sigBuf, a)) return true;
    if (sigBuf.length === b.length && crypto.timingSafeEqual(sigBuf, b)) return true;

    return false;
  } catch {
    return false;
  }
}

app.post("/webhook/alchemy", (req, res) => {
  console.log("[HOOK HIT]", req.method, req.url);

  // 1) 驗簽
  const sig = req.headers["x-alchemy-signature"];
  const raw = req.body; // Buffer (因為用 raw parser)
  if (!verifyAlchemySignature(raw, sig, WEBHOOK_SECRET)) {
    console.warn("[HOOK] invalid signature");
    return res.status(401).send("invalid signature");
  }

  // 2) 解析 payload
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    console.warn("[HOOK] bad json", e);
    return res.status(400).send("bad json");
  }

  // Address Activity: 事件陣列
  const events = payload?.event?.activity || [];
  if (!Array.isArray(events) || events.length === 0) {
    console.log("[HOOK] no activity");
    return res.status(200).send("ok");
  }

  // 3) 嘗試把每個 activity 對到訂單
  const receiving = RECEIVING_ADDR; // 你的收款地址
  for (const ev of events) {
    const token = String(ev.asset || ev.category || "").toUpperCase(); // 例：'USDT' / 'NATIVE'
    const toAddr = (ev.toAddress || ev.to || "").toLowerCase();
    const amount = Number(ev.value || ev.rawAmount || ev.erc20Value || "0"); // 人看得懂的數字
    const txHash = ev.hash || ev.transactionHash || ev.txHash || "";
    const conf = Number(ev.confirmations || 0);

    // 只接受白名單 token
    if (!ACCEPT_TOKENS.includes(token)) continue;
    // 必須打到你的收款位址
    if (toAddr !== receiving) continue;

    // 掃描可以匹配的訂單（pending/paying、未逾時、資產一致、金額相同）
    const now = Date.now();
    for (const o of orders.values()) {
      if (!["pending", "paying"].includes(o.status)) continue;
      if (o.expiresAt && now > o.expiresAt) continue;
      if (String(o.asset).toUpperCase() !== token) continue;
      if (Number(o.amount) !== amount) continue;

      o.txHash = txHash;

      // 4) 最小確認數門檻：paying → paid
      if (MIN_CONFIRMATIONS <= 0 || conf >= MIN_CONFIRMATIONS) {
        o.status = "paid";
        o.paidAt = Date.now();
        console.log(`[ORDER PAID] id=${o.id} conf=${conf} tx=${txHash}`);
      } else {
        o.status = "paying";
        console.log(`[ORDER PAYING] id=${o.id} conf=${conf}/${MIN_CONFIRMATIONS} tx=${txHash}`);
      }
      break; // 成功對到一張就跳出迴圈
    }
  }

  return res.status(200).send("ok");
});

/* ========= Start ========= */
app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS =", ACCEPT_TOKENS.join(", "));
  console.log("MIN_CONF =", MIN_CONFIRMATIONS, "ORDER_TTL_MIN =", ORDER_TTL_MIN);
});

