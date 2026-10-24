/**
 * Fábrica de provedores de pagamento.
 *
 * Contrato que todo provedor implementa:
 *
 *   createCharge({ order, customer, items, method, card, installments, ip, notifyUrl })
 *     -> { status: 'paid'|'pending'|'refused', providerId, pix?:{code,qr}, boleto?:{url,barcode}, error? }
 *
 *   parseWebhook(req) -> { providerId, orderId, status } | null
 *   verifyWebhook(req) -> boolean
 *
 * Para trocar/adicionar um gateway: crie server/payments/<nome>.js seguindo esse contrato
 * e registre abaixo. O resto do sistema (checkout, pedidos, admin) não precisa mudar.
 */
const { getSetting } = require('../db');

const providers = {
  mock: () => require('./mock'),
  mundpay: () => require('./mundpay'),
};

// Status internos: pending | paid | refused | refunded | expired | chargeback
function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (['paid', 'approved', 'authorized', 'captured', 'completed', 'succeeded', 'confirmed', 'pago', 'aprovado'].includes(s)) return 'paid';
  if (['refused', 'declined', 'failed', 'denied', 'rejected', 'canceled', 'cancelled', 'recusado', 'error'].includes(s)) return 'refused';
  if (['refunded', 'reversed', 'estornado', 'reembolsado'].includes(s)) return 'refunded';
  if (['chargeback', 'charged_back', 'disputed'].includes(s)) return 'chargeback';
  if (['expired', 'expirado'].includes(s)) return 'expired';
  return 'pending';
}

const ALL_METHODS = ['card', 'pix', 'boleto'];

// Métodos que a conta do gateway tem habilitados (Admin > Configurações). O checkout só oferece estes.
function enabledMethods() {
  try {
    const list = JSON.parse(getSetting('enabled_methods', '') || 'null');
    if (Array.isArray(list)) return ALL_METHODS.filter((m) => list.includes(m));
  } catch { /* usa o padrão */ }
  return ALL_METHODS;
}

function activeName() {
  return getSetting('payment_provider', 'mock');
}
function getProvider(name = activeName()) {
  const loader = providers[name];
  if (!loader) throw new Error(`Provedor de pagamento desconhecido: ${name}`);
  return { name, impl: loader() };
}

module.exports = { getProvider, activeName, enabledMethods, normalizeStatus, providers, ALL_METHODS };
