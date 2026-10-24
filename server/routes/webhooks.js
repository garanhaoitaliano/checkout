const express = require('express');
const { run } = require('../db');
const { getProvider, providers } = require('../payments');
const { applyStatus, findOrder } = require('../utils/orders');

const router = express.Router();

// POST /webhooks/mundpay?token=SEU_TOKEN   (configure essa URL no painel da MundPay)
router.post('/:provider', (req, res) => {
  const name = req.params.provider;
  if (!providers[name]) return res.status(404).end();
  const { impl } = getProvider(name);

  const log = (result) => run('INSERT INTO webhook_logs(provider,payload,result) VALUES(?,?,?)', name, JSON.stringify(req.body || {}).slice(0, 8000), result);

  // O provedor "mock" só aceita chamadas locais (usado pelo botão de simulação)
  if (!impl.verifyWebhook(req) || (name === 'mock' && !['::1', '127.0.0.1', '::ffff:127.0.0.1'].includes(req.ip))) {
    log('rejeitado: assinatura/token inválido');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const evt = impl.parseWebhook(req);
  if (!evt) { log('ignorado: payload não reconhecido'); return res.json({ ok: true }); }

  const order = findOrder(evt);
  if (!order) { log(`ignorado: pedido não encontrado (${evt.orderId || evt.providerId})`); return res.json({ ok: true }); }

  applyStatus(order.id, evt.status);
  log(`ok: ${order.id} -> ${evt.status}`);
  res.json({ ok: true });
});

module.exports = router;
