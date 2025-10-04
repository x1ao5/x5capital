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

// 放在任何 app.use(express.json()) 之前！
app.post("/webhook/alchemy", express.raw({ type: "*/*" }), (req, res) => {
  try {
    if (!WEBHOOK_SECRET) return res.status(500).send("server missing secret");

    // 1) 驗簽
    const sig = req.header("x-alchemy-signature") || "";
    const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const digest = crypto.createHmac("sha256", WEBHOOK_SECRET).update(bodyBuf).digest("hex");
    if (!(sig === digest || sig === `sha256=${digest}`)) {
      console.log("[HOOK] invalid signature");
      return res.status(401).send("invalid signature");
    }

    // 2) 解析 payload（不同版本欄位名稱都涵蓋）
    const payload = JSON.parse(bodyBuf.toString("utf8"));
    const activities =
      payload?.event?.activities ||
      payload?.data?.event?.activity ||
      payload?.activity ||
      [];

    // 3) 幫手：從 rawLog 解 ERC20 Transfer
    const getFromRawLog = (a) => {
      const raw = a.rawLog || a.log || a.rawContract || {};
      const topics = raw.topics || raw.rawLogTopics || [];
      const dataHex = (raw.data || raw.rawLogData || "").toLowerCase();

      if (!topics || topics.length < 3 || !dataHex?.startsWith("0x")) return null;

      // topics[2] 的最後 20 bytes 是 to 地址
      const toHex = topics[2].toLowerCase().replace(/^0x/, "");
      const to = ("0x" + toHex.slice(-40)).toLowerCase();

      let valueBI = 0n;
      try { valueBI = BigInt(dataHex); } catch { valueBI = 0n; }

      const tokenAddr = (raw.address || "").toLowerCase();
      return { to, valueBI, tokenAddr };
    };

    // 4) 嘗試找出一筆「打到我們地址的 USDT 入帳」
    let match = null;

    for (const a of activities) {
      // 先讀較高階欄位
      const toAddr =
        (a.toAddress || a.to || a.toAddressRaw || "").toLowerCase();

      const tokenAddrHigh =
        (
          a.rawContract?.address ||
          a.contractAddress ||
          a.erc20?.contractAddress ||
          a.asset_contract?.address ||
          ""
        ).toLowerCase();

      // decimals / symbol（抓不到就給 USDT 6）
      const decimals =
        a.erc20Metadata?.decimals ??
        a.decimals ??
        6;
      const symbol =
        (a.erc20Metadata?.symbol || a.asset?.symbol || a.symbol || "USDT").toUpperCase();

      // 數量（先從高階欄位；抓不到再從 rawLog）
      let valueBI = 0n;
      if (a.value != null || a.rawValue != null || a.erc20Transfer?.value != null) {
        const vStr = String(a.value ?? a.rawValue ?? a.erc20Transfer?.value);
        try { valueBI = BigInt(vStr); } catch { valueBI = 0n; }
      }

      // 若 still 取不到，就解析 rawLog
      if (valueBI === 0n || !toAddr || !tokenAddrHigh) {
        const raw = getFromRawLog(a);
        if (raw) {
          // 用 rawLog 取到的覆蓋
          const token = raw.tokenAddr || tokenAddrHigh;
          const to = raw.to || toAddr;
          valueBI = raw.valueBI || valueBI;

          if (to && token) {
            const isMyTo = to === RECEIVING_ADDR;
            const allowed = ACCEPT_TOKENS.has(token.toLowerCase());
            if (isMyTo && allowed && valueBI > 0n) {
              match = { valueBI, decimals, symbol, txHash: a.hash || a.transactionHash || "" };
              break;
            }
          }
        }
      }

      // 已有高階欄位就先比對一次
      if (!match && toAddr && tokenAddrHigh) {
        const isMyTo = toAddr === RECEIVING_ADDR;
        const allowed = ACCEPT_TOKENS.has(tokenAddrHigh);
        if (isMyTo && allowed && valueBI > 0n) {
          match = { valueBI, decimals, symbol, txHash: a.hash || a.transactionHash || "" };
          break;
        }
      }
    }

    // 5) 更新訂單狀態
    if (match) {
      const now = Date.now();
      const cand = Object.values(orders)
        .filter(o => (o.status === "pending" || o.status === "paying") && o.expiresAt > now)
        .sort((a, b) => b.createdAt - a.createdAt)[0];

      if (cand) {
        // 用 BigInt 10^decimals 換算需求金額
        const need = BigInt(Math.round(cand.amount)) * (10n ** BigInt(match.decimals));
        if (match.valueBI >= need) {
          cand.status = "paid";
          cand.txHash = match.txHash;
          console.log("[PAID] order=%s need=%s got=%s tx=%s", cand.id, need.toString(), match.valueBI.toString(), cand.txHash);
          return res.status(200).send("ok");
        } else {
          console.log("[HOOK] amount not enough need=%s got=%s", need.toString(), match.valueBI.toString());
        }
      } else {
        console.log("[HOOK] no pending order to match");
      }
    } else {
      // 觀察 payload 方便 debug
      console.log("[HOOK] no match in activities, sample=", JSON.stringify(activities?.[0] || {}, null, 2));
    }

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

