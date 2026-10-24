const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT 'Admin',
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  author TEXT DEFAULT '',
  description TEXT DEFAULT '',
  image_url TEXT DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  delivery_url TEXT DEFAULT '',
  thank_you_url TEXT DEFAULT '',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS checkouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  price_cents INTEGER,
  active INTEGER DEFAULT 1,
  banner_url TEXT DEFAULT '',
  banner_link TEXT DEFAULT '',
  bg_color TEXT DEFAULT '#f3f3f1',
  card_color TEXT DEFAULT '#ffffff',
  button_color TEXT DEFAULT '#12a54a',
  button_text_color TEXT DEFAULT '#ffffff',
  button_label TEXT DEFAULT 'Comprar ahora',
  accent_color TEXT DEFAULT '#12a54a',
  methods TEXT DEFAULT '["card","pix"]',
  max_installments INTEGER DEFAULT 12,
  min_installment_cents INTEGER DEFAULT 500,
  interest_percent REAL DEFAULT 0,
  pix_discount_percent REAL DEFAULT 0,
  require_email_confirm INTEGER DEFAULT 1,
  ask_phone INTEGER DEFAULT 0,
  countdown_minutes INTEGER DEFAULT 0,
  countdown_text TEXT DEFAULT 'Oferta por tiempo limitado',
  show_coupon INTEGER DEFAULT 1,
  support_email TEXT DEFAULT '',
  footer_text TEXT DEFAULT '',
  terms_url TEXT DEFAULT '',
  privacy_url TEXT DEFAULT '',
  seller_name TEXT DEFAULT '',
  facebook_pixel TEXT DEFAULT '',
  head_script TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_bumps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_id INTEGER NOT NULL REFERENCES checkouts(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  title TEXT DEFAULT '',
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  original_price_cents INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'percent',
  value REAL NOT NULL,
  checkout_id INTEGER REFERENCES checkouts(id) ON DELETE CASCADE,
  max_uses INTEGER DEFAULT 0,
  uses INTEGER DEFAULT 0,
  expires_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  checkout_id INTEGER REFERENCES checkouts(id),
  product_id INTEGER REFERENCES products(id),
  customer_name TEXT, customer_email TEXT, customer_document TEXT, customer_phone TEXT,
  method TEXT, installments INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pending',
  subtotal_cents INTEGER, discount_cents INTEGER DEFAULT 0, total_cents INTEGER,
  coupon_code TEXT,
  items TEXT,
  provider TEXT, provider_id TEXT,
  pix_code TEXT, pix_qr TEXT, boleto_url TEXT, boleto_barcode TEXT, pix_expires_at TEXT,
  error TEXT, utm TEXT, ip TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_provider ON orders(provider_id);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checkout_id INTEGER REFERENCES checkouts(id) ON DELETE CASCADE,
  email TEXT, name TEXT, phone TEXT,
  converted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(checkout_id, email)
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT, payload TEXT, result TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// ---------- migrações leves (bancos já existentes) ----------
const hasCol = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
if (!hasCol('checkouts', 'document_mode')) {
  // br = CPF/CNPJ validado | any = documento de identidade sem validação | none = não pedir
  db.exec("ALTER TABLE checkouts ADD COLUMN document_mode TEXT DEFAULT 'br'");
}
// Checkout do comprador agora é em espanhol: converte os textos padrão antigos
db.exec(`UPDATE checkouts SET button_label='Comprar ahora' WHERE button_label='Comprar agora';
         UPDATE checkouts SET countdown_text='Oferta por tiempo limitado' WHERE countdown_text='Oferta por tempo limitado';`);

// ---------- helpers ----------
const all = (sql, ...p) => db.prepare(sql).all(...p);
const get = (sql, ...p) => db.prepare(sql).get(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

function getSetting(key, fallback = '') {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value ?? ''));
}
function allSettings() {
  const out = {};
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

module.exports = { db, all, get, run, getSetting, setSetting, allSettings };
