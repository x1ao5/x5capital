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

/* ========== Webhook（一定要在任何 body parser 之前） ========== */
app.post("/webhook/alchemy", express.raw({ type: "*/*" }), (req, res) => {
  const signature =
    req.get("x-alchemy-signature") || req.get("X-Alchemy-Signature");

  // 支援兩個環境變數名稱，擇一即可
  const secret = process.env.ALCHEMY_SIGNING_KEY || process.env.WEBHOOK_SECRET || "";
  if (!secret) {
    console.error("[HOOK] missing env ALCHEMY_SIGNING_KEY/WEBHOOK_SECRET");
    return res.status(500).send("server misconfigured");
  }

  // raw body 必須是 Buffer
  let raw = req.body;
  if (!Buffer.isBuffer(raw)) {
    if (typeof raw === "string") raw = Buffer.from(raw);
    else if (raw instanceof Uint8Array) raw = Buffer.from(raw);
    else {
      console.error("[HOOK] raw is not Buffer:", typeof raw);
      return res.status(400).send("bad raw body");
    }
  }

  // HMAC 驗簽（同時接受 hex 與 'sha256=hex'）
  const digest = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const ok =
    signature &&
    (safeEq(signature, digest) || safeEq(signature, `sha256=${digest}`));

  if (!ok) {
    console.log("[HOOK] invalid signature", {
      hasSig: !!signature,
      bodyLen: raw.length,
    });
    return res.status(401).send("invalid signature");
  }

  // 驗簽 OK，解析 JSON
  let payload;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch (e) {
    console.error("[HOOK] bad json:", e.message);
    return res.status(400).send("bad json");
  }

  const acts = payload?.event?.activity || payload?.event?.activities || [];
  console.log("✅ [HOOK OK]", payload?.event?.network, "acts:", acts.length, "sample:", acts[0]);

  // 這裡先把事件丟到 app 事件（你若有更完整的「對單」邏輯，可以在這裡做 mapping）
  try {
    req.app.emit("alchemy_event", payload);
  } catch {}

  return res.json({ ok: true });
});

// 安全字串比較（避免時序攻擊）
function safeEq(a, b) {
  try {
    const ba = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch { return false; }
}

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

// 更健壯的對單規則：
// - 只處理「打到 RECEIVING_ADDR」的 activity
// - 抓出 symbol / tokenAddr / amount
// - 優先找「同金額、同資產、未逾時的 pending 訂單」
//   （沒有 orderId 的情況先這樣解；未來你也可以把 orderId 放到註記裡，對得更準）
app.on("alchemy_event", (payload) => {
  const acts = payload?.event?.activity || payload?.event?.activities || [];
  console.log("[MATCH] activities:", acts.length);

  for (const a of acts) {
    // 常見欄位名稱整理（不同鏈/不同型別會略有差）
    const to =
      (a?.toAddress || a?.toAddr || a?.to || "").toLowerCase();
    if (!sameAddr(to, RECEIVING_ADDR)) continue;

    const txHash =
      a?.hash || a?.txHash || a?.transactionHash || null;

    const symbol =
      (a?.asset ||
        a?.erc20Info?.symbol ||
        a?.rawContract?.symbol ||
        a?.tokenSymbol ||
        "").toUpperCase();

    // ERC20 合約地址（USDT 會有），比對你 .env 的 ACCEPT_TOKENS 可用
    const tokenAddr =
      (a?.erc20Info?.contractAddress ||
        a?.rawContract?.address ||
        a?.tokenAddress ||
        "").toLowerCase();

    // decimals 與 raw value
    const decimals =
      Number(
        a?.decimals ||
          a?.erc20Info?.decimals ||
          a?.decInEvt ||
          18
      );
    const rawValue =
      a?.rawValueHex ||
      a?.rawValue ||
      a?.value ||
      "0";
    const amount = toAmount(rawValue, decimals);

    // ---- 找一張最合理的 pending 訂單 ----
    // 規則：還在有效期、狀態 pending、資產（symbol）一致、金額相等（允許一點點浮點誤差）
    const candidate = [...orders.values()].find((o) => {
      if (o.status !== "pending") return false;
      if (nowMs() > o.expiresAt) return false;
      if ((o.asset || "").toUpperCase() !== symbol) return false;
      return Math.abs(Number(o.amount) - amount) < 1e-8;
    });

    if (!candidate) {
      console.log("[MATCH] no candidate:", { to, symbol, amount, txHash });
      continue;
    }

    candidate.status = "paid";
    candidate.txHash = txHash;
    candidate.paidAt = nowMs();

    console.log("💰 marked paid", {
      id: candidate.id,
      symbol,
      amount,
      txHash,
    });
  }
});

/* ========== Start ========== */
app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS  =", ACCEPT_TOKENS.join(", "));
  console.log("MIN_CONF =", MIN_CONFIRMATIONS, "ORDER_TTL_MIN =", ORDER_TTL_MIN);
});

