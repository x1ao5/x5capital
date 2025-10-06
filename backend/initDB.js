// initDB.js  —— 一次性建表腳本
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = `
-- 商品表：items
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,                -- 你自訂的商品識別碼
  name TEXT NOT NULL,
  price_usdt NUMERIC(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 訂單表：orders
CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,               -- 我們用你的 order-xxxxxxxx 當主鍵
  item_id INT REFERENCES items(id),
  amount_usdt NUMERIC(10,2) NOT NULL,      -- 訂單應收金額
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/paid/cancelled/expired
  tx_hash TEXT,                            -- 區塊鏈交易哈希
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP                     -- 逾期時間（前端倒數就是它）
);

-- 一些索引用來加速查詢
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_expires ON orders(expires_at);
`;

(async () => {
  try {
    await db.query(sql);
    console.log('✅ tables ready');
  } catch (e) {
    console.error('❌ init error', e);
  } finally {
    await db.end();
  }
})();
