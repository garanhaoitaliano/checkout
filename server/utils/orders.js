const { get, run, all } = require('../db');

/**
 * Aplica uma mudança de status vinda do provedor (webhook/polling) ou do admin.
 * Idempotente: repetir o mesmo status não faz nada.
 */
function applyStatus(orderId, status) {
  const order = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!order || order.status === status) return order;

  // Pedido pago só pode evoluir para refunded/chargeback
  if (order.status === 'paid' && !['refunded', 'chargeback'].includes(status)) return order;

  if (status === 'paid') {
    run("UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP, error=NULL WHERE id=?", orderId);
    if (order.coupon_code) run('UPDATE coupons SET uses = uses + 1 WHERE code = ?', order.coupon_code);
    run('UPDATE leads SET converted=1 WHERE checkout_id=? AND email=?', order.checkout_id, order.customer_email);
  } else {
    run('UPDATE orders SET status=? WHERE id=?', status, orderId);
  }
  return get('SELECT * FROM orders WHERE id = ?', orderId);
}

function redirectFor(order) {
  if (order.status !== 'paid') return null;
  const p = get('SELECT thank_you_url, delivery_url FROM products WHERE id = ?', order.product_id);
  return (p && (p.thank_you_url || p.delivery_url)) || null;
}

function findOrder({ providerId, orderId }) {
  if (orderId) {
    const o = get('SELECT * FROM orders WHERE id = ?', orderId);
    if (o) return o;
  }
  if (providerId) return get('SELECT * FROM orders WHERE provider_id = ?', providerId);
  return null;
}

module.exports = { applyStatus, redirectFor, findOrder, all };
