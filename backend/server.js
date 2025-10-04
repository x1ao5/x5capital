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

function timingMatch(inSig, hex) {
  const a = Buffer.from(String(inSig || ""));
  const b = Buffer.from(String(hex || ""));
  const c = Buffer.from(`sha256=${hex}`);
  try {
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    if (a.length === c.length && crypto.timingSafeEqual(a, c)) return true;
  } catch {}
  return false;
}

// 只在這條路由掛 raw parser；其他路由維持 express.json()
app.post("/webhook/alchemy", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body;                             // <Buffer ...>
  const sig = req.get("x-alchemy-signature") || ""; // 來自 Alchemy 的簽名
  const secret = process.env.WEBHOOK_SECRET || "";  // 你在 Render 的環境變數

  // 1) 計算我們端的 HMAC
  const hex = crypto.createHmac("sha256", secret).update(raw).digest("hex");

  // 2) 基本除錯（避免把完整簽名打到 log）
  console.log("[HOOK HIT] POST /webhook/alchemy",
              "hdr=", sig.slice(0, 12) + "...",
              "hex=", hex.slice(0, 12) + "...",
              "len=", raw?.length);

  // 3) 驗簽
  if (!timingMatch(sig, hex)) {
    console.log("[HOOK] invalid signature");
    return res.status(401).send("invalid signature");
  }

  // 4) parse JSON
  let body;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    console.log("[HOOK] bad json:", e.message);
    return res.status(400).send("bad json");
  }

  // 5) 你的既有配對邏輯（保留原本的 normalizeActivity / handle）
  try {
    const evt = body?.event || body;
    const match = normalizeActivity(evt); // ← 用你原本的函式；回傳 { orderId, txHash } 等
    if (!match) {
      console.log("[HOOK] no match");
      return res.json({ ok: true });
    }

    const o = orders.get(match.orderId);
    if (!o) return res.json({ ok: true });

    // 最小改動：若已收款、把 pending → paid（你若做了「paying → paid」也 OK）
    if (o.status !== "paid") {
      o.status = "paid";
      o.txHash = match.txHash || o.txHash;
      o.paidAt = Date.now();
      console.log(`[ORDER PAID] ${o.id} -> ${o.asset} ${o.amount}`);
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[HOOK] handler error:", e);
    return res.status(500).send("hook error");
  }
});

/* ========= Start ========= */
app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS =", ACCEPT_TOKENS.join(", "));
  console.log("MIN_CONF =", MIN_CONFIRMATIONS, "ORDER_TTL_MIN =", ORDER_TTL_MIN);
});
