const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const config = require('../config');
const { db, all, get, run, getSetting, setSetting, allSettings } = require('../db');
const H = require('../utils/helpers');
const { applyStatus } = require('../utils/orders');
const { activeName, enabledMethods, ALL_METHODS } = require('../payments');

const router = express.Router();
const COOKIE = 'sid';
const TTL = 60 * 60 * 24 * 7;

// ======================= AUTH =======================
const loginLimiter = H.rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post('/login', loginLimiter, (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const admin = get('SELECT * FROM admins WHERE email = ?', email);
  if (!admin || !H.verifyPassword(String(req.body.password || ''), admin.password_hash))
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  const token = H.sign({ id: admin.id }, config.sessionSecret, TTL);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${TTL}${config.isProd ? '; Secure' : ''}`);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
});

// Tudo abaixo exige login
router.use((req, res, next) => {
  const session = H.unsign(H.parseCookies(req.headers.cookie)[COOKIE], config.sessionSecret);
  const admin = session && get('SELECT id,email,name FROM admins WHERE id = ?', session.id);
  if (!admin) return res.status(401).json({ error: 'Sessão expirada.' });
  req.admin = admin;
  next();
});

router.get('/me', (req, res) => {
  res.json({
    ...req.admin,
    defaultPassword: H.verifyPassword(config.adminPassword, get('SELECT password_hash FROM admins WHERE id=?', req.admin.id).password_hash),
  });
});

router.post('/password', (req, res) => {
  const { current, next } = req.body;
  const row = get('SELECT * FROM admins WHERE id = ?', req.admin.id);
  if (!H.verifyPassword(String(current || ''), row.password_hash)) return res.status(400).json({ error: 'Senha atual incorreta.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'A nova senha precisa ter ao menos 8 caracteres.' });
  run('UPDATE admins SET password_hash = ? WHERE id = ?', H.hashPassword(next), req.admin.id);
  res.json({ ok: true });
});

// ======================= HELPERS =======================
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const int = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Math.round(Number(v)) : d);
const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const color = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : d);
const url = (v) => {
  const s = str(v, 1000);
  return s === '' || /^(https?:\/\/|\/uploads\/|\/assets\/)/i.test(s) ? s : '';
};

function upsert(table, data, id) {
  const cols = Object.keys(data);
  if (id) {
    run(`UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...cols.map((c) => data[c]), id);
    return id;
  }
  const r = run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((c) => data[c]));
  return Number(r.lastInsertRowid);
}

const tx = (fn) => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};

// ======================= UPLOAD =======================
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new Error('Envie uma imagem PNG, JPG, WEBP ou GIF.'))),
});
router.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Imagem maior que 5MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    res.json({ url: '/uploads/' + path.basename(req.file.filename) });
  });
});

// ======================= DASHBOARD =======================
router.get('/dashboard', (req, res) => {
  const days = Math.min(90, Math.max(1, int(req.query.days, 7)));
  const since = `datetime('now','-${days} days')`;
  const tz = "'-3 hours'";

  const totals = get(
    `SELECT COUNT(*) AS orders,
            SUM(status='paid') AS paid,
            COALESCE(SUM(CASE WHEN status='paid' THEN total_cents END),0) AS revenue,
            SUM(status='pending') AS pending,
            SUM(status='refused') AS refused
       FROM orders WHERE created_at >= ${since}`);
  const series = all(
    `SELECT date(created_at,${tz}) AS day,
            COALESCE(SUM(CASE WHEN status='paid' THEN total_cents END),0) AS revenue,
            SUM(status='paid') AS paid
       FROM orders WHERE created_at >= ${since} GROUP BY day ORDER BY day`);
  const top = all(
    `SELECT c.name, c.slug, COUNT(*) AS orders, SUM(o.status='paid') AS paid,
            COALESCE(SUM(CASE WHEN o.status='paid' THEN o.total_cents END),0) AS revenue
       FROM orders o JOIN checkouts c ON c.id = o.checkout_id
      WHERE o.created_at >= ${since} GROUP BY c.id ORDER BY revenue DESC LIMIT 5`);
  const byMethod = all(
    `SELECT method, COUNT(*) AS n, COALESCE(SUM(total_cents),0) AS revenue FROM orders
      WHERE status='paid' AND created_at >= ${since} GROUP BY method`);
  const recent = all(
    `SELECT id, customer_name, method, status, total_cents, created_at FROM orders ORDER BY created_at DESC LIMIT 6`);
  const leads = get(`SELECT COUNT(*) AS n FROM leads WHERE converted=0 AND created_at >= ${since}`).n;

  res.json({
    days, ...totals, paid: totals.paid || 0, pending: totals.pending || 0, refused: totals.refused || 0,
    ticket: totals.paid ? Math.round(totals.revenue / totals.paid) : 0,
    conversion: totals.orders ? (totals.paid || 0) / totals.orders : 0,
    series, top, byMethod, recent, abandoned: leads,
  });
});

