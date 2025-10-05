// server.js  —— X5 backend (Render friendly, with rich logs)

import 'dotenv/config.js';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

const PORT              = process.env.PORT || 10000;
const RECEIVING_ADDR    = (process.env.RECEIVING_ADDR || '').toLowerCase();
const WEBHOOK_SECRET    = process.env.WEBHOOK_SECRET || '';
const ACCEPT_TOKENS     = process.env.ACCEPT_TOKENS || 'NATIVE:eth,ERC20:usdt';
const MIN_CONFIRMATIONS = Number(process.env.MIN_CONFIRMATIONS || '0');
const ORDER_TTL_MIN     = Math.max(1, Number(process.env.ORDER_TTL_MIN || '15')); // 最少 1 分鐘

// ──────────────────────────────────────────────────────────────────────────────
// 小工具
// ──────────────────────────────────────────────────────────────────────────────
const nowSec = () => Math.floor(Date.now() / 1000);
const ttlSec = ORDER_TTL_MIN * 60;
const ok  = (res, data) => res.json(data);
const err = (res, code, message) => res.status(code).json({ error: message });

const tag = (t, ...msg) => console.log(`[${t}]`, ...msg);

// In-memory 訂單（Render Free 會睡覺，僅用於展示）
const Orders = new Map();

// 讀取最新 pending 訂單（你要更精準對單時，可改用 id 或 amount 比對）
const latestPending = () => {
  const arr = [...Orders.values()].filter(o => o.status === 'pending');
  arr.sort((a,b) => b.createdAt - a.createdAt);
  return arr[0] || null;
};

// 過期檢查（每次 API 讀取/建立時都會順手處理）
const sweepExpired = () => {
  const now = nowSec();
  for (const o of Orders.values()) {
    if (o.status === 'pending' && o.expiresAt <= now) {
      o.status = 'expired';
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// ！！！一定要在任何 JSON 解析前，放原始 body 的 webhook route！！！
// ──────────────────────────────────────────────────────────────────────────────
const app = express();

app.post('/webhook/alchemy', express.raw({ type: '*/*' }), (req, res) => {
  try {
    // 驗簽
    const sigHeader = req.get('x-alchemy-signature') || '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    const digest = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    const isMatch = (sigHeader === digest || sigHeader === `sha256=${digest}`);
    tag('HOOK HIT', req.method, req.url, 'sigOK=', isMatch);

    if (!isMatch) {
      tag('HOOK', 'invalid signature');
      return res.status(401).send('invalid signature');
    }

    const payload = JSON.parse(raw.toString('utf8'));
    const evt  = payload?.event || {};
    const acts = evt.activity || evt.activities || [];

    // 紀錄一份漂亮的摘要，方便你在 Render Logs 觀察
    tag('HOOK OK', {
      network   : evt.network || evt.eventNetwork || 'unknown',
      type      : evt.eventType || 'unknown',
      activities: acts.length
    });

    // 嘗試逐筆活動比對
    for (const a of acts) {
      const to        = (a?.toAddress || a?.to || '').toLowerCase();
      const decimals  = Number(a?.decimals ?? 6);
      const valueRaw  = Number(a?.value ?? a?.amount ?? 0);
      const amount    = valueRaw / Math.pow(10, isFinite(decimals) ? decimals : 6);
      const confs     = Number(a?.confirmations ?? 0);
      const txHash    = a?.hash || a?.txHash || a?.transactionHash || '';
      const tokenAddr = (a?.rawContract?.address || a?.contractAddress || '').toLowerCase();

      // 只處理匯入到我們的收款地址 + 確認數符合 + 有金額
      if (to === RECEIVING_ADDR && confs >= MIN_CONFIRMATIONS && amount > 0) {
        const p = latestPending();

        // 你想要更嚴格對單，可改成：p && Math.abs(p.amount - amount) < 1e-9
        if (p) {
          p.status  = 'paid';
          p.paidAt  = nowSec();
          p.txHash  = txHash;
          p.token   = tokenAddr;
          tag('ORDER', `auto match -> ${p.id} set to PAID (amount=${amount}, confs=${confs}, tx=${txHash})`);
        } else {
          tag('ORDER', 'no pending order to match, skip');
        }
      }
    }

    return res.status(200).send('ok');
  } catch (e) {
    console.error('[HOOK ERROR]', e);
    return res.status(500).send('error');
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// 其餘中介與 API
// ──────────────────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// 健康檢查
app.get('/health', (req, res) => res.status(200).send('ok'));

// 安全環境檢視（不返回敏感值）
app.get('/env', (req, res) => {
  res.json({
    PORT: String(PORT),
    RECEIVING_ADDR,
    ACCEPT_TOKENS,
    MIN_CONFIRMATIONS,
    ORDER_TTL_MIN,
    has_WEBHOOK_SECRET: WEBHOOK_SECRET ? true : false
  });
});

// 建立訂單
app.post('/orders', (req, res) => {
  sweepExpired();
  const { id, asset, amount } = req.body || {};
  if (!id)     return err(res, 400, 'id required');
  if (!asset)  return err(res, 400, 'asset required');
  if (!amount) return err(res, 400, 'amount required');

  const exists = Orders.get(id);
  if (exists) return ok(res, exists);

  const now = nowSec();
  const order = {
    id,
    asset,
    amount: Number(amount),
    status: 'pending',
    createdAt: now,
    expiresAt: now + ttlSec,
    txHash: null
  };
  Orders.set(order.id, order);
  tag('ORDERS API', 'POST /orders -> ok', order.id, asset, amount);
  return ok(res, order);
});

// 查單
app.get('/orders/:id', (req, res) => {
  sweepExpired();
  const o = Orders.get(req.params.id);
  if (!o) return err(res, 404, 'not found');
  return ok(res, o);
});

// 取消
app.post('/orders/:id/cancel', (req, res) => {
  const o = Orders.get(req.params.id);
  if (!o) return err(res, 404, 'not found');
  if (o.status === 'pending') o.status = 'cancelled';
  return ok(res, o);
});

// 前端手動確認（開發測試方便用）
app.post('/orders/:id/confirm', (req, res) => {
  const o = Orders.get(req.params.id);
  if (!o) return err(res, 404, 'not found');
  o.status = 'paid';
  o.paidAt = nowSec();
  return ok(res, o);
});

// 404
app.use((req, res) => err(res, 404, 'not found'));

// 啟動
app.listen(PORT, () => {
  console.log('////////////////////////////////////////////////////////////');
  console.log('x5 backend listening on http://localhost:' + PORT);
  console.log('RECEIVING_ADDR =', RECEIVING_ADDR || '(not set)');
  console.log('ACCEPT_TOKENS  =', ACCEPT_TOKENS);
  console.log('MIN_CONF       =', MIN_CONFIRMATIONS, '  ORDER_TTL_MIN =', ORDER_TTL_MIN);
  console.log('==> Available at your primary URL after deploy (Render)');
  console.log('////////////////////////////////////////////////////////////');
});
