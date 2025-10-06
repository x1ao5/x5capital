// server.js — ESM 版
import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import { Pool } from 'pg';

const app  = express();
const PORT = process.env.PORT || 10000;

// ===== Admin Token（有設才啟用，建議設定） =====
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
function requireAdmin(req, res, next){
  if (!ADMIN_TOKEN) return next(); // 若沒設，就不做權限檢查
  const t = req.header('x-admin-token') || req.query.token || '';
  if (t === ADMIN_TOKEN) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// ===== Middleware（Webhook 要 raw body，其它用 JSON） =====
app.use((req, res, next) => { res.setHeader('ngrok-skip-browser-warning', 'true'); next(); });
app.use(cors({ origin: '*' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/webhook')) return next(); // 讓 webhook 維持 raw
  express.json({ limit: '1mb' })(req, res, next);
});

// ===== Postgres =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
async function withTx(fn){
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e){ await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

// ===== Consts =====
const RECEIVING_ADDR = (process.env.RECEIVING_ADDR || '').toLowerCase();
const MIN_CONF       = Number(process.env.MIN_CONFIRMATIONS || 0);
const ORDER_TTL_MIN  = Number(process.env.ORDER_TTL_MIN || 15);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

// ===================================================================
// Items（商品/庫存）
// ===================================================================
app.get('/items', async (req, res) => {
  const r = await pool.query(
    `SELECT id, sku, title, description, category, price, stock, img, sort_order
     FROM items
     ORDER BY sort_order NULLS LAST, id`
  );
  res.json({ items: r.rows });
});

app.post('/items/upsert', requireAdmin, async (req, res, next) => {
  try {
    const {
      id,
      sku: skuRaw,
      title,
      description = '',
      category = null,
      price = 0,
      stock = 0,
      img = null,
      sortOrder = null,
    } = req.body || {};

    if (!id || !title) return res.status(400).json({ error: 'id/title required' });

    const sku = (String(skuRaw ?? id)).trim(); // ★ 沒填就用 id

    const q = `
      INSERT INTO items (id, sku, title, description, category, price, stock, img, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE
        SET sku=EXCLUDED.sku,
            title=EXCLUDED.title,
            description=EXCLUDED.description,
            category=EXCLUDED.category,
            price=EXCLUDED.price,
            stock=EXCLUDED.stock,
            img=EXCLUDED.img,
            sort_order=EXCLUDED.sort_order
      RETURNING *`;
    const r = await pool.query(q, [id, sku, title, description, category, price, stock, img, sortOrder]);
    res.json({ item: r.rows[0] });
  } catch (e) { next(e); }
});

app.post('/items/:id/adjust', requireAdmin, async (req, res, next) => {
  try {
    const id    = req.params.id;
    const delta = Number(req.body?.delta || 0);
    const r = await pool.query(
      `UPDATE items SET stock = GREATEST(0, stock + $2) WHERE id=$1 RETURNING *`,
      [id, delta]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'item not found' });
    res.json({ item: r.rows[0] });
  } catch (e) { next(e); }
});

app.post('/items/:id/set-stock', requireAdmin, async (req, res, next) => {
  try {
    const id    = req.params.id;
    const stock = Math.max(0, Number(req.body?.stock || 0));
    const r = await pool.query(
      `UPDATE items SET stock = $2 WHERE id=$1 RETURNING *`,
      [id, stock]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'item not found' });
    res.json({ item: r.rows[0] });
  } catch (e) { next(e); }
});

// ==================== Items：進階管理 ====================

// 刪除商品（若被訂單引用會失敗 → 自動改為 stock=0 當作下架）
app.delete('/items/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const r = await pool.query(`DELETE FROM items WHERE id=$1`, [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'item not found' });
    return res.json({ ok: true, deleted: id });
  } catch (e) {
    // 多半是外鍵約束擋住（order_items 參考了它）
    await pool.query(`UPDATE items SET stock=0 WHERE id=$1`, [id]);
    return res.json({ ok: false, downgraded: id, note: 'item referenced by orders; set stock=0 instead' });
  }
});

// 調整排序（sort_order）
app.post('/items/:id/sort', requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const sortOrder = req.body?.sortOrder == null ? null : Number(req.body.sortOrder);
    const r = await pool.query(
      `UPDATE items SET sort_order=$2 WHERE id=$1 RETURNING *`,
      [id, sortOrder]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'item not found' });
    res.json({ item: r.rows[0] });
  } catch (e) { next(e); }
});