// ======================= PRODUTOS =======================
const productData = (b) => ({
  name: str(b.name, 200), author: str(b.author, 200), description: str(b.description, 3000),
  image_url: url(b.image_url), price_cents: Math.max(0, int(b.price_cents)),
  delivery_url: url(b.delivery_url), thank_you_url: url(b.thank_you_url), active: bool(b.active ?? 1),
});

router.get('/products', (req, res) => res.json(all('SELECT * FROM products ORDER BY id DESC')));
router.post('/products', (req, res) => {
  const d = productData(req.body);
  if (!d.name) return res.status(400).json({ error: 'Informe o nome do produto.' });
  res.json(get('SELECT * FROM products WHERE id=?', upsert('products', d)));
});
router.put('/products/:id', (req, res) => {
  const d = productData(req.body);
  if (!d.name) return res.status(400).json({ error: 'Informe o nome do produto.' });
  upsert('products', d, int(req.params.id));
  res.json(get('SELECT * FROM products WHERE id=?', int(req.params.id)));
});
router.delete('/products/:id', (req, res) => {
  const id = int(req.params.id);
  const used = get('SELECT (SELECT COUNT(*) FROM checkouts WHERE product_id=?) + (SELECT COUNT(*) FROM order_bumps WHERE product_id=?) + (SELECT COUNT(*) FROM orders WHERE product_id=?) AS n', id, id, id).n;
  if (used) {
    run('UPDATE products SET active=0 WHERE id=?', id);
    return res.json({ ok: true, archived: true });
  }
  run('DELETE FROM products WHERE id=?', id);
  res.json({ ok: true });
});

