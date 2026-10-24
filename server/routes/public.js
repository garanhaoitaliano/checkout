const express = require('express');
const QRCode = require('qrcode');
const { get, all, run, getSetting } = require('../db');
const { getProvider, enabledMethods } = require('../payments');
const { computeTotals } = require('../utils/pricing');
const { applyStatus, redirectFor } = require('../utils/orders');
const H = require('../utils/helpers');

const router = express.Router();
const TOO_MANY = 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
const payLimiter = H.rateLimit({ windowMs: 10 * 60 * 1000, max: 25, message: TOO_MANY });
const leadLimiter = H.rateLimit({ windowMs: 60 * 1000, max: 20, message: TOO_MANY });

const METHODS = ['card', 'pix', 'boleto'];

function loadCheckout(slug) {
  const c = get('SELECT * FROM checkouts WHERE slug = ? AND active = 1', slug);
  if (!c) return null;
  const product = get('SELECT * FROM products WHERE id = ? AND active = 1', c.product_id);
  if (!product) return null;
  const bumps = all(
    `SELECT b.*, p.name AS product_name, p.image_url AS product_image
       FROM order_bumps b JOIN products p ON p.id = b.product_id
      WHERE b.checkout_id = ? AND b.active = 1 AND p.active = 1 ORDER BY b.sort, b.id`, c.id);
  return { c, product, bumps };
}

// Mesma forma usada pelo preview do admin (postMessage) — mantenha em sincronia.
function publicConfig({ c, product, bumps }) {
  return {
    slug: c.slug,
    name: c.name,
    price_cents: c.price_cents ?? product.price_cents,
    product: { name: product.name, author: product.author, description: product.description, image_url: product.image_url },
    bumps: bumps.map((b) => ({
      id: b.id,
      title: b.title || b.product_name,
      description: b.description,
      image_url: b.product_image,
      price_cents: b.price_cents,
      original_price_cents: b.original_price_cents,
    })),
    theme: {
      bg_color: c.bg_color, card_color: c.card_color, button_color: c.button_color,
      button_text_color: c.button_text_color, accent_color: c.accent_color,
    },
    banner_url: c.banner_url, banner_link: c.banner_link,
    button_label: c.button_label,
    // só métodos escolhidos no checkout E habilitados na conta do gateway
    methods: JSON.parse(c.methods || '["card"]').filter((m) => METHODS.includes(m) && enabledMethods().includes(m)),
    document_mode: ['br', 'any', 'none'].includes(c.document_mode) ? c.document_mode : 'br',
    max_installments: c.max_installments, min_installment_cents: c.min_installment_cents,
    interest_percent: c.interest_percent, pix_discount_percent: c.pix_discount_percent,
    require_email_confirm: !!c.require_email_confirm, ask_phone: !!c.ask_phone,
    countdown_minutes: c.countdown_minutes, countdown_text: c.countdown_text,
    show_coupon: !!c.show_coupon,
    support_email: c.support_email, footer_text: c.footer_text,
    terms_url: c.terms_url, privacy_url: c.privacy_url, seller_name: c.seller_name,
    facebook_pixel: c.facebook_pixel, head_script: c.head_script,
  };
}

router.get('/checkout/:slug', (req, res) => {
  const data = loadCheckout(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Checkout no encontrado o inactivo.' });
  res.json(publicConfig(data));
});

router.post('/checkout/:slug/lead', leadLimiter, (req, res) => {
  const data = loadCheckout(req.params.slug);
  if (!data) return res.status(404).end();
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!H.validEmail(email)) return res.status(400).end();
  run(
    `INSERT INTO leads(checkout_id,email,name,phone) VALUES(?,?,?,?)
     ON CONFLICT(checkout_id,email) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),leads.name),
       phone=COALESCE(NULLIF(excluded.phone,''),leads.phone), updated_at=CURRENT_TIMESTAMP`,
    data.c.id, email, String(req.body.name || '').slice(0, 120), String(req.body.phone || '').slice(0, 30));
  res.json({ ok: true });
});