// 批次 upsert（陣列）
app.post('/items/bulk-upsert', requireAdmin, async (req, res, next) => {
  try {
    const arr = Array.isArray(req.body) ? req.body : [];
    const out = [];
    for (const it of arr) {
      const { id, title, description = '', category = null, price = 0, stock = 0, img = null, sortOrder = null } = it || {};
      if (!id || !title) continue;
      const q = `
        INSERT INTO items (id,title,description,category,price,stock,img,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO UPDATE
          SET title=EXCLUDED.title,
              description=EXCLUDED.description,
              category=EXCLUDED.category,
              price=EXCLUDED.price,
              stock=EXCLUDED.stock,
              img=EXCLUDED.img,
              sort_order=EXCLUDED.sort_order
        RETURNING *`;
      const r = await pool.query(q, [id, title, description, category, price, stock, img, sortOrder]);
      out.push(r.rows[0]);
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

// ===================================================================
// Orders（訂單）
// ===================================================================
app.post('/orders', async (req, res, next) => {
  const { id, asset = 'USDT', amount = 0, items = [] } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });

  try {
    const now = new Date();
    const exp = new Date(now.getTime() + ORDER_TTL_MIN * 60000);

    const order = await withTx(async (c) => {
      await c.query(
        `INSERT INTO orders (id, asset, amount, status, created_at, expires_at)
         VALUES ($1,$2,$3,'pending',$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [id, asset, amount, now, exp]
      );

      // 建單同時扣庫存＋寫 order_items（避免超賣）
      if (Array.isArray(items) && items.length > 0) {
        for (const it of items) {
          const itemId = it.id, qty = Number(it.qty || 0);
          if (!itemId || qty <= 0) continue;

          const row = await c.query(`SELECT stock FROM items WHERE id=$1 FOR UPDATE`, [itemId]);
          if (row.rowCount === 0) throw new Error(`item not found: ${itemId}`);
          if (row.rows[0].stock < qty) throw new Error(`insufficient stock for ${itemId}`);

          await c.query(`UPDATE items SET stock = stock - $2 WHERE id=$1`, [itemId, qty]);
          await c.query(
            `INSERT INTO order_items (order_id, item_id, qty) VALUES ($1,$2,$3)
             ON CONFLICT (order_id,item_id) DO UPDATE SET qty = order_items.qty + EXCLUDED.qty`,
            [id, itemId, qty]
          );
        }
      }

      const r = await c.query(
        `SELECT id, asset, amount, status, expires_at AS "expiresAt", tx_hash AS "txHash", network
         FROM orders WHERE id=$1`,
        [id]
      );
      return r.rows[0];
    });

    console.log('[ORDERS] created', id, asset, amount);
    res.json({ order });
  } catch (e) { next(e); }
});

app.get('/orders/:id', async (req, res) => {
  const id = req.params.id;
  const r  = await pool.query(
    `SELECT id, asset, amount, status, expires_at AS "expiresAt",
            tx_hash AS "txHash", network
     FROM orders WHERE id=$1`, [id]
  );
  if (r.rowCount === 0) return res.status(404).json({ error: 'order not found' });
  res.json({ order: r.rows[0] });
});

app.post('/orders/:id/cancel', async (req, res, next) => {
  const id = req.params.id;
  try {
    const o = await withTx(async (c) => {
      const q = await c.query(`SELECT status FROM orders WHERE id=$1 FOR UPDATE`, [id]);
      if (q.rowCount === 0) throw new Error('order not found');
      if (q.rows[0].status !== 'pending') return null;

      const items = await c.query(`SELECT item_id, qty FROM order_items WHERE order_id=$1`, [id]);
      for (const it of items.rows) {
        await c.query(`UPDATE items SET stock = stock + $2 WHERE id=$1`, [it.item_id, it.qty]);
      }
      await c.query(`UPDATE orders SET status='cancelled', cancelled_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);

      const r = await c.query(
        `SELECT id, asset, amount, status, expires_at AS "expiresAt", tx_hash AS "txHash", network
         FROM orders WHERE id=$1`, [id]
      );
      return r.rows[0];
    });
    if (!o) return res.json({ ok: true, note: 'not pending' });
    res.json({ order: o });
  } catch (e) { next(e); }
});

// 掃描逾期訂單並退庫存（建議搭配 Cron Job）
app.post('/orders/sweep-expired', requireAdmin, async (req, res, next) => {
  try {
    const affected = await withTx(async (c) => {
      const q = await c.query(
        `SELECT id FROM orders
         WHERE status='pending' AND NOW() > expires_at
         FOR UPDATE`
      );
      for (const row of q.rows) {
        const items = await c.query(`SELECT item_id, qty FROM order_items WHERE order_id=$1`, [row.id]);
        for (const it of items.rows) {
          await c.query(`UPDATE items SET stock = stock + $2 WHERE id=$1`, [it.item_id, it.qty]);
        }
        await c.query(`UPDATE orders SET status='expired', updated_at=NOW() WHERE id=$1`, [row.id]);
      }
      return q.rowCount;
    });
    res.json({ expired: affected });
  } catch (e) { next(e); }
});

// ==================== Orders：查詢/明細 ====================

// 訂單列表（管理用）：?status=pending|paid|cancelled|expired&q=keyword&limit=50&offset=0
app.get('/orders/admin', requireAdmin, async (req, res, next) => {
  try {
    const { status = null, q = null, limit = 50, offset = 0 } = req.query;
    const r = await pool.query(
      `SELECT id, asset, amount, status, tx_hash AS "txHash", network,
              created_at, updated_at, paid_at, cancelled_at, expires_at AS "expiresAt"
       FROM orders
       WHERE ($1::text IS NULL OR status=$1::text)
         AND ($2::text IS NULL OR id ILIKE '%'||$2::text||'%')
       ORDER BY created_at DESC
       LIMIT LEAST($3::int, 200) OFFSET GREATEST($4::int, 0)`,
      [status, q, Number(limit), Number(offset)]
    );
    res.json({ orders: r.rows });
  } catch (e) { next(e); }
});

// 訂單明細（items）
app.get('/orders/:id/items', requireAdmin, async (req, res, next) => {
  try {
    const id = req.params.id;
    const r = await pool.query(
      `SELECT oi.item_id AS "itemId", oi.qty, i.title, i.price
       FROM order_items oi
       LEFT JOIN items i ON i.id = oi.item_id
       WHERE oi.order_id=$1`,
      [id]
    );
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

// ===================================================================
// Webhook（Alchemy）— 同時嘗試 raw 與除精度兩種解讀
// ===================================================================
app.post('/webhook/alchemy', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody  = req.body; // Buffer
    const sig  = req.header('X-Alchemy-Signature') || '';
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    if (sig !== hmac) { console.log('[HOOK] invalid signature'); return res.status(401).end(); }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const acts = payload?.event?.activity || [];

    for (const a of acts) {
      const to = (a.toAddress || '').toLowerCase();
      if (!to || to !== RECEIVING_ADDR) continue;

      const confs = Number(a?.extraInfo?.confirmations || 0);
      if (confs < MIN_CONF) continue;

      const tokenAddr = (a.rawContract?.address || '').toLowerCase();
      const isUSDT    = tokenAddr === '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'; // USDT (Arbitrum)
      const isETH     = !tokenAddr || tokenAddr === '0x0000000000000000000000000000000000000000';

      const raw = Number(a.value || 0);
      let candidates = [];
      if (isUSDT) candidates = [raw, raw / 1e6];
      else if (isETH) candidates = [raw, raw / 1e18];
      else continue;

      const asset   = isUSDT ? 'USDT' : 'ETH';
      const txhash  = a.hash;
      const network = (payload?.event?.network || '').toUpperCase();

      let updated = false;
      for (const amt of candidates) {
        const amountStr = String(amt);
        updated = await withTx(async (c) => {
          let q = await c.query(
            `SELECT id FROM orders
             WHERE status='pending' AND asset=$1 AND amount::numeric = $2::numeric
               AND NOW() <= expires_at
             ORDER BY created_at DESC
             LIMIT 1 FOR UPDATE`,
            [asset, amountStr]
          );
          if (q.rowCount === 0) {
            q = await c.query(
              `SELECT id FROM orders
               WHERE status='pending' AND asset=$1
                 AND ROUND(amount::numeric,2) = ROUND($2::numeric,2)
                 AND NOW() <= expires_at
               ORDER BY created_at DESC
               LIMIT 1 FOR UPDATE`,
              [asset, amountStr]
            );
          }
          if (q.rowCount === 0) {
            q = await c.query(
              `SELECT id FROM orders
               WHERE status='pending' AND asset=$1
                 AND ABS(amount::numeric - $2::numeric) <= 0.01
                 AND NOW() <= expires_at
               ORDER BY created_at DESC
               LIMIT 1 FOR UPDATE`,
              [asset, amountStr]
            );
          }
          if (q.rowCount === 0) return false;

          const id = q.rows[0].id;
          await c.query(
            `UPDATE orders
               SET status='paid', tx_hash=$2, network=$3, paid_at=NOW(), updated_at=NOW()
             WHERE id=$1`,
            [id, txhash, network]
          );
          return true;
        });
        if (updated) { console.log('✅ HOOK PAID', asset, amountStr, '(raw:', raw, ')', txhash); break; }
      }
      if (!updated) console.log('⚠️ HOOK no match', asset, raw, '(tried:', candidates.join(' | '), ')', txhash);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('HOOK error', err);
    res.status(500).end();
  }
});

// ===================================================================
// Misc
// ===================================================================
app.get('/orders/debug-latest', async (req, res) => {
  const r = await pool.query(
    `SELECT id, asset, amount, status, expires_at, created_at
     FROM orders ORDER BY created_at DESC LIMIT 10`
  );
  res.json(r.rows);
});

app.get('/', (_, res) => res.send('x5 backend live'));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: String(err.message || err) }); });

app.listen(PORT, () => console.log('listening on', PORT));