// ======================= CHECKOUTS =======================
const METHODS = ['card', 'pix', 'boleto'];
function checkoutData(b, existing) {
  let slug = H.slugify(b.slug || b.name);
  if (!slug) slug = crypto.randomBytes(4).toString('hex');
  return {
    slug, name: str(b.name, 200) || 'Checkout', product_id: int(b.product_id),
    price_cents: b.price_cents === '' || b.price_cents === null || b.price_cents === undefined ? null : Math.max(0, int(b.price_cents)),
    active: bool(b.active ?? 1),
    banner_url: url(b.banner_url), banner_link: url(b.banner_link),
    bg_color: color(b.bg_color, '#f3f3f1'), card_color: color(b.card_color, '#ffffff'),
    button_color: color(b.button_color, '#12a54a'), button_text_color: color(b.button_text_color, '#ffffff'),
    accent_color: color(b.accent_color, '#12a54a'),
    button_label: str(b.button_label, 60) || 'Comprar ahora',
    document_mode: ['br', 'any', 'none'].includes(b.document_mode) ? b.document_mode : 'br',
    methods: JSON.stringify((Array.isArray(b.methods) ? b.methods : []).filter((m) => METHODS.includes(m))),
    max_installments: Math.min(12, Math.max(1, int(b.max_installments, 1))),
    min_installment_cents: Math.max(100, int(b.min_installment_cents, 500)),
    interest_percent: Math.min(30, Math.max(0, num(b.interest_percent))),
    pix_discount_percent: Math.min(90, Math.max(0, num(b.pix_discount_percent))),
    require_email_confirm: bool(b.require_email_confirm), ask_phone: bool(b.ask_phone),
    countdown_minutes: Math.min(1440, Math.max(0, int(b.countdown_minutes))),
    countdown_text: str(b.countdown_text, 120), show_coupon: bool(b.show_coupon),
    support_email: str(b.support_email, 200), footer_text: str(b.footer_text, 1000),
    terms_url: url(b.terms_url), privacy_url: url(b.privacy_url), seller_name: str(b.seller_name, 200),
    facebook_pixel: str(b.facebook_pixel, 40).replace(/\D/g, ''), head_script: str(b.head_script, 10000),
  };
}
function checkoutFull(id) {
  const c = get('SELECT * FROM checkouts WHERE id=?', id);
  if (!c) return null;
  c.methods = JSON.parse(c.methods || '[]');
  c.bumps = all('SELECT * FROM order_bumps WHERE checkout_id=? ORDER BY sort,id', id);
  return c;
}
function saveBumps(checkoutId, bumps) {
  run('DELETE FROM order_bumps WHERE checkout_id=?', checkoutId);
  (Array.isArray(bumps) ? bumps : []).forEach((b, i) => {
    if (!int(b.product_id) || !get('SELECT id FROM products WHERE id=?', int(b.product_id))) return;
    upsert('order_bumps', {
      checkout_id: checkoutId, product_id: int(b.product_id), title: str(b.title, 200), description: str(b.description, 600),
      price_cents: Math.max(0, int(b.price_cents)), original_price_cents: Math.max(0, int(b.original_price_cents)),
      sort: i, active: bool(b.active ?? 1),
    });
  });
}
function uniqueSlug(slug, exceptId = 0) {
  let s = slug, n = 2;
  while (get('SELECT id FROM checkouts WHERE slug=? AND id<>?', s, exceptId)) s = `${slug}-${n++}`;
  return s;
}

router.get('/checkouts', (req, res) => res.json(all(
  `SELECT c.id, c.slug, c.name, c.active, c.price_cents, c.created_at, p.name AS product_name, p.price_cents AS product_price,
          (SELECT COUNT(*) FROM orders o WHERE o.checkout_id=c.id) AS orders,
          (SELECT COUNT(*) FROM orders o WHERE o.checkout_id=c.id AND o.status='paid') AS paid
     FROM checkouts c JOIN products p ON p.id=c.product_id ORDER BY c.id DESC`)));
