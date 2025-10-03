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

const bodyParser = require('body-parser');
app.use('/webhook/alchemy', bodyParser.raw({ type: '*/*' }));

const MIN_CONFIRMATIONS = Number(process.env.MIN_CONFIRMATIONS ?? 0);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET; // Alchemy 的 Signing Key
const ACCEPT_TOKENS = (process.env.ACCEPT_TOKENS || 'NATIVE:eth').split(',').map(s => s.trim().toUpperCase());

// 這是你的記憶體訂單存放（你原本就有）：
const orders = new Map(); // id -> { id, amount, asset, status, expiresAt, txHash, ... }

// 驗簽工具（你原本如果已有驗簽可沿用）
const crypto = require('crypto');
function verifyAlchemySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const digest = `sha256=${hmac.digest('hex')}`;
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

app.post('/webhook/alchemy', (req, res) => {
  // 只在 handler 內使用 req/res
  console.log('[HOOK HIT]', req.method, req.url);

  // ── 1) 驗簽 ─────────────────────
  const sig = req.headers['x-alchemy-signature'];
  const raw = req.body; // 因為用 raw parser，所以是 Buffer
  if (!verifyAlchemySignature(raw, sig, WEBHOOK_SECRET)) {
    console.warn('[HOOK] invalid signature');
    return res.status(401).send('invalid signature');
  }

  // Alchemy Address Activity payload 是 JSON；raw 是 Buffer 所以要 parse
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    console.warn('[HOOK] bad json', e);
    return res.status(400).send('bad json');
  }

  // 取出活動（依你實際 payload 結構調整）
  const events = payload?.event?.activity || [];
  if (!Array.isArray(events) || events.length === 0) {
    console.log('[HOOK] no activity');
    return res.status(200).send('ok');
  }

  // ── 2) 檢查每個 activity，嘗試對應訂單 ─────────────────────
  for (const ev of events) {
    // 你根據實際欄位取值（以下範例對應 USDT/ERC20 轉帳）
    const token = String(ev.asset || ev.category || '').toUpperCase(); // 例如 'USDT' 或 'NATIVE'
    const amountStr = ev.value || ev.rawAmount || ev.erc20Value || '0';
    const amount = Number(amountStr) || 0;
    const toAddr = (ev.toAddress || ev.to || '').toLowerCase();
    const fromAddr = (ev.fromAddress || ev.from || '').toLowerCase();
    const txHash = ev.hash || ev.transactionHash || ev.txHash || '';

    // 你接收的地址（.env RECEIVING_ADDR）
    const receiving = (process.env.RECEIVING_ADDR || '').toLowerCase();

    // (A) 僅接受指定 token 類型
    if (!ACCEPT_TOKENS.includes(token)) {
      console.log('[HOOK] skip token', token);
      continue;
    }
    // (B) 必須打到你的收款位址
    if (toAddr !== receiving) {
      console.log('[HOOK] not to receiving addr', toAddr);
      continue;
    }

    // 依你訂單 amount/asset 對應
    // 這裡示範：掃所有 pending / paying 訂單，找到第一筆「尚未逾時、資產相同、金額相同」的訂單來核對
    const now = Date.now();
    for (const o of orders.values()) {
      if (!['pending', 'paying'].includes(o.status)) continue;
      if (o.expiresAt && now > o.expiresAt) continue;
      if (String(o.asset).toUpperCase() !== token) continue;

      // 數量換算：USDT 6 位小數，你可依你儲存邏輯統一換算
      // 如果你在建單時就已經把 amount 視為“人看得懂的數字”(例如 1 USDT)，那就直接比對：
      if (Number(o.amount) !== amount) continue;

      // ── 3) 最小確認數的「paying → paid」判斷 ─────────────────
      const conf = Number(ev.confirmations || 0); // 有些 payload 可能沒有，需要你日後輪詢補齊
      o.txHash = txHash;

      if (MIN_CONFIRMATIONS <= 0 || conf >= MIN_CONFIRMATIONS) {
        o.status = 'paid';
        console.log(`[ORDER PAID] id=${o.id} conf=${conf} tx=${txHash}`);
      } else {
        o.status = 'paying'; // 前端顯示「已收到、等待確認中」
        console.log(`[ORDER PAYING] id=${o.id} conf=${conf}/${MIN_CONFIRMATIONS} tx=${txHash}`);
      }

      break; // 成功對到一張訂單就跳出
    }
  }

  return res.status(200).send('ok');
});

app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS =", ACCEPT_TOKENS.join(", "));
  console.log("MIN_CONF=", MIN_CONFIRMATIONS, "ORDER_TTL_MIN=", ORDER_TTL_MIN);

});

