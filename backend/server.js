// server.js — DB 版
require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const cors    = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app  = express();
const PORT = process.env.PORT || 10000;

// ---- CORS/JSON 注意：webhook 需要 raw body 驗簽，所以只對其它路徑用 JSON ----
app.use((req,res,next)=>{
  res.setHeader('ngrok-skip-browser-warning','true');
  next();
});
app.use(cors({ origin: '*'}));
app.use((req,res,next)=>{
  if (req.path.startsWith('/webhook')) return next(); // 留給 raw-body
  bodyParser.json({ limit:'1mb' })(req,res,next);
});

// ---- Postgres ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : false
});
async function withTx(fn){
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch(err){ await c.query('ROLLBACK'); throw err; }
  finally{ c.release(); }
}

// ---- 參數/常數 ----
const RECEIVING_ADDR = (process.env.RECEIVING_ADDR || '').toLowerCase();
const MIN_CONF       = Number(process.env.MIN_CONFIRMATIONS || 0);
const ORDER_TTL_MIN  = Number(process.env.ORDER_TTL_MIN || 15);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''; // Alchemy Signing Key

// ====== Items（庫存管理）======
// 取得全部商品（前台或後台都可用）
app.get('/items', async (req,res)=>{
  const r = await pool.query(
    `SELECT id, title, description, category, price, stock, img, sort_order
     FROM items ORDER BY sort_order NULLS LAST, id`
  );
  res.json({ items: r.rows });
});

// 新增/更新商品（補登資料或改價、改圖）
app.post('/items/upsert', async (req,res,next)=>{
  try{
    const { id, title, description='', category=null, price=0, stock=0, img=null, sortOrder=null } = req.body||{};
    if(!id || !title) return res.status(400).json({ error:'id/title required' });

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
    const r = await pool.query(q,[id,title,description,category,price,stock,img,sortOrder]);
    res.json({ item:r.rows[0] });
  }catch(e){ next(e); }
});

// 調整庫存（補貨/減庫存）：delta 可正可負，最少 0
app.post('/items/:id/adjust', async (req,res,next)=>{
  try{
    const id    = req.params.id;
    const delta = Number(req.body?.delta||0);
    const r = await pool.query(
      `UPDATE items SET stock = GREATEST(0, stock + $2) WHERE id=$1 RETURNING *`,
      [id, delta]
    );
    if (r.rowCount===0) return res.status(404).json({ error:'item not found' });
    res.json({ item:r.rows[0] });
  }catch(e){ next(e); }
});

// 直接設定庫存為某值
app.post('/items/:id/set-stock', async (req,res,next)=>{
  try{
    const id    = req.params.id;
    const stock = Math.max(0, Number(req.body?.stock||0));
    const r = await pool.query(
      `UPDATE items SET stock = $2 WHERE id=$1 RETURNING *`,
      [id, stock]
    );
    if (r.rowCount===0) return res.status(404).json({ error:'item not found' });
    res.json({ item:r.rows[0] });
  }catch(e){ next(e); }
});

