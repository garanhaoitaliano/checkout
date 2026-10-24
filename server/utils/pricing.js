/**
 * Cálculo de preço — fonte única de verdade no servidor.
 * (public/checkout/checkout.js tem uma cópia espelhada só para exibição.)
 */
function couponDiscount(coupon, subtotal) {
  if (!coupon) return 0;
  const d = coupon.type === 'fixed' ? Math.round(coupon.value * 100) : Math.round(subtotal * (coupon.value / 100));
  return Math.max(0, Math.min(d, subtotal));
}

function installmentTotal(amount, n, interestPercent) {
  if (n <= 1 || !interestPercent) return amount;
  return Math.round(amount * Math.pow(1 + interestPercent / 100, n - 1));
}

function maxInstallmentsFor(amount, checkout) {
  const byMin = Math.max(1, Math.floor(amount / Math.max(1, checkout.min_installment_cents || 1)));
  return Math.max(1, Math.min(checkout.max_installments || 1, byMin));
}

/**
 * @param {object} p {checkout, baseCents, bumps:[{price_cents}], coupon, method, installments}
 */
function computeTotals({ checkout, baseCents, bumps = [], coupon = null, method = 'card', installments = 1 }) {
  const subtotal = baseCents + bumps.reduce((s, b) => s + b.price_cents, 0);
  const couponCents = couponDiscount(coupon, subtotal);
  let total = subtotal - couponCents;
  let pixCents = 0;
  if (method === 'pix' && checkout.pix_discount_percent > 0) {
    pixCents = Math.round(total * (checkout.pix_discount_percent / 100));
    total -= pixCents;
  }
  let n = 1;
  if (method === 'card') {
    n = Math.min(Math.max(1, Number(installments) || 1), maxInstallmentsFor(total, checkout));
    total = installmentTotal(total, n, checkout.interest_percent);
  }
  return { subtotal, couponCents, pixCents, total, installments: n, installmentCents: Math.ceil(total / n) };
}

module.exports = { computeTotals, couponDiscount, installmentTotal, maxInstallmentsFor };
