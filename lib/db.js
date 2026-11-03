// lib/db.js — one query helper for Neon (production) or a local Postgres (testing)
import { neon } from '@neondatabase/serverless';

let runner = null;
async function getRunner() {
  if (runner) return runner;
  if (process.env.LOCAL_PG) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({ connectionString: process.env.LOCAL_PG });
    runner = async (text, params = []) => (await pool.query(text, params)).rows;
  } else {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw Object.assign(new Error('Database not configured'), { code: 'NO_DB' });
    const sql = neon(url);
    runner = (text, params = []) => sql.query(text, params);
  }
  return runner;
}
export const hasDb = () => !!(process.env.LOCAL_PG || process.env.DATABASE_URL || process.env.POSTGRES_URL);
export async function q(text, params) { return (await getRunner())(text, params); }
export async function one(text, params) { return (await q(text, params))[0] || null; }

let schemaReady = false;
export async function ensureSchema() {
  if (schemaReady) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, type TEXT, name TEXT, email TEXT, discipline TEXT, package TEXT, message TEXT, lang TEXT, status TEXT DEFAULT 'new', order_id INT, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, ref TEXT UNIQUE, token TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'new',
      customer_name TEXT, customer_email TEXT, phone TEXT, lang TEXT DEFAULT 'en', package TEXT DEFAULT 'signature', copies INT DEFAULT 1,
      price_usd NUMERIC(10,2), shipping_usd NUMERIC(10,2), deposit_paid BOOLEAN DEFAULT false, balance_paid BOOLEAN DEFAULT false,
      ship_name TEXT, ship_address TEXT, ship_city TEXT, ship_region TEXT, ship_postal TEXT, ship_country TEXT,
      printer TEXT, printer_order_id TEXT, tracking TEXT, notes TEXT,
      profile JSONB DEFAULT '{}'::jsonb, submitted_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS shoots (id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id) ON DELETE CASCADE, position INT DEFAULT 0,
      kind TEXT, title TEXT, credits JSONB DEFAULT '[]'::jsonb, story TEXT, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS photos (id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id) ON DELETE CASCADE, shoot_id INT REFERENCES shoots(id) ON DELETE CASCADE,
      position INT DEFAULT 0, url TEXT NOT NULL, filename TEXT, width INT, height INT, bytes INT, low_res BOOLEAN DEFAULT false, keep BOOLEAN DEFAULT true, role TEXT, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS proofs (id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id) ON DELETE CASCADE, version INT NOT NULL,
      status TEXT DEFAULT 'draft', layout JSONB, interior_url TEXT, cover_url TEXT, page_count INT, sent_at TIMESTAMPTZ, decided_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS proof_comments (id SERIAL PRIMARY KEY, proof_id INT REFERENCES proofs(id) ON DELETE CASCADE, page INT, body TEXT, author TEXT, resolved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS events (id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id) ON DELETE CASCADE, actor TEXT, text TEXT, created_at TIMESTAMPTZ DEFAULT now())`,
  ];
  for (const s of stmts) await q(s);
  schemaReady = true;
}
export async function logEvent(orderId, actor, text) {
  try { await q('INSERT INTO events (order_id, actor, text) VALUES ($1,$2,$3)', [orderId, actor, text]); } catch (e) { console.error('event', e); }
}