// ====== Orders（訂單）======
// 建單：可只傳 {id, asset, amount}（維持前端相容），也可加 items:[{id,qty},...]
// 若帶 items，會檢查庫存並扣減
app.post('/orders', async (req,res,next)=>{
  const { id, asset='USDT', amount=0, items=[] } = req.body||{};
  if(!id) return res.status(400).json({ error:'id required' });

  try{
    const now = new Date();
    const exp = new Date(now.getTime() + ORDER_TTL_MIN*60000);

    const order = await withTx(async (c)=>{
      // 1) 新建訂單（若已存在就直接回舊資料）
      const ins = await c.query(
        `INSERT INTO orders (id, asset, amount, status, created_at, expires_at)
         VALUES ($1,$2,$3,'pending',$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [id, asset, amount, now, exp]
      );

      // 2) 若有 items：確認庫存、扣庫存、寫入 order_items
      if (Array.isArray(items) && items.length>0){
        for (const it of items){
          const itemId = it.id, qty = Number(it.qty||0);
          if (!itemId || qty<=0) continue;

          // 鎖定該商品的列，避免超賣
          const row = await c.query(`SELECT stock FROM items WHERE id=$1 FOR UPDATE`, [itemId]);
          if (row.rowCount===0) throw new Error(`item not found: ${itemId}`);
          const stock = row.rows[0].stock;
          if (stock < qty) throw new Error(`insufficient stock for ${itemId}`);

          await c.query(`UPDATE items SET stock = stock - $2 WHERE id=$1`, [itemId, qty]);
          await c.query(
            `INSERT INTO order_items (order_id, item_id, qty) VALUES ($1,$2,$3)
             ON CONFLICT (order_id,item_id) DO UPDATE SET qty = order_items.qty + EXCLUDED.qty`,
            [id, itemId, qty]
          );
        }
      }

      const r = await c.query(`SELECT id, asset, amount, status, expires_at AS "expiresAt", tx_hash AS "txHash", network
                               FROM orders WHERE id=$1`, [id]);
      return r.rows[0];
    });

    res.json({ order });
  }catch(e){ next(e); }
});

// 查單
app.get('/orders/:id', async (req,res)=>{
  const id = req.params.id;
  const r  = await pool.query(
    `SELECT id, asset, amount, status, expires_at AS "expiresAt",
            tx_hash AS "txHash", network
     FROM orders WHERE id=$1`, [id]
  );
  if (r.rowCount===0) return res.status(404).json({ error:'order not found' });
  res.json({ order: r.rows[0] });
});

// 取消訂單（只允許 pending，並把庫存加回）
app.post('/orders/:id/cancel', async (req,res,next)=>{
  const id = req.params.id;
  try{
    const o = await withTx(async (c)=>{
      const q = await c.query(`SELECT status FROM orders WHERE id=$1 FOR UPDATE`, [id]);
      if (q.rowCount===0) throw new Error('order not found');
      if (q.rows[0].status!=='pending') return null;

      const items = await c.query(`SELECT item_id, qty FROM order_items WHERE order_id=$1`, [id]);
      for (const it of items.rows){
        await c.query(`UPDATE items SET stock = stock + $2 WHERE id=$1`, [it.item_id, it.qty]);
      }
      await c.query(`UPDATE orders SET status='cancelled', cancelled_at=NOW() WHERE id=$1`, [id]);

      const r = await c.query(
        `SELECT id, asset, amount, status, expires_at AS "expiresAt", tx_hash AS "txHash", network
         FROM orders WHERE id=$1`, [id]
      );
      return r.rows[0];
    });
    if (!o) return res.json({ ok:true, note:'not pending' });
    res.json({ order:o });
  }catch(e){ next(e); }
});

// 前端「我已完成轉帳」通知（可選）
app.post('/orders/:id/confirm', async (req,res)=>{
  res.json({ ok:true }); // 我們用 webhook 實際判斷
});

// ====== Webhook：Alchemy Address Activity ======
// 注意：一定要 raw body 驗簽
app.post('/webhook/alchemy', express.raw({type:'application/json'}), async (req,res)=>{
  try{
    const raw   = req.body;                // Buffer
    const sig   = req.header('X-Alchemy-Signature') || '';
    const hmac  = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
    if (sig !== hmac) { console.log('[HOOK] invalid signature'); return res.status(401).end(); }

    const payload = JSON.parse(raw.toString('utf8'));
    const acts = payload?.event?.activity || [];

    for (const a of acts){
      // 只看「入帳到我們收款位址」的 log
      const to   = (a.toAddress||'').toLowerCase();
      const from = (a.fromAddress||'').toLowerCase();
      if (!to || to !== RECEIVING_ADDR) continue;

      const confs = Number(a?.extraInfo?.confirmations || 0);
      if (confs < MIN_CONF) continue; // 等待足夠確認數

      const tokenAddr = (a.rawContract?.address||'').toLowerCase();
      const isUSDT    = tokenAddr === '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
      const isETH     = !tokenAddr || tokenAddr === '0x0000000000000000000000000000000000000000';

      // 取金額（USDT 6 decimals、ETH 18 decimals）
      let amount = '0';
      if (isUSDT) amount = String(Number(a.value || 0) / 1e6);
      else if (isETH) amount = String(Number(a.value || 0) / 1e18);
      else continue;

      const asset  = isUSDT ? 'USDT' : 'ETH';
      const txhash = a.hash;
      const network= (payload?.event?.network || '').toUpperCase();

      // 用 amount + status=pending 去配對最新一張訂單（也可改成你把 orderId 放在 memo 來配對）
      await withTx(async (c)=>{
        const q = await c.query(
          `SELECT id FROM orders
            WHERE status='pending' AND asset=$1 AND amount::numeric = $2::numeric
              AND NOW() <= expires_at
            ORDER BY created_at DESC
            LIMIT 1 FOR UPDATE`,
          [asset, amount]
        );
        if (q.rowCount===0) return;

        const id = q.rows[0].id;
        await c.query(`UPDATE orders SET status='paid', tx_hash=$2, network=$3, paid_at=NOW() WHERE id=$1`, [id, txhash, network]);
      });

      console.log('✅ HOOK PAID', asset, amount, a.hash);
    }
    res.json({ ok:true });
  }catch(err){
    console.error('HOOK error', err);
    res.status(500).end();
  }
});

// ====== misc ======
app.get('/', (_,res)=>res.send('x5 backend live'));
app.use((err,req,res,next)=>{
  console.error(err);
  res.status(500).json({ error: String(err.message||err) });
});

app.listen(PORT, ()=>console.log('listening on', PORT));
