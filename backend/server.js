// ================== server.js (drop-in) ==================
import express from "express";
import cors from "cors";
import crypto from "crypto";

// ---- 基本設定：環境變數 ----
const PORT = process.env.PORT || 10000;

// 收款地址（小寫）
const RECEIVING_ADDR = (process.env.RECEIVING_ADDR || "").toLowerCase();

// 接受代幣：這裡只做 USDT (ARB) 範例；你也可用環境變數配置
// 例如：ACCEPT_TOKENS=ERC20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9
const USDT_ARB = "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9".toLowerCase(); // Arbitrum USDT
const ACCEPT_TOKENS = new Set([USDT_ARB]);

// 訂單 TTL & 確認數
const ORDER_TTL_MIN = parseInt(process.env.ORDER_TTL_MIN || "15", 10);
const MIN_CONF = parseInt(process.env.MIN_CONFIRMATIONS || "0", 10);

// Alchemy Webhook 簽名 key
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

// ---- 訂單暫存（開發階段用）----
/**
 * orders[orderId] = {
 *   id, asset:'USDT', amount: 1, status:'pending'|'paying'|'paid'|'expired'|'cancelled',
 *   createdAt, expiresAt, txHash?
 * }
 */
const orders = Object.create(null);

const app = express();
app.use(cors({ origin: "*"}));

// ！！！重點 1：Webhook 路由一定要在任何 JSON 解析器之前！！！
//    用 express.raw() 才拿得到原始位元組做 HMAC
app.post("/webhook/alchemy", express.raw({ type: "*/*" }), (req, res) => {
  try {
    if (!WEBHOOK_SECRET) {
      console.log("[HOOK DEBUG] missing secret");
      return res.status(500).send("server missing secret");
    }
    // ---- 1) 驗簽 ----
    const hdr = req.header("x-alchemy-signature") || "";
    const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const digest = crypto.createHmac("sha256", WEBHOOK_SECRET)
      .update(bodyBuf)
      .digest("hex");

    const ok = hdr === digest || hdr === `sha256=${digest}`;
    if (!ok) {
      console.log("[HOOK] invalid signature");
      return res.status(401).send("invalid signature");
    }

    // ---- 2) 解析 payload ----
    const payload = JSON.parse(bodyBuf.toString("utf8"));

    // 兼容不同版本欄位
    const activities =
      payload?.event?.activities ||
      payload?.data?.event?.activity ||
      payload?.activity ||
      [];

    // ---- 3) 掃描活動，找出「打到我們收款地址的 USDT 入帳」----
    let matched = null;

    for (const a of activities) {
      // 盡量兼容各版本欄位
      const toAddr = (a.toAddress || a.to || a.toAddressRaw || "").toLowerCase();
      const tokenAddr = (
        a.rawContract?.address ||
        a.contractAddress ||
        a.erc20?.contractAddress ||
        a.asset_contract?.address ||
        ""
      ).toLowerCase();

      // 取得數量與小數位
      // Alchemy 一般會提供 erc20Metadata.decimals / symbol
      const decimals =
        a.erc20Metadata?.decimals ??
        a.decimals ??
        6; // usdt 多半 6
      const symbol =
        (a.erc20Metadata?.symbol ||
          a.asset?.symbol ||
          a.symbol ||
          "USDT").toUpperCase();

      // value 可能在不同欄位
      const rawValue =
        a.value ??
        a.rawValue ??
        a.erc20Transfer?.value ??
        0;

      // 轉成 BigInt（都是整數基數，之後用 decimals 換算）
      let valueBI;
      try {
        valueBI = BigInt(rawValue);
      } catch {
        valueBI = 0n;
      }

      // 條件：打到我的收款地址 + USDT 合約
      if (toAddr === RECEIVING_ADDR && ACCEPT_TOKENS.has(tokenAddr)) {
        matched = { valueBI, decimals, symbol, txHash: a.hash || a.transactionHash || "" };
        break;
      }
    }

    // ---- 4) 如果有匹配，就把「最新一筆 pending/paying」改成 paid ----
    if (matched) {
      const now = Date.now();

      // 找最新還在 pending/paying 且沒過期的
      const cand = Object.values(orders)
        .filter((o) => (o.status === "pending" || o.status === "paying") && o.expiresAt > now)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (cand) {
        // 以 decimals 換算最小單位
        const need = BigInt(Math.round(cand.amount * (10 ** matched.decimals)));
        if (matched.valueBI >= need) {
          cand.status = "paid";
          cand.txHash = matched.txHash;
          console.log(
            "[PAID] order=%s token=%s need=%s got=%s tx=%s",
            cand.id,
            matched.symbol,
            need.toString(),
            matched.valueBI.toString(),
            cand.txHash
          );
          return res.status(200).send("ok");
        }
      }
    }

    // 沒關係，回 200 告訴 Alchemy 已接收（避免重試風暴）
    return res.status(200).send("no-op");
  } catch (e) {
    console.error("[HOOK] error", e);
    return res.status(500).send("error");
  }
});

// ！！！重點 2：其餘路由才開始用 JSON parser
app.use(express.json());

// ---- 訂單 API：建立、查詢 ----

// 建立訂單
app.post("/orders", (req, res) => {
  const { id, asset = "USDT", amount = 1 } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "missing id" });

  const now = Date.now();
  const expiresAt = now + ORDER_TTL_MIN * 60 * 1000;

  orders[id] = {
    id,
    asset,
    amount: Number(amount),
    status: "pending",
    createdAt: now,
    expiresAt
  };

  console.log("[ORDERS API] POST /orders -> ok order=%s %s %s", id, asset, amount);
  res.json({ ok: true, order: orders[id] });
});

// 查單
app.get("/orders/:id", (_req, res) => {
  const id = _req.params.id;
  const o = orders[id];
  if (!o) return res.status(404).json({ ok: false, error: "not found" });

  // 過期就標記 expired
  if (o.status !== "paid" && Date.now() > o.expiresAt) o.status = "expired";
  res.json({ ok: true, order: o });
});

// 手動取消（選擇性）
app.post("/orders/:id/cancel", (req, res) => {
  const id = req.params.id;
  const o = orders[id];
  if (!o) return res.status(404).json({ ok: false, error: "not found" });
  if (o.status === "paid") return res.status(400).json({ ok: false, error: "already paid" });
  o.status = "cancelled";
  res.json({ ok: true, order: o });
});

app.listen(PORT, () => {
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log("RECEIVING_ADDR =", RECEIVING_ADDR);
  console.log("ACCEPT_TOKENS =", [...ACCEPT_TOKENS].join(", "));
  console.log("MIN_CONF =", MIN_CONF, "ORDER_TTL_MIN=", ORDER_TTL_MIN);
});
// ================== end server.js ==================
