(() => {
  'use strict';

  /* ── helpers ── */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
  const thisMonth = () => todayStr().slice(0, 7);
  const monthName = (ym) => new Date(+ym.slice(0,4), +ym.slice(5,7)-1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const shortMonth = (ym) => new Date(+ym.slice(0,4), +ym.slice(5,7)-1, 1)
    .toLocaleDateString('en-IN', { month: 'short' });
  const dateFmt = (d) => d ? new Date(d + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const nTx = (n) => `${n} transaction${n === 1 ? '' : 's'}`;
  const pct = (v, t) => (t > 0 ? Math.min(100, Math.round((v / t) * 100)) : 0);
  let currency = 'INR';
  const money = (n, d = 0) => new Intl.NumberFormat('en-IN', {
    style: 'currency', currency,
    minimumFractionDigits: d, maximumFractionDigits: d
  }).format(n || 0);

  /* ── state ── */
  let token = localStorage.getItem('sw_token');
  let user = null;
  let charts = [];
  let modalHandler = null;
  const cache = { tx: new Map(), cats: new Map(), cards: new Map() };
  const state = { month: thisMonth(), tx: { month: thisMonth(), type: '', q: '' } };

  /* ── api ── */
  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      logout(); throw new Error('Session expired. Please sign in again.');
    }
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  /* ── toast ── */
  function toast(msg, type = 'good') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + type;
    clearTimeout(toast._id);
    toast._id = setTimeout(() => (t.className = ''), 3000);
  }

  /* ── auth ── */
  function setSession(d) {
    token = d.token;
    localStorage.setItem('sw_token', token);
    user = d.user;
  }

  function logout() {
    token = null; user = null;
    localStorage.removeItem('sw_token');
    destroyCharts();
    $('#app').hidden = true;
    $('#auth').hidden = false;
    $('#loginForm').reset();
    $('#registerForm').reset();
    $('#loginErr').textContent = '';
    $('#registerErr').textContent = '';
    setAuthTab('login');
  }

  function setAuthTab(tab) {
    const titles = {
      login:    { h: 'Welcome back',   s: 'Sign in to your Spend Wise account' },
      register: { h: 'Create account', s: 'Start tracking your finances today'  },
    };
    const t = titles[tab];
    if (t) { $('#authTitle').textContent = t.h; $('#authSub').textContent = t.s; }
    document.querySelectorAll('.tab').forEach((el) =>
      el.classList.toggle('on', el.dataset.tab === tab));
    $('#loginForm').hidden    = (tab !== 'login');
    $('#registerForm').hidden = (tab !== 'register');
  }

  async function boot() {
    if (token) {
      try {
        const me = await api('/auth/me');
        user = me;
        currency = me.currency || 'INR';
        return enterApp();
      } catch {
        token = null;
        localStorage.removeItem('sw_token');
      }
    }
    $('#auth').hidden = false;
  }

  async function enterApp() {
    if (!user.currency) {
      try { currency = (await api('/profile')).currency_code || 'INR'; } catch { /**/ }
    }
    $('#auth').hidden = true;
    $('#app').hidden  = false;
    const initials = (user.full_name || 'U').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    $('#userChip').textContent      = user.full_name;
    $('#sideUserName').textContent  = user.full_name;
    $('#sideUser').textContent      = user.email;
    $('#sideAvatar').textContent    = initials;
    if (!location.hash) location.hash = '#/dashboard';
    route();
  }

  async function submitAuth(form, path, errEl, build) {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    errEl.textContent = '';
    try {
      setSession(await api(path, { method: 'POST', body: build(Object.fromEntries(new FormData(form))) }));
      form.reset();
      await enterApp();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      btn.disabled = false;
    }
  }

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/auth/login', $('#loginErr'), (d) => d);
  });
  $('#registerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth(e.target, '/auth/register', $('#registerErr'), (d) => ({
      full_name:          d.full_name,
      email:              d.email,
      password:           d.password,
      net_monthly_income: Number(d.net_monthly_income) || 0,
      target_savings:     Number(d.target_savings)     || 0,
    }));
  });

  /* ── mobile sidebar ── */
  $('#menuToggle').addEventListener('click', () => {
    $('#sidebar').classList.toggle('open');
    $('#sideOverlay').classList.toggle('show');
  });
  $('#sideOverlay').addEventListener('click', () => {
    $('#sidebar').classList.remove('open');
    $('#sideOverlay').classList.remove('show');
  });

  /* ── modal ── */
  function openModal(title, html, onSubmit, label = 'Save') {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML    = html;
    $('#modalErr').textContent   = '';
    $('#modalSubmit').textContent = label;
    modalHandler = onSubmit;
    $('#modal').showModal();
  }
  $('#modalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#modalSubmit');
    btn.disabled = true;
    try {
      await modalHandler(Object.fromEntries(new FormData(e.target)));
      $('#modal').close();
    } catch (err) {
      $('#modalErr').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  /* form field builders */
  const inp = (label, name, val = '', attrs = '') =>
    `<label class="f"><span>${label}</span><input name="${name}" value="${esc(val)}" ${attrs}></label>`;
  const sel = (label, name, opts, val) =>
    `<label class="f"><span>${label}</span><select name="${name}">
      ${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}
    </select></label>`;

  /* ── charts ── */
  const destroyCharts = () => { charts.forEach((c) => c.destroy()); charts = []; };
  const palette = ['#3A7050','#4D8B64','#6BA882','#A8D4B8','#22442F','#A8741A','#2D5C3F'];

  function mkChart(id, cfg) {
    const el = $('#' + id);
    if (!window.Chart || !el) return;
    Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    Chart.defaults.color       = '#6B7280';
    charts.push(new Chart(el, {
      ...cfg,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true } } },
        ...cfg.options,
      },
    }));
  }

  /* ── routing ── */
  const views = { dashboard, transactions, portfolio, predictions, cards, profile };
  const pageInfo = {
    dashboard:    { title: 'Dashboard',       sub: 'Your financial overview'    },
    transactions: { title: 'Transactions',    sub: 'All income and expenses'    },
    portfolio:    { title: 'Spend Portfolio', sub: 'Budget by category'         },
    predictions:  { title: 'Forecast',        sub: 'Next month ML prediction'   },
    cards:        { title: 'Credit Cards',    sub: 'Manage your cards'          },
    profile:      { title: 'Profile',         sub: 'Account & preferences'      },
  };

  async function route() {
    if (!token) return;
    const name = location.hash.replace('#/', '') || 'dashboard';
    const key  = views[name] ? name : 'dashboard';
    document.querySelectorAll('.nav a').forEach((a) =>
      a.classList.toggle('on', a.dataset.route === key));
    const info = pageInfo[key] || {};
    $('#title').textContent       = info.title || key;
    $('#pageSubtitle').textContent = info.sub   || '';
    destroyCharts();
    $('#view').innerHTML = '<p class="loading">Loading…</p>';
    $('#sidebar').classList.remove('open');
    $('#sideOverlay').classList.remove('show');
    try {
      await views[key]($('#view'));
    } catch (e) {
      $('#view').innerHTML =
        `<div class="panel"><div class="empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg><p>${esc(e.message)}</p></div></div>`;
    }
  }
  window.addEventListener('hashchange', route);

  /* ══════════════════════════════════════
     DASHBOARD
  ══════════════════════════════════════ */
  async function dashboard(el) {
    const d = await api('/dashboard?month=' + state.month);
    const saved      = d.savings;
    const overBudget = d.plannedTotal > 0 && d.expenses > d.plannedTotal;

    el.innerHTML = `
      <div class="hero">
        <div>
          <div class="hero-label">${monthName(d.month)}</div>
          <div class="hero-value">${saved < 0 ? 'Overspent ' : 'Saved '} ${money(Math.abs(saved))}</div>
          <div class="hero-sub">${d.income > 0
            ? `Income ${money(d.income)} · Expenses ${money(d.expenses)}`
            : 'No income recorded yet this month.'}</div>
        </div>
        ${d.targetSavings ? `
          <div class="hero-badge">
            <div class="hero-badge-val">${pct(Math.max(0,saved), d.targetSavings)}%</div>
            <div class="hero-badge-label">of ${money(d.targetSavings)} goal</div>
          </div>` : ''}
      </div>

      <div class="toolbar">
        <label class="f">
          <span>View month</span>
          <input type="month" id="monthPick" value="${esc(d.month)}" style="min-width:155px">
        </label>
      </div>

      <div class="kpis">
        <div class="kpi success-kpi">
          <div class="kpi-label">Income</div>
          <div class="kpi-value">${money(d.income)}</div>
          <div class="kpi-sub">${d.income > 0 ? 'Recorded this month' : 'Using profile baseline'}</div>
        </div>
        <div class="kpi ${overBudget ? 'danger-kpi' : ''}">
          <div class="kpi-label">Expenses</div>
          <div class="kpi-value ${overBudget ? 'neg' : ''}">${money(d.expenses)}</div>
          <div class="kpi-sub">${d.plannedTotal ? `of ${money(d.plannedTotal)} budgeted` : 'No budget set'}</div>
        </div>
        <div class="kpi ${saved < 0 ? 'danger-kpi' : 'success-kpi'}">
          <div class="kpi-label">Net savings</div>
          <div class="kpi-value ${saved < 0 ? 'neg' : 'pos'}">${money(saved)}</div>
          <div class="kpi-sub">${d.income > 0 ? d.savingsRate + '% of income' : ''}</div>
        </div>
        <div class="kpi ${d.targetSavings && saved >= d.targetSavings ? 'success-kpi' : d.targetSavings ? 'warn-kpi' : ''}">
          <div class="kpi-label">Savings goal</div>
          <div class="kpi-value">${d.targetSavings ? money(d.targetSavings) : '—'}</div>
          <div class="kpi-sub">${d.targetSavings
            ? (saved >= d.targetSavings ? '✓ Goal reached this month' : 'Not reached yet')
            : 'Set one in Profile'}</div>
        </div>
      </div>

      <div class="grid2">
        <div class="panel">
          <div class="panel-title">Income vs Expenses <small>Last 6 months</small></div>
          <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-title">Spending by Category <small>${monthName(d.month)}</small></div>
          ${d.expenses > 0
            ? '<div class="chart-wrap"><canvas id="catChart"></canvas></div>'
            : '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 3.055A9 9 0 1020.945 13H11V3.055z"/></svg><p>No spending recorded this month yet.</p></div>'}
        </div>
      </div>

      <div class="panel" style="margin-bottom:1.1rem">
        <div class="panel-title">Budget Progress <small>${monthName(d.month)}</small></div>
        ${d.categories.length ? `
          <div class="tablewrap"><table>
            <thead><tr>
              <th>Category</th><th>Progress</th>
              <th class="num">Spent</th><th class="num">Budget</th><th class="num">Remaining</th>
            </tr></thead>
            <tbody>
              ${d.categories.map((c) => {
                const over = c.planned > 0 && c.spent > c.planned;
                const p2   = pct(c.spent, c.planned);
                const rem  = c.planned > 0 ? c.planned - c.spent : null;
                return `<tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:.5rem">
                      <span class="dot" style="background:${esc(c.color||'#6BA882')}"></span>
                      <span class="tx-desc">${esc(c.name)}</span>
                      ${over ? '<span class="badge expense" style="font-size:.68rem">Over</span>' : ''}
                    </div>
                  </td>
                  <td style="min-width:100px">
                    ${c.planned > 0
                      ? `<div class="progress"><div class="progress-fill ${over ? 'over' : p2 > 80 ? 'warn' : ''}" style="width:${p2}%"></div></div>`
                      : '<span style="color:var(--n400);font-size:.78rem">No budget</span>'}
                  </td>
                  <td class="num"><b style="color:${over ? 'var(--danger)' : 'inherit'}">${money(c.spent)}</b></td>
                  <td class="num">${c.planned ? money(c.planned) : '—'}</td>
                  <td class="num">
                    <span style="color:${rem === null ? 'var(--n400)' : rem < 0 ? 'var(--danger)' : 'var(--success)'}">
                      ${rem === null ? '—' : (rem < 0 ? '−' : '+') + money(Math.abs(rem))}
                    </span>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>`
          : '<div class="empty"><p>Add categories in Spend Portfolio to see budget progress.</p></div>'}
      </div>

      <div class="grid2">
        <div class="panel">
          <div class="panel-title">Recent Transactions</div>
          ${d.recent.length ? `
            <div class="item-list">
              ${d.recent.map((t) => `
                <div class="list-item">
                  <div class="list-item-left">
                    <div class="list-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${t.transaction_type === 'income'
                          ? '<path d="M12 5v14M5 12l7-7 7 7"/>'
                          : '<path d="M12 19V5M5 12l7 7 7-7"/>'}
                      </svg>
                    </div>
                    <div>
                      <div class="list-title">${esc(t.description)}</div>
                      <div class="list-meta">${esc(t.category)} · ${dateFmt(t.transaction_date)}</div>
                    </div>
                  </div>
                  <div class="list-amount ${t.transaction_type === 'income' ? 'pos' : 'neg'}">
                    ${t.transaction_type === 'income' ? '+' : '−'}${money(t.amount, 2)}
                  </div>
                </div>`).join('')}
            </div>`
          : '<div class="empty"><p>No transactions yet. Add your first one.</p></div>'}
        </div>
        <div class="panel">
          <div class="panel-title">Upcoming Card Payments</div>
          ${d.dues.length ? `
            <div class="due-list">
              ${d.dues.map((c) => `
                <div class="due-item">
                  <div>
                    <div class="due-bank">${esc(c.card_nickname || c.bank_name)}</div>
                    <div class="due-num">••${esc(c.last_four)}</div>
                  </div>
                  <div class="due-date">${dateFmt(c.due_date)}</div>
                </div>`).join('')}
            </div>`
          : '<div class="empty"><p>No upcoming card payments set.</p></div>'}
        </div>
      </div>`;

    $('#monthPick').addEventListener('change', (e) => {
      if (e.target.value) { state.month = e.target.value; route(); }
    });

    mkChart('trendChart', {
      type: 'bar',
      data: {
        labels: d.trend.map((t) => shortMonth(t.month)),
        datasets: [
          { label: 'Income',   data: d.trend.map((t) => t.income),   backgroundColor: '#6BA882', borderRadius: 4, borderSkipped: false },
          { label: 'Expenses', data: d.trend.map((t) => t.expenses), backgroundColor: '#22442F', borderRadius: 4, borderSkipped: false },
        ],
      },
      options: {
        scales: {
          y: { ticks: { callback: (v) => money(v) }, grid: { color: '#F3F4F6' } },
          x: { grid: { display: false } },
        },
      },
    });

    if (d.expenses > 0) {
      const sp = d.categories.filter((c) => c.spent > 0);
      mkChart('catChart', {
        type: 'doughnut',
        data: {
          labels: sp.map((c) => c.name),
          datasets: [{
            data: sp.map((c) => c.spent),
            backgroundColor: sp.map((c, i) => (c.color && c.color !== '#D2E4D4' ? c.color : palette[i % palette.length])),
            borderWidth: 2, borderColor: '#fff', hoverBorderWidth: 3,
          }],
        },
        options: { cutout: '65%' },
      });
    }
  }

  /* ══════════════════════════════════════
     TRANSACTIONS
  ══════════════════════════════════════ */
  async function transactions(el) {
    const f  = state.tx;
    const qs = new URLSearchParams({ limit: 200 });
    if (f.month) qs.set('month', f.month);
    if (f.type)  qs.set('type',  f.type);
    if (f.q)     qs.set('q',     f.q);
    const rows = await api('/transactions?' + qs);
    cache.tx   = new Map(rows.map((t) => [String(t.id), t]));
    const inc  = rows.filter((t) => t.transaction_type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp  = rows.filter((t) => t.transaction_type === 'expense').reduce((s, t) => s + t.amount, 0);

    el.innerHTML = `
      <div class="kpis" style="margin-bottom:1rem">
        <div class="kpi success-kpi">
          <div class="kpi-label">Total income</div>
          <div class="kpi-value pos">${money(inc)}</div>
          <div class="kpi-sub">${nTx(rows.filter((t) => t.transaction_type === 'income').length)}</div>
        </div>
        <div class="kpi danger-kpi">
          <div class="kpi-label">Total expenses</div>
          <div class="kpi-value neg">${money(exp)}</div>
          <div class="kpi-sub">${nTx(rows.filter((t) => t.transaction_type === 'expense').length)}</div>
        </div>
        <div class="kpi ${inc - exp < 0 ? 'danger-kpi' : 'success-kpi'}">
          <div class="kpi-label">Net</div>
          <div class="kpi-value ${inc - exp < 0 ? 'neg' : 'pos'}">${money(inc - exp)}</div>
          <div class="kpi-sub">${rows.length} total records</div>
        </div>
      </div>

      <div class="toolbar">
        <label class="f"><span>Month</span>
          <input type="month" id="fMonth" value="${esc(f.month)}" style="min-width:150px">
        </label>
        <label class="f"><span>Type</span>
          <select id="fType" style="min-width:120px">
            <option value="">All types</option>
            <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Expenses</option>
            <option value="income"  ${f.type === 'income'  ? 'selected' : ''}>Income</option>
          </select>
        </label>
        <label class="f grow"><span>Search</span>
          <input id="fQ" type="search" placeholder="Search descriptions…" value="${esc(f.q)}">
        </label>
        <div class="toolbar-actions">
          <button class="btn" data-action="add-tx">+ Add Transaction</button>
        </div>
      </div>

      <div class="panel">
        ${rows.length ? `
          <div class="tablewrap"><table>
            <thead><tr>
              <th>Date</th><th>Description</th><th>Category</th><th>Type</th>
              <th class="num">Amount</th><th></th>
            </tr></thead>
            <tbody>
              ${rows.map((t) => `<tr>
                <td style="white-space:nowrap;color:var(--n400);font-size:.8rem">${dateFmt(t.transaction_date)}</td>
                <td>
                  <div class="tx-desc">${esc(t.description)}</div>
                  ${t.notes ? `<div class="tx-meta">${esc(t.notes)}</div>` : ''}
                </td>
                <td>
                  ${t.color ? `<span class="dot" style="background:${esc(t.color)};margin-right:.35rem"></span>` : ''}
                  <span style="font-size:.83rem">${esc(t.category)}</span>
                </td>
                <td><span class="badge ${t.transaction_type}">${t.transaction_type === 'income' ? 'Income' : 'Expense'}</span></td>
                <td class="num">
                  <b style="color:${t.transaction_type === 'income' ? 'var(--success)' : 'var(--danger)'}">
                    ${t.transaction_type === 'income' ? '+' : '−'}${money(t.amount, 2)}
                  </b>
                </td>
                <td class="num" style="white-space:nowrap">
                  <button class="btn ghost small" data-action="edit-tx" data-id="${t.id}">Edit</button>
                  <button class="btn danger small" style="margin-left:.3rem" data-action="del-tx" data-id="${t.id}">Delete</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table></div>`
          : `<div class="empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
                <rect x="9" y="3" width="6" height="4" rx="1"/>
              </svg>
              <p>No transactions match your filters.</p>
            </div>`}
      </div>`;

    $('#fMonth').addEventListener('change', (e) => { f.month = e.target.value; route(); });
    $('#fType').addEventListener('change',  (e) => { f.type  = e.target.value; route(); });
    let timer;
    $('#fQ').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { f.q = e.target.value.trim(); route(); }, 350);
    });
  }

  async function txForm(t) {
    const [cats, cds] = await Promise.all([api('/portfolio'), api('/cards')]);
    openModal(t ? 'Edit Transaction' : 'Add Transaction',
      sel('Type', 'transaction_type',
        [['expense', 'Expense'], ['income', 'Income']], t?.transaction_type || 'expense') +
      inp('Description', 'description', t?.description, 'required maxlength="255" placeholder="e.g. Groceries, Salary"') +
      `<div class="row2">
        ${inp('Amount (₹)', 'amount', t?.amount, 'type="number" step="0.01" min="0.01" required placeholder="0.00"')}
        ${inp('Date', 'transaction_date', t?.transaction_date || todayStr(), 'type="date" required')}
      </div>` +
      sel('Category', 'portfolio_id',
        [['', 'No category'], ...cats.map((c) => [c.id, c.category_name])], t?.portfolio_id || '') +
      sel('Paid with', 'credit_card_id',
        [['', 'Cash / Debit / UPI'],
         ...cds.map((c) => [c.id, `${c.card_nickname || c.bank_name} ••${c.last_four}`])],
        t?.credit_card_id || '') +
      inp('Notes (optional)', 'notes', t?.notes || '', 'maxlength="500" placeholder="Any extra notes…"'),
      async (d) => {
        const body = {
          description:      d.description,
          amount:           Number(d.amount),
          transaction_type: d.transaction_type,
          transaction_date: d.transaction_date,
          portfolio_id:     d.portfolio_id   ? Number(d.portfolio_id)   : null,
          credit_card_id:   d.credit_card_id ? Number(d.credit_card_id) : null,
          notes:            d.notes || null,
        };
        await api(t ? '/transactions/' + t.id : '/transactions', { method: t ? 'PUT' : 'POST', body });
        toast(t ? 'Transaction updated ✓' : 'Transaction added ✓');
        route();
      }
    );
  }

  /* ══════════════════════════════════════
     SPEND PORTFOLIO
  ══════════════════════════════════════ */
  async function portfolio(el) {
    const [cats, dash] = await Promise.all([api('/portfolio'), api('/dashboard?month=' + thisMonth())]);
    cache.cats = new Map(cats.map((c) => [String(c.id), c]));
    const spent        = new Map(dash.categories.map((c) => [c.name, c.spent]));
    const totalPlanned = cats.reduce((s, c) => s + c.planned_amount, 0);
    const totalSpent   = cats.reduce((s, c) => s + (spent.get(c.category_name) || 0), 0);
    const totalRem     = totalPlanned - totalSpent;

    el.innerHTML = `
      <div class="kpis" style="margin-bottom:1rem">
        <div class="kpi">
          <div class="kpi-label">Total budgeted</div>
          <div class="kpi-value">${money(totalPlanned)}</div>
          <div class="kpi-sub">${cats.length} categories</div>
        </div>
        <div class="kpi ${totalSpent > totalPlanned && totalPlanned > 0 ? 'danger-kpi' : ''}">
          <div class="kpi-label">Total spent</div>
          <div class="kpi-value ${totalSpent > totalPlanned && totalPlanned > 0 ? 'neg' : ''}">${money(totalSpent)}</div>
          <div class="kpi-sub">This month</div>
        </div>
        <div class="kpi ${totalPlanned > 0 && totalRem < 0 ? 'danger-kpi' : 'success-kpi'}">
          <div class="kpi-label">Remaining</div>
          <div class="kpi-value ${totalPlanned > 0 && totalRem < 0 ? 'neg' : 'pos'}">${totalPlanned ? money(totalRem) : '—'}</div>
          <div class="kpi-sub">Budget left</div>
        </div>
      </div>

      <div class="toolbar">
        <div class="grow" style="color:var(--n400);font-size:.85rem;align-self:center">
          ${cats.length} budget categories · ${monthName(thisMonth())}
        </div>
        <div class="toolbar-actions">
          <button class="btn" data-action="add-cat">+ Add Category</button>
        </div>
      </div>

      <div class="cat-grid">
        ${cats.map((c) => {
          const s    = spent.get(c.category_name) || 0;
          const over = c.planned_amount > 0 && s > c.planned_amount;
          const p2   = pct(s, c.planned_amount);
          const rem  = c.planned_amount > 0 ? c.planned_amount - s : null;
          return `
            <div class="cat-card ${over ? 'over' : ''}" style="border-left-color:${esc(c.color_hex)}">
              <div class="cat-header">
                <div class="cat-name">${esc(c.category_name)}</div>
                ${over ? '<span class="badge expense">Over budget</span>' : p2 > 80 ? '<span class="badge warn">Near limit</span>' : ''}
              </div>
              <div class="cat-amounts">
                <span>Spent: <b style="color:${over ? 'var(--danger)' : 'inherit'}">${money(s)}</b></span>
                <span>Plan: <b>${c.planned_amount ? money(c.planned_amount) : 'None'}</b></span>
              </div>
              ${c.planned_amount > 0 ? `
                <div class="progress" style="margin:.3rem 0">
                  <div class="progress-fill ${over ? 'over' : p2 > 80 ? 'warn' : ''}" style="width:${p2}%"></div>
                </div>
                <div style="font-size:.77rem;font-weight:600;margin-top:.25rem;color:${rem < 0 ? 'var(--danger)' : 'var(--success)'}">
                  ${rem < 0 ? `Over by ${money(Math.abs(rem))}` : `${money(rem)} remaining (${100 - p2}%)`}
                </div>` : ''}
              <div class="cat-actions">
                <button class="btn ghost small" data-action="edit-cat" data-id="${c.id}">Edit</button>
                <button class="btn danger small" data-action="del-cat" data-id="${c.id}">Delete</button>
              </div>
            </div>`;
        }).join('')}
      </div>
      ${cats.length === 0
        ? '<div class="panel"><div class="empty"><p>No categories yet. Add one to start planning your budget.</p></div></div>'
        : ''}`;
  }

  function catForm(c) {
    openModal(c ? 'Edit Category' : 'Add Category',
      inp('Category name', 'category_name', c?.category_name || '', 'required maxlength="80" placeholder="e.g. Food, Transport"') +
      inp('Monthly budget (₹)', 'planned_amount', c?.planned_amount ?? 0, 'type="number" min="0" step="0.01" required') +
      inp('Colour', 'color_hex', c?.color_hex || '#3A7050', 'type="color"'),
      async (d) => {
        const body = {
          category_name:  d.category_name,
          planned_amount: Number(d.planned_amount),
          color_hex:      d.color_hex,
        };
        await api(c ? '/portfolio/' + c.id : '/portfolio', { method: c ? 'PUT' : 'POST', body });
        toast(c ? 'Category updated ✓' : 'Category added ✓');
        route();
      }
    );
  }

  /* ══════════════════════════════════════
     CREDIT CARDS
  ══════════════════════════════════════ */
  async function cards(el) {
    const list = await api('/cards');
    cache.cards = new Map(list.map((c) => [String(c.id), c]));

    el.innerHTML = `
      <div class="info-banner">
        🔒 Only the last 4 digits of each card are stored. Never enter full card numbers, CVV, PIN or banking passwords.
      </div>
      <div class="toolbar">
        <div class="grow" style="color:var(--n400);font-size:.85rem;align-self:center">
          ${list.length} card${list.length !== 1 ? 's' : ''} saved
        </div>
        <div class="toolbar-actions">
          <button class="btn" data-action="add-card">+ Add Card</button>
        </div>
      </div>
      <div class="card-grid">
        ${list.map((c) => `
          <div>
            <div class="credit-card">
              <div>
                <div class="card-bank">${esc(c.bank_name)}</div>
                <div class="card-nick">${esc(c.card_nickname || 'Credit Card')}</div>
              </div>
              <div class="card-number">•••• •••• •••• ${esc(c.last_four)}</div>
              <div class="card-footer">
                <div class="card-holder">
                  <span>Cardholder</span>
                  <b>${esc(c.holder_name)}</b>
                </div>
                <div class="card-due">
                  <span>Due date</span>
                  <b>${c.next_due_date ? dateFmt(c.next_due_date) : c.due_day ? 'Day ' + c.due_day : '—'}</b>
                </div>
              </div>
            </div>
            <div class="card-actions">
              <button class="btn ghost small" data-action="edit-card" data-id="${c.id}">Edit</button>
              <button class="btn danger small" data-action="del-card" data-id="${c.id}">Remove</button>
            </div>
          </div>`).join('')}
      </div>
      ${list.length === 0
        ? '<div class="panel"><div class="empty"><p>No cards added yet. Add one to track due dates.</p></div></div>'
        : ''}`;
  }

  function cardForm(c) {
    openModal(c ? 'Edit Card' : 'Add Card',
      inp('Bank name', 'bank_name', c?.bank_name || '', 'required maxlength="100" placeholder="e.g. HDFC Bank, SBI, ICICI"') +
      inp('Card nickname (optional)', 'card_nickname', c?.card_nickname || '', 'maxlength="60" placeholder="e.g. My Rewards Card"') +
      `<div class="row2">
        ${inp('Last 4 digits only', 'last_four', c?.last_four || '', 'required pattern="\\d{4}" maxlength="4" inputmode="numeric" placeholder="1234"')}
        ${inp('Due day of month', 'due_day', c?.due_day || '', 'type="number" min="1" max="31" placeholder="e.g. 15')}
      </div>` +
      inp('Name on card', 'holder_name', c?.holder_name || (user ? user.full_name : ''), 'required maxlength="120"') +
      inp('Next payment date (optional)', 'next_due_date', c?.next_due_date || '', 'type="date"'),
      async (d) => {
        const body = {
          bank_name:     d.bank_name,
          last_four:     d.last_four,
          holder_name:   d.holder_name,
          card_nickname: d.card_nickname || null,
          due_day:       d.due_day ? Number(d.due_day) : null,
          next_due_date: d.next_due_date || null,
        };
        await api(c ? '/cards/' + c.id : '/cards', { method: c ? 'PUT' : 'POST', body });
        toast(c ? 'Card updated ✓' : 'Card added ✓');
        route();
      }
    );
  }

  /* ══════════════════════════════════════
     PROFILE
  ══════════════════════════════════════ */
  async function profile(el) {
    const p = await api('/profile');

    el.innerHTML = `
      <div class="profile-wrap">
        <form id="profileForm">
          <div class="panel" style="margin-bottom:1rem">
            <div class="profile-section-title">Personal Information</div>
            <div class="stack">
              ${inp('Full name', 'full_name', p.full_name || '', 'required maxlength="120"')}
              <label class="f">
                <span>Email address</span>
                <input value="${esc(p.email)}" disabled style="background:var(--n50);color:var(--n400)">
              </label>
              <div class="row2">
                ${inp('Age', 'age', p.age || '', 'type="number" min="1" max="120" placeholder="Optional"')}
                ${inp('Occupation', 'occupation', p.occupation || '', 'maxlength="120" placeholder="Optional"')}
              </div>
            </div>
          </div>

          <div class="panel" style="margin-bottom:1rem">
            <div class="profile-section-title">Financial Settings</div>
            <div class="stack">
              <div class="row2">
                ${inp('Monthly income after tax (₹)', 'net_monthly_income', p.net_monthly_income ?? 0, 'type="number" min="0" step="0.01" required')}
                ${inp('Monthly savings goal (₹)', 'target_savings', p.target_savings ?? 0, 'type="number" min="0" step="0.01" required')}
              </div>
              <label class="f"><span>Currency</span>
                <select name="currency_code">
                  ${[['INR','Indian Rupee (₹ INR)'],['USD','US Dollar ($ USD)'],['EUR','Euro (€ EUR)'],['GBP','British Pound (£ GBP)']]
                    .map(([v, t]) => `<option value="${v}" ${(p.currency_code||'INR') === v ? 'selected' : ''}>${t}</option>`)
                    .join('')}
                </select>
              </label>
            </div>
          </div>

          <div class="panel" style="margin-bottom:1rem">
            <div class="profile-section-title">Financial Goals</div>
            <label class="f">
              <span>Notes about your goals (optional)</span>
              <textarea name="financial_bio" maxlength="500" placeholder="Describe your financial goals or notes…">${esc(p.financial_bio || '')}</textarea>
            </label>
          </div>

          <p class="err" id="profileErr" role="alert"></p>
          <div>
            <button class="btn" type="submit" style="min-width:140px">Save Profile</button>
          </div>
        </form>
      </div>`;

    $('#profileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      btn.disabled = true;
      $('#profileErr').textContent = '';
      const d = Object.fromEntries(new FormData(e.target));
      try {
        const saved = await api('/profile', {
          method: 'PUT',
          body: {
            full_name:          d.full_name,
            age:                d.age ? Number(d.age) : null,
            occupation:         d.occupation  || null,
            financial_bio:      d.financial_bio || null,
            net_monthly_income: Number(d.net_monthly_income),
            target_savings:     Number(d.target_savings),
            currency_code:      d.currency_code,
          },
        });
        currency = saved.currency_code;
        user.full_name = saved.full_name;
        $('#userChip').textContent     = saved.full_name;
        $('#sideUserName').textContent = saved.full_name;
        $('#sideAvatar').textContent   = saved.full_name.split(' ').map((w) => w[0]).join('').slice(0,2).toUpperCase();
        toast('Profile saved ✓');
      } catch (err) {
        $('#profileErr').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ══════════════════════════════════════
     FORECAST / PREDICTIONS
  ══════════════════════════════════════ */
  async function predictions(el) {
    const p   = await api('/predict');
    const mtd = p.monthToDate;

    const mtdPanel = `
      <div class="panel">
        <div class="panel-title">This Month So Far</div>
        <div class="item-list">
          <div class="list-item">
            <span style="color:var(--n400);font-size:.88rem">Spent to date</span>
            <b>${money(mtd.spent)}</b>
          </div>
          <div class="list-item">
            <span style="color:var(--n400);font-size:.88rem">Month-end projection</span>
            <b>${mtd.projected ? money(mtd.projected) : '—'}</b>
          </div>
          <div class="list-item">
            <span style="color:var(--n400);font-size:.88rem">Total budget</span>
            <b>${mtd.plannedTotal ? money(mtd.plannedTotal) : '—'}</b>
          </div>
        </div>
        <p class="note">${mtd.projected
          ? 'Projection continues your current daily spending pace.'
          : 'Projection appears after the first 5 days of the month.'}</p>
      </div>`;

    if (!p.ready) {
      const e = p.earlyEstimate;
      const early = e ? `
        <div class="panel">
          <div class="panel-title">Early estimate</div>
          <div class="item-list">
            <div class="list-item"><span style="color:var(--n400);font-size:.88rem">Spent so far (day ${e.day} of ${e.daysInMonth})</span><b>${money(e.spentSoFar)}</b></div>
            <div class="list-item"><span style="color:var(--n400);font-size:.88rem">A full month at this pace</span><b>${money(e.projected)}</b></div>
          </div>
          <p class="note">This is only a rough pace estimate from the current month. The proper next-month forecast learns from your last six completed months.</p>
        </div>` : '';
      el.innerHTML = `
        <div class="panel" style="margin-bottom:1rem">
          <div class="empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            <p>${esc(p.message)}</p>
          </div>
        </div>
        <div class="grid2">${mtdPanel}${early}</div>`;
      return;
    }

    const f  = p.forecast;
    const t  = f.total;
    const ml = p.engine === 'ml';
    const hm = p.history.months, ht = p.history.total, hi = p.history.income;
    const avg = ht.reduce((s2, v) => s2 + v, 0) / ht.length;
    const hiIdx = ht.indexOf(Math.max(...ht)), loIdx = ht.indexOf(Math.min(...ht));
    const last = ht[ht.length - 1], prev = ht.length > 1 ? ht[ht.length - 2] : null;
    const mom = prev > 0 ? Math.round(((last - prev) / prev) * 100) : null;
    const historyPanel = `
      <div class="panel" style="margin-bottom:1.1rem">
        <div class="panel-title">Your past ${hm.length} month${hm.length > 1 ? 's' : ''} <small>What the forecast learned from</small></div>
        <div class="mini-stats">
          <div class="mini-stat"><span>Average per month</span><b>${money(avg)}</b></div>
          <div class="mini-stat"><span>Highest month</span><b>${money(ht[hiIdx])}</b><small>${monthName(hm[hiIdx])}</small></div>
          <div class="mini-stat"><span>Lowest month</span><b>${money(ht[loIdx])}</b><small>${monthName(hm[loIdx])}</small></div>
          <div class="mini-stat"><span>Last month vs before</span><b>${mom === null ? '—' : (mom > 0 ? '+' : '') + mom + '%'}</b><small>${monthName(hm[hm.length - 1])}</small></div>
        </div>
        <div class="tablewrap"><table>
          <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Net</th></tr></thead>
          <tbody>${hm.map((m, i) => `<tr>
            <td class="tx-desc">${monthName(m)}</td>
            <td class="num">${money(hi[i])}</td>
            <td class="num">${money(ht[i])}</td>
            <td class="num"><b style="color:${hi[i] - ht[i] < 0 ? 'var(--danger)' : 'var(--success)'}">${money(hi[i] - ht[i])}</b></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`;

    el.innerHTML = `
      <div class="toolbar" style="margin-bottom:1rem">
        <div class="grow">
          <b style="color:var(--n800)">${monthName(p.nextMonth)}</b>
          <span style="color:var(--n400);font-size:.85rem"> — learned from your last ${p.historyMonths} completed month${p.historyMonths > 1 ? 's' : ''}</span>
        </div>
        <span class="badge ml">${ml ? 'Machine learning model (scikit-learn)' : 'Built-in statistical model'}</span>
      </div>

      <div class="kpis">
        <div class="kpi">
          <div class="kpi-label">Predicted spending</div>
          <div class="kpi-value">${money(t.predicted)}</div>
          <div class="kpi-sub">Range: ${money(t.low)} – ${money(t.high)}</div>
        </div>
        <div class="kpi success-kpi">
          <div class="kpi-label">Expected income</div>
          <div class="kpi-value pos">${money(f.income)}</div>
          <div class="kpi-sub">Based on your past income</div>
        </div>
        <div class="kpi ${f.savings < 0 ? 'danger-kpi' : 'success-kpi'}">
          <div class="kpi-label">Predicted savings</div>
          <div class="kpi-value ${f.savings < 0 ? 'neg' : 'pos'}">${money(f.savings)}</div>
          <div class="kpi-sub">${f.targetSavings ? `Goal: ${money(f.targetSavings)}` : 'No goal set'}</div>
        </div>
        ${f.targetSavings ? `
          <div class="kpi ${f.onTrack ? 'success-kpi' : 'danger-kpi'}">
            <div class="kpi-label">Goal status</div>
            <div class="kpi-value" style="font-size:1.15rem">${f.onTrack ? '✓ On track' : '✗ At risk'}</div>
            <div class="kpi-sub">${f.onTrack ? 'Savings goal will be met' : 'May miss savings target'}</div>
          </div>` : ''}
      </div>

      <div class="grid2">
        <div class="panel">
          <div class="panel-title">Spending History + Forecast</div>
          <div class="chart-wrap"><canvas id="fcChart"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-title">Insights</div>
          ${p.insights.length
            ? `<ul class="insights">${p.insights.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
            : '<div class="empty"><p>Everything looks steady. No issues detected.</p></div>'}
        </div>
      </div>

      ${historyPanel}
      <div class="panel" style="margin-bottom:1.1rem">
        <div class="panel-title">Category Forecast <small>For ${monthName(p.nextMonth)}</small></div>
        <div class="tablewrap"><table>
          <thead><tr>
            <th>Category</th><th class="num">Forecast</th><th class="num">Range</th>
            <th class="num">Budget</th><th>Trend</th><th>Confidence</th>
          </tr></thead>
          <tbody>
            ${f.categories.map((c) => `<tr>
              <td><span class="tx-desc">${esc(c.category)}</span></td>
              <td class="num"><b>${money(c.predicted)}</b></td>
              <td class="num" style="color:var(--n400);font-size:.8rem">${money(c.low)} – ${money(c.high)}</td>
              <td class="num">
                <span style="color:${c.over_plan > 0 ? 'var(--danger)' : c.planned ? 'inherit' : 'var(--n400)'}">
                  ${c.planned ? money(c.planned) : '—'}
                </span>
              </td>
              <td><span class="${c.trend === 'up' ? 'trend-up' : c.trend === 'down' ? 'trend-down' : 'trend-flat'}">
                ${c.trend === 'up' ? '↑ Rising' : c.trend === 'down' ? '↓ Falling' : '→ Steady'}
              </span></td>
              <td><span class="badge ${c.confidence === 'high' ? 'income' : c.confidence === 'medium' ? 'warn' : 'neutral'}">
                ${c.confidence || 'low'}
              </span></td>
            </tr>`).join('')}
          </tbody>
        </table></div>
        <p class="note">The model tests several algorithms on your history and picks the most accurate one per category. More months = higher confidence.</p>
      </div>

      <div class="grid2">
        ${mtdPanel}
        <div class="panel">
          <div class="panel-title">Unusual Expenses</div>
          ${p.anomalies.length ? `
            <div class="item-list">
              ${p.anomalies.map((a) => `
                <div class="list-item">
                  <div>
                    <div class="list-title">${esc(a.description)}</div>
                    <div class="list-meta">${esc(a.category)} · ${dateFmt(a.date)} · ${a.ratio}× your usual ${money(a.typical)}</div>
                  </div>
                  <b class="list-amount neg">${money(a.amount, 2)}</b>
                </div>`).join('')}
            </div>`
          : '<div class="empty"><p>No unusually large expenses detected recently.</p></div>'}
        </div>
      </div>`;

    const labels = [...p.history.months.map(shortMonth), shortMonth(p.nextMonth)];
    const hist   = p.history.total;
    const n      = hist.length;

    mkChart('fcChart', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Actual',   data: [...hist, null], borderColor: '#22442F', backgroundColor: 'rgba(34,68,47,.08)', tension: .3, pointRadius: 4, fill: true },
          { label: 'Forecast', data: [...Array(n-1).fill(null), hist[n-1], t.predicted], borderColor: '#4D8B64', borderDash: [6,4], tension: 0, pointRadius: [0,7] },
          { label: 'High',     data: [...Array(n).fill(null), t.high],    borderColor: 'transparent', backgroundColor: 'rgba(107,168,130,.12)', pointRadius: 3, pointBackgroundColor: '#6BA882' },
          { label: 'Low',      data: [...Array(n).fill(null), t.low],     borderColor: 'transparent', backgroundColor: 'rgba(107,168,130,.12)', pointRadius: 3, pointBackgroundColor: '#6BA882', fill: '-1' },
        ],
      },
      options: {
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => money(v) }, grid: { color: '#F3F4F6' } },
          x: { grid: { display: false } },
        },
        plugins: { legend: { labels: { filter: (i) => i.text !== 'Low' } } },
      },
    });
  }

  /* ══════════════════════════════════════
     GLOBAL CLICK HANDLER
  ══════════════════════════════════════ */
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const { action, id, tab } = b.dataset;
    try {
      if      (action === 'auth-tab')   setAuthTab(tab);
      else if (action === 'logout')     logout();
      else if (action === 'close-modal') $('#modal').close();
      else if (action === 'add-tx')    await txForm(null);
      else if (action === 'edit-tx')   await txForm(cache.tx.get(id));
      else if (action === 'del-tx') {
        if (confirm('Delete this transaction? This cannot be undone.')) {
          await api('/transactions/' + id, { method: 'DELETE' });
          toast('Transaction deleted');
          route();
        }
      }
      else if (action === 'add-cat')   catForm(null);
      else if (action === 'edit-cat')  catForm(cache.cats.get(id));
      else if (action === 'del-cat') {
        if (confirm('Delete this category? Past transactions will keep their label.')) {
          await api('/portfolio/' + id, { method: 'DELETE' });
          toast('Category deleted');
          route();
        }
      }
      else if (action === 'add-card')  cardForm(null);
      else if (action === 'edit-card') cardForm(cache.cards.get(id));
      else if (action === 'del-card') {
        if (confirm('Remove this card? Past transactions will not be affected.')) {
          await api('/cards/' + id, { method: 'DELETE' });
          toast('Card removed');
          route();
        }
      }
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  boot();
})();
