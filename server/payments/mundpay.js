/**
 * ADAPTADOR MUNDPAY
 * ---------------------------------------------------------------------------
 * Toda a integração com a MundPay vive NESTE arquivo.
 *
 * ⚠️ A documentação oficial da MundPay não é pública, então os nomes de endpoints e
 * campos abaixo são um MAPEAMENTO PADRÃO (estilo gateway REST brasileiro). Quando você
 * abrir a documentação da MundPay, só ajuste os 3 pontos marcados com  >>> AJUSTAR <<<:
 *
 *   1. ENDPOINTS      -> caminhos da API
 *   2. buildPayload() -> corpo da requisição (nomes dos campos)
 *   3. mapResponse()  -> como ler a resposta (status, QR Pix, boleto)
 *   (+ parseWebhook / verifyWebhook para as notificações)
 *
 * Credenciais ficam em Admin > Configurações (ou no .env), nunca no código.
 */
const { getSetting } = require('../db');
const { normalizeStatus } = require('./index');
const { onlyDigits } = require('../utils/helpers');

// >>> AJUSTAR <<< 1. ENDPOINTS (relativos à base URL configurada no admin)
const ENDPOINTS = {
  createTransaction: '/transactions',
  getTransaction: (id) => `/transactions/${id}`,
};

const cfg = () => ({
  baseUrl: (getSetting('mundpay_base_url') || process.env.MUNDPAY_BASE_URL || '').replace(/\/$/, ''),
  apiKey: getSetting('mundpay_api_key') || process.env.MUNDPAY_API_KEY || '',
  webhookToken: getSetting('mundpay_webhook_token') || process.env.MUNDPAY_WEBHOOK_TOKEN || '',
});

// >>> AJUSTAR <<< 2. Corpo da requisição
function buildPayload({ order, customer, items, method, card, installments, notifyUrl }) {
  const doc = onlyDigits(customer.document); // pode vir vazio quando o checkout não pede documento
  const payload = {
    external_id: order.id, // usamos o ID do pedido como referência para conciliar no webhook
    amount: order.total_cents, // em centavos
    payment_method: method === 'card' ? 'credit_card' : method, // credit_card | pix | boleto
    postback_url: notifyUrl,
    customer: {
      name: customer.name,
      email: customer.email,
      document: doc || undefined,
      document_type: doc ? (doc.length > 11 ? 'cnpj' : 'cpf') : undefined,
      phone: onlyDigits(customer.phone) || undefined,
    },
    items: items.map((i) => ({ title: i.name, unit_price: i.price_cents, quantity: 1 })),
  };
  if (method === 'card') {
    payload.installments = installments || 1;
    payload.card = {
      number: onlyDigits(card.number),
      holder_name: card.holder,
      exp_month: card.expiry.split('/')[0],
      exp_year: '20' + card.expiry.split('/')[1],
      cvv: card.cvv,
    };
  }
  return payload;
}

// >>> AJUSTAR <<< 3. Leitura da resposta
function mapResponse(data, method) {
  const d = data.data || data;
  const out = {
    providerId: String(d.id || d.transaction_id || ''),
    status: normalizeStatus(d.status),
  };
  if (method === 'pix') {
    const pix = d.pix || {};
    out.pix = { code: pix.qr_code || pix.copy_paste || pix.emv || d.pix_code, qr: pix.qr_code_base64 || pix.qr_code_url };
  }
  if (method === 'boleto') {
    const b = d.boleto || {};
    out.boleto = { url: b.url || b.pdf, barcode: b.barcode || b.digitable_line };
  }
  if (out.status === 'refused') out.error = d.refuse_reason || d.message || 'Pago rechazado.';
  return out;
}

async function request(path, { method = 'GET', body } = {}) {
  const { baseUrl, apiKey } = cfg();
  if (!baseUrl || !apiKey) throw new Error('MundPay não configurada (Admin > Configurações).');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`, // >>> AJUSTAR <<< se a MundPay usar Basic / x-api-key
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch { /* resposta não-JSON */ }
    if (!res.ok) {
      const err = new Error(json.message || json.error || `Erro MundPay (HTTP ${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function createCharge(args) {
  try {
    const data = await request(ENDPOINTS.createTransaction, { method: 'POST', body: buildPayload(args) });
    return mapResponse(data, args.method);
  } catch (e) {
    console.error('[mundpay] createCharge:', e.message); // nunca logar dados de cartão
    // Mensagem exibida ao comprador (espanhol). Erros 4xx do gateway (ex.: cartão recusado) vêm do próprio gateway.
    return { status: 'refused', providerId: '', error: e.status && e.status < 500 ? e.message : 'No pudimos procesar el pago en este momento. Inténtalo de nuevo.' };
  }
}

async function getStatus(providerId) {
  const data = await request(ENDPOINTS.getTransaction(providerId));
  return mapResponse(data).status;
}

// Webhook: >>> AJUSTAR <<< nomes dos campos enviados pela MundPay
function parseWebhook(req) {
  const b = req.body || {};
  const d = b.data || b;
  const providerId = String(d.id || d.transaction_id || '');
  const orderId = d.external_id || d.reference || null;
  if (!providerId && !orderId) return null;
  return { providerId, orderId, status: normalizeStatus(d.status || b.event) };
}

// Segurança do webhook: token na URL (?token=...) ou header. Se a MundPay assinar o corpo
// (HMAC), valide a assinatura aqui usando req.rawBody.
function verifyWebhook(req) {
  const { webhookToken } = cfg();
  if (!webhookToken) return false;
  const got = req.query.token || req.headers['x-webhook-token'] || '';
  return got === webhookToken;
}

module.exports = { createCharge, getStatus, parseWebhook, verifyWebhook };
