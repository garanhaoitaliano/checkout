/* Painel admin — SPA sem dependências. Rotas por hash (#/pagina). */
(() => {
  'use strict';

  // ================= utilitários =================
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const moneyStr = (c) => (c === null || c === undefined || c === '' ? '' : (c / 100).toFixed(2).replace('.', ','));
  const parseMoney = (s) => { const t = String(s).trim(); if (!t) return null; const n = Number(t.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : null; };
  const dt = (s) => (s ? new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const STATUS = { pending: 'Pendente', paid: 'Aprovado', refused: 'Recusado', refunded: 'Reembolsado', expired: 'Expirado', chargeback: 'Chargeback' };
  const METHOD = { card: 'Cartão', pix: 'Pix', boleto: 'Boleto' };
  const badge = (s) => `<span class="badge ${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const origin = location.origin;

  const ICONS = {
    dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-3H4z"/></svg>',
    orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h12l2 4v13H4V7zM4 7h16M9 11h6"/></svg>',
    products: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8"/></svg>',
    checkouts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 15h4"/></svg>',
    coupons: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 1 0-6V6H3zM14 6v12" stroke-dasharray="2 2"/></svg>',
    leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 4h2l2.5 11h10L20 7H6.5M9 20h.01M17 20h.01"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.4a7 7 0 0 0-2.2 1.3l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .9.1 1.3l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.4a7 7 0 0 0 2.2-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z"/></svg>',
  };

  function toast(msg, err = false) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), err ? 6000 : 3000);
  }

  async function api(method, path, body) {
    const res = await fetch('/api/admin' + path, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/login') { state.me = null; renderLogin(); throw new Error('Sessão expirada.'); }
    if (!res.ok) throw new Error(data.error || 'Erro inesperado.');
    return data;
  }
  const act = async (fn) => { try { return await fn(); } catch (e) { if (e.message !== 'Sessão expirada.') toast(e.message, true); } };

  function copyText(text, label = 'Copiado!') {
    const done = () => toast(label);
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fb); else fb();
    function fb() { const i = document.createElement('input'); i.value = text; document.body.appendChild(i); i.select(); document.execCommand('copy'); i.remove(); done(); }
  }

  // ---------- modal ----------
  const dlg = $('#modal');
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  function openModal({ title, body, foot = '', onOpen }) {
    dlg.innerHTML = `<div class="m-head"><h2 style="margin:0">${esc(title)}</h2><button class="x" aria-label="Fechar" data-close>×</button></div>
      <div class="m-body">${body}</div>${foot ? `<div class="m-foot">${foot}</div>` : ''}`;
    $$('[data-close]', dlg).forEach((b) => b.addEventListener('click', () => dlg.close()));
    if (!dlg.open) dlg.showModal();
    if (onOpen) onOpen(dlg);
  }
  const closeModal = () => dlg.open && dlg.close();

  // ---------- upload ----------
  function pickAndUpload() {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp,image/gif';
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return resolve(null);
        const fd = new FormData(); fd.append('file', f);
        try {
          const r = await fetch('/api/admin/upload', { method: 'POST', body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          resolve(j.url);
        } catch (e) { toast(e.message || 'Falha no upload.', true); resolve(null); }
      };
      inp.click();
    });
  }
  function uploaderHTML(key, url, hint = '') {
    return `<div class="upl" data-upl="${key}">
      <div class="pv">${url ? `<img src="${esc(url)}" alt="">` : 'sem imagem'}</div>
      <div><button type="button" class="btn sm" data-up>Enviar imagem</button> ${url ? '<button type="button" class="btn sm danger" data-rm>Remover</button>' : ''}
      <div class="hint muted small">${hint}</div></div></div>`;
  }
  function bindUploader(root, key, getUrl, setUrl, rerender) {
    const box = $(`[data-upl="${key}"]`, root); if (!box) return;
    $('[data-up]', box).addEventListener('click', async () => { const u = await pickAndUpload(); if (u) { setUrl(u); rerender(); } });
    const rm = $('[data-rm]', box); if (rm) rm.addEventListener('click', () => { setUrl(''); rerender(); });
  }

  // ================= estado / layout =================
  const state = { me: null };
  const root = $('#root');

  const NAV = [
    ['dashboard', 'Dashboard', 'dash'], ['orders', 'Pedidos', 'orders'], ['checkouts', 'Checkouts', 'checkouts'],
    ['products', 'Produtos', 'products'], ['coupons', 'Cupons', 'coupons'], ['leads', 'Abandonos', 'leads'], ['settings', 'Config.', 'settings'],
  ];
  function layout(active, inner) {
    root.innerHTML = `<div class="shell">
      <aside class="side">
        <div class="brand"><i>$</i> Checkout Pro</div>
        <nav class="nav">${NAV.map(([k, l, i]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${ICONS[i]}<span>${l}</span></a>`).join('')}</nav>
        <div class="grow"></div>
        <div class="user">${esc(state.me.email)}<br><a href="#" id="logout" style="color:#8fb7ff">Sair</a></div>
      </aside>
      <main class="main" id="main">${inner}</main></div>`;
    $('#logout').addEventListener('click', async (e) => { e.preventDefault(); await api('POST', '/logout'); state.me = null; renderLogin(); });
  }

  // ================= login =================
  function renderLogin() {
    root.innerHTML = `<div class="login"><form id="lf">
      <h1>Checkout Pro</h1><p class="muted" style="margin-top:0">Acesse o painel administrativo</p>
      <div class="fld"><label class="l">E-mail</label><input type="email" name="email" autocomplete="username" required autofocus></div>
      <div class="fld"><label class="l">Senha</label><input type="password" name="password" autocomplete="current-password" required></div>
      <button class="btn primary" style="width:100%;justify-content:center" type="submit">Entrar</button>
    </form></div>`;
    $('#lf').addEventListener('submit', (e) => act(async () => {
      e.preventDefault();
      const f = new FormData(e.target);
      await api('POST', '/login', { email: f.get('email'), password: f.get('password') });
      await boot();
    }));
  }

  // ================= dashboard =================
  async function pageDashboard() {
    const days = Number(sessionStorage.getItem('dash_days') || 7);
    const d = await api('GET', `/dashboard?days=${days}`);
    const max = Math.max(1, ...d.series.map((s) => s.revenue));
    const maxM = Math.max(1, ...d.byMethod.map((m) => m.revenue));
    layout('dashboard', `
      <div class="page-head"><h1>Dashboard</h1>
        <select id="days" style="width:auto">${[7, 30, 90].map((n) => `<option value="${n}" ${n === days ? 'selected' : ''}>Últimos ${n} dias</option>`).join('')}</select></div>
      ${state.me.defaultPassword ? '<div class="notice">⚠ Você ainda usa a senha padrão. <a href="#/settings">Troque agora em Configurações</a>.</div>' : ''}
      <div class="grid g4" style="margin-bottom:16px">
        <div class="kpi"><div class="l">Receita aprovada</div><div class="v">${brl(d.revenue)}</div></div>
        <div class="kpi"><div class="l">Vendas aprovadas</div><div class="v">${d.paid}</div></div>
        <div class="kpi"><div class="l">Ticket médio</div><div class="v">${brl(d.ticket)}</div></div>
        <div class="kpi"><div class="l">Conversão (pedidos)</div><div class="v">${(d.conversion * 100).toFixed(1)}%</div></div>
        <div class="kpi"><div class="l">Pedidos gerados</div><div class="v">${d.orders}</div></div>
        <div class="kpi"><div class="l">Pendentes (Pix/boleto)</div><div class="v">${d.pending}</div></div>
        <div class="kpi"><div class="l">Recusados</div><div class="v">${d.refused}</div></div>
        <div class="kpi"><div class="l">Carrinhos abandonados</div><div class="v">${d.abandoned}</div></div>
      </div>
      <div class="grid g2">
        <div class="panel"><h2>Receita por dia</h2>
          ${d.series.length ? `<div class="bars">${d.series.map((s) => `<div class="bar" title="${esc(s.day)}: ${brl(s.revenue)} (${s.paid} vendas)"><i style="height:${Math.max(2, (s.revenue / max) * 100)}%"></i><span>${esc(s.day.slice(8))}/${esc(s.day.slice(5, 7))}</span></div>`).join('')}</div>` : '<div class="empty">Sem vendas no período.</div>'}
        </div>
        <div class="panel"><h2>Por forma de pagamento</h2>
          ${d.byMethod.length ? d.byMethod.map((m) => `<div style="margin-bottom:12px"><div class="inline" style="justify-content:space-between"><b>${METHOD[m.method] || m.method}</b><span>${brl(m.revenue)} · ${m.n} ${m.n === 1 ? 'venda' : 'vendas'}</span></div><div class="hbar"><i style="width:${(m.revenue / maxM) * 100}%"></i></div></div>`).join('') : '<div class="empty">Sem dados.</div>'}
        </div>
        <div class="panel"><h2>Checkouts com mais receita</h2>
          ${d.top.length ? `<table><thead><tr><th>Checkout</th><th class="right">Pedidos</th><th class="right">Aprov.</th><th class="right">Receita</th></tr></thead><tbody>${d.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="right">${t.orders}</td><td class="right">${t.paid}</td><td class="right">${brl(t.revenue)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Sem dados.</div>'}
        </div>
        <div class="panel"><h2>Pedidos recentes</h2>
          ${d.recent.length ? `<table><tbody>${d.recent.map((o) => `<tr class="click" data-o="${esc(o.id)}"><td>${esc(o.customer_name)}<div class="muted small">${esc(o.id)}</div></td><td>${badge(o.status)}</td><td class="right">${brl(o.total_cents)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhum pedido ainda.</div>'}
        </div>
      </div>`);
    $('#days').addEventListener('change', (e) => { sessionStorage.setItem('dash_days', e.target.value); route(); });
    $$('tr[data-o]').forEach((tr) => tr.addEventListener('click', () => showOrder(tr.dataset.o)));
  }

  // ================= pedidos =================
  const oq = { page: 1, status: '', q: '' };
  async function pageOrders() {
    const params = new URLSearchParams({ page: oq.page, ...(oq.status && { status: oq.status }), ...(oq.q && { q: oq.q }) });
    const d = await api('GET', '/orders?' + params);
    layout('orders', `
      <div class="page-head"><h1>Pedidos</h1></div>
      <div class="toolbar">
        <input type="search" id="oq" placeholder="Buscar por nome, e-mail, CPF ou nº do pedido" value="${esc(oq.q)}">
        <select id="os"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${oq.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      <div class="panel table-wrap" style="padding:6px 10px">
        ${d.rows.length ? `<table><thead><tr><th>Pedido</th><th>Cliente</th><th class="hide-m">Checkout</th><th>Pagamento</th><th>Status</th><th class="right">Valor</th><th class="hide-m">Data</th></tr></thead><tbody>
          ${d.rows.map((o) => `<tr class="click" data-o="${esc(o.id)}"><td class="mono">${esc(o.id)}</td><td>${esc(o.customer_name)}<div class="muted small">${esc(o.customer_email)}</div></td><td class="hide-m">${esc(o.checkout_name || '—')}</td><td>${METHOD[o.method] || o.method}</td><td>${badge(o.status)}</td><td class="right nowrap">${brl(o.total_cents)}</td><td class="hide-m nowrap">${dt(o.created_at)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nenhum pedido encontrado.</div>'}
      </div>
      <div class="pager"><span class="muted small">${d.total} pedidos · página ${d.page}/${d.pages}</span>
        <button class="btn sm" id="prev" ${d.page <= 1 ? 'disabled' : ''}>←</button><button class="btn sm" id="next" ${d.page >= d.pages ? 'disabled' : ''}>→</button></div>`);
    $('#oq').addEventListener('input', debounce((e) => { oq.q = e.target.value; oq.page = 1; route(true); }, 350));
    $('#os').addEventListener('change', (e) => { oq.status = e.target.value; oq.page = 1; route(); });
    $('#prev').addEventListener('click', () => { oq.page--; route(); });
    $('#next').addEventListener('click', () => { oq.page++; route(); });
    $$('tr[data-o]').forEach((tr) => tr.addEventListener('click', () => showOrder(tr.dataset.o)));
    if (document.activeElement === document.body && oq.q) { const i = $('#oq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  async function showOrder(id) {
    const o = await act(() => api('GET', '/orders/' + encodeURIComponent(id)));
    if (!o) return;
    const doc = o.customer_document;
    const fmtDoc = doc.length === 11 ? doc.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : doc.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    const actions = [['paid', 'Marcar como pago', o.status === 'pending'], ['refunded', 'Marcar como reembolsado', o.status === 'paid'], ['expired', 'Marcar como expirado', o.status === 'pending']].filter((a) => a[2]);
    openModal({
      title: `Pedido ${o.id}`,
      body: `<dl class="kv">
        <dt>Status</dt><dd>${badge(o.status)}</dd>
        <dt>Cliente</dt><dd>${esc(o.customer_name)}<br>${esc(o.customer_email)}${o.customer_phone ? '<br>' + esc(o.customer_phone) : ''}</dd>
        <dt>CPF/CNPJ</dt><dd>${esc(fmtDoc)}</dd>
        <dt>Checkout</dt><dd>${esc(o.checkout_name || '—')}</dd>
        <dt>Pagamento</dt><dd>${METHOD[o.method] || o.method}${o.method === 'card' ? ` · ${o.installments}x` : ''} · via <b>${esc(o.provider)}</b></dd>
        <dt>ID no gateway</dt><dd class="mono">${esc(o.provider_id || '—')}</dd>
        <dt>Criado em</dt><dd>${dt(o.created_at)}</dd><dt>Pago em</dt><dd>${dt(o.paid_at)}</dd>
        ${o.coupon_code ? `<dt>Cupom</dt><dd>${esc(o.coupon_code)}</dd>` : ''}
        ${o.error ? `<dt>Erro</dt><dd style="color:var(--danger)">${esc(o.error)}</dd>` : ''}
        ${Object.keys(o.utm).length ? `<dt>UTMs</dt><dd class="mono small">${esc(Object.entries(o.utm).map(([k, v]) => `${k}=${v}`).join(' · '))}</dd>` : ''}
      </dl>
      <h3 style="margin-top:18px">Itens</h3>
      <table><tbody>${o.items.map((i) => `<tr><td>${esc(i.name)} ${i.type === 'bump' ? '<span class="badge">bump</span>' : ''}</td><td class="right">${brl(i.price_cents)}</td></tr>`).join('')}
        ${o.discount_cents ? `<tr><td>Descontos</td><td class="right">- ${brl(o.discount_cents)}</td></tr>` : ''}
        <tr><td><b>Total</b></td><td class="right"><b>${brl(o.total_cents)}</b></td></tr></tbody></table>`,
      foot: actions.map((a) => `<button class="btn ${a[0] === 'paid' ? 'primary' : ''}" data-st="${a[0]}">${a[1]}</button>`).join('') + '<button class="btn" data-close>Fechar</button>',
      onOpen: (d) => $$('[data-st]', d).forEach((b) => b.addEventListener('click', () => act(async () => {
        if (!confirm(`${b.textContent}? Isso altera o status no sistema (não move dinheiro no gateway).`)) return;
        await api('POST', `/orders/${o.id}/status`, { status: b.dataset.st }); closeModal(); toast('Status atualizado.'); route();
      }))),
    });
  }

  // ================= produtos =================
  async function pageProducts() {
    const list = await api('GET', '/products');
    layout('products', `
      <div class="page-head"><h1>Produtos</h1><div class="actions"><button class="btn primary" id="new">+ Novo produto</button></div></div>
      <div class="panel table-wrap" style="padding:6px 10px">
        ${list.length ? `<table><thead><tr><th></th><th>Produto</th><th class="right">Preço</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((p) => `<tr><td style="width:56px">${p.image_url ? `<img class="thumb" src="${esc(p.image_url)}" alt="">` : '<div class="thumb"></div>'}</td>
          <td><b>${esc(p.name)}</b><div class="muted small">${esc(p.author)}</div></td><td class="right nowrap">${brl(p.price_cents)}</td>
          <td><span class="badge ${p.active ? 'on' : 'off'}">${p.active ? 'Ativo' : 'Arquivado'}</span></td>
          <td class="right nowrap"><button class="btn sm" data-e="${p.id}">Editar</button> <button class="btn sm danger" data-d="${p.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Cadastre seu primeiro produto para criar um checkout.</div>'}
      </div>`);
    $('#new').addEventListener('click', () => productModal({ active: 1, price_cents: 0 }));
    $$('[data-e]').forEach((b) => b.addEventListener('click', () => productModal(list.find((p) => p.id == b.dataset.e))));
    $$('[data-d]').forEach((b) => b.addEventListener('click', () => act(async () => {
      if (!confirm('Excluir este produto? Se ele já tiver pedidos/checkouts será apenas arquivado.')) return;
      const r = await api('DELETE', '/products/' + b.dataset.d); toast(r.archived ? 'Produto arquivado (possui vínculos).' : 'Produto excluído.'); route();
    })));
  }

  function productModal(p) {
    const P = { ...p };
    const paint = () => openModal({
      title: P.id ? 'Editar produto' : 'Novo produto',
      body: `<div class="fld"><label class="l">Nome do produto *</label><input type="text" name="name" value="${esc(P.name)}"></div>
        <div class="row"><div class="fld"><label class="l">Autor / produtor</label><input type="text" name="author" value="${esc(P.author)}"></div>
        <div class="fld"><label class="l">Preço (R$) *</label><input type="text" inputmode="decimal" name="price" value="${moneyStr(P.price_cents)}" placeholder="0,00"></div></div>
        <div class="fld"><label class="l">Imagem / capa</label>${uploaderHTML('image', P.image_url, 'Recomendado: 400×500 px')}</div>
        <div class="fld"><label class="l">Descrição interna</label><textarea name="description">${esc(P.description)}</textarea></div>
        <div class="fld"><label class="l">URL de entrega (área de membros / download)</label><input type="url" name="delivery_url" value="${esc(P.delivery_url)}" placeholder="https://"></div>
        <div class="fld"><label class="l">URL da página de obrigado (opcional)</label><input type="url" name="thank_you_url" value="${esc(P.thank_you_url)}" placeholder="https://"><div class="hint">Se preenchida, o cliente é redirecionado para cá após a compra aprovada.</div></div>
        <label class="check"><input type="checkbox" name="active" ${P.active ? 'checked' : ''}> Produto ativo</label>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="save">Salvar</button>',
      onOpen: (d) => {
        bindUploader(d, 'image', () => P.image_url, (u) => { sync(d); P.image_url = u; }, paint);
        $('#save', d).addEventListener('click', () => act(async () => {
          sync(d);
          const body = { ...P };
          P.id ? await api('PUT', '/products/' + P.id, body) : await api('POST', '/products', body);
          closeModal(); toast('Produto salvo.'); route();
        }));
      },
    });
    function sync(d) {
      const g = (n) => $(`[name="${n}"]`, d);
      P.name = g('name').value; P.author = g('author').value; P.price_cents = parseMoney(g('price').value) || 0;
      P.description = g('description').value; P.delivery_url = g('delivery_url').value; P.thank_you_url = g('thank_you_url').value; P.active = g('active').checked ? 1 : 0;
    }
    paint();
  }

  // ================= checkouts (lista) =================
  async function pageCheckouts() {
    const list = await api('GET', '/checkouts');
    layout('checkouts', `
      <div class="page-head"><h1>Checkouts</h1><div class="actions"><a class="btn primary" href="#/checkouts/new">+ Novo checkout</a></div></div>
      <div class="panel table-wrap" style="padding:6px 10px">
        ${list.length ? `<table><thead><tr><th>Checkout</th><th class="hide-m">Produto</th><th class="right">Preço</th><th class="right hide-m">Vendas</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="muted small mono">/c/${esc(c.slug)}</div></td><td class="hide-m">${esc(c.product_name)}</td>
          <td class="right nowrap">${brl(c.price_cents ?? c.product_price)}</td><td class="right hide-m">${c.paid}/${c.orders}</td>
          <td><span class="badge ${c.active ? 'on' : 'off'}">${c.active ? 'Ativo' : 'Inativo'}</span></td>
          <td class="right nowrap"><a class="btn sm" href="#/checkouts/${c.id}">Editar</a> <button class="btn sm" data-copy="${esc(c.slug)}">Copiar link</button>
            <a class="btn sm" href="/c/${esc(c.slug)}" target="_blank" rel="noopener">Abrir</a> <button class="btn sm" data-dup="${c.id}">Duplicar</button> <button class="btn sm danger" data-del="${c.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nenhum checkout ainda.</div>'}
      </div>`);
    $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(`${origin}/c/${b.dataset.copy}`, 'Link copiado!')));
    $$('[data-dup]').forEach((b) => b.addEventListener('click', () => act(async () => { await api('POST', `/checkouts/${b.dataset.dup}/duplicate`); toast('Checkout duplicado.'); route(); })));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => act(async () => {
      if (!confirm('Excluir este checkout? Se tiver pedidos será apenas desativado.')) return;
      const r = await api('DELETE', '/checkouts/' + b.dataset.del); toast(r.archived ? 'Checkout desativado (possui pedidos).' : 'Checkout excluído.'); route();
    })));
  }

  // ================= checkout (editor + preview) =================
  const CK_DEFAULTS = {
    name: '', slug: '', product_id: '', price_cents: null, active: 1, banner_url: '', banner_link: '',
    bg_color: '#f3f3f1', card_color: '#ffffff', button_color: '#12a54a', button_text_color: '#ffffff', accent_color: '#12a54a',
    button_label: 'Comprar ahora', methods: ['card', 'pix'], max_installments: 12, min_installment_cents: 500, interest_percent: 0,
    pix_discount_percent: 0, require_email_confirm: 1, ask_phone: 0, document_mode: 'br', countdown_minutes: 0, countdown_text: 'Oferta por tiempo limitado',
    show_coupon: 1, support_email: '', footer_text: '', terms_url: '', privacy_url: '', seller_name: '', facebook_pixel: '', head_script: '', bumps: [],
  };

  async function pageCheckoutEditor(idParam) {
    const products = (await api('GET', '/products')).filter((p) => p.active);
    const isNew = idParam === 'new';
    const M = isNew ? JSON.parse(JSON.stringify(CK_DEFAULTS)) : await api('GET', '/checkouts/' + idParam);
    if (isNew && products[0]) M.product_id = products[0].id;
    let iframeReady = false;

    const toPublic = () => {
      const p = products.find((x) => x.id == M.product_id) || { name: 'Selecione um produto', author: '', price_cents: 0, image_url: '' };
      return {
        slug: M.slug || 'preview', name: M.name, price_cents: M.price_cents ?? p.price_cents,
        product: { name: p.name, author: p.author, description: p.description, image_url: p.image_url },
        bumps: M.bumps.filter((b) => b.active !== 0).map((b, i) => {
          const bp = products.find((x) => x.id == b.product_id) || {};
          return { id: i + 1, title: b.title || bp.name || 'Produto', description: b.description, image_url: bp.image_url, price_cents: b.price_cents || 0, original_price_cents: b.original_price_cents || 0 };
        }),
        theme: { bg_color: M.bg_color, card_color: M.card_color, button_color: M.button_color, button_text_color: M.button_text_color, accent_color: M.accent_color },
        banner_url: M.banner_url, banner_link: M.banner_link, button_label: M.button_label || 'Comprar ahora', document_mode: M.document_mode || 'br',
        methods: M.methods, max_installments: M.max_installments, min_installment_cents: M.min_installment_cents,
        interest_percent: M.interest_percent, pix_discount_percent: M.pix_discount_percent,
        require_email_confirm: !!M.require_email_confirm, ask_phone: !!M.ask_phone,
        countdown_minutes: M.countdown_minutes, countdown_text: M.countdown_text, show_coupon: !!M.show_coupon,
        support_email: M.support_email, footer_text: M.footer_text, terms_url: M.terms_url, privacy_url: M.privacy_url,
        seller_name: M.seller_name, facebook_pixel: '', head_script: '',
      };
    };
    const sendPreview = debounce(() => {
      const f = $('#pv'); if (f && iframeReady) f.contentWindow.postMessage({ type: 'checkout-preview', config: toPublic() }, origin);
    }, 120);
    const onMsg = (e) => { if (e.origin === origin && e.data?.type === 'checkout-preview-ready') { iframeReady = true; sendPreview(); } };
    window.addEventListener('message', onMsg);
    cleanup = () => window.removeEventListener('message', onMsg);

    const v = (k) => esc(M[k] ?? '');
    const chk = (k) => (M[k] ? 'checked' : '');
    const txt = (k, label, extra = '', hint = '') => `<div class="fld"><label class="l">${label}</label><input type="text" data-k="${k}" value="${v(k)}" ${extra}>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const colorF = (k, label) => `<div class="fld"><label class="l">${label}</label><div class="inline"><input type="color" data-k="${k}" value="${v(k)}"><code>${v(k)}</code></div></div>`;
    const link = isNew ? '' : `${origin}/c/${M.slug}`;

    layout('checkouts', `
      <div class="page-head"><h1>${isNew ? 'Novo checkout' : esc(M.name || 'Editar checkout')}</h1>
        <div class="actions"><a class="btn" href="#/checkouts">← Voltar</a>${isNew ? '' : `<a class="btn" href="/c/${esc(M.slug)}" target="_blank" rel="noopener">Abrir checkout</a>`}<button class="btn primary" id="save">Salvar</button></div></div>
      ${isNew ? '' : `<div class="panel"><label class="l">Link do checkout</label><div class="copy-url"><input type="text" readonly value="${esc(link)}"><button class="btn" id="cplink">Copiar</button></div></div>`}
      ${products.length ? '' : '<div class="notice">Cadastre um produto antes: <a href="#/products">ir para Produtos</a>.</div>'}
      <div class="tabs-m"><button class="btn sm" data-tab="form">Editar</button><button class="btn sm" data-tab="prev">Visualizar</button></div>
      <div class="editor show-form" id="ed">
        <div class="form-col">
          <details class="sec" open><summary>Geral</summary><div class="body">
            ${txt('name', 'Nome interno do checkout')}
            <div class="row"><div class="fld"><label class="l">Produto principal</label><select data-k="product_id" data-t="int">${products.map((p) => `<option value="${p.id}" ${p.id == M.product_id ? 'selected' : ''}>${esc(p.name)} — ${brl(p.price_cents)}</option>`).join('')}</select></div>
            <div class="fld"><label class="l">Preço neste checkout (R$)</label><input type="text" inputmode="decimal" data-k="price_cents" data-t="money" value="${moneyStr(M.price_cents)}" placeholder="vazio = preço do produto"></div></div>
            ${txt('slug', 'Endereço (slug)', '', 'Link final: /c/<b>seu-slug</b>. Gerado automaticamente a partir do nome se vazio.')}
            <label class="check"><input type="checkbox" data-k="active" data-t="bool" ${chk('active')}> Checkout ativo (aceitando compras)</label>
          </div></details>

          <details class="sec" open><summary>Aparência e banner</summary><div class="body">
            <div class="fld"><label class="l">Banner (topo da página)</label><div id="up-banner">${uploaderHTML('banner', M.banner_url, 'Recomendado: 1200×400 px (proporção 3:1). PNG, JPG ou WEBP até 5MB.')}</div></div>
            ${txt('banner_link', 'Link do banner (opcional)', 'placeholder="https://"')}
            <div class="grid g2">${colorF('bg_color', 'Cor de fundo da página')}${colorF('card_color', 'Cor do cartão')}${colorF('button_color', 'Cor do botão de compra')}${colorF('button_text_color', 'Cor do texto do botão')}${colorF('accent_color', 'Cor de destaque (bumps, timer)')}</div>
            ${txt('button_label', 'Texto do botão de compra')}
          </div></details>

          <details class="sec"><summary>Pagamento</summary><div class="body">
            <div class="fld"><label class="l">Formas de pagamento</label><div class="chips">
              ${['card', 'pix', 'boleto'].map((m) => `<label class="chip"><input type="checkbox" data-method="${m}" ${M.methods.includes(m) ? 'checked' : ''}>${METHOD[m]}</label>`).join('')}</div></div>
            <div class="row"><div class="fld"><label class="l">Máx. de parcelas</label><input type="number" min="1" max="12" data-k="max_installments" data-t="int" value="${v('max_installments')}"></div>
            <div class="fld"><label class="l">Parcela mínima (R$)</label><input type="text" inputmode="decimal" data-k="min_installment_cents" data-t="money0" value="${moneyStr(M.min_installment_cents)}"></div></div>
            <div class="row"><div class="fld"><label class="l">Juros por parcela (%)</label><input type="number" min="0" step="0.01" data-k="interest_percent" data-t="float" value="${v('interest_percent')}"><div class="hint">0 = parcelamento sem juros.</div></div>
            <div class="fld"><label class="l">Desconto no Pix (%)</label><input type="number" min="0" max="90" step="0.01" data-k="pix_discount_percent" data-t="float" value="${v('pix_discount_percent')}"></div></div>
          </div></details>

          <details class="sec"><summary>Campos e conversão</summary><div class="body">
            <label class="check"><input type="checkbox" data-k="require_email_confirm" data-t="bool" ${chk('require_email_confirm')}> Pedir confirmação de e-mail</label>
            <label class="check"><input type="checkbox" data-k="ask_phone" data-t="bool" ${chk('ask_phone')}> Pedir celular</label>
            <div class="fld" style="margin-top:8px"><label class="l">Campo de documento do comprador</label>
              <select data-k="document_mode"><option value="br" ${M.document_mode === 'br' ? 'selected' : ''}>CPF/CNPJ (Brasil, com validação)</option><option value="any" ${M.document_mode === 'any' ? 'selected' : ''}>Documento de identidad (DNI/CI/RUT… sem validação)</option><option value="none" ${M.document_mode === 'none' ? 'selected' : ''}>Não pedir documento</option></select>
              <div class="hint">Compradores de fora do Brasil não têm CPF. Confirme com a MundPay se ela exige documento para o método escolhido.</div></div>
            <label class="check"><input type="checkbox" data-k="show_coupon" data-t="bool" ${chk('show_coupon')}> Mostrar campo de cupom</label>
            <div class="row" style="margin-top:10px"><div class="fld"><label class="l">Contador regressivo (minutos)</label><input type="number" min="0" data-k="countdown_minutes" data-t="int" value="${v('countdown_minutes')}"><div class="hint">0 = desligado.</div></div>${txt('countdown_text', 'Texto do contador')}</div>
          </div></details>

          <details class="sec"><summary>Order bumps (ofertas adicionais)</summary><div class="body">
            <div id="bumps"></div>
            <button class="btn" id="add-bump" type="button" style="margin-bottom:14px">+ Adicionar order bump</button>
          </div></details>

          <details class="sec"><summary>Rodapé e suporte</summary><div class="body">
            ${txt('seller_name', 'Nome do vendedor / loja')}${txt('support_email', 'E-mail de suporte')}
            <div class="row">${txt('terms_url', 'Link dos Termos de Compra')}${txt('privacy_url', 'Link da Política de Privacidade')}</div>
            <div class="fld"><label class="l">Texto adicional do rodapé</label><textarea data-k="footer_text">${v('footer_text')}</textarea></div>
          </div></details>

          <details class="sec"><summary>Rastreamento</summary><div class="body">
            ${txt('facebook_pixel', 'ID do Pixel do Facebook/Meta', 'inputmode="numeric"', 'Dispara PageView, InitiateCheckout, AddPaymentInfo e Purchase.')}
            <div class="fld"><label class="l">Script personalizado (HTML)</label><textarea data-k="head_script" placeholder="<script>…</script>" class="mono">${v('head_script')}</textarea><div class="hint">Inserido no &lt;head&gt; do checkout (Google Ads, TikTok, UTMify etc.). Só cole códigos de fontes confiáveis.</div></div>
          </div></details>
        </div>

        <div class="preview"><div class="phone"><iframe id="pv" src="/c/preview?preview=1" title="Pré-visualização"></iframe></div>
          <p class="muted small" style="text-align:center">Pré-visualização ao vivo (mobile). Alterações aparecem aqui antes de salvar.</p></div>
      </div>`);

    // ----- binding genérico -----
    const main = $('#main');
    const conv = { int: (x) => parseInt(x, 10) || 0, float: (x) => parseFloat(x) || 0, money: (x) => parseMoney(x), money0: (x) => parseMoney(x) ?? 0, bool: (x) => (x ? 1 : 0) };
    $$('[data-k]', main).forEach((el) => {
      const evt = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'color' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const t = el.dataset.t;
        M[el.dataset.k] = el.type === 'checkbox' ? conv.bool(el.checked) : t ? conv[t](el.value) : el.value;
        if (el.type === 'color' && el.nextElementSibling) el.nextElementSibling.textContent = el.value;
        sendPreview();
      });
      if (el.type === 'color') el.addEventListener('input', () => { M[el.dataset.k] = el.value; if (el.nextElementSibling) el.nextElementSibling.textContent = el.value; sendPreview(); });
    });
    $$('[data-method]', main).forEach((el) => el.addEventListener('change', () => {
      M.methods = $$('[data-method]', main).filter((x) => x.checked).map((x) => x.dataset.method); sendPreview();
    }));
    const repaintBanner = () => { $('#up-banner').innerHTML = uploaderHTML('banner', M.banner_url, 'Recomendado: 1200×400 px (proporção 3:1). PNG, JPG ou WEBP até 5MB.'); bindUploader(main, 'banner', () => M.banner_url, (u) => { M.banner_url = u; }, () => { repaintBanner(); sendPreview(); }); };
    repaintBanner();

    // ----- bumps -----
    const bumpsBox = $('#bumps');
    function paintBumps() {
      bumpsBox.innerHTML = M.bumps.map((b, i) => `<div class="bump-ed" data-i="${i}">
        <div class="row"><div class="fld"><label class="l">Produto</label><select data-bk="product_id" data-t="int">${products.map((p) => `<option value="${p.id}" ${p.id == b.product_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
          <div class="fld"><label class="l">Título exibido</label><input type="text" data-bk="title" value="${esc(b.title)}"></div></div>
        <div class="fld"><label class="l">Descrição</label><textarea data-bk="description" style="min-height:60px">${esc(b.description)}</textarea></div>
        <div class="row"><div class="fld"><label class="l">Preço (R$)</label><input type="text" inputmode="decimal" data-bk="price_cents" data-t="money0" value="${moneyStr(b.price_cents)}"></div>
          <div class="fld"><label class="l">Preço "de" (R$) — riscado</label><input type="text" inputmode="decimal" data-bk="original_price_cents" data-t="money0" value="${moneyStr(b.original_price_cents)}"></div></div>
        <div class="inline" style="justify-content:space-between"><label class="check"><input type="checkbox" data-bk="active" data-t="bool" ${b.active !== 0 ? 'checked' : ''}> Ativo</label>
          <div><button type="button" class="btn sm" data-mv="-1" ${i === 0 ? 'disabled' : ''}>↑</button> <button type="button" class="btn sm" data-mv="1" ${i === M.bumps.length - 1 ? 'disabled' : ''}>↓</button> <button type="button" class="btn sm danger" data-rm>Remover</button></div></div>
      </div>`).join('') || '<p class="muted">Nenhum order bump. Adicione ofertas complementares abaixo do pagamento para aumentar o ticket médio.</p>';
      $$('.bump-ed', bumpsBox).forEach((box) => {
        const i = +box.dataset.i;
        $$('[data-bk]', box).forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
          const t = el.dataset.t;
          M.bumps[i][el.dataset.bk] = el.type === 'checkbox' ? conv.bool(el.checked) : t ? conv[t](el.value) : el.value;
          sendPreview();
        }));
        $$('[data-mv]', box).forEach((b) => b.addEventListener('click', () => { const j = i + +b.dataset.mv; [M.bumps[i], M.bumps[j]] = [M.bumps[j], M.bumps[i]]; paintBumps(); sendPreview(); }));
        $('[data-rm]', box).addEventListener('click', () => { M.bumps.splice(i, 1); paintBumps(); sendPreview(); });
      });
    }
    paintBumps();
    $('#add-bump').addEventListener('click', () => {
      const used = M.bumps.map((b) => b.product_id);
      const p = products.find((x) => x.id != M.product_id && !used.includes(x.id)) || products.find((x) => x.id != M.product_id) || products[0];
      if (!p) return toast('Cadastre outro produto para usar como bump.', true);
      M.bumps.push({ product_id: p.id, title: p.name, description: '', price_cents: p.price_cents, original_price_cents: 0, active: 1 });
      paintBumps(); sendPreview();
    });

    // ----- ações -----
    $('#pv').addEventListener('load', () => { iframeReady = true; sendPreview(); });
    $$('.tabs-m [data-tab]').forEach((b) => b.addEventListener('click', () => { $('#ed').className = 'editor show-' + b.dataset.tab; if (b.dataset.tab === 'prev') sendPreview(); }));
    const cp = $('#cplink'); if (cp) cp.addEventListener('click', () => copyText(link, 'Link copiado!'));
    $('#save').addEventListener('click', (e) => act(async () => {
      if (!M.name.trim()) { toast('Dê um nome ao checkout.', true); return; }
      if (!M.methods.length) { toast('Ative ao menos uma forma de pagamento.', true); return; }
      e.target.disabled = true;
      try {
        const saved = isNew ? await api('POST', '/checkouts', M) : await api('PUT', '/checkouts/' + M.id, M);
        toast('Checkout salvo!');
        if (isNew) location.hash = '#/checkouts/' + saved.id; else route();
      } finally { e.target.disabled = false; }
    }));
  }

  // ================= cupons =================
  async function pageCoupons() {
    const [list, cks] = await Promise.all([api('GET', '/coupons'), api('GET', '/checkouts')]);
    layout('coupons', `
      <div class="page-head"><h1>Cupons</h1><div class="actions"><button class="btn primary" id="new">+ Novo cupom</button></div></div>
      <div class="panel table-wrap" style="padding:6px 10px">
        ${list.length ? `<table><thead><tr><th>Código</th><th>Desconto</th><th class="hide-m">Escopo</th><th>Usos</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map((c) => `<tr><td><b class="mono">${esc(c.code)}</b></td><td>${c.type === 'percent' ? c.value + '%' : brl(Math.round(c.value * 100))}</td>
          <td class="hide-m">${esc(c.checkout_name || 'Todos os checkouts')}</td><td>${c.uses}${c.max_uses ? '/' + c.max_uses : ''}</td>
          <td><span class="badge ${c.active ? 'on' : 'off'}">${c.active ? 'Ativo' : 'Inativo'}</span></td>
          <td class="right nowrap"><button class="btn sm" data-e="${c.id}">Editar</button> <button class="btn sm danger" data-d="${c.id}">Excluir</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nenhum cupom criado.</div>'}
      </div>`);
    const modal = (c) => openModal({
      title: c.id ? 'Editar cupom' : 'Novo cupom',
      body: `<div class="row"><div class="fld"><label class="l">Código *</label><input type="text" name="code" value="${esc(c.code)}" style="text-transform:uppercase" placeholder="BEMVINDO10"></div>
        <div class="fld"><label class="l">Tipo</label><select name="type"><option value="percent" ${c.type !== 'fixed' ? 'selected' : ''}>Percentual (%)</option><option value="fixed" ${c.type === 'fixed' ? 'selected' : ''}>Valor fixo (R$)</option></select></div>
        <div class="fld"><label class="l">Valor *</label><input type="text" name="value" inputmode="decimal" value="${c.value ?? ''}"></div></div>
        <div class="fld"><label class="l">Válido para</label><select name="checkout_id"><option value="">Todos os checkouts</option>${cks.map((k) => `<option value="${k.id}" ${k.id == c.checkout_id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</select></div>
        <div class="row"><div class="fld"><label class="l">Limite de usos (0 = ilimitado)</label><input type="number" min="0" name="max_uses" value="${c.max_uses || 0}"></div>
        <div class="fld"><label class="l">Expira em</label><input type="date" name="expires_at" value="${esc((c.expires_at || '').slice(0, 10))}" style="width:100%;padding:8px;border:1px solid #cfd4de;border-radius:8px"></div></div>
        <label class="check"><input type="checkbox" name="active" ${c.active !== 0 ? 'checked' : ''}> Cupom ativo</label>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="save">Salvar</button>',
      onOpen: (d) => $('#save', d).addEventListener('click', () => act(async () => {
        const g = (n) => $(`[name="${n}"]`, d);
        const body = { code: g('code').value, type: g('type').value, value: parseFloat(g('value').value.replace(',', '.')) || 0, checkout_id: g('checkout_id').value, max_uses: g('max_uses').value, expires_at: g('expires_at').value, active: g('active').checked };
        c.id ? await api('PUT', '/coupons/' + c.id, body) : await api('POST', '/coupons', body);
        closeModal(); toast('Cupom salvo.'); route();
      })),
    });
    $('#new').addEventListener('click', () => modal({}));
    $$('[data-e]').forEach((b) => b.addEventListener('click', () => modal(list.find((c) => c.id == b.dataset.e))));
    $$('[data-d]').forEach((b) => b.addEventListener('click', () => act(async () => { if (!confirm('Excluir este cupom?')) return; await api('DELETE', '/coupons/' + b.dataset.d); route(); })));
  }

  // ================= abandonos =================
  async function pageLeads() {
    const list = await api('GET', '/leads');
    layout('leads', `
      <div class="page-head"><h1>Carrinhos abandonados</h1><div class="actions"><button class="btn" id="csv" ${list.length ? '' : 'disabled'}>Exportar CSV</button></div></div>
      <p class="muted">Pessoas que digitaram o e-mail no checkout. Quem comprou aparece como “Convertido”. Use a lista para recuperação por e-mail/WhatsApp.</p>
      <div class="panel table-wrap" style="padding:6px 10px">
        ${list.length ? `<table><thead><tr><th>E-mail</th><th>Nome</th><th class="hide-m">Checkout</th><th>Atualizado</th><th>Situação</th><th></th></tr></thead><tbody>
        ${list.map((l) => `<tr><td>${esc(l.email)}</td><td>${esc(l.name || '—')}</td><td class="hide-m">${esc(l.checkout_name || '—')}</td><td class="nowrap">${dt(l.updated_at)}</td>
          <td><span class="badge ${l.converted ? 'paid' : 'pending'}">${l.converted ? 'Convertido' : 'Abandonou'}</span></td>
          <td class="right nowrap"><button class="btn sm" data-c="${esc(l.email)}">Copiar</button> <button class="btn sm danger" data-d="${l.id}">×</button></td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Nenhum lead capturado ainda.</div>'}
      </div>`);
    $$('[data-c]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.c, 'E-mail copiado!')));
    $$('[data-d]').forEach((b) => b.addEventListener('click', () => act(async () => { await api('DELETE', '/leads/' + b.dataset.d); route(); })));
    const csv = $('#csv'); if (csv) csv.addEventListener('click', () => {
      const q = (s) => `"${String(s ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
      const rows = [['email', 'nome', 'telefone', 'checkout', 'convertido', 'atualizado'], ...list.map((l) => [l.email, l.name, l.phone, l.checkout_name, l.converted ? 'sim' : 'nao', l.updated_at])];
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
      a.download = 'abandonos.csv'; a.click();
    });
  }

  // ================= configurações =================
  async function pageSettings() {
    const [s, logs] = await Promise.all([api('GET', '/settings'), api('GET', '/webhook-logs')]);
    layout('settings', `
      <div class="page-head"><h1>Configurações</h1><div class="actions"><button class="btn primary" id="save">Salvar</button></div></div>
      <div class="panel"><h2>Gateway de pagamento</h2>
        <div class="fld"><label class="l">Provedor ativo</label>
          <select id="provider"><option value="mock" ${s.payment_provider === 'mock' ? 'selected' : ''}>Simulação (testes — não cobra de verdade)</option><option value="mundpay" ${s.payment_provider === 'mundpay' ? 'selected' : ''}>MundPay (produção)</option></select></div>
        <div id="mp" class="${s.payment_provider === 'mundpay' ? '' : 'hidden'}">
          <div class="notice info">Credenciais ficam guardadas no servidor e nunca vão para o navegador do cliente. O mapeamento dos campos da API está em <code>server/payments/mundpay.js</code>.</div>
          <div class="fld"><label class="l">URL base da API MundPay</label><input type="url" id="mp_url" value="${esc(s.mundpay_base_url)}" placeholder="https://api.mundpay.com/v1"></div>
          <div class="fld"><label class="l">Chave de API (secret key)</label><input type="password" id="mp_key" value="${esc(s.mundpay_api_key)}" autocomplete="off" placeholder="cole sua chave"></div>
          <div class="fld"><label class="l">Token do webhook</label><div class="copy-url"><input type="text" id="mp_tok" value="${esc(s.mundpay_webhook_token)}" readonly><button class="btn" id="gen">Gerar novo</button></div></div>
          <div class="fld"><label class="l">URL de webhook (cadastre no painel da MundPay)</label><div class="copy-url"><input type="text" readonly value="${esc(s.webhook_url)}"><button class="btn" id="cpw">Copiar</button></div>
            <div class="hint">Use uma URL pública HTTPS (defina <code>PUBLIC_URL</code> no .env em produção).</div></div>
        </div>
        <div class="fld"><label class="l">Métodos habilitados na sua conta do gateway</label>
          <div class="chips">${['card', 'pix', 'boleto'].map((m) => `<label class="chip"><input type="checkbox" data-em="${m}" ${s.enabled_methods.includes(m) ? 'checked' : ''}>${METHOD[m]}</label>`).join('')}</div>
          <div class="hint">O checkout só oferece métodos marcados aqui <b>e</b> ativos no checkout. Desmarque o que a MundPay não liberou para sua conta (ex.: Pix e boleto só existem no Brasil).</div></div>
        <div id="mock-note" class="notice ${s.payment_provider === 'mock' ? '' : 'hidden'}">Modo simulação: cartão aprovado por padrão; use CVV <b>000</b> para simular recusa. O Pix é confirmado automaticamente após ~15s.</div>
      </div>

      <div class="panel"><h2>Alterar senha</h2>
        <div class="row"><div class="fld"><label class="l">Senha atual</label><input type="password" id="pw0" autocomplete="current-password"></div>
        <div class="fld"><label class="l">Nova senha (mín. 8)</label><input type="password" id="pw1" autocomplete="new-password"></div></div>
        <button class="btn" id="pw-save">Alterar senha</button></div>

      <div class="panel"><h2>Últimos webhooks recebidos</h2>
        ${logs.length ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Provedor</th><th>Resultado</th></tr></thead><tbody>${logs.map((l) => `<tr><td class="nowrap">${dt(l.created_at)}</td><td>${esc(l.provider)}</td><td>${esc(l.result)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nenhum webhook recebido ainda.</div>'}
      </div>`);
    $('#provider').addEventListener('change', (e) => { $('#mp').classList.toggle('hidden', e.target.value !== 'mundpay'); $('#mock-note').classList.toggle('hidden', e.target.value !== 'mock'); });
    $('#save').addEventListener('click', () => act(async () => {
      await api('PUT', '/settings', {
        payment_provider: $('#provider').value, mundpay_base_url: $('#mp_url')?.value, mundpay_api_key: $('#mp_key')?.value,
        enabled_methods: $$('[data-em]').filter((x) => x.checked).map((x) => x.dataset.em),
      });
      toast('Configurações salvas.'); route();
    }));
    const gen = $('#gen'); if (gen) gen.addEventListener('click', () => act(async () => { if (s.mundpay_webhook_token && !confirm('Gerar um novo token invalida o anterior. Continuar?')) return; await api('POST', '/settings/generate-token'); toast('Novo token gerado. Atualize a URL na MundPay.'); route(); }));
    const cpw = $('#cpw'); if (cpw) cpw.addEventListener('click', () => copyText(s.webhook_url, 'URL copiada!'));
    $('#pw-save').addEventListener('click', () => act(async () => { await api('POST', '/password', { current: $('#pw0').value, next: $('#pw1').value }); toast('Senha alterada.'); $('#pw0').value = $('#pw1').value = ''; }));
  }

  // ================= roteador =================
  let cleanup = null;
  async function route(keepFocus) {
    if (!state.me) return;
    if (cleanup) { cleanup(); cleanup = null; }
    const parts = (location.hash.replace(/^#\//, '') || 'dashboard').split('/');
    try {
      switch (parts[0]) {
        case 'orders': return await pageOrders();
        case 'products': return await pageProducts();
        case 'checkouts': return parts[1] ? await pageCheckoutEditor(parts[1]) : await pageCheckouts();
        case 'coupons': return await pageCoupons();
        case 'leads': return await pageLeads();
        case 'settings': return await pageSettings();
        default: return await pageDashboard();
      }
    } catch (e) { if (e.message !== 'Sessão expirada.') { layout('', `<div class="empty">Erro: ${esc(e.message)}</div>`); } }
  }
  window.addEventListener('hashchange', () => route());

  async function boot() {
    try { state.me = await api('GET', '/me'); } catch { return renderLogin(); }
    route();
  }
  boot();
})();
