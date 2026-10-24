# Checkout Pro

Checkout de alta conversão (layout inspirado no da Hotmart, mobile-first) + painel admin completo.
Stack: Node 22.5+ · Express · SQLite (embutido no Node) · front em JS puro (sem build).

## Rodar

```
npm install
npm start          # ou dê dois cliques em iniciar.bat
```

- Checkout de exemplo: http://localhost:3000/c/demo
- Admin: http://localhost:3000/admin/ — login inicial `admin@admin.com` / `admin123` (**troque em Configurações**)

Copie `.env.example` para `.env` e defina `SESSION_SECRET`, `PUBLIC_URL` e `NODE_ENV=production` ao publicar (use HTTPS).

## O que o painel faz

| Área | Funções |
|---|---|
| Dashboard | receita, vendas, ticket médio, conversão, receita/dia, por forma de pagamento, top checkouts |
| Checkouts | criar/duplicar/desativar, **editor com preview mobile ao vivo**, banner (upload), cores, texto do botão, formas de pagamento, parcelas/juros, desconto Pix, contador regressivo, confirmação de e-mail, celular, order bumps, rodapé/suporte, Pixel do Meta e script customizado |
| Produtos | CRUD, capa, preço, URL de entrega e de página de obrigado (redirect pós-compra) |
| Pedidos | busca/filtros, detalhes, UTMs, mudança manual de status |
| Cupons | % ou valor fixo, por checkout, limite de usos, validade |
| Abandonos | e-mails capturados no checkout, exportação CSV |
| Configurações | gateway ativo, credenciais, URL/token de webhook, log de webhooks, troca de senha |

Cada checkout tem um link próprio: `/c/<slug>`. UTMs (`utm_*`, `src`, `sck`, `fbclid`, `gclid`) são gravadas no pedido.

## Idioma e documento do comprador

- O **checkout é em espanhol (LATAM)**; o painel admin é em português. Textos do checkout ficam em `public/checkout/checkout.js`
  e as mensagens de erro do comprador em `server/routes/public.js`. Texto do botão, contador e rodapé são editáveis por checkout.
- Campo de documento por checkout (Admin → Checkouts → Campos e conversão): **CPF/CNPJ** (validado), **Documento de identidad** (livre) ou **não pedir**.
- Valores seguem em R$ (BRL).

## Integração MundPay (onde mexer)

Todos os pagamentos (cartão, Pix, boleto) são processados pela API da MundPay. Em **Configurações → Métodos habilitados** marque
só o que sua conta MundPay liberou: o checkout nunca oferece um método desmarcado ali.


Toda a integração fica em **`server/payments/mundpay.js`**. A documentação da MundPay não é pública,
então o mapeamento de campos é um padrão genérico — ajuste só os pontos marcados com `>>> AJUSTAR <<<`:

1. `ENDPOINTS` – caminhos da API
2. `buildPayload()` – corpo da requisição de cobrança (cartão / Pix / boleto)
3. `mapResponse()` – leitura da resposta (status, QR Pix, boleto)
4. `parseWebhook()` / `verifyWebhook()` – notificações (e assinatura HMAC, se a MundPay usar)
5. Header de autenticação em `request()` (Bearer por padrão)

Depois, em **Admin → Configurações**: escolha *MundPay*, informe URL base e chave de API, gere o token do webhook
e cadastre no painel da MundPay a URL exibida (`https://seudominio/webhooks/mundpay?token=...`).
Enquanto isso, o provedor **Simulação** (padrão) permite testar tudo: cartão válido aprova, CVV `000` recusa,
Pix confirma sozinho em ~15 s.

Para outro gateway, crie `server/payments/<nome>.js` com `createCharge`, `parseWebhook`, `verifyWebhook` e registre em `server/payments/index.js`.

## Segurança já tratada

- Preço, desconto, cupom e parcelas **sempre recalculados no servidor**; o navegador nunca define o valor.
- Dados de cartão passam só em memória até o gateway: não são gravados nem logados. (Se a MundPay oferecer tokenização via JS, prefira-a para reduzir escopo PCI.)
- Senhas com scrypt, sessão em cookie HttpOnly/SameSite=Strict assinado, rate-limit em login, pagamento e cupom.
- Upload restrito a PNG/JPG/WEBP/GIF (sem SVG), 5 MB, nome aleatório.
- Webhook exige token; chaves secretas ficam mascaradas no painel.

## Estrutura

```
server/            index.js, db.js, config.js
  routes/          public.js (checkout/pagamento), admin.js, webhooks.js
  payments/        index.js (fábrica), mundpay.js, mock.js
  utils/           pricing.js, orders.js, helpers.js
public/checkout/   página de compra (index.html, checkout.css, checkout.js)
public/admin/      painel (SPA)
data/              banco SQLite (criado automaticamente)
```

## Ainda não incluso (próximos passos naturais)

PayPal, e-mails transacionais/recuperação de carrinho automáticos, área de membros, order bump pós-compra (upsell),
reembolso via API do gateway (hoje é marcação manual) e multi-idioma.
