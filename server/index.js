const express = require('express');
const path = require('path');
const config = require('./config');
const { get, run, getSetting, setSetting } = require('./db');
const { hashPassword } = require('./utils/helpers');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // atrás de Nginx/Cloudflare/Railway etc. (IP real p/ rate limit)

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '200kb' }));

// ---------- API ----------
app.use('/api', require('./routes/public'));
app.use('/api/admin', require('./routes/admin'));
app.use('/webhooks', require('./routes/webhooks'));

// ---------- Front ----------
const pub = path.join(config.root, 'public');
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));
app.use('/assets', express.static(path.join(pub, 'assets'), { maxAge: '7d' }));
app.use('/checkout-static', express.static(path.join(pub, 'checkout'), { maxAge: 0 }));
app.use('/admin', express.static(path.join(pub, 'admin'), { maxAge: 0 }));
app.get('/c/:slug', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(pub, 'checkout', 'index.html'));
});
app.get('/', (req, res) => res.redirect('/admin/'));
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));
app.use((err, req, res, next) => {
  console.error('[erro]', err.message);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
  res.status(500).json({ error: 'Erro interno.' });
});

// ---------- Seed (primeira execução) ----------
function seed() {
  if (!get('SELECT id FROM admins LIMIT 1')) {
    run('INSERT INTO admins(email,password_hash) VALUES(?,?)', config.adminEmail.toLowerCase(), hashPassword(config.adminPassword));
    console.log(`\n  ⚠  Admin criado: ${config.adminEmail} / ${config.adminPassword}  -> TROQUE a senha em Configurações.\n`);
  }
  if (!getSetting('payment_provider')) setSetting('payment_provider', 'mock');

  if (!get('SELECT id FROM products LIMIT 1')) {
    const mk = (n, a, d, img, price, ty = '') =>
      Number(run('INSERT INTO products(name,author,description,image_url,price_cents,thank_you_url) VALUES(?,?,?,?,?,?)', n, a, d, img, price, ty).lastInsertRowid);
    const main = mk('Los 73 Libros Explicados en un lenguaje sencillo', 'Autor de ejemplo', '', '/assets/demo-main.svg', 5432);
    const b1 = mk('Manual del Católico', 'Autor de ejemplo', '', '/assets/demo-bump1.svg', 2743);
    const b2 = mk('Quién es quién en la Biblia Católica', 'Autor de ejemplo', '', '/assets/demo-bump2.svg', 3237);
    const cid = Number(run(
      `INSERT INTO checkouts(slug,name,product_id,banner_url,methods,countdown_minutes,support_email,seller_name,document_mode)
       VALUES('demo','Checkout de exemplo',?,'/assets/demo-banner.svg','["card","pix","boleto"]',0,'soporte@tudominio.com','Tu Tienda','br')`, main).lastInsertRowid);
    run(`INSERT INTO order_bumps(checkout_id,product_id,title,description,price_cents,original_price_cents,sort) VALUES(?,?,?,?,?,?,0)`,
      cid, b1, 'Manual del Católico',
      'Las 40 oraciones que todo católico debería saberse de memoria + examen de conciencia según los 10 mandamientos. Padre Nuestro, Ave María, Credo, Acordados (Memorare), Ángel de la Guarda, Actos de Fe/Esperanza/Caridad y mucho más.', 2743, 8229);
    run(`INSERT INTO order_bumps(checkout_id,product_id,title,description,price_cents,original_price_cents,sort) VALUES(?,?,?,?,?,?,1)`,
      cid, b2, 'Quién es quién en la Biblia Católica',
      'Dos Santiagos (Tiagos), dos Josés, varias Marías, un Judas apóstol y otro traidor. 60 personajes en 70 páginas: quién fue, el momento que lo define, sus relaciones familiares y la lección espiritual.', 3237, 13716);
    console.log('  ✓ Dados de exemplo criados (checkout: /c/demo)');
  }
}
seed();

app.listen(config.port, () => {
  console.log(`  Checkout no ar:  http://localhost:${config.port}/c/demo`);
  console.log(`  Painel admin:    http://localhost:${config.port}/admin/`);
});
