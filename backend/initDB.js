// initDB.js — 一次性建表/補表，對齊 server.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const sql = `
-- ============ ITEMS（商品）============
CREATE TABLE IF NOT EXISTS items (
  id         TEXT PRIMARY KEY,                 -- 與後端一致的文字型 ID
  title      TEXT NOT NULL,
  description TEXT DEFAULT '',
  category   TEXT,
  price      NUMERIC(10,2) NOT NULL,
  stock      INT NOT NULL DEFAULT 0,
  img        TEXT,
  sort_order INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============ ORDERS（訂單）============
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,               -- order-xxxxx
  asset        TEXT NOT NULL DEFAULT 'USDT',   -- USDT / ETH
  amount       NUMERIC(10,2) NOT NULL,         -- 應收金額
  status       TEXT NOT NULL DEFAULT 'pending',-- pending/paid/cancelled/expired
  tx_hash      TEXT,
  network      TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW(),
  expires_at   TIMESTAMP,                      -- 逾期時間（前端倒數）
  cancelled_at TIMESTAMP,
  paid_at      TIMESTAMP
);

-- ============ ORDER_ITEMS（訂單明細，用來退/扣庫存）============
CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_id  TEXT NOT NULL REFERENCES items(id),
  qty      INT  NOT NULL DEFAULT 1,
  PRIMARY KEY (order_id, item_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_expires ON orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX IF NOT EXISTS idx_items_sort     ON items(sort_order);
`;

(async () => {
  try {
    await db.query(sql);
    console.log('✅ tables ready (aligned with server.js)');
  } catch (e) {
    console.error('❌ init error', e);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