router.get('/checkouts/:id', (req, res) => {
  const c = checkoutFull(int(req.params.id));
  c ? res.json(c) : res.status(404).json({ error: 'Não encontrado.' });
});
router.post('/checkouts', (req, res) => {
  const d = checkoutData(req.body);
  if (!get('SELECT id FROM products WHERE id=?', d.product_id)) return res.status(400).json({ error: 'Selecione um produto.' });
  d.slug = uniqueSlug(d.slug);
  const id = tx(() => { const i = upsert('checkouts', d); saveBumps(i, req.body.bumps); return i; });
  res.json(checkoutFull(id));
});
router.put('/checkouts/:id', (req, res) => {
  const id = int(req.params.id);
  if (!get('SELECT id FROM checkouts WHERE id=?', id)) return res.status(404).json({ error: 'Não encontrado.' });
  const d = checkoutData(req.body);
  if (!get('SELECT id FROM products WHERE id=?', d.product_id)) return res.status(400).json({ error: 'Selecione um produto.' });
  d.slug = uniqueSlug(d.slug, id);
  tx(() => { upsert('checkouts', d, id); saveBumps(id, req.body.bumps); });
  res.json(checkoutFull(id));
});
router.post('/checkouts/:id/duplicate', (req, res) => {
  const src = checkoutFull(int(req.params.id));
  if (!src) return res.status(404).json({ error: 'Não encontrado.' });
  const d = checkoutData({ ...src, name: src.name + ' (cópia)', slug: src.slug + '-copia' });
  d.slug = uniqueSlug(d.slug);
  const id = tx(() => { const i = upsert('checkouts', d); saveBumps(i, src.bumps); return i; });
  res.json(checkoutFull(id));
});
router.delete('/checkouts/:id', (req, res) => {
  const id = int(req.params.id);
  if (get('SELECT COUNT(*) AS n FROM orders WHERE checkout_id=?', id).n) {
    run('UPDATE checkouts SET active=0 WHERE id=?', id);
    return res.json({ ok: true, archived: true });
  }
  run('DELETE FROM checkouts WHERE id=?', id);
  res.json({ ok: true });
});

// ======================= CUPONS =======================
router.get('/coupons', (req, res) => res.json(all(
  'SELECT cp.*, c.name AS checkout_name FROM coupons cp LEFT JOIN checkouts c ON c.id=cp.checkout_id ORDER BY cp.id DESC')));
