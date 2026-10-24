/**
 * Provedor de TESTE. Não move dinheiro.
 *  - Cartão: use um número válido (ex.: 4111 1111 1111 1111). CVV 000 simula recusa; qualquer outro CVV aprova.
 *  - Pix/boleto ficam pendentes; o Pix é "pago" automaticamente após ~15s (ver routes/public.js).
 *    No admin também há o botão "Simular pagamento".
 */
const crypto = require('crypto');

async function createCharge({ method, card, order }) {
  const providerId = 'mock_' + crypto.randomBytes(6).toString('hex');

  if (method === 'card') {
    if (card && String(card.cvv) === '000') {
      return { status: 'refused', providerId, error: 'Tarjeta rechazada por el emisor (simulación).' };
    }
    return { status: 'paid', providerId };
  }
  if (method === 'pix') {
    const code = `00020126580014br.gov.bcb.pix0136${crypto.randomUUID()}5204000053039865406${(order.total_cents / 100).toFixed(2)}5802BR5909CHECKOUT6009SAO PAULO62070503***6304ABCD`;
    return { status: 'pending', providerId, pix: { code }, pixExpiresInSec: 900 };
  }
  if (method === 'boleto') {
    return {
      status: 'pending', providerId,
      boleto: { url: '#', barcode: '23793.38128 60000.000003 00000.000408 1 84340000012345' },
    };
  }
  return { status: 'refused', providerId, error: 'Método de pago inválido.' };
}

const parseWebhook = (req) => {
  const b = req.body || {};
  return b.providerId ? { providerId: b.providerId, orderId: b.orderId, status: b.status } : null;
};
const verifyWebhook = () => true;

module.exports = { createCharge, parseWebhook, verifyWebhook };
