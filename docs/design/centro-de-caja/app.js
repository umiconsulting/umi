/* ============================================================================
   Centro de caja — referencia interactiva
   Todos los importes viven en unidades menores (centavos), como en la API.
   El esperado no es un número escrito a mano: se calcula desde el libro.
   ========================================================================== */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const nf = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  });
  const money = (m) => nf.format((m || 0) / 100);
  const signed = (m) => (m > 0 ? '+' : m < 0 ? '−' : '') + money(Math.abs(m || 0));

  /* ───────────────────────────── datos ───────────────────────────── */

  const LEDGER = [
    {
      seq: 1,
      kind: 'opening',
      label: 'Fondo',
      detail: 'Fondo de apertura · 10 denominaciones',
      effect: 150000,
      actor: 'Ana R.',
      approver: null,
      device: 'POS-01',
      time: '07:12',
      note: 'Fondo estándar de la sucursal',
    },
    {
      seq: 2,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $500.00 · cambio $190.00',
      effect: 31000,
      received: 50000,
      change: 19000,
      link: 'Venta #1042',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '09:04',
    },
    {
      seq: 3,
      kind: 'in',
      label: 'Ingreso',
      detail: 'Ingreso para cambio · «fondo de monedas»',
      effect: 20000,
      actor: 'Ana R.',
      approver: 'Gerardo P.',
      device: 'POS-01',
      time: '10:22',
    },
    {
      seq: 4,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $200.00 · cambio $20.00',
      effect: 18000,
      received: 20000,
      change: 2000,
      link: 'Venta #1047',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '10:38',
    },
    {
      seq: 5,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $500.00 · cambio $50.00',
      effect: 45000,
      received: 50000,
      change: 5000,
      link: 'Venta #1053',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '11:02',
    },
    {
      seq: 6,
      kind: 'out',
      label: 'Retiro',
      detail: 'Compra de hielo · «pago a proveedor»',
      effect: -35000,
      actor: 'Luis M.',
      approver: 'Gerardo P.',
      device: 'POS-01',
      time: '11:48',
    },
    {
      seq: 7,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $700.00 · cambio $80.00',
      effect: 62000,
      received: 70000,
      change: 8000,
      link: 'Venta #1061',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '12:05',
    },
    {
      seq: 8,
      kind: 'refund',
      label: 'Reembolso',
      detail: 'Reembolso en efectivo · «producto frío»',
      effect: -12000,
      link: 'Venta #1038',
      actor: 'Luis M.',
      approver: 'Gerardo P.',
      device: 'POS-01',
      time: '12:31',
    },
    {
      seq: 9,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $400.00 · cambio $20.00',
      effect: 38000,
      received: 40000,
      change: 2000,
      link: 'Venta #1066',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '12:44',
    },
    {
      seq: 10,
      kind: 'safe',
      label: 'Caja fuerte',
      detail: 'Retiro a caja fuerte',
      effect: -200000,
      actor: 'Luis M.',
      device: 'POS-01',
      time: '12:55',
    },
    {
      seq: 11,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $300.00 · cambio $40.00',
      effect: 26000,
      received: 30000,
      change: 4000,
      link: 'Venta #1072',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '13:02',
    },
    {
      seq: 12,
      kind: 'nosale',
      label: 'No-sale',
      detail: 'Abrir cajón · «cambio» · hardware no verificado',
      effect: 0,
      actor: 'Ana R.',
      approver: 'Gerardo P.',
      device: 'POS-01',
      time: '13:20',
      note: 'Solicitud registrada. El sistema no afirma que el cajón se abrió.',
    },
    {
      seq: 13,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $600.00 · cambio $50.00',
      effect: 55000,
      received: 60000,
      change: 5000,
      link: 'Venta #1080',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '13:26',
    },
    {
      seq: 14,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $500.00 · cambio $90.00',
      effect: 41000,
      received: 50000,
      change: 9000,
      link: 'Venta #1084',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '13:34',
    },
    {
      seq: 15,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $400.00 · cambio $60.00',
      effect: 34000,
      received: 40000,
      change: 6000,
      link: 'Venta #1088',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '13:39',
    },
    {
      seq: 16,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $320.00 · cambio $20.00',
      effect: 30000,
      received: 32000,
      change: 2000,
      link: 'Venta #1091',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '13:44',
    },
    {
      seq: 17,
      kind: 'sale',
      label: 'Venta',
      detail: 'Recibido $400.00 · cambio $0.00',
      effect: 40000,
      received: 40000,
      change: 0,
      link: 'Venta #1093',
      actor: 'Luis M.',
      device: 'POS-01',
      time: '13:47',
    },
  ];

  const REGISTERS = [
    {
      id: 'r1',
      name: 'Caja principal',
      terminal: 'POS-01',
      state: 'in_use',
      openedAt: '07:12',
      mine: true,
    },
    { id: 'r2', name: 'Caja barra', terminal: 'POS-02', state: 'in_use', openedAt: '08:40' },
    {
      id: 'r3',
      name: 'Caja barra (2)',
      terminal: 'POS-02',
      state: 'paused',
      openedAt: '12:10',
      replaced: true,
    },
    { id: 'r4', name: 'Caja terraza', terminal: '—', state: 'free' },
  ];

  const SHIFTS_TODAY = [
    {
      name: 'Turno actual',
      who: 'Luis M.',
      from: '07:12',
      to: 'ahora',
      variance: null,
      outcome: 'abierto',
    },
    {
      name: 'Turno de apertura',
      who: 'Ana R.',
      from: '07:12',
      to: '11:40',
      variance: 0,
      outcome: 'cuadró',
    },
  ];

  const OTHER_TENDERS = [
    ['Tarjeta', 894000],
    ['Monedero', 122000],
    ['Gift card', 0],
  ];

  const SPARK = [400, -2150, 50, -300, 100, 0, 50];

  const DENOMS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50];

  const BASE = {
    policy: {
      version: 'pilot-1',
      expires: '30 días',
      blind: true,
      method: 'denominación',
      tolerance: 100,
      moveThreshold: 5000,
      closeThreshold: 500,
      noSale: true,
      handoff: true,
      offline: false,
    },
    shiftStatus: 'open',
    online: true,
    counted: 342850,
    countAttempt: 1,
    countedBy: 'Luis M.',
    countedAt: '13:51',
    denominations: {
      100000: 2,
      50000: 2,
      10000: 3,
      5000: 2,
      2000: 1,
      1000: 0,
      500: 1,
      200: 1,
      100: 1,
      50: 1,
    },
    varianceReason: null,
    varianceApproved: false,
    reconciled: false,
    closed: false,
    depositCreated: false,
    recoveryState: 'none',
    pendingCommand: null,
    adoptable: false,
    reclaimable: null,
    approvedUse: { who: 'Gerardo P.', what: 'Retiro de $350.00' },
  };

  const SCENARIOS = [
    {
      id: 'over-short',
      label: 'Faltante fuera de tolerancia',
      desc: 'Cuenta $1.50 menos que el esperado. Requiere un gerente.',
    },
    { id: 'balanced', label: 'Conteo cuadrado', desc: 'El conteo coincide con el libro.' },
    {
      id: 'within',
      label: 'Sobrante dentro de tolerancia',
      desc: 'Diferencia de $0.50 dentro de la tolerancia de $1.00.',
    },
    {
      id: 'full',
      label: 'Vista completa (sin ciego)',
      desc: 'El operador puede ver el esperado antes de contar.',
    },
    { id: 'suspended', label: 'Turno suspendido', desc: 'Se pausó el turno sin contar el cajón.' },
    { id: 'handoff', label: 'Traspaso pendiente', desc: 'El turno espera al siguiente operador.' },
    {
      id: 'adopt',
      label: 'Turno propio en otra terminal',
      desc: 'Esta terminal perdió su identidad guardada.',
    },
    {
      id: 'orphan',
      label: 'Cajón con terminal perdida',
      desc: 'Nadie va a volver a contar ese cajón.',
    },
    {
      id: 'no-policy',
      label: 'Sin política',
      desc: 'La sucursal no tiene política de caja. Todo está negado.',
    },
    { id: 'offline', label: 'Sin conexión', desc: 'La caja requiere red; el cobro no.' },
    {
      id: 'pending',
      label: 'Comando pendiente',
      desc: 'Un movimiento quedó en duda tras una caída.',
    },
    {
      id: 'closed',
      label: 'Turno cerrado con depósito',
      desc: 'El cierre completo, con arqueo y depósito.',
    },
  ];

  const state = Object.assign({}, BASE, {
    scenario: 'over-short',
    theme: null,
    view: 'todo',
    filter: 'todo',
    search: '',
    selectedRegister: 'r1',
    expanded: null,
    offline: false,
  });

  const expectedCash = () => LEDGER.reduce((sum, r) => sum + (r.effect || 0), 0);
  const sumBy = (kind) =>
    LEDGER.filter((r) => r.kind === kind).reduce((s, r) => s + (r.effect || 0), 0);
  const received = () =>
    LEDGER.filter((r) => r.kind === 'sale').reduce((s, r) => s + r.received, 0);
  const change = () => LEDGER.filter((r) => r.kind === 'sale').reduce((s, r) => s + r.change, 0);
  const variance = () => (state.counted == null ? null : state.counted - expectedCash());
  const approvalFor = () =>
    variance() == null ? false : Math.abs(variance()) > state.policy.tolerance;
  const closeNeedsPin = () =>
    variance() == null ? false : Math.abs(variance()) > state.policy.closeThreshold;
  const countedTotal = (bag) => Object.keys(bag).reduce((s, k) => s + Number(k) * bag[k], 0);

  /* ───────────────────────────── helpers ───────────────────────────── */

  let noticeTimer = null;
  function notice(text, tone) {
    const n = $('#notice');
    n.textContent = text;
    n.className = 'notice' + (tone ? ' notice--' + tone : '');
    n.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      n.hidden = true;
    }, 4200);
  }

  function openDialog(id, focusSel) {
    const d = $(id);
    if (!d || d.open) return d;
    d.showModal();
    const first = focusSel && $(focusSel, d);
    if (first) setTimeout(() => first.focus(), 30);
    return d;
  }
  const closeDialog = (d, v) => d && d.open && d.close(v || '');

  function actionButton(label, meta, onClick, opts) {
    const o = opts || {};
    const b = el(
      'button',
      'action' + (o.wide ? ' action--wide' : '') + (o.danger ? ' action--danger' : ''),
    );
    b.type = 'button';
    if (o.act) b.dataset.act = o.act;
    b.appendChild(el('span', 'lbl', label));
    if (meta) b.appendChild(el('span', 'meta', meta));
    if (o.disabled) {
      b.disabled = true;
      if (o.reason) b.title = o.reason;
    } else b.addEventListener('click', onClick);
    return b;
  }

  function execButton(label, meta, onClick, disabled) {
    const b = el('button', 'exec');
    b.type = 'button';
    b.dataset.act = 'cta';
    b.appendChild(el('span', 'exec-lbl', label));
    if (meta) b.appendChild(el('span', 'exec-meta', meta));
    if (disabled) b.disabled = true;
    else b.addEventListener('click', onClick);
    return b;
  }

  /* ───────────────────────────── render ───────────────────────────── */

  function renderPills() {
    const p = state.policy,
      host = $('#policy-pills');
    host.textContent = '';
    const add = (text, tone) => {
      const s = el('span', 'pill' + (tone ? ' pill--' + tone : ''));
      s.innerHTML = text;
      host.appendChild(s);
    };
    if (!p) {
      add('<b>Sin política</b>', 'bad');
      add('Todo está negado hasta configurar la caja', 'bad');
      return;
    }
    add('Fecha operativa <b>2026-09-29</b> · inicio 04:00', 'muted');
    add('Política <b>' + p.version + '</b> · expira ' + p.expires, 'on');
    add(p.blind ? 'Conteo <b>ciego</b>' : 'Conteo <b>visible</b>', p.blind ? 'warn' : 'muted');
    add('Tolerancia <b>' + money(p.tolerance) + '</b>', 'muted');
    add('Cierre con PIN si la <b>diferencia</b> &gt; ' + money(p.closeThreshold), 'bad');
    add(p.offline ? 'Offline permitido' : 'Offline no permitido', p.offline ? 'warn' : 'muted');
    if (state.pendingCommand) add('Comando pendiente', 'bad');
    else if (state.online) add('En línea · sync 2 s', 'ok');
    else add('Sin conexión · solo lectura', 'warn');
  }

  function renderShift() {
    const s = state.shiftStatus;
    const map = {
      open: ['state state--open', 'Turno abierto'],
      suspended: ['state state--suspended', 'Turno suspendido'],
      handoff_pending: ['state state--suspended', 'Traspaso pendiente'],
      reconciliation_required: ['state state--suspended', 'Conciliación requerida'],
      closed: ['state state--danger', 'Turno cerrado'],
      blocked: ['state state--danger', 'Caja bloqueada'],
    };
    const [cls, text] = map[s] || map.open;
    $('#shift-state').className = cls;
    $('#shift-state-text').textContent = text;
    $('#reg-name').textContent =
      (REGISTERS.find((r) => r.id === state.selectedRegister) || {}).name || '';
  }

  function renderEquation() {
    const eq = $('#eq');
    eq.textContent = '';
    const adjustments = LEDGER.filter((r) => r.kind === 'correction' || r.kind === 'close').reduce(
      (s, r) => s + r.effect,
      0,
    );
    const terms = [
      ['Fondo inicial', sumBy('opening'), ''],
      ['Ingresos', sumBy('in'), ''],
      ['Retiros', -sumBy('out'), 'neg'],
      ['Caja fuerte', -sumBy('safe'), 'neg'],
      ['Reembolsos', -sumBy('refund'), 'neg'],
      ['Ventas efectivo', sumBy('sale'), ''],
    ];
    if (adjustments !== 0) terms.push(['Ajustes', adjustments, adjustments < 0 ? 'neg' : '']);
    terms.forEach(([label, value, mod], i) => {
      const li = el('li');
      const dl = el('dl', 'term' + (mod ? ' term--' + mod : ''));
      const dt = el('dt', null, label);
      const dd = el('dd', null, signed(value));
      dl.append(dt, dd);
      li.appendChild(dl);
      eq.appendChild(li);
    });
  }

  function renderAnswer() {
    const host = $('#answer');
    host.textContent = '';
    const exp = expectedCash();
    const counted = state.counted;
    const v = variance();
    const block = (label, valueNode, sub) => {
      const b = el('div', 'block');
      b.appendChild(el('span', 'block-label', label));
      b.appendChild(valueNode);
      if (sub) b.appendChild(sub);
      return b;
    };
    const expNode = el('span', 'block-value', money(exp));
    host.appendChild(
      block(
        'Esperado',
        expNode,
        el('span', 'block-sub', 'desde el libro · secuencia ' + LEDGER.length),
      ),
    );

    let countNode, sub;
    if (counted == null) {
      countNode = el('span', 'block-value lock');
      countNode.innerHTML =
        '<svg viewBox="0 0 24 24" style="width:1.1rem;height:1.1rem"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg> —';
      sub = el(
        'span',
        'block-sub',
        state.policy && state.policy.blind ? 'ciego: se revela al contar' : 'sin conteo',
      );
    } else {
      countNode = el('span', 'block-value', money(counted));
      sub = el(
        'span',
        'block-sub',
        state.countedBy + ' · ' + state.countedAt + ' · intento ' + state.countAttempt,
      );
    }
    host.appendChild(block('Contado', countNode, sub));

    const vb = el('div', 'block block--var');
    vb.appendChild(el('span', 'block-label', 'Diferencia'));
    const vv = el('span', 'block-value');
    if (v == null) {
      vv.textContent = '—';
      vv.classList.add('is-muted');
    } else {
      vv.textContent = signed(v);
      vv.classList.add(
        v === 0 ? 'is-ok' : Math.abs(v) <= state.policy.tolerance ? 'is-warn' : 'is-bad',
      );
    }
    vb.appendChild(vv);
    if (v != null) {
      vb.appendChild(
        el(
          'span',
          'block-sub',
          v === 0
            ? 'cuadrado'
            : (v > 0 ? 'sobrante' : 'faltante') +
                (approvalFor() ? ' · requiere aprobación' : ' · dentro de tolerancia'),
        ),
      );
    }
    host.appendChild(vb);
  }

  function renderDrawers() {
    const host = $('#drawers');
    host.textContent = '';
    REGISTERS.forEach((r) => {
      const b = el('button', 'drawer' + (r.id === state.selectedRegister ? ' is-sel' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(r.id === state.selectedRegister));
      const nm = el('span', 'nm', r.name);
      const amt = el(
        'span',
        'amt',
        r.state === 'free'
          ? '—'
          : r.id === state.selectedRegister
            ? money(expectedCash())
            : r.id === 'r2'
              ? money(106694)
              : money(50000),
      );
      const sub = el('span', 'sub');
      if (r.state === 'free') sub.innerHTML = '<span class="tag tag--free">Libre</span> sin turno';
      else if (r.state === 'paused')
        sub.innerHTML =
          '<span class="tag tag--paused">Por contar</span> pausada ' + r.openedAt + ' → reemplazo';
      else
        sub.innerHTML =
          (r.mine ? '<span class="tag tag--read">Esta terminal</span>' : '') +
          ' en uso · ' +
          r.terminal +
          ' · ' +
          r.openedAt;
      b.append(nm, amt, sub);
      b.addEventListener('click', () => {
        state.selectedRegister = r.id;
        if (r.state !== 'in_use' || !r.mine)
          notice(
            'Vista de ' +
              r.name +
              '. Solo lectura: el turno vive en ' +
              (r.terminal || 'otra terminal') +
              '.',
            'warn',
          );
        render();
      });
      host.appendChild(b);
    });
    $('#drawers-hint').textContent = state.policy ? 'activo · pausado · libre' : 'sin política';
  }

  function renderShifts() {
    const host = $('#shifts');
    host.textContent = '';
    SHIFTS_TODAY.forEach((s) => {
      const row = el('li', 'shift-row');
      const who = el(
        'span',
        'who',
        s.from ? s.from + '–' + s.to + ' · ' + s.who : s.name + ' · ' + s.who,
      );
      const right = el('span', 'num');
      if (s.outcome === 'abierto') right.innerHTML = '<span class="tag tag--read">Abierto</span>';
      else if (s.outcome === 'libre') right.innerHTML = '<span class="tag">Libre</span>';
      else
        right.innerHTML =
          s.variance === 0 ? '<span class="tag tag--free">Cuadró</span>' : money(s.variance);
      row.append(who, right);
      host.appendChild(row);
    });
    const foot = el('li');
    foot.style.cssText =
      'border-top:1px dashed var(--line-2); margin-top:var(--s1); padding-top:var(--s2)';
    const dl = el('dl', 'duties');
    [
      ['Fondo conservado del cierre anterior', money(150000)],
      ['Discrepancia de apertura', money(0)],
    ].forEach(([k, v]) => {
      const d = el('div');
      d.appendChild(el('dt', null, k));
      d.appendChild(el('dd', null, v));
      dl.appendChild(d);
    });
    foot.appendChild(dl);
    host.appendChild(foot);
  }

  function renderDeposit() {
    const host = $('#deposit-body');
    host.textContent = '';
    const keep = 150000;
    const counted = state.counted == null ? 0 : state.counted;
    const dep = Math.max(0, counted - keep);
    const wrap = el('div', 'deposit');
    const hero = el('div', 'deposit-hero');
    const left = el('div');
    left.appendChild(el('span', 'lbl', 'Depositar'));
    left.appendChild(
      el('span', 'val', state.closed || state.depositCreated ? money(dep) : money(dep)),
    );
    const meta = el('span', 'hint', 'fondo ' + money(keep));
    hero.append(left, meta);
    wrap.appendChild(hero);
    const legend = el('div', 'spark-legend');
    legend.append(el('span', null, 'Depósitos de hoy'), el('span', null, money(200000)));
    wrap.appendChild(legend);
    const others = el('div', 'others');
    others.appendChild(el('span', 'others-label', 'otros medios'));
    OTHER_TENDERS.forEach(([k, v]) => {
      const s = el('span');
      s.append(document.createTextNode(k + ' '), el('b', null, money(v)));
      others.appendChild(s);
    });
    wrap.appendChild(others);
    if (state.depositCreated) {
      const ok = el('div', 'pill pill--ok', 'Depósito creado · referencia DEP-2291');
      wrap.appendChild(ok);
    }
    host.appendChild(wrap);
    $('#deposit-hint').textContent = state.closed ? 'listo' : 'tras el cierre';
  }

  const FILTERS = [
    ['todo', 'Todo'],
    ['sale', 'Ventas'],
    ['in', 'Ingresos'],
    ['out', 'Retiros'],
    ['safe', 'Caja fuerte'],
    ['refund', 'Reembolsos'],
    ['nosale', 'No-sale'],
  ];
  function renderFilters() {
    const host = $('#ledger-filters');
    host.textContent = '';
    FILTERS.forEach(([id, label]) => {
      const n = id === 'todo' ? LEDGER.length : LEDGER.filter((r) => r.kind === id).length;
      const b = el('button', 'chip' + (state.filter === id ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(state.filter === id));
      b.innerHTML = label + ' <span class="n">' + n + '</span>';
      b.addEventListener('click', () => {
        state.filter = id;
        renderFilters();
        renderLedger();
      });
      host.appendChild(b);
    });
  }

  function visibleRows() {
    const q = state.search.trim().toLowerCase();
    return LEDGER.filter(
      (r) =>
        (state.filter === 'todo' || r.kind === state.filter) &&
        (!q ||
          (r.label + ' ' + r.detail + ' ' + r.actor + ' ' + r.time + ' ' + money(r.effect))
            .toLowerCase()
            .includes(q)),
    );
  }

  function renderLedger() {
    const body = $('#ledger-body');
    body.textContent = '';
    const rows = visibleRows();
    $('#ledger-empty').hidden = rows.length > 0;
    rows.forEach((r) => {
      const tr = el('tr');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-expanded', String(state.expanded === r.seq));
      const td1 = el('td', 'c-seq');
      td1.textContent = r.seq + ' · ' + r.time;
      const td2 = el('td');
      const t = el('span', 'ttype');
      t.dataset.k = r.kind === 'opening' ? 'neutral' : r.kind;
      t.appendChild(el('i'));
      t.appendChild(document.createTextNode(r.label));
      td2.appendChild(t);
      td2.appendChild(el('span', 'who', ' · ' + r.actor));
      const td3 = el('td', null, r.detail);
      if (r.link) {
        const a = el('a', 'd-link', r.link);
        a.href = '#';
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          notice('Se abre ' + r.link + ' en la vista de ventas.', 'ok');
        });
        td3.appendChild(a);
      }
      const td7 = el(
        'td',
        'c-amt' + (r.effect < 0 ? ' is-neg' : ''),
        r.effect === 0 ? '$0.00' : signed(r.effect),
      );
      tr.append(td1, td2, td3, td7);
      body.appendChild(tr);
      if (state.expanded === r.seq) {
        const dtr = el('tr', 'row-detail');
        const td = el('td');
        td.colSpan = 4;
        const box = el('div', 'detail');
        const item = (k, v, mono) => {
          const w = el('div', 'detail-item');
          w.appendChild(el('dt', null, k));
          const dd = el('dd', mono ? 'mono' : null, v);
          w.appendChild(dd);
          return w;
        };
        box.append(
          item('Referencia', 'cmd ' + r.seq + '·9f' + (r.seq * 7).toString(16) + 'a', true),
          item('Efecto en el cajón', r.effect === 0 ? 'ninguno' : signed(r.effect)),
          item('Operador', r.actor),
          item('Aprobación', r.approver ? 'PIN de ' + r.approver : 'no requerida'),
          item('Terminal', r.device || '—'),
          item('Nota', r.note || '—'),
        );
        td.appendChild(box);
        dtr.appendChild(td);
        body.appendChild(dtr);
      }
      const toggle = () => {
        state.expanded = state.expanded === r.seq ? null : r.seq;
        renderLedger();
        if (state.expanded) {
          const nt = body.querySelector('tr[aria-expanded="true"]');
          if (nt) nt.focus();
        }
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
    $('#ledger-count').textContent = rows.length + ' de ' + LEDGER.length + ' movimientos';
  }

  function renderFoot() {
    const host = $('#ledger-foot');
    host.textContent = '';
    const left = el(
      'span',
      null,
      LEDGER.length +
        ' movimientos · ' +
        LEDGER.filter((r) => r.kind === 'sale').length +
        ' ventas en efectivo · ' +
        LEDGER.filter((r) => r.kind === 'nosale').length +
        ' no-sale',
    );
    const right = el('span');
    const sum = expectedCash();
    right.innerHTML =
      'El libro suma <b>' +
      money(sum) +
      '</b> ' +
      '<span class="match">✓ coincide con el esperado</span>';
    host.append(left, right);
  }

  function renderRecon() {
    const host = $('#recon');
    host.textContent = '';
    // attempts
    const c1 = el('div');
    c1.appendChild(el('h3', null, 'Intentos'));
    if (state.counted == null) {
      c1.appendChild(el('p', 'empty', 'Aún no hay conteo en este turno.'));
    } else {
      const a = el('div', 'attempt');
      const top = el('div', 'top');
      top.append(
        el('span', null, '#' + state.countAttempt + ' · ' + state.countedBy),
        el('span', null, money(state.counted)),
      );
      const meta = el(
        'div',
        'meta',
        'secuencia ' +
          LEDGER.length +
          ' · ' +
          Object.keys(state.denominations).length +
          ' denominaciones · ' +
          state.countedAt,
      );
      a.append(top, meta);
      c1.appendChild(a);
      const tools = el('div');
      tools.style.cssText = 'display:flex;gap:var(--s1);flex-wrap:wrap;margin-top:var(--s2)';
      const b1 = el('button', 'ghost-btn ghost-btn--sm', 'Volver a contar');
      b1.type = 'button';
      b1.dataset.act = 'count';
      b1.addEventListener('click', openCount);
      tools.appendChild(b1);
      if (!state.reconciled && !state.closed) {
        const b2 = el('button', 'ghost-btn ghost-btn--sm', 'Cancelar conteo');
        b2.type = 'button';
        b2.dataset.act = 'cancel-count';
        b2.addEventListener('click', cancelCount);
        tools.appendChild(b2);
      }
      c1.appendChild(tools);
    }
    // denominations
    const c2 = el('div');
    c2.appendChild(el('h3', null, 'Composición del conteo'));
    if (state.counted == null) {
      c2.appendChild(el('p', 'empty', 'Sin conteo.'));
    } else {
      const total = countedTotal(state.denominations) || 1;
      const bar = el('div', 'composition');
      const legend = el('div', 'legend');
      const present = DENOMS.filter((d) => (state.denominations[d] || 0) > 0);
      present.slice(0, 4).forEach((d, i) => {
        const qty = state.denominations[d] || 0;
        const line = d * qty;
        const tint =
          'color-mix(in srgb, var(--brand) ' + Math.max(26, 100 - i * 8) + '%, var(--surface-3))';
        const seg = el('i');
        seg.style.width = (line / total) * 100 + '%';
        seg.style.background = tint;
        bar.appendChild(seg);
        const lg = el('span');
        const sw = el('i', 'swatch');
        sw.style.background = tint;
        lg.append(sw, document.createTextNode(money(d) + ' ×' + qty + ' '));
        const b = el('b', null, money(line));
        lg.appendChild(b);
        legend.appendChild(lg);
      });
      if (present.length > 4)
        legend.appendChild(el('span', null, 'y ' + (present.length - 4) + ' más'));
      c2.append(bar, legend);
    }
    // duties
    const c3 = el('div');
    c3.appendChild(el('h3', null, 'Separación de funciones'));
    const dl = el('dl', 'duties');
    [
      ['Abrió', 'Ana R.'],
      ['Contó', state.counted ? state.countedBy : '—'],
      ['Aprobó', state.varianceReason && approvalFor() ? 'Gerardo P. (PIN)' : '—'],
      ['Cerrará', state.closed ? 'Luis M.' : '—'],
      ['Motivo', state.varianceReason || (variance() === 0 ? 'sin diferencia' : 'pendiente')],
    ].forEach(([k, v]) => {
      const d = el('div');
      d.appendChild(el('dt', null, k));
      d.appendChild(el('dd', null, v));
      dl.appendChild(d);
    });
    c3.appendChild(dl);
    host.append(c1, c2, c3);
  }

  function renderActions() {
    const host = $('#quick-actions');
    host.textContent = '';
    const on =
      !!state.policy &&
      state.shiftStatus === 'open' &&
      state.online &&
      state.selectedRegister === 'r1';
    const off = (reason) => ({ disabled: !on, reason: reason });
    host.appendChild(
      actionButton(
        '+ Entrada',
        'PIN ≥ ' + money(state.policy ? state.policy.moveThreshold : 0),
        () => openMove('in'),
        Object.assign(off('El turno no está abierto'), { act: 'move-in' }),
      ),
    );
    host.appendChild(
      actionButton(
        '− Salida',
        'gasto',
        () => openMove('out'),
        Object.assign(off('El turno no está abierto'), { act: 'move-out' }),
      ),
    );
    host.appendChild(
      actionButton(
        'Retiro a caja fuerte',
        'custodia',
        () => openMove('safe'),
        Object.assign(off('El turno no está abierto'), { act: 'move-safe' }),
      ),
    );
    host.appendChild(
      actionButton(
        'Abrir el cajón sin venta',
        'motivo + PIN',
        openNoSale,
        Object.assign(off('El turno no está abierto'), { act: 'nosale', wide: true }),
      ),
    );
  }

  function renderCustody() {
    const host = $('#custody-actions');
    host.textContent = '';
    const s = state.shiftStatus;
    host.appendChild(
      actionButton(
        'Suspender',
        'pausa el turno',
        () => {
          state.shiftStatus = 'suspended';
          notice('Turno suspendido. El cajón sigue siendo tuyo.', 'warn');
          render();
        },
        { act: 'suspend', disabled: s !== 'open' },
      ),
    );
    host.appendChild(
      actionButton(
        'Reanudar',
        'vuelve a abierto',
        () => {
          state.shiftStatus = 'open';
          notice('Turno reanudado.', 'ok');
          render();
        },
        { act: 'resume', disabled: s !== 'suspended' && s !== 'handoff_pending' },
      ),
    );
    host.appendChild(
      actionButton(
        'Entregar turno',
        'PIN del entrante',
        () => {
          state.shiftStatus = 'handoff_pending';
          notice('Traspaso registrado. Espera al siguiente operador.', 'ok');
          render();
        },
        { act: 'handoff', disabled: !(state.policy && state.policy.handoff) || s !== 'open' },
      ),
    );
    host.appendChild(
      actionButton(
        'Traer a esta terminal',
        'sin conteo',
        () => {
          state.adoptable = false;
          state.shiftStatus = 'open';
          notice('El turno volvió a esta terminal.', 'ok');
          render();
        },
        { act: 'adopt', disabled: !state.adoptable },
      ),
    );
    if (s === 'blocked' || state.reclaimable) {
      host.appendChild(
        actionButton('Recuperar', 'cuenta el cajón', () => openCount(), { act: 'recover' }),
      );
      host.appendChild(
        actionButton(
          'Liberar la caja',
          'terminal perdida',
          () => {
            state.reclaimable = null;
            state.shiftStatus = 'open';
            notice('Caja liberada. El dinero sigue en el cajón.', 'warn');
            render();
          },
          { act: 'reclaim', disabled: !state.reclaimable },
        ),
      );
    } else if (state.adoptable) {
      host.appendChild(
        actionButton('Liberar la caja', 'no aplica', () => {}, {
          act: 'reclaim',
          disabled: true,
          reason: 'El turno tiene dueño',
        }),
      );
    }
  }

  function renderTrace() {
    const host = $('#trace');
    host.textContent = '';
    const items = [
      { t: '07:12', w: 'Apertura del turno', who: 'Ana R. · POS-01 · fondo ' + money(150000) },
      { t: '12:10', w: 'Caja barra pausada', who: 'reemplazo por Caja barra (2)', custody: true },
      { t: '12:55', w: 'Retiro a caja fuerte', who: 'Luis M. · ' + money(200000) },
      { t: '13:20', w: 'Apertura de cajón sin venta', who: 'Ana R. · aprobó Gerardo P.' },
    ];
    if (state.counted != null)
      items.push({
        t: state.countedAt,
        w: 'Conteo #' + state.countAttempt,
        who: state.countedBy + ' · ' + money(state.counted),
      });
    if (state.varianceReason)
      items.push({ t: '13:58', w: 'Motivo de la diferencia', who: state.varianceReason });
    if (state.reconciled)
      items.push({ t: '13:59', w: 'Turno conciliado', who: 'secuencia fija ' + LEDGER.length });
    if (state.closed) items.push({ t: '14:01', w: 'Turno cerrado', who: 'caja liberada' });
    if (state.depositCreated) items.push({ t: '14:03', w: 'Depósito creado', who: 'DEP-2291' });
    if (state.adoptable)
      items.push({
        t: '—',
        w: 'Turno propio en otra terminal',
        who: 'puedes traerlo sin contar',
        pending: true,
      });
    if (state.reclaimable)
      items.push({
        t: '—',
        w: 'Cajón retenido por terminal perdida',
        who: state.reclaimable,
        pending: true,
      });
    if (state.pendingCommand)
      items.push({ t: '—', w: 'Comando pendiente', who: state.pendingCommand, pending: true });
    if (!state.closed)
      items.push({ t: '—', w: 'Cierre del turno', who: 'pendiente', pending: true });
    const extra = items.length - 5;
    const shown = extra > 0 ? items.slice(-5) : items;
    if (extra > 0) {
      const li = el('li', 'is-pending');
      li.appendChild(
        el('div', 'who', extra + (extra === 1 ? ' evento anterior' : ' eventos anteriores')),
      );
      host.appendChild(li);
    }
    shown.forEach((i) => {
      const li = el('li', i.pending ? 'is-pending' : i.custody ? 'is-custody' : '');
      li.appendChild(el('div', 'when', i.t));
      li.appendChild(el('div', 'what', i.w));
      li.appendChild(el('div', 'who', i.who));
      host.appendChild(li);
    });
  }

  function stepState(n) {
    const c = state.counted != null;
    const reasonDone = c && (variance() === 0 || state.varianceReason);
    const done = [c, reasonDone, state.reconciled, state.closed, state.depositCreated];
    if (done[n - 1]) return 'is-done';
    const first = done.findIndex((d) => !d);
    return first === n - 1 ? 'is-now' : '';
  }

  function renderSteps() {
    const host = $('#steps');
    host.textContent = '';
    const steps = [
      {
        n: 1,
        t: 'Contar el cajón',
        d:
          state.counted == null
            ? state.policy && state.policy.blind
              ? 'ciego: el esperado se revela al enviar'
              : 'conteo visible'
            : 'intento ' + state.countAttempt + ' · ' + money(state.counted),
      },
      {
        n: 2,
        t: 'Registrar la diferencia',
        d:
          variance() == null
            ? 'espera el conteo'
            : variance() === 0
              ? 'sin diferencia'
              : signed(variance()) +
                (approvalFor() ? ' · requiere PIN' : ' · dentro de tolerancia'),
      },
      { n: 3, t: 'Conciliar el turno', d: 'fija el conteo y el esperado' },
      {
        n: 4,
        t: 'Cerrar y liberar la caja',
        d: closeNeedsPin()
          ? 'la diferencia supera ' +
            money(state.policy ? state.policy.closeThreshold : 0) +
            ' → PIN'
          : 'sin aprobación adicional',
      },
      { n: 5, t: 'Crear el depósito', d: 'el fondo se queda' },
    ];
    steps.forEach((s) => {
      const li = el('li', 'step ' + stepState(s.n));
      li.appendChild(el('span', 'num', s.n));
      const txt = el('div', 'txt');
      txt.appendChild(el('div', 't', s.t));
      txt.appendChild(el('div', 'd', s.d));
      li.appendChild(txt);
      li.appendChild(el('span', null, ''));
      host.appendChild(li);
    });
    // close actions
    const ca = $('#close-actions');
    ca.textContent = '';
    const canReason = state.counted != null && variance() !== 0 && !state.varianceReason;
    const canReconcile =
      state.counted != null && (variance() === 0 || !!state.varianceReason) && !state.reconciled;
    const canClose = state.reconciled && !state.closed;
    const canDeposit = state.closed && !state.depositCreated;
    let label = 'Contar el cajón';
    let fn = openCount;
    let meta = 'paso 1';
    let disabled = false;
    if (state.closed) {
      if (canDeposit) {
        label = 'Crear el depósito';
        fn = openDeposit;
        meta = 'paso 5 · ' + money(Math.max(0, (state.counted || 0) - 150000));
      } else {
        label = 'Turno cerrado y depositado';
        fn = openPrint;
        meta = 'ver el arqueo';
      }
    } else if (canClose) {
      label = 'Cerrar el turno' + (closeNeedsPin() ? ' · requiere PIN' : '');
      fn = () => doClose(false);
      meta = 'paso 4 · libera la caja';
    } else if (canReconcile) {
      label = 'Conciliar el turno';
      fn = reconcile;
      meta = 'paso 3 · fija el conteo';
    } else if (canReason) {
      label = 'Registrar el motivo';
      fn = openVariance;
      meta = 'paso 2 · ' + signed(variance());
    } else if (state.counted != null) {
      label = 'Volver a contar';
      fn = openCount;
      meta = 'intento ' + state.countAttempt;
    }
    const primary = execButton(label, meta, fn, disabled);
    ca.appendChild(primary);
    $('#close-hint').textContent = state.closed
      ? 'cerrado 14:01'
      : 'paso ' +
        (1 +
          [
            state.counted != null,
            state.varianceReason != null || variance() === 0,
            state.reconciled,
            state.closed,
          ].filter(Boolean).length);
  }

  function renderCountSummary() {
    const host = $('#count-summary');
    host.textContent = '';
    const card = el('div', 'count-strip');
    if (state.counted == null) {
      card.appendChild(el('span', 'lbl', 'Conteo'));
      card.appendChild(
        el(
          'span',
          'hint',
          state.policy && state.policy.blind
            ? 'ciego · el esperado se revela al enviar'
            : 'sin conteo todavía',
        ),
      );
    } else {
      card.appendChild(el('span', 'lbl', 'Conteo #' + state.countAttempt));
      const b = el('b', null, money(state.counted));
      card.appendChild(b);
      card.appendChild(
        el(
          'span',
          'hint',
          state.countedBy +
            ' · ' +
            state.countedAt +
            ' · ' +
            Object.keys(state.denominations).length +
            ' denom.',
        ),
      );
    }
    host.appendChild(card);
  }

  function renderApprovals() {
    const p = state.policy;
    const host = $('#approvals');
    host.textContent = '';
    const rows = p
      ? [
          ['Movimiento ≥', money(p.moveThreshold)],
          ['Cierre si la diferencia >', money(p.closeThreshold)],
          ['Tolerancia', money(p.tolerance)],
          ['Aprobación usada', state.approvedUse.who + ' · ' + state.approvedUse.what],
          [
            'Aprobación requerida',
            closeNeedsPin() ? 'sí (PIN)' : 'no',
            closeNeedsPin() ? 'is-bad' : 'is-muted',
          ],
        ]
      : [['Política', 'ausente', 'is-bad']];
    rows.forEach(([k, v, cls]) => {
      const d = el('div');
      d.appendChild(el('dt', null, k));
      d.appendChild(el('dd', cls || null, v));
      host.appendChild(d);
    });
    const tools = $('#approval-tools');
    tools.textContent = '';
    const print = el('button', 'ghost-btn ghost-btn--sm', 'Ver arqueo');
    print.type = 'button';
    print.dataset.act = 'print';
    print.addEventListener('click', openPrint);
    const mail = el('button', 'ghost-btn ghost-btn--sm', 'Enviar por correo');
    mail.type = 'button';
    mail.dataset.act = 'email';
    mail.addEventListener('click', () => {
      notice('Arqueo enviado a administracion@kalala.mx', 'ok');
    });
    tools.append(print, mail);
  }

  function renderDiagnostics(host) {
    host = host || $('#diagnostics');
    if (!host) return;
    host.textContent = '';
    [
      ['Recovery state', state.recoveryState],
      ['Comando pendiente', state.pendingCommand || '—'],
      ['correlationId', '9f2c…41ab'],
      ['ledger seq', String(LEDGER.length)],
    ].forEach(([k, v]) => {
      const d = el('div');
      d.appendChild(el('dt', null, k));
      d.appendChild(el('dd', null, v));
      host.appendChild(d);
    });
  }

  function render() {
    document.body.dataset.view = state.view;
    renderShift();
    renderPills();
    renderEquation();
    renderAnswer();
    renderDrawers();
    renderShifts();
    renderDeposit();
    renderFilters();
    renderLedger();
    renderFoot();
    renderRecon();
    renderActions();
    renderCustody();
    renderTrace();
    renderSteps();
    renderCountSummary();
    renderApprovals();
    renderDiagnostics();
  }

  /* ───────────────────────────── flujos ───────────────────────────── */

  let draft = {};
  function openCount() {
    draft = Object.assign({}, state.denominations);
    renderDenoms();
    openDialog('#dlg-count', '#denoms input');
  }

  function renderDenoms() {
    const host = $('#denoms');
    host.textContent = '';
    DENOMS.forEach((d) => {
      const row = el('div', 'denom');
      row.appendChild(el('span', 'face', money(d)));
      const stepper = el('div', 'stepper');
      const minus = el('button', null, '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', 'Quitar ' + money(d));
      const input = el('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.value = String(draft[d] || 0);
      input.setAttribute('aria-label', 'Cantidad de ' + money(d));
      const plus = el('button', null, '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', 'Agregar ' + money(d));
      const set = (n) => {
        draft[d] = Math.max(0, Math.min(999, n));
        input.value = String(draft[d]);
        updateTally();
      };
      minus.addEventListener('click', () => set((draft[d] || 0) - 1));
      plus.addEventListener('click', () => set((draft[d] || 0) + 1));
      input.addEventListener('input', () =>
        set(parseInt(input.value.replace(/\D/g, '') || '0', 10)),
      );
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          set((draft[d] || 0) + 1);
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          set((draft[d] || 0) - 1);
        }
      });
      stepper.append(minus, input, plus);
      row.appendChild(stepper);
      row.appendChild(el('span', 'line', money((draft[d] || 0) * d)));
      host.appendChild(row);
      const idx = DENOMS.indexOf(d);
      if (idx === 0) setTimeout(() => {}, 0);
    });
    updateTally();
  }

  function updateTally() {
    const total = countedTotal(draft);
    $('#tally-value').textContent = money(total);
    const lines = Object.keys(draft).filter((k) => draft[k] > 0).length;
    $('#tally-sub').textContent = lines + (lines === 1 ? ' denominación' : ' denominaciones');
    const btn = $('#btn-submit-count');
    btn.disabled = total <= 0;
    btn.textContent = 'Confirmar conteo · ' + money(total);
    $$('#denoms .denom').forEach((row, i) =>
      row.classList.toggle('is-on', (draft[DENOMS[i]] || 0) > 0),
    );
  }

  function submitCount() {
    const total = countedTotal(draft);
    if (total <= 0) return;
    const hadCount = state.counted != null;
    state.denominations = Object.assign({}, draft);
    state.counted = total;
    state.countAttempt = hadCount ? state.countAttempt + 1 : 1;
    state.countedBy = 'Luis M.';
    state.countedAt = new Date().toTimeString().slice(0, 5);
    state.varianceReason = null;
    state.varianceApproved = false;
    state.reconciled = false;
    closeDialog($('#dlg-count'), 'ok');
    const v = variance();
    notice(
      'Conteo enviado. El esperado era ' +
        money(expectedCash()) +
        ' · ' +
        (v === 0 ? 'sin diferencia' : signed(v) + (v < 0 ? ' faltante' : ' sobrante')),
      v === 0 ? 'ok' : 'warn',
    );
    const ans = $('#answer');
    ans.classList.remove('flash');
    void ans.offsetWidth;
    ans.classList.add('flash');
    render();
  }

  function cancelCount() {
    state.counted = null;
    state.varianceReason = null;
    state.reconciled = false;
    notice('Conteo cancelado. El turno vuelve a abierto y vuelve a aceptar efectivo.', 'ok');
    render();
  }

  const REASONS = [
    ['counting_error', 'Error de conteo'],
    ['change_error', 'Error de cambio'],
    ['unrecorded_paid_in', 'Ingreso no registrado'],
    ['unrecorded_paid_out', 'Retiro no registrado'],
    ['missing_safe_drop', 'Retiro a caja fuerte no registrado'],
    ['cash_handling_error', 'Error de manejo de efectivo'],
    ['unknown_operational_difference', 'Diferencia operativa'],
    ['other_approved_reason', 'Otro motivo aprobado'],
  ];

  let varDraft = null;
  function openVariance() {
    if (state.counted == null) {
      notice('Primero cuenta el cajón.', 'warn');
      return;
    }
    varDraft = { reason: state.varianceReason || '', note: '' };
    const host = $('#dlg-var-body');
    host.textContent = '';
    $('#dlg-var-sub').textContent =
      signed(variance()) +
      ' · ' +
      (approvalFor() ? 'fuera de tolerancia' : 'dentro de la tolerancia');
    const fs = el('fieldset', 'reasons');
    fs.appendChild(el('legend', 'sr', 'Motivo'));
    REASONS.forEach(([id, label]) => {
      const lab = el('label', 'reason' + (varDraft.reason === id ? ' is-on' : ''));
      const input = el('input');
      input.type = 'radio';
      input.name = 'vreason';
      input.value = id;
      input.checked = varDraft.reason === id;
      input.addEventListener('change', () => {
        varDraft.reason = id;
        $$('.reason', fs).forEach((r) =>
          r.classList.toggle('is-on', r.contains(input) && input.checked),
        );
      });
      lab.append(input, el('span', 'r', label));
      fs.appendChild(lab);
    });
    host.appendChild(fs);
    const note = el('label', 'field');
    note.appendChild(el('span', null, 'Nota (opcional)'));
    const ni = el('input');
    ni.id = 'var-note';
    ni.maxLength = 160;
    ni.placeholder = 'Ej. faltó registrar el retiro del proveedor';
    note.appendChild(ni);
    host.appendChild(note);
    const hint = el(
      'p',
      'field-help',
      approvalFor()
        ? 'La diferencia supera la tolerancia. El motivo lo aprueba un gerente con PIN.'
        : 'Dentro de la tolerancia. El motivo queda registrado.',
    );
    host.appendChild(hint);
    openDialog('#dlg-variance', '.reason input');
  }

  function submitVariance() {
    if (!varDraft.reason) {
      notice('Elige un motivo.', 'warn');
      return;
    }
    if (approvalFor() && !state.varianceApproved) {
      closeDialog($('#dlg-variance'), 'pin');
      openPin(
        'variance',
        'Aprobación de la diferencia',
        signed(variance()) + ' supera la tolerancia de ' + money(state.policy.tolerance) + '.',
        operationCard(
          signed(variance()),
          'Diferencia del turno · motivo: ' +
            (REASONS.find((r) => r[0] === varDraft.reason) || [])[1],
        ),
      );
      return;
    }
    state.varianceReason = (REASONS.find((r) => r[0] === varDraft.reason) || [])[1];
    varDraft = null;
    closeDialog($('#dlg-variance'), 'ok');
    notice('Motivo registrado: ' + state.varianceReason + '.', 'ok');
    render();
  }

  let pinIntent = null;
  function openPin(intent, title, sub, operation) {
    pinIntent = intent;
    $('#dlg-pin-t').textContent = title;
    $('#dlg-pin-sub').textContent = sub;
    $('#dlg-pin-op').innerHTML = operation;
    $('#pin-input').value = '';
    $('#pin-error').hidden = true;
    openDialog('#dlg-pin', '#pin-input');
  }

  function submitPin() {
    const v = $('#pin-input').value.trim();
    if (!/^\d{4,8}$/.test(v)) {
      const e = $('#pin-error');
      e.textContent = 'El PIN tiene de 4 a 8 dígitos.';
      e.hidden = false;
      $('#pin-input').focus();
      return;
    }
    closeDialog($('#dlg-pin'), 'ok');
    const i = pinIntent;
    pinIntent = null;
    if (i === 'close') doClose(true);
    else if (i === 'variance') {
      state.varianceApproved = true;
      submitVariance();
    } else if (i === 'move') applyMove(true);
    else if (i === 'nosale') applyNoSale(true);
  }

  function reconcile() {
    if (state.counted == null) return;
    if (variance() !== 0 && !state.varianceReason) {
      notice('Registra primero el motivo de la diferencia.', 'warn');
      return;
    }
    if (approvalFor() && !state.approvedUse) {
      openPin(
        'variance',
        'Aprobación de la diferencia',
        signed(variance()) + ' supera la tolerancia de ' + money(state.policy.tolerance),
        operationCard(signed(variance()), 'Diferencia del turno'),
      );
      return;
    }
    state.reconciled = true;
    state.shiftStatus = 'reconciliation_required';
    notice('Turno conciliado. El conteo queda fijo con la secuencia ' + LEDGER.length + '.', 'ok');
    render();
  }

  function operationCard(amount, meta) {
    return '<span class="op-amount">' + amount + '</span><span class="op-meta">' + meta + '</span>';
  }

  function doClose(skipPin) {
    if (!state.reconciled) return;
    if (closeNeedsPin() && !skipPin) {
      openPin(
        'close',
        'Aprobación del cierre',
        'La diferencia ' +
          signed(variance()) +
          ' supera ' +
          money(state.policy.closeThreshold) +
          '.',
        operationCard(signed(variance()), 'Diferencia del turno · cierre'),
      );
      return;
    }
    state.closed = true;
    state.shiftStatus = 'closed';
    notice('Turno cerrado. El cajón quedó libre y el arqueo está listo.', 'ok');
    render();
    setTimeout(openPrint, 500);
  }

  function openDeposit() {
    const keep = 150000;
    const dep = Math.max(0, (state.counted || 0) - keep);
    const host = $('#deposit-form');
    host.textContent = '';
    const f1 = el('label', 'field');
    f1.appendChild(el('span', null, 'Fondo que se queda en el cajón'));
    const i1 = el('input');
    i1.className = 'money-input';
    i1.id = 'dep-keep';
    i1.value = money(keep);
    f1.appendChild(i1);
    const f2 = el('label', 'field');
    f2.appendChild(el('span', null, 'Depósito calculado'));
    const i2 = el('input');
    i2.id = 'dep-amount';
    i2.value = money(dep);
    i2.readOnly = true;
    f2.appendChild(i2);
    const upd = () => {
      const n = Math.max(0, parseFloat((i1.value || '').replace(/[^\d.]/g, '')) || 0);
      i2.value = money(Math.max(0, (state.counted || 0) - n * 100));
    };
    i1.addEventListener('input', upd);
    host.append(f1, f2);
    host.appendChild(
      el('p', 'field-help', 'El depósito se calcula sobre el conteo fijo del cierre.'),
    );
    openDialog('#dlg-deposit', '#dep-keep');
  }

  function submitDeposit() {
    state.depositCreated = true;
    closeDialog($('#dlg-deposit'), 'ok');
    notice('Depósito creado · DEP-2291.', 'ok');
    render();
  }

  function openMove(kind) {
    const map = {
      in: [
        'Entrada de efectivo',
        'Suma al cajón. Requiere PIN por encima de ' + money(state.policy.moveThreshold) + '.',
      ],
      out: ['Salida de efectivo', 'Baja el cajón. Requiere motivo.'],
      safe: ['Retiro a caja fuerte', 'Baja el cajón y queda en custodia.'],
    };
    const [title, help] = map[kind];
    $('#dlg-move-t').textContent = title;
    $('#dlg-move-sub').textContent =
      kind === 'in' ? 'Entra dinero al cajón' : 'Sale dinero del cajón';
    $('#move-amount').value = '';
    $('#move-reason').value = '';
    $('#move-help').textContent = help;
    $('#dlg-move').dataset.kind = kind;
    const presets = {
      in: ['Cobro al operador', 'Fondo para cambio', 'Reposición de monedas'],
      out: ['Pago a proveedor', 'Propinas', 'Compra urgente'],
      safe: ['Corte parcial', 'Exceso sobre el máximo'],
    };
    const host = $('#move-presets');
    host.textContent = '';
    (presets[kind] || []).forEach((p) => {
      const c = el('button', 'chip', p);
      c.type = 'button';
      c.addEventListener('click', () => {
        $('#move-reason').value = p;
        $$('.chip', host).forEach((x) => x.classList.toggle('is-on', x === c));
      });
      host.appendChild(c);
    });
    openDialog('#dlg-move', '#move-amount');
  }

  function applyMove(skipPin) {
    const kind = $('#dlg-move').dataset.kind;
    const raw = parseFloat(($('#move-amount').value || '').replace(/[^\d.]/g, '')) || 0;
    const minor = Math.round(raw * 100);
    const reason = $('#move-reason').value.trim();
    if (minor <= 0) {
      notice('Escribe un importe mayor que cero.', 'warn');
      return;
    }
    if (!reason) {
      notice('Escribe el motivo del movimiento.', 'warn');
      return;
    }
    if (minor >= state.policy.moveThreshold && !skipPin) {
      closeDialog($('#dlg-move'), 'pin');
      openPin(
        'move',
        'Aprobación del movimiento',
        money(minor) + ' alcanza el umbral de ' + money(state.policy.moveThreshold) + '.',
        operationCard(money(minor), reason),
      );
      return;
    }
    const seq = LEDGER.length + 1;
    const time = new Date().toTimeString().slice(0, 5);
    const kindMap = { in: 'in', out: 'out', safe: 'safe' };
    const labelMap = { in: 'Ingreso', out: 'Retiro', safe: 'Caja fuerte' };
    const effect = kind === 'in' ? minor : -minor;
    LEDGER.push({
      seq,
      kind: kindMap[kind],
      label: labelMap[kind],
      detail: reason,
      effect,
      actor: 'Luis M.',
      approver: minor >= state.policy.moveThreshold ? 'Gerardo P.' : null,
      device: 'POS-01',
      time,
    });
    closeDialog($('#dlg-move'), 'ok');
    notice(labelMap[kind] + ' de ' + money(minor) + ' registrado. El esperado cambió.', 'ok');
    state.counted = null;
    state.varianceReason = null;
    state.varianceApproved = false;
    state.reconciled = false;
    state.closed = false;
    render();
  }

  function openNoSale() {
    const fs = $('#ns-reasons');
    fs.textContent = '';
    fs.appendChild(el('legend', 'sr', 'Motivo'));
    [
      ['change_drawer', 'Hacer cambio · cajón'],
      ['change_customer', 'Hacer cambio · cliente'],
      ['count_drawer', 'Contar el cajón'],
    ].forEach(([id, label], i) => {
      const lab = el('label', 'reason' + (i === 0 ? ' is-on' : ''));
      const input = el('input');
      input.type = 'radio';
      input.name = 'nsreason';
      input.value = id;
      input.checked = i === 0;
      input.addEventListener('change', () =>
        $$('.reason', fs).forEach((r) =>
          r.classList.toggle('is-on', r.querySelector('input').checked),
        ),
      );
      lab.append(input, el('span', 'r', label));
      fs.appendChild(lab);
    });
    openDialog('#dlg-nosale', '.reason input');
  }

  function applyNoSale(skipPin) {
    const chosen = ($('#ns-reasons input:checked') || {}).value || 'change_drawer';
    if (!skipPin) {
      closeDialog($('#dlg-nosale'), 'pin');
      openPin(
        'nosale',
        'Abrir el cajón sin venta',
        'Queda registrado con tu nombre y el del gerente.',
        operationCard('$0.00', 'Sin efecto en el saldo'),
      );
      return;
    }
    const seq = LEDGER.length + 1;
    LEDGER.push({
      seq,
      kind: 'nosale',
      label: 'No-sale',
      detail: 'Abrir cajón · «' + chosen.replace(/_/g, ' ') + '» · hardware no verificado',
      effect: 0,
      actor: 'Luis M.',
      approver: 'Gerardo P.',
      device: 'POS-01',
      time: new Date().toTimeString().slice(0, 5),
    });
    closeDialog($('#dlg-nosale'), 'ok');
    notice('Solicitud registrada. El sistema no afirma que el cajón se abrió.', 'warn');
    render();
  }

  function receiptText() {
    const v = variance();
    const lines = [];
    lines.push('ARQUEO DE CAJA');
    lines.push('Kalala Chapultepec · Caja principal');
    lines.push('Turno 4a11-9c2 · 2026-09-29 07:12–' + (state.closed ? '14:01' : 'abierto'));
    lines.push('Operador: Luis M. · Terminal POS-01');
    lines.push('');
    lines.push('Fondo inicial          ' + money(150000));
    lines.push('Ventas en efectivo     ' + money(sumBy('sale')));
    lines.push('Ingresos               ' + money(sumBy('in')));
    lines.push('Retiros               −' + money(-sumBy('out')));
    lines.push('Caja fuerte           −' + money(-sumBy('safe')));
    lines.push('Reembolsos            −' + money(-sumBy('refund')));
    lines.push('───────────────────────────');
    lines.push('Esperado               ' + money(expectedCash()));
    lines.push('Contado                ' + (state.counted == null ? '—' : money(state.counted)));
    lines.push('Diferencia             ' + (v == null ? '—' : signed(v)));
    lines.push('');
    lines.push('Abrió: Ana R. · Contó: ' + (state.counted ? state.countedBy : '—'));
    lines.push('Aprobó: ' + (state.varianceReason && approvalFor() ? 'Gerardo P.' : '—'));
    lines.push('Motivo: ' + (state.varianceReason || '—'));
    lines.push('');
    lines.push('Firma ______________________');
    return lines.join('\n');
  }

  function openPrint() {
    $('#receipt').textContent = receiptText();
    $('#dlg-print-sub').textContent = state.closed
      ? 'Turno cerrado · listo para imprimir'
      : 'Vista previa';
    openDialog('#dlg-print', '.sheet-foot .primary-btn');
  }

  /* ───────────────────────────── paleta ───────────────────────────── */

  function paletteItems() {
    const on = !!state.policy;
    return [
      {
        g: 'Caja',
        t: 'Contar el cajón (ciego)',
        m: 'cuenta por denominación',
        run: openCount,
        off: !on,
      },
      {
        g: 'Caja',
        t: 'Entrada de efectivo',
        m: 'suma al cajón',
        run: () => openMove('in'),
        off: !on,
      },
      {
        g: 'Caja',
        t: 'Salida de efectivo',
        m: 'resta del cajón',
        run: () => openMove('out'),
        off: !on,
      },
      {
        g: 'Caja',
        t: 'Retiro a caja fuerte',
        m: 'custodia',
        run: () => openMove('safe'),
        off: !on,
      },
      { g: 'Caja', t: 'Abrir el cajón sin venta', m: 'motivo + PIN', run: openNoSale, off: !on },
      {
        g: 'Cierre',
        t: 'Registrar el motivo de la diferencia',
        m: 'obligatorio si hay diferencia',
        run: openVariance,
        off: state.counted == null,
      },
      {
        g: 'Cierre',
        t: 'Conciliar el turno',
        m: 'fija el conteo',
        run: reconcile,
        off: state.counted == null,
      },
      {
        g: 'Cierre',
        t: 'Cerrar el turno',
        m: closeNeedsPin() ? 'requiere PIN' : 'libera la caja',
        run: () => doClose(false),
        off: !state.reconciled,
      },
      {
        g: 'Cierre',
        t: 'Crear el depósito',
        m: 'el fondo se queda',
        run: openDeposit,
        off: !state.closed,
      },
      { g: 'Cierre', t: 'Ver el arqueo', m: 'imprimir o enviar', run: openPrint, off: false },
      {
        g: 'Turno',
        t: 'Suspender',
        m: 'el cajón sigue siendo tuyo',
        run: () => {
          state.shiftStatus = 'suspended';
          render();
        },
        off: state.shiftStatus !== 'open',
      },
      {
        g: 'Turno',
        t: 'Entregar el turno',
        m: 'PIN del entrante',
        run: () => {
          state.shiftStatus = 'handoff_pending';
          render();
        },
        off: !state.policy || !state.policy.handoff,
      },
      {
        g: 'Turno',
        t: 'Cancelar el conteo y volver a abierto',
        m: 'solo si el libro no cambió',
        run: cancelCount,
        off: state.counted == null,
      },
      {
        g: 'Revisión',
        t: 'Abrir los escenarios',
        m: 'ver cada estado',
        run: openScenarios,
        off: false,
      },
    ];
  }

  let palIdx = 0;
  function openPalette() {
    palIdx = 0;
    $('#palette-input').value = '';
    drawPalette();
    openDialog('#dlg-palette', '#palette-input');
  }

  function drawPalette() {
    const q = $('#palette-input').value.trim().toLowerCase();
    const list = $('#palette-list');
    list.textContent = '';
    let last = '';
    const items = paletteItems().filter(
      (i) => !q || (i.t + ' ' + i.m + ' ' + i.g).toLowerCase().includes(q),
    );
    items.forEach((i, idx) => {
      if (i.g !== last) {
        list.appendChild(el('li', 'palette-group', i.g));
        last = i.g;
      }
      const li = el('li');
      const b = el('button', 'palette-item');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(idx === palIdx));
      b.innerHTML =
        '<span>' +
        i.t +
        '</span><span class="meta">' +
        (i.off ? 'no disponible ahora' : i.m) +
        '</span>';
      if (i.off) b.disabled = true;
      b.addEventListener('click', () => {
        closeDialog($('#dlg-palette'), 'ok');
        i.run();
      });
      li.appendChild(b);
      list.appendChild(li);
    });
    if (!items.length) list.appendChild(el('li', 'palette-item', 'Sin resultados'));
  }

  /* ───────────────────────────── escenarios ───────────────────────────── */

  function applyScenario(id) {
    Object.assign(state, {
      policy: Object.assign({}, BASE.policy),
      shiftStatus: 'open',
      online: true,
      counted: BASE.counted,
      countAttempt: 1,
      countedBy: 'Luis M.',
      countedAt: '13:51',
      denominations: Object.assign({}, BASE.denominations),
      varianceReason: null,
      reconciled: false,
      closed: false,
      depositCreated: false,
      recoveryState: 'none',
      varianceApproved: false,
      pendingCommand: null,
      adoptable: false,
      reclaimable: null,
      scenario: id,
      selectedRegister: 'r1',
    });
    switch (id) {
      case 'balanced':
        state.counted = expectedCash();
        break;
      case 'within':
        state.counted = expectedCash() + 50;
        break;
      case 'big-missing':
        state.counted = expectedCash() - 65000;
        break;
      case 'full':
        state.policy.blind = false;
        break;
      case 'suspended':
        state.shiftStatus = 'suspended';
        state.counted = null;
        break;
      case 'handoff':
        state.shiftStatus = 'handoff_pending';
        state.counted = null;
        break;
      case 'adopt':
        state.adoptable = true;
        state.shiftStatus = 'suspended';
        state.counted = null;
        state.recoveryState = 'device_adoption_required';
        break;
      case 'orphan':
        state.reclaimable = 'POS-03 · revocada';
        state.recoveryState = 'register_blocked';
        break;
      case 'no-policy':
        state.policy = null;
        state.recoveryState = 'policy_expired';
        break;
      case 'offline':
        state.online = false;
        state.policy.offline = false;
        break;
      case 'pending':
        state.pendingCommand = 'pos.cash.movement paid_out · 12 s';
        state.recoveryState = 'query_original_command';
        break;
      case 'closed':
        state.counted = BASE.counted;
        state.varianceReason = 'Error de conteo';
        state.reconciled = true;
        state.closed = true;
        state.shiftStatus = 'closed';
        state.depositCreated = true;
        break;
      default:
        break;
    }
    render();
  }

  function openScenarios() {
    const fs = $('#scenarios');
    fs.textContent = '';
    fs.appendChild(el('legend', 'sr', 'Escenario'));
    SCENARIOS.forEach((s) => {
      const lab = el('label', 'reason' + (state.scenario === s.id ? ' is-on' : ''));
      const input = el('input');
      input.type = 'radio';
      input.name = 'scenario';
      input.value = s.id;
      input.checked = state.scenario === s.id;
      input.addEventListener('change', () => {
        applyScenario(s.id);
        $$('.reason', fs).forEach((r) =>
          r.classList.toggle('is-on', r.querySelector('input').checked),
        );
      });
      const wrap = el('span');
      wrap.appendChild(el('span', 'r', s.label));
      wrap.appendChild(el('span', 'field-help', s.desc));
      lab.append(input, wrap);
      fs.appendChild(lab);
    });
    const diag = el('div');
    diag.style.cssText =
      'margin-top:var(--s2); border-top:1px solid var(--line-2); padding-top:var(--s3)';
    diag.appendChild(el('h3', null, 'Diagnóstico'));
    const dl = el('dl', 'kv kv--mono');
    diag.appendChild(dl);
    fs.parentNode.appendChild(diag);
    renderDiagnostics(dl);
    openDialog('#dlg-scenarios', '.reason input');
  }

  /* ───────────────────────────── arranque ───────────────────────────── */

  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    state.theme = t;
    $('#btn-theme').setAttribute('aria-pressed', String(t === 'dark'));
  }

  function wire() {
    // theme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');
    $('#btn-theme').addEventListener('click', () =>
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    );
    $('#btn-scenarios').addEventListener('click', openScenarios);
    $('#btn-close-center').addEventListener('click', () =>
      notice('El Centro de caja se cierra y vuelve al catálogo.', 'ok'),
    );
    // views
    $$('.seg').forEach((b) =>
      b.addEventListener('click', () => {
        state.view = b.dataset.view;
        $$('.seg').forEach((x) => x.classList.toggle('is-on', x === b));
        document.body.dataset.view = state.view;
      }),
    );
    // dialogs: cancel buttons
    $$('.sheet').forEach((d) => {
      $$('[value="cancel"]', d).forEach((b) =>
        b.addEventListener('click', (e) => {
          e.preventDefault();
          closeDialog(d, 'cancel');
        }),
      );
      d.addEventListener('close', () => {
        if (document.activeElement && d.contains(document.activeElement))
          document.activeElement.blur();
      });
    });
    const btn = (id, fn) => {
      const b = $(id);
      if (b) {
        b.type = 'button';
        b.addEventListener('click', fn);
      }
    };
    btn('#btn-submit-count', submitCount);
    btn('#btn-submit-variance', submitVariance);
    btn('#btn-submit-pin', submitPin);
    btn('#btn-submit-move', () => applyMove(false));
    btn('#btn-submit-ns', () => applyNoSale(false));
    btn('#btn-submit-deposit', submitDeposit);
    btn('#btn-print', () => {
      window.print();
      closeDialog($('#dlg-print'), 'ok');
    });
    btn('#btn-email', () => {
      closeDialog($('#dlg-print'), 'ok');
      notice('Arqueo enviado a administracion@kalala.mx', 'ok');
    });
    btn('#btn-export', () => notice('Libro exportado a CSV · 17 movimientos.', 'ok'));
    $('#pin-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitPin();
      }
    });
    // search
    const search = $('#ledger-search');
    search.addEventListener('input', () => {
      state.search = search.value;
      renderLedger();
    });
    // palette input
    const pi = $('#palette-input');
    pi.addEventListener('input', () => {
      palIdx = 0;
      drawPalette();
    });
    pi.addEventListener('keydown', (e) => {
      const items = $$('#palette-list .palette-item:not([disabled])');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        palIdx = Math.min(items.length - 1, palIdx + 1);
        drawPalette();
        $$('#palette-list .palette-item')[palIdx] &&
          $$('#palette-list .palette-item')[palIdx].focus();
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        palIdx = Math.max(0, palIdx - 1);
        drawPalette();
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const b = $$('#palette-list .palette-item:not([disabled])')[palIdx];
        if (b) {
          closeDialog($('#dlg-palette'), 'ok');
          b.click();
        }
      }
    });
    // global keys
    document.addEventListener('keydown', (e) => {
      const typing =
        /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '') &&
        e.target.closest('dialog[open]');
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
        return;
      }
      if (!typing && e.key === '/') {
        e.preventDefault();
        search.focus();
        return;
      }
      if (e.key === 'Escape') {
        $$('.sheet[open]').forEach((d) => d.close('cancel'));
      }
    });
  }

  wire();
  applyScenario('over-short');
})();