function couponData(b) {
  return {
    code: str(b.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
    type: b.type === 'fixed' ? 'fixed' : 'percent',
    value: Math.max(0, num(b.value)),
    checkout_id: int(b.checkout_id) || null,
    max_uses: Math.max(0, int(b.max_uses)),
    expires_at: str(b.expires_at, 30) || null,
    active: bool(b.active ?? 1),
  };
}
router.post('/coupons', (req, res) => {
  const d = couponData(req.body);
  if (!d.code || !d.value) return res.status(400).json({ error: 'Informe o código e o valor do cupom.' });
  if (d.type === 'percent' && d.value > 100) return res.status(400).json({ error: 'Percentual máximo é 100.' });
  if (get('SELECT id FROM coupons WHERE code=?', d.code)) return res.status(400).json({ error: 'Já existe um cupom com esse código.' });
  res.json(get('SELECT * FROM coupons WHERE id=?', upsert('coupons', d)));
});
router.put('/coupons/:id', (req, res) => {
  const id = int(req.params.id);
  const d = couponData(req.body);
  if (get('SELECT id FROM coupons WHERE code=? AND id<>?', d.code, id)) return res.status(400).json({ error: 'Já existe um cupom com esse código.' });
  upsert('coupons', d, id);
  res.json(get('SELECT * FROM coupons WHERE id=?', id));
});
router.delete('/coupons/:id', (req, res) => { run('DELETE FROM coupons WHERE id=?', int(req.params.id)); res.json({ ok: true }); });

// ======================= PEDIDOS =======================
router.get('/orders', (req, res) => {
  const page = Math.max(1, int(req.query.page, 1));
  const limit = 20;
  const where = [], params = [];
  if (req.query.status) { where.push('o.status = ?'); params.push(String(req.query.status)); }
  if (req.query.checkout) { where.push('o.checkout_id = ?'); params.push(int(req.query.checkout)); }
  if (req.query.q) {
    where.push('(o.customer_name LIKE ? OR o.customer_email LIKE ? OR o.id LIKE ? OR o.customer_document LIKE ?)');
    const q = `%${String(req.query.q).trim()}%`;
    params.push(q, q, q, q);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS n FROM orders o ${w}`, ...params).n;
  const rows = all(
    `SELECT o.id,o.customer_name,o.customer_email,o.method,o.status,o.total_cents,o.created_at,o.paid_at,c.name AS checkout_name
       FROM orders o LEFT JOIN checkouts c ON c.id=o.checkout_id ${w}
      ORDER BY o.created_at DESC, o.rowid DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});
router.get('/orders/:id', (req, res) => {
  const o = get(
    `SELECT o.*, c.name AS checkout_name, p.name AS product_name FROM orders o
       LEFT JOIN checkouts c ON c.id=o.checkout_id LEFT JOIN products p ON p.id=o.product_id WHERE o.id=?`, req.params.id);
  if (!o) return res.status(404).json({ error: 'Pedido não encontrado.' });
  o.items = JSON.parse(o.items || '[]');
  o.utm = JSON.parse(o.utm || '{}');
  delete o.pix_qr;
  res.json(o);
});
// Alteração manual de status (ex.: conciliar um pagamento, marcar estorno feito no gateway)
router.post('/orders/:id/status', (req, res) => {
  const status = String(req.body.status);
  if (!['paid', 'refused', 'refunded', 'expired', 'pending', 'chargeback'].includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  if (!get('SELECT id FROM orders WHERE id=?', req.params.id)) return res.status(404).json({ error: 'Pedido não encontrado.' });
  applyStatus(req.params.id, status);
  res.json({ ok: true });
});

// ======================= CARRINHOS ABANDONADOS =======================
router.get('/leads', (req, res) => res.json(all(
  `SELECT l.*, c.name AS checkout_name FROM leads l LEFT JOIN checkouts c ON c.id=l.checkout_id
    ORDER BY l.converted, l.updated_at DESC LIMIT 300`)));
router.delete('/leads/:id', (req, res) => { run('DELETE FROM leads WHERE id=?', int(req.params.id)); res.json({ ok: true }); });

// ======================= CONFIGURAÇÕES =======================
const SETTING_KEYS = ['payment_provider', 'store_name', 'mundpay_base_url', 'mundpay_api_key', 'mundpay_webhook_token'];
const SECRET_KEYS = ['mundpay_api_key', 'mundpay_webhook_token'];
const mask = (v) => (v ? '••••••••' + v.slice(-4) : '');

router.get('/settings', (req, res) => {
  const s = allSettings();
  const out = {};
  for (const k of SETTING_KEYS) out[k] = SECRET_KEYS.includes(k) ? mask(s[k] || '') : s[k] || '';
  out.payment_provider = activeName();
  out.enabled_methods = enabledMethods();
  const base = config.publicUrl || `${req.protocol}://${req.get('host')}`;
  const tok = s.mundpay_webhook_token || '';
  out.webhook_url = `${base}/webhooks/mundpay${tok ? `?token=${tok}` : ''}`;
  res.json(out);
});
router.put('/settings', (req, res) => {
  for (const k of SETTING_KEYS) {
    if (req.body[k] === undefined) continue;
    const v = String(req.body[k]).trim();
    if (SECRET_KEYS.includes(k) && v.startsWith('••••')) continue; // não mudou
    if (k === 'payment_provider' && !['mock', 'mundpay'].includes(v)) return res.status(400).json({ error: 'Provedor inválido.' });
    if (k === 'mundpay_base_url' && v && !/^https:\/\//i.test(v)) return res.status(400).json({ error: 'A URL base da MundPay deve começar com https://' });
    setSetting(k, v);
  }
  if (Array.isArray(req.body.enabled_methods)) {
    const list = ALL_METHODS.filter((m) => req.body.enabled_methods.includes(m));
    if (!list.length) return res.status(400).json({ error: 'Habilite ao menos um método de pagamento.' });
    setSetting('enabled_methods', JSON.stringify(list));
  }
  res.json({ ok: true });
});
router.post('/settings/generate-token', (req, res) => {
  setSetting('mundpay_webhook_token', crypto.randomBytes(24).toString('hex'));
  res.json({ ok: true });
});
router.get('/webhook-logs', (req, res) => res.json(all('SELECT * FROM webhook_logs ORDER BY id DESC LIMIT 50')));

module.exports = router;