function findCoupon(code, checkoutId) {
  if (!code) return null;
  const cp = get('SELECT * FROM coupons WHERE code = ? AND active = 1', String(code).trim().toUpperCase());
  if (!cp) return null;
  if (cp.checkout_id && cp.checkout_id !== checkoutId) return null;
  if (cp.max_uses && cp.uses >= cp.max_uses) return null;
  if (cp.expires_at && new Date(cp.expires_at) < new Date()) return null;
  return cp;
}

router.post('/checkout/:slug/coupon', leadLimiter, (req, res) => {
  const data = loadCheckout(req.params.slug);
  if (!data) return res.status(404).end();
  const cp = findCoupon(req.body.code, data.c.id);
  if (!cp) return res.status(404).json({ error: 'Cupón inválido o vencido.' });
  res.json({ code: cp.code, type: cp.type, value: cp.value });
});

router.post('/checkout/:slug/pay', payLimiter, async (req, res) => {
  const data = loadCheckout(req.params.slug);
  if (!data) return res.status(404).json({ error: 'Checkout no disponible.' });
  const { c, product } = data;
  const b = req.body || {};
  const cu = b.customer || {};

  // ---- validação (mensagens em espanhol: o comprador as vê) ----
  const errors = {};
  const name = String(cu.name || '').trim();
  const email = String(cu.email || '').trim().toLowerCase();
  if (name.split(/\s+/).length < 2) errors.name = 'Escribe tu nombre completo.';
  if (!H.validEmail(email)) errors.email = 'Correo electrónico inválido.';
  const docMode = c.document_mode || 'br';
  let document = '';
  if (docMode === 'br') {
    if (!H.validDocument(cu.document)) errors.document = 'CPF o CNPJ inválido.';
    document = H.onlyDigits(cu.document);
  } else if (docMode === 'any') {
    document = String(cu.document || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
    if (document.length < 5) errors.document = 'Documento inválido.';
  }
  const phone = H.onlyDigits(cu.phone);
  if (c.ask_phone && phone.length < 8) errors.phone = 'Teléfono inválido.';

  const allowed = JSON.parse(c.methods || '[]').filter((m) => enabledMethods().includes(m));
  const method = String(b.method || '');
  if (!allowed.includes(method)) errors.method = 'Forma de pago no disponible.';

  const card = b.card || {};
  if (method === 'card') {
    if (!H.luhn(card.number)) errors.card_number = 'Número de tarjeta inválido.';
    const m = String(card.expiry || '').match(/^(\d{2})\/(\d{2})$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 12 || new Date(2000 + Number(m[2]), Number(m[1]), 1) <= new Date())
      errors.card_expiry = 'Fecha de vencimiento inválida.';
    if (!/^\d{3,4}$/.test(String(card.cvv || ''))) errors.card_cvv = 'CVV inválido.';
    if (String(card.holder || '').trim().length < 3) errors.card_holder = 'Escribe el nombre impreso en la tarjeta.';
  }
  if (Object.keys(errors).length) return res.status(422).json({ error: 'Revisa los campos marcados.', errors });

  // ---- preço (sempre recalculado no servidor) ----
  const bumpIds = Array.isArray(b.bumps) ? b.bumps.map(Number) : [];
  const bumps = data.bumps.filter((x) => bumpIds.includes(x.id));
  const coupon = findCoupon(b.coupon, c.id);
  const baseCents = c.price_cents ?? product.price_cents;
  const totals = computeTotals({ checkout: c, baseCents, bumps, coupon, method, installments: b.installments });
  if (totals.total <= 0) return res.status(422).json({ error: 'Monto total inválido.' });

  const items = [
    { type: 'main', product_id: product.id, name: product.name, price_cents: baseCents },
    ...bumps.map((x) => ({ type: 'bump', product_id: x.product_id, name: x.title || x.product_name, price_cents: x.price_cents })),
  ];

  const orderId = H.newOrderId();
  const provider = getProvider();
  run(
    `INSERT INTO orders(id,checkout_id,product_id,customer_name,customer_email,customer_document,customer_phone,
       method,installments,status,subtotal_cents,discount_cents,total_cents,coupon_code,items,provider,utm,ip)
     VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?)`,
    orderId, c.id, product.id, name, email, document, phone,
    method, totals.installments, totals.subtotal, totals.couponCents + totals.pixCents, totals.total,
    coupon ? coupon.code : null, JSON.stringify(items), provider.name,
    JSON.stringify(b.utm || {}).slice(0, 1000), req.ip);

  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  const notifyUrl = `${baseUrl(req)}/webhooks/${provider.name}` + (provider.name === 'mundpay' && getSetting('mundpay_webhook_token') ? `?token=${encodeURIComponent(getSetting('mundpay_webhook_token'))}` : '');

  let result;
  try {
    result = await provider.impl.createCharge({
      order, items, method, card, installments: totals.installments, ip: req.ip, notifyUrl,
      customer: { name, email, document, phone },
    });
  } catch (e) {
    console.error('[pay] provider error:', e.message);
    result = { status: 'refused', error: 'No pudimos procesar el pago en este momento. Inténtalo de nuevo.' };
  }

  // QR Code do Pix (gera a imagem a partir do código copia-e-cola, se o provedor não mandou)
  let pixQr = null;
  if (result.pix) {
    pixQr = result.pix.qr || null;
    if (pixQr && !/^(data:|https?:)/.test(pixQr)) pixQr = 'data:image/png;base64,' + pixQr;
    if (!pixQr && result.pix.code) pixQr = await QRCode.toDataURL(result.pix.code, { margin: 1, width: 280 });
  }

  run(
    `UPDATE orders SET provider_id=?, pix_code=?, pix_qr=?, boleto_url=?, boleto_barcode=?, pix_expires_at=?, error=? WHERE id=?`,
    result.providerId || null, result.pix?.code || null, pixQr, result.boleto?.url || null, result.boleto?.barcode || null,
    result.pix ? new Date(Date.now() + (result.pixExpiresInSec || 3600) * 1000).toISOString() : null,
    result.status === 'refused' ? (result.error || 'Rechazado') : null, orderId);

  const final = applyStatus(orderId, result.status);
  if (result.status === 'refused') {
    return res.status(402).json({ error: result.error || 'Pago rechazado.', orderId });
  }
  res.json({
    orderId,
    status: final.status,
    method,
    total_cents: final.total_cents,
    pix: result.pix ? { code: result.pix.code, qr: pixQr, expires_at: final.pix_expires_at } : null,
    boleto: result.boleto || null,
    redirect: redirectFor(final),
  });
});

// Polling da tela de Pix/boleto
router.get('/orders/:id/status', async (req, res) => {
  let order = get('SELECT * FROM orders WHERE id = ?', req.params.id);
  if (!order) return res.status(404).end();

  if (order.status === 'pending') {
    try {
      if (order.provider === 'mock' && order.method === 'pix' && Date.now() - new Date(order.created_at + 'Z').getTime() > 15000) {
        order = applyStatus(order.id, 'paid'); // simulação do Pix pago
      } else if (order.provider === 'mundpay' && order.provider_id) {
        const { impl } = getProvider('mundpay');
        const st = await impl.getStatus(order.provider_id);
        if (st && st !== 'pending') order = applyStatus(order.id, st);
      }
    } catch (e) { /* mantém pending; webhook resolve */ }
  }
  res.json({ status: order.status, redirect: redirectFor(order) });
});

function baseUrl(req) {
  return require('../config').publicUrl || `${req.protocol}://${req.get('host')}`;
}

module.exports = router;
