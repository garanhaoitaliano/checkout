/* Checkout público — renderiza a partir de /api/checkout/:slug (ou de postMessage no preview do admin). */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const app = $('#app');

  const slug = location.pathname.split('/').filter(Boolean)[1] || '';
  const PREVIEW = new URLSearchParams(location.search).has('preview');
  const S = { cfg: null, method: null, bumps: new Set(), coupon: null, installments: 1, busy: false, poll: null };
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('ck_customer') || '{}'); } catch { return {}; } },
    set(v) { try { localStorage.setItem('ck_customer', JSON.stringify(v)); } catch { /* ignore */ } },
    clear() { try { localStorage.removeItem('ck_customer'); } catch { /* ignore */ } },
  };

  // ---------- ícones ----------
  const ICON = {
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 9.5h19M6 15h4"/></svg>',
    pix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2.8l4.2 4.2a2 2 0 0 1 0 2.8L12 14l-4.2-4.2a2 2 0 0 1 0-2.8zM12 22l4.2-4.2a2 2 0 0 0 0-2.8L12 10.8M12 22l-4.2-4.2a2 2 0 0 1 0-2.8"/></svg>',
    boleto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5v14M7 5v14M11 5v14M14 5v14M17 5v14M20 5v14" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 10V8a6 6 0 1 1 12 0v2h1.2c.9 0 1.8.9 1.8 1.8v8.4c0 .9-.9 1.8-1.8 1.8H4.8C3.9 22 3 21.1 3 20.2v-8.4C3 10.9 3.9 10 4.8 10zm2 0h8V8a4 4 0 1 0-8 0z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };
  const METHOD_LABEL = { card: 'Tarjeta de crédito o débito', pix: 'Pix', boleto: 'Boleto bancario' };

  // ---------- validações (espelham o servidor) ----------
  function validCPF(v) {
    const c = digits(v);
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let s = 0;
      for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== +c[t]) return false;
    }
    return true;
  }
  function validCNPJ(v) {
    const c = digits(v);
    if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    const calc = (len) => { let s = 0, p = len - 7; for (let i = len; i >= 1; i--) { s += +c[len - i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === +c[12] && calc(13) === +c[13];
  }
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e).trim());
  function luhn(n) {
    const d = digits(n);
    if (d.length < 13 || d.length > 19) return false;
    let s = 0, alt = false;
    for (let i = d.length - 1; i >= 0; i--) { let x = +d[i]; if (alt) { x *= 2; if (x > 9) x -= 9; } s += x; alt = !alt; }
    return s % 10 === 0;
  }
  function validExpiry(v) {
    const m = String(v).match(/^(\d{2})\/(\d{2})$/);
    if (!m || +m[1] < 1 || +m[1] > 12) return false;
    return new Date(2000 + +m[2], +m[1], 1) > new Date();
  }

  // ---------- máscaras ----------
  const mask = {
    document(v) {
      const d = digits(v).slice(0, 14);
      if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
      return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
    },
    phone(v) {
      const d = digits(v).slice(0, 11);
      if (d.length <= 2) return d ? `(${d}` : '';
      if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
      if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
      return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    },
    card(v) { return digits(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '); },
    expiry(v) { const d = digits(v).slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; },
    cvv(v) { return digits(v).slice(0, 4); },
  };

  // ---------- preço (espelha server/utils/pricing.js; o servidor é quem manda) ----------
  function calc() {
    const c = S.cfg;
    const bumps = c.bumps.filter((b) => S.bumps.has(b.id));
    const subtotal = c.price_cents + bumps.reduce((s, b) => s + b.price_cents, 0);
    let couponCents = 0;
    if (S.coupon) {
      couponCents = S.coupon.type === 'fixed' ? Math.round(S.coupon.value * 100) : Math.round(subtotal * S.coupon.value / 100);
      couponCents = Math.max(0, Math.min(couponCents, subtotal));
    }
    let total = subtotal - couponCents, pixCents = 0;
    if (S.method === 'pix' && c.pix_discount_percent > 0) { pixCents = Math.round(total * c.pix_discount_percent / 100); total -= pixCents; }
    const maxN = maxInstallments(total);
    let n = 1;
    if (S.method === 'card') {
      n = Math.min(Math.max(1, S.installments), maxN);
      if (n > 1 && c.interest_percent) total = Math.round(total * Math.pow(1 + c.interest_percent / 100, n - 1));
    }
    return { bumps, subtotal, couponCents, pixCents, total, n, maxN };
  }
  function maxInstallments(amount) {
    const c = S.cfg;
    return Math.max(1, Math.min(c.max_installments || 1, Math.floor(amount / Math.max(1, c.min_installment_cents || 1))));
  }
  function installmentOptions() {
    const c = S.cfg;
    const bumps = c.bumps.filter((b) => S.bumps.has(b.id));
    let base = c.price_cents + bumps.reduce((s, b) => s + b.price_cents, 0);
    if (S.coupon) base -= S.coupon.type === 'fixed' ? Math.min(base, Math.round(S.coupon.value * 100)) : Math.round(base * S.coupon.value / 100);
    const out = [];
    for (let n = 1; n <= maxInstallments(base); n++) {
      const total = n > 1 && c.interest_percent ? Math.round(base * Math.pow(1 + c.interest_percent / 100, n - 1)) : base;
      const part = Math.ceil(total / n);
      out.push(`<option value="${n}">${n}x de ${brl(part)}${n === 1 || !c.interest_percent ? ' sin intereses' : ` (total ${brl(total)})`}</option>`);
    }
    return out.join('');
  }

  // ---------- tracking ----------
  function track(event, data) {
    if (PREVIEW) return;
    try { if (window.fbq) window.fbq('track', event, data); } catch { /* ignore */ }
  }
  function loadTracking(cfg) {
    if (PREVIEW) return;
    if (cfg.facebook_pixel && !window.fbq) {
      /* eslint-disable */
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
      /* eslint-enable */
      window.fbq('init', cfg.facebook_pixel);
      window.fbq('track', 'PageView');
    }
    if (cfg.head_script) {
      try { document.head.appendChild(document.createRange().createContextualFragment(cfg.head_script)); } catch (e) { console.warn('head_script', e); }
    }
  }

  // ---------- render ----------
  function applyTheme(t) {
    const r = document.documentElement.style;
    r.setProperty('--bg', t.bg_color); r.setProperty('--card', t.card_color);
    r.setProperty('--btn', t.button_color); r.setProperty('--btn-text', t.button_text_color);
    r.setProperty('--accent', t.accent_color);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t.bg_color;
  }

  function field(name, label, input, extra = '') {
    return `<div class="field" data-f="${name}"><label for="f-${name}">${label}</label>${input}<div class="msg"></div>${extra}</div>`;
  }

  function bumpHTML(b) {
    const off = b.original_price_cents > b.price_cents ? Math.round((1 - b.price_cents / b.original_price_cents) * 100) : 0;
    return `
      <div class="bump${S.bumps.has(b.id) ? ' on' : ''}" data-bump="${b.id}">
        <div class="bump-body">
          ${b.image_url ? `<img src="${esc(b.image_url)}" alt="" loading="lazy">` : ''}
          <div>
            <h3>${esc(b.title)}</h3>
            ${b.description ? `<p>${esc(b.description)}</p>` : ''}
            ${off ? `<span class="old">${brl(b.original_price_cents)}</span><span class="off">↓ ${off}%</span>` : ''}
            <span class="now">${brl(b.price_cents)}</span>
          </div>
        </div>
        <label class="bump-add"><input type="checkbox" ${S.bumps.has(b.id) ? 'checked' : ''}> Agregar producto</label>
      </div>`;
  }

  function payOption(m) {
    const c = S.cfg;
    let body = '';
    if (m === 'card') {
      body = `
        ${field('card_number', 'Número de tarjeta', `<div class="input-icon"><input class="input" id="f-card_number" inputmode="numeric" autocomplete="cc-number" placeholder="0000 0000 0000 0000">${ICON.card}</div>`)}
        <div class="row">
          ${field('card_expiry', 'Vencimiento', '<input class="input" id="f-card_expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/AA">')}
          ${field('card_cvv', 'CVV <span class="help" title="Código de 3 o 4 dígitos en el reverso de la tarjeta">?</span>', '<input class="input" id="f-card_cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="3 o 4 dígitos">')}
        </div>
        ${field('card_holder', 'Nombre del titular', '<input class="input" id="f-card_holder" autocomplete="cc-name" placeholder="Escribe el nombre impreso en la tarjeta">')}
        ${c.max_installments > 1 ? field('installments', 'Cuotas', '<select class="select" id="f-installments"></select>') : ''}`;
    } else if (m === 'pix') {
      body = `<p class="pay-note">Aprobación inmediata. El código QR y el código Pix aparecen después de hacer clic en <b>${esc(c.button_label)}</b>.
        ${c.pix_discount_percent > 0 ? `<br><span class="tag">${c.pix_discount_percent}% de descuento con Pix</span>` : ''}</p>`;
    } else {
      body = '<p class="pay-note">El boleto se genera después de hacer clic en <b>' + esc(c.button_label) + '</b>. La acreditación puede tardar hasta 2 días hábiles.</p>';
    }
    return `
      <div class="pay-opt${S.method === m ? ' on' : ''}" data-m="${m}">
        <button type="button" class="pay-head" aria-pressed="${S.method === m}"><span class="radio"></span>${ICON[m]}<span>${METHOD_LABEL[m]}</span></button>
        <div class="pay-body">${body}</div>
      </div>`;
  }

  function render() {
    const c = S.cfg;
    applyTheme(c.theme);
    document.title = `${c.product.name} — Finalizar compra`;
    const docMode = c.document_mode || 'br';
    const docField = docMode === 'none' ? ''
      : docMode === 'any' ? field('document', 'Documento de identidad', '<input class="input" id="f-document" autocomplete="off" placeholder="Escribe tu número de documento">')
        : field('document', 'CPF/CNPJ', '<input class="input" id="f-document" inputmode="numeric" autocomplete="off" placeholder="Escribe tu número de CPF o CNPJ">');
    const saved = store.get();
    if (!S.method || !c.methods.includes(S.method)) S.method = c.methods[0] || 'card';
    const code = `CKTID-${(c.slug || 'preview').toUpperCase()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

    app.innerHTML = `
      ${c.countdown_minutes > 0 ? `<div class="countdown" id="cd"><span>${esc(c.countdown_text)}</span><b id="cd-t">--:--</b></div>` : ''}
      <div class="page">
        <div class="wrap">
          ${c.banner_url ? (c.banner_link ? `<a class="banner" href="${esc(c.banner_link)}" target="_blank" rel="noopener">` : '<div class="banner">') + `<img src="${esc(c.banner_url)}" alt="">` + (c.banner_link ? '</a>' : '</div>') : ''}
          <div class="card" id="card"><div id="card-inner">
            <div class="product">
              ${c.product.image_url ? `<img src="${esc(c.product.image_url)}" alt="">` : ''}
              <div>
                <h1>${esc(c.product.name)}</h1>
                ${c.product.author ? `<div class="author">Autor: ${esc(c.product.author)}</div>` : ''}
                <div class="price" id="head-price"></div>
              </div>
            </div>

            <form id="form" novalidate autocomplete="on">
              <h2 class="section-title">Datos personales</h2>
              ${field('email', 'Tu correo electrónico', '<input class="input" id="f-email" type="email" inputmode="email" autocomplete="email" placeholder="Escribe tu correo para recibir la compra">')}
              ${c.require_email_confirm ? field('email2', 'Confirma tu correo electrónico', '<input class="input" id="f-email2" type="email" inputmode="email" autocomplete="off" placeholder="Escribe nuevamente tu correo">') : ''}
              ${field('name', 'Nombre completo', '<input class="input" id="f-name" autocomplete="name" placeholder="Escribe tu nombre completo">')}
              ${docField}
              ${c.ask_phone ? field('phone', 'Teléfono celular', '<input class="input" id="f-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="Escribe tu número con código de área">') : ''}

              <h2 class="section-title">Elige la forma de pago</h2>
              ${c.methods.map(payOption).join('') || '<p>No hay formas de pago disponibles.</p>'}

              ${c.bumps.length ? `<h2 class="section-title">Aprovecha y compra junto:</h2>${c.bumps.map(bumpHTML).join('')}` : ''}

              <h2 class="section-title">Detalles de la compra</h2>
              <div class="summary" id="summary"></div>
              ${c.show_coupon ? `<div class="coupon"><button type="button" class="coupon-toggle" id="cp-toggle">¿Tienes un cupón de descuento?</button>
                <div class="coupon-form" id="cp-form"><input class="input" id="cp-code" placeholder="Código del cupón" autocomplete="off"><button type="button" class="btn-ghost" id="cp-apply">Aplicar</button></div>
                <div class="msg" id="cp-msg" style="font-size:12.5px;margin-top:4px"></div></div>` : ''}

              <div class="alert" id="alert" role="alert"></div>
              <button class="btn-buy" id="buy" type="submit">${esc(c.button_label)}</button>
              <div class="secure">${ICON.lock}<span>Pago 100% seguro y encriptado</span></div>
            </form>
          </div></div>
        </div>

        <footer class="foot"><div class="wrap">
          <p>${c.seller_name || c.support_email ? `¿Tienes dudas sobre el producto? Comunícate ${c.support_email ? `con <a href="mailto:${esc(c.support_email)}">${esc(c.seller_name || c.support_email)}</a>` : `con ${esc(c.seller_name)}`}.` : ''}</p>
          <p>¿No puedes finalizar esta compra? Contacta a soporte e indica el código de abajo:<br><span class="code">${esc(code)}</span></p>
          ${Object.keys(saved).length ? '<p>¿Tus datos se completaron automáticamente? <button class="link-btn" type="button" id="clear-data">Borrar mis datos</button>.</p>' : ''}
          <small>Al hacer clic en “${esc(c.button_label)}”, declaro que leí y acepto (i) la ${c.privacy_url ? `<a href="${esc(c.privacy_url)}" target="_blank" rel="noopener">Política de Privacidad</a>` : 'Política de Privacidad'} y (ii) los ${c.terms_url ? `<a href="${esc(c.terms_url)}" target="_blank" rel="noopener">Términos de Compra</a>` : 'Términos de Compra'}.</small>
          ${c.footer_text ? `<small style="margin-top:12px">${esc(c.footer_text)}</small>` : ''}
        </div></footer>
      </div>`;

    // valores salvos
    const set = (id, v) => { const el = $('#f-' + id); if (el && v) el.value = v; };
    set('email', saved.email); set('email2', saved.email); set('name', saved.name);
    set('document', saved.document && (docMode === 'br' ? mask.document(saved.document) : saved.document)); set('phone', saved.phone);

    bind();
    update();
    startCountdown();
  }

  function update() {
    const c = S.cfg, t = calc();
    const head = $('#head-price');
    if (head) head.textContent = brl(c.price_cents);

    const sel = $('#f-installments');
    if (sel) { sel.innerHTML = installmentOptions(); sel.value = String(Math.min(S.installments, t.maxN)); S.installments = +sel.value; }

    const rows = [`<div class="sum-row main"><span>${esc(c.product.name)}</span><span>${brl(c.price_cents)}</span></div>`];
    t.bumps.forEach((b) => rows.push(`<div class="sum-row"><span>${esc(b.title)}</span><span>${brl(b.price_cents)}</span></div>`));
    if (t.couponCents) rows.push(`<div class="sum-row"><span>Cupón ${esc(S.coupon.code)}</span><span class="neg">- ${brl(t.couponCents)}</span></div>`);
    if (t.pixCents) rows.push(`<div class="sum-row"><span>Descuento Pix</span><span class="neg">- ${brl(t.pixCents)}</span></div>`);
    if (rows.length > 1) rows.push(`<div class="sum-row sum-total"><span>Total</span><span>${brl(t.total)}${S.method === 'card' && t.n > 1 ? `<small>${t.n}x de ${brl(Math.ceil(t.total / t.n))}</small>` : ''}</span></div>`);
    $('#summary').innerHTML = rows.join('');
  }

  // ---------- eventos ----------
  function bind() {
    const form = $('#form');
    form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

    $$('.pay-opt', form).forEach((el) => $('.pay-head', el).addEventListener('click', () => {
      S.method = el.dataset.m;
      $$('.pay-opt', form).forEach((o) => { o.classList.toggle('on', o === el); $('.pay-head', o).setAttribute('aria-pressed', o === el); });
      update();
      track('AddPaymentInfo');
    }));

    $$('.bump', form).forEach((el) => {
      const id = +el.dataset.bump, cb = $('input', el);
      cb.addEventListener('change', () => { cb.checked ? S.bumps.add(id) : S.bumps.delete(id); el.classList.toggle('on', cb.checked); update(); });
    });

    const masks = { card_number: mask.card, card_expiry: mask.expiry, card_cvv: mask.cvv };
    if ((S.cfg.document_mode || 'br') === 'br') masks.document = mask.document; // CPF/CNPJ
    Object.entries(masks).forEach(([id, fn]) => { const el = $('#f-' + id); if (el) el.addEventListener('input', () => { el.value = fn(el.value); clearErr(id); }); });
    ['email', 'email2', 'name', 'card_holder', 'phone', 'document'].forEach((id) => { const el = $('#f-' + id); if (el) el.addEventListener('input', () => clearErr(id)); });

    const sel = $('#f-installments'); if (sel) sel.addEventListener('change', () => { S.installments = +sel.value; update(); });

    // lead (carrinho abandonado) quando o e-mail é válido
    const em = $('#f-email');
    em.addEventListener('blur', () => {
      if (PREVIEW || !validEmail(em.value)) return;
      track('InitiateCheckout');
      fetch(`/api/checkout/${slug}/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em.value, name: $('#f-name').value, phone: $('#f-phone')?.value || '' }) }).catch(() => {});
    });

    const tg = $('#cp-toggle');
    if (tg) {
      tg.addEventListener('click', () => { $('#cp-form').classList.toggle('open'); $('#cp-code').focus(); });
      $('#cp-apply').addEventListener('click', applyCoupon);
      $('#cp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });
    }
    const clr = $('#clear-data'); if (clr) clr.addEventListener('click', () => { store.clear(); $$('#form input').forEach((i) => { i.value = ''; }); clr.parentElement.remove(); });
  }

  async function applyCoupon() {
    const code = $('#cp-code').value.trim();
    const msg = $('#cp-msg');
    if (!code) return;
    if (PREVIEW) { msg.style.color = '#6d6d6d'; msg.textContent = 'Los cupones no funcionan en la vista previa.'; return; }
    try {
      const r = await fetch(`/api/checkout/${slug}/coupon`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      S.coupon = j; msg.style.color = '#0b7a35'; msg.textContent = `¡Cupón ${j.code} aplicado!`;
    } catch (e) { S.coupon = null; msg.style.color = '#d92d20'; msg.textContent = e.message || 'Cupón inválido.'; }
    update();
  }

  // ---------- erros ----------
  function setErr(name, text) {
    const f = $(`.field[data-f="${name}"]`); if (!f) return;
    f.classList.add('err'); $('.msg', f).textContent = text;
  }
  function clearErr(name) { const f = $(`.field[data-f="${name}"]`); if (f) f.classList.remove('err'); }
  function showAlert(text) { const a = $('#alert'); a.textContent = text || ''; a.classList.toggle('show', !!text); }

  function validate() {
    const e = {};
    const v = (id) => ($('#f-' + id)?.value || '').trim();
    const mode = S.cfg.document_mode || 'br';
    if (!validEmail(v('email'))) e.email = 'Escribe un correo electrónico válido.';
    if (S.cfg.require_email_confirm && v('email').toLowerCase() !== v('email2').toLowerCase()) e.email2 = 'Los correos no coinciden.';
    if (v('name').split(/\s+/).filter(Boolean).length < 2) e.name = 'Escribe tu nombre completo.';
    if (mode === 'br' && !(validCPF(v('document')) || validCNPJ(v('document')))) e.document = 'CPF o CNPJ inválido.';
    if (mode === 'any' && v('document').replace(/[^A-Za-z0-9]/g, '').length < 5) e.document = 'Escribe un documento válido.';
    if (S.cfg.ask_phone && digits(v('phone')).length < 8) e.phone = 'Escribe un teléfono válido.';
    if (S.method === 'card') {
      if (!luhn(v('card_number'))) e.card_number = 'Número de tarjeta inválido.';
      if (!validExpiry(v('card_expiry'))) e.card_expiry = 'Fecha de vencimiento inválida.';
      if (!/^\d{3,4}$/.test(v('card_cvv'))) e.card_cvv = 'CVV inválido.';
      if (v('card_holder').length < 3) e.card_holder = 'Escribe el nombre del titular.';
    }
    $$('.field.err').forEach((f) => f.classList.remove('err'));
    Object.entries(e).forEach(([k, m]) => setErr(k, m));
    return e;
  }

  function utm() {
    const p = new URLSearchParams(location.search), o = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'src', 'sck', 'fbclid', 'gclid'].forEach((k) => { if (p.get(k)) o[k] = p.get(k).slice(0, 200); });
    return o;
  }

  // ---------- envio ----------
  async function submit() {
    if (S.busy) return;
    showAlert('');
    if (PREVIEW) return showAlert('Modo vista previa: el pago está desactivado.');
    const errs = validate();
    if (Object.keys(errs).length) {
      const first = $('.field.err'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const v = (id) => ($('#f-' + id)?.value || '').trim();
    const t = calc();
    const body = {
      customer: { name: v('name'), email: v('email'), document: (S.cfg.document_mode || 'br') === 'br' ? digits(v('document')) : v('document'), phone: digits(v('phone')) },
      method: S.method, installments: t.n, bumps: [...S.bumps], coupon: S.coupon?.code || '', utm: utm(),
      card: S.method === 'card' ? { number: digits(v('card_number')), holder: v('card_holder'), expiry: v('card_expiry'), cvv: v('card_cvv') } : undefined,
    };
    store.set({ name: body.customer.name, email: body.customer.email, document: body.customer.document, phone: body.customer.phone });

    busy(true);
    try {
      const r = await fetch(`/api/checkout/${slug}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 422 && j.errors) {
        Object.entries(j.errors).forEach(([k, m]) => setErr(k, m));
        showAlert(j.error);
      } else if (!r.ok) {
        showAlert(j.error || 'No pudimos completar la compra. Inténtalo de nuevo.');
      } else {
        track('Purchase', { value: j.total_cents / 100, currency: 'BRL' });
        showResult(j);
      }
    } catch {
      showAlert('Falla de conexión. Revisa tu internet e inténtalo de nuevo.');
    } finally { busy(false); }
  }
  function busy(on) {
    S.busy = on;
    const b = $('#buy'); if (!b) return;
    b.disabled = on;
    b.innerHTML = on ? '<span class="spinner"></span> Procesando...' : esc(S.cfg.button_label);
  }

  // ---------- resultados ----------
  function copy(text, btn) {
    const done = () => { const o = btn.textContent; btn.textContent = '¡Copiado!'; setTimeout(() => (btn.textContent = o), 1800); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const i = btn.previousElementSibling; i.select(); document.execCommand('copy'); done(); }
  }

  function showResult(j) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const box = $('#card-inner');
    if (j.status === 'paid') return showSuccess(j.redirect);

    if (j.pix) {
      box.innerHTML = `<div class="result">
        <h2>Paga con Pix</h2><p>Abre la app de tu banco y escanea el código QR, o usa el código Pix copia y pega.</p>
        ${j.pix.qr ? `<img class="qr" src="${esc(j.pix.qr)}" alt="Código QR Pix">` : ''}
        <div class="copybox"><input readonly value="${esc(j.pix.code)}" aria-label="Código Pix"><button type="button" id="cp-pix">Copiar</button></div>
        <p><b>${brl(j.total_cents)}</b> · vence en <b id="pix-t">--:--</b></p>
        <div class="waiting"><span class="spinner"></span> Esperando la confirmación del pago…</div>
      </div>`;
      $('#cp-pix').addEventListener('click', (e) => copy(j.pix.code, e.currentTarget));
      const exp = new Date(j.pix.expires_at).getTime();
      const tick = () => { const s = Math.max(0, Math.round((exp - Date.now()) / 1000)); const el = $('#pix-t'); if (el) el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
      tick(); const ti = setInterval(() => { tick(); if (!$('#pix-t')) clearInterval(ti); }, 1000);
      return poll(j.orderId);
    }
    if (j.boleto) {
      box.innerHTML = `<div class="result">
        <h2>¡Boleto generado!</h2><p>Págalo antes del vencimiento. Cuando el pago sea acreditado recibirás el acceso por correo electrónico.</p>
        ${j.boleto.barcode ? `<div class="copybox"><input readonly value="${esc(j.boleto.barcode)}" aria-label="Línea digitable"><button type="button" id="cp-bol">Copiar</button></div>` : ''}
        ${j.boleto.url && j.boleto.url !== '#' ? `<a class="btn-buy" style="text-decoration:none" href="${esc(j.boleto.url)}" target="_blank" rel="noopener">Abrir boleto</a>` : ''}
        <p style="margin-top:14px"><b>${brl(j.total_cents)}</b></p>
      </div>`;
      const cb = $('#cp-bol'); if (cb) cb.addEventListener('click', (e) => copy(j.boleto.barcode, e.currentTarget));
      return poll(j.orderId);
    }
    box.innerHTML = '<div class="result"><h2>Pedido recibido</h2><p>Estamos procesando tu pago. Recibirás un correo con la confirmación.</p></div>';
    poll(j.orderId);
  }

  function showSuccess(redirect) {
    clearInterval(S.poll);
    $('#card-inner').innerHTML = `<div class="result">
      <div class="check">${ICON.check}</div>
      <h2>¡Compra aprobada!</h2>
      <p>¡Gracias! Enviamos los detalles y el acceso al producto a tu correo electrónico. Revisa también la carpeta de spam.</p>
      ${redirect ? `<p class="waiting"><span class="spinner"></span> Redirigiendo…</p><br><a href="${esc(redirect)}">Haz clic aquí si no eres redirigido</a>` : ''}
    </div>`;
    if (redirect) setTimeout(() => { location.href = redirect; }, 2500);
  }

  function poll(orderId) {
    clearInterval(S.poll);
    let tries = 0;
    S.poll = setInterval(async () => {
      if (++tries > 600) return clearInterval(S.poll); // ~30 min
      try {
        const r = await fetch(`/api/orders/${orderId}/status`, { cache: 'no-store' });
        const j = await r.json();
        if (j.status === 'paid') showSuccess(j.redirect);
        else if (['refused', 'expired', 'refunded'].includes(j.status)) { clearInterval(S.poll); $('#card-inner').innerHTML = '<div class="result"><h2>Pago no completado</h2><p>El pedido venció o fue rechazado. Actualiza la página para intentarlo de nuevo.</p></div>'; }
      } catch { /* tenta de novo */ }
    }, 3000);
  }

  // ---------- contagem regressiva ----------
  function startCountdown() {
    const m = S.cfg.countdown_minutes;
    if (!m || !$('#cd-t')) return;
    const key = 'ck_cd_' + (S.cfg.slug || 'p');
    let end = 0;
    try { end = +sessionStorage.getItem(key) || 0; } catch { /* ignore */ }
    if (!end || end < Date.now()) { end = Date.now() + m * 60000; try { sessionStorage.setItem(key, end); } catch { /* ignore */ } }
    const tick = () => {
      const el = $('#cd-t'); if (!el) return clearInterval(ti);
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    tick(); const ti = setInterval(tick, 1000);
  }

  // ---------- init ----------
  function notFound(msg) {
    app.innerHTML = `<div class="notfound"><h1>¡Ups!</h1><p>${esc(msg || 'Checkout no disponible.')}</p></div>`;
  }

  async function init() {
    if (PREVIEW) {
      window.addEventListener('message', (e) => {
        if (e.origin !== location.origin || !e.data || e.data.type !== 'checkout-preview') return;
        const y = window.scrollY;
        S.cfg = e.data.config; S.bumps = new Set(); S.coupon = null;
        render(); window.scrollTo(0, y);
      });
      parent.postMessage({ type: 'checkout-preview-ready' }, location.origin);
      return;
    }
    try {
      const r = await fetch(`/api/checkout/${encodeURIComponent(slug)}`);
      if (!r.ok) return notFound('Este checkout no existe o está desactivado.');
      S.cfg = await r.json();
      render();
      loadTracking(S.cfg);
    } catch { notFound('No se pudo cargar el checkout. Inténtalo de nuevo.'); }
  }
  init();
})();
