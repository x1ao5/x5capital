// server.js  — 完整版（可直接覆蓋）
// ---------------------------------

import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

// ====== 環境變數 ======
const PORT = process.env.PORT || 10000;

const RECEIVING_ADDR   = (process.env.RECEIVING_ADDR || '').toLowerCase(); // 你的收款地址
const WEBHOOK_SECRET   = process.env.WEBHOOK_SECRET || '';                 // Alchemy Signing Key
const ACCEPT_TOKENS    = process.env.ACCEPT_TOKENS || 'NATIVE:eth,ERC20:usdt';
const MIN_CONFIRMATIONS= Number(process.env.MIN_CONFIRMATIONS || '0');
const ORDER_TTL_MIN    = Number(process.env.ORDER_TTL_MIN || '15');
const CORS_ALLOW       = process.env.CORS_ALLOW || '*';

// ====== 記憶體訂單（開發用；上線請換 DB）======
/** @type {Map<string, any>} */
const Orders = new Map();

// 小工具
const ok = (res, data) => res.json(data);
const nowSec = () => Math.floor(Date.now() / 1000);

// ====== 建立 app ======
const app = express();

// 1) **Webhook 一定要在所有 body parser 之前，用 raw()**
// ---------------------------------------------------------
app.post('/webhook/alchemy', express.raw({ type: '*/*' }), (req, res) => {
  try {
    // 驗簽
    const sig = req.get('x-alchemy-signature') || '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const matches = (sig === digest || sig === `sha256=${digest}`);

    if (!matches) {
      console.log('[HOOK] invalid signature');
      return res.status(401).send('invalid signature');
    }

    // 直接完整打印 payload，方便你截圖給我
    const payload = JSON.parse(raw.toString('utf8'));
    console.log('\n========== [HOOK RAW PAYLOAD] ==========');
    console.log(JSON.stringify(payload, null, 2));
    console.log('========================================\n');

    // ---- 以下是「嘗試解析」並列印摘要（仍以 debug 為主）----
    // Alchemy「Address Activity」常見結構：payload.event.activity 或 payload.event.activities
    const evt = payload?.event || {};
    const acts = evt.activity || evt.activities || [];
    if (!Array.isArray(acts) || acts.length === 0) {
      console.log('[HOOK] no activity items in event');
      return res.status(200).send('ok'); // 仍回 200，避免被重送
    }

    for (const a of acts) {
      // 常見欄位（會因鏈或版本不同而異；所以 else 會另印原始資料）
      const to        = (a?.toAddress || a?.to || '').toLowerCase();
      const from      = (a?.fromAddress || a?.from || '').toLowerCase();
      const tokenSym  = a?.asset?.symbol || a?.symbol || a?.rawContract?.symbol || '';
      const tokenAddr = (a?.asset?.address || a?.contractAddress || a?.rawContract?.address || '').toLowerCase();
      // 金額：有的放 decimals/ value，有的放 amount / value，故多種兜底
      const decimals  = Number(a?.asset?.decimals ?? a?.decimals ?? 6);
      const valueRaw  = a?.value ?? a?.valueRaw ?? a?.amount ?? 0;
      const amount    = typeof valueRaw === 'string'
        ? (Number(valueRaw) / Math.pow(10, decimals))
        : Number(valueRaw);

      const confs     = Number(a?.confirmations ?? a?.log?.confirmations ?? 0);
      const txHash    = a?.hash || a?.txHash || a?.transactionHash || '';

      const matchTo   = to === RECEIVING_ADDR;
      console.log('[HOOK OK]',
        JSON.stringify({
          to, from, tokenSym, tokenAddr, amount, decimals, confs, txHash,
          network: evt?.network, eventType: evt?.eventType || payload?.type || 'unknown',
          matchToReceiving: matchTo
        }, null, 2)
      );

      // 這段仍只做示範：若你想要「自動對單」，可在此用金額/txHash/訂單建立時間去匹配 pending 訂單
      // === DEMO: 若轉到我方地址、確認數 >= MIN_CONFIRMATIONS，就把**最近的 pending**改成 paid ===
      if (matchTo && confs >= MIN_CONFIRMATIONS && amount > 0) {
        const pending = [...Orders.values()]
          .filter(o => o.status === 'pending' && (nowSec() - o.createdAt) <= (ORDER_TTL_MIN * 60))
          .sort((a, b) => b.createdAt - a.createdAt)[0];

        if (pending) {
          pending.status = 'paid';
          pending.paidTx = txHash || '(no-txHash)';
          pending.paidAt = nowSec();
          console.log(`[ORDER] auto match -> ${pending.id} set to PAID (amount=${amount}, tx=${txHash})`);
        }
      }
    }

    return res.status(200).send('ok');
  } catch (err) {
    console.error('[HOOK ERROR]', err);
    return res.status(500).send('error');
  }
});

// 2) 其餘路由再來用 JSON parser
// -----------------------------
app.use(express.json());
app.use(cors({
  origin: (origin, cb) => cb(null, true), // 開發方便；上線可改成 CORS_ALLOW 白名單
  credentials: true
}));

// ====== 訂單 API（簡版開發用）======

// 建立訂單：POST /orders  { id, asset, amount }
app.post('/orders', (req, res) => {
  try {
    const { id, asset, amount } = req.body || {};
    if (!id || !asset || !amount) return res.status(400).json({ error: 'id/asset/amount required' });

    const order = {
      id: String(id),
      asset: String(asset).toUpperCase(), // USDT / ETH
      amount: Number(amount),
      status: 'pending',
      createdAt: nowSec(),
      expiresAt: nowSec() + ORDER_TTL_MIN * 60
    };
    Orders.set(order.id, order);
    console.log(`[ORDERS API] POST /orders -> ok order=${order.id} ${order.asset} ${order.amount}`);
    return ok(res, order);
  } catch (e) {
    console.error('[ORDERS API] POST /orders error', e);
    return res.status(500).json({ error: 'server error' });
  }
});

// 查單：GET /orders/:id
app.get('/orders/:id', (req, res) => {
  const id = req.params.id;
  const o = Orders.get(id);
  if (!o) return res.status(404).json({ error: 'not found' });
  return ok(res, o);
});

// 手動標記已付（開發用）：POST /orders/:id/confirm
app.post('/orders/:id/confirm', (req, res) => {
  const id = req.params.id;
  const o = Orders.get(id);
  if (!o) return res.status(404).json({ error: 'not found' });
  o.status = 'paid';
  o.paidAt = nowSec();
  console.log(`[ORDERS API] confirm -> ${o.id} set to PAID (manual)`);
  return ok(res, o);
});

// 健康檢查
app.get('/health', (_req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log('//////////////////////////////////////////////////////');
  console.log(`x5 backend listening on http://localhost:${PORT}`);
  console.log('RECEIVING_ADDR =', RECEIVING_ADDR);
  console.log('ACCEPT_TOKENS  =', ACCEPT_TOKENS);
  console.log('MIN_CONF_      =', MIN_CONFIRMATIONS, ' ORDER_TTL_MIN=', ORDER_TTL_MIN);
  console.log('//////////////////////////////////////////////////////\n');
});
