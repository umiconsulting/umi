import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { I } from '@/icons.jsx';
import { XSep } from '@/shell.jsx';
import {
  creditLoyaltySeals,
  topupWallet,
  useCustomerDetail,
  useCustomerInsights,
  useCustomersData,
} from '@/data.jsx';

const FILTERS = [
  { id: '', label: 'Todos' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'cash', label: 'Lealtad' },
  { id: 'memory', label: 'Notas' },
  { id: 'review', label: 'Review' },
];

const TABS = [
  { id: 'overview', label: 'Resumen' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'orders', label: 'Orders' },
  { id: 'loyalty', label: 'Lealtad' },
  { id: 'notes', label: 'Notes' },
  { id: 'data', label: 'Data' },
];

function fmtDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function fmtTime(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function initials(name) {
  return (
    (name || 'UC')
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'UC'
  );
}

function statusBadge(status) {
  if (!status) return 'badge-neutral';
  if (['active', 'ready', 'open'].includes(status)) return 'badge-active';
  if (['needs_review', 'warning', 'pending'].includes(status)) return 'badge-trial';
  if (['failed', 'blocked', 'closed'].includes(status)) return 'badge-susp';
  return 'badge-info';
}

function ProductChip({ product, icon, label }) {
  const active = Boolean(product?.active);
  const available = product?.available !== false;
  return (
    <span className={'customer-chip ' + (active ? 'on' : available ? 'idle' : 'off')}>
      {icon}
      {label}
    </span>
  );
}

function CustomerRow({ customer, selected, onOpen }) {
  return (
    <button className={'customer-row focusable' + (selected ? ' selected' : '')} onClick={onOpen}>
      <span className="avatar-lg customer-avatar">{initials(customer.displayName)}</span>
      <span className="customer-main">
        <span className="customer-name">{customer.displayName || 'Unknown customer'}</span>
        <span className="customer-meta">
          <I.Phone size={12} />
          {customer.normalizedPhone || customer.phone || '-'}
          <XSep />
          {fmtDate(customer.lastTouchAt)}
        </span>
      </span>
      <span className="customer-products">
        {customer.products?.whatsapp?.active && <I.WhatsApp size={15} />}
        {customer.products?.cash?.active && <I.Wallet size={15} />}
        {customer.dataQuality?.needsReview && <I.AlertTriangle size={15} />}
      </span>
      <span className="customer-value">
        <strong>{customer.value?.totalSpend || '$0.00'}</strong>
        <small>{customer.value?.visits || 0} visits</small>
      </span>
    </button>
  );
}

function CustomersList({ selectedId }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get('page') || 1));
  const [search, setSearch] = useState(params.get('q') || '');
  const filter = params.get('filter') || '';
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Reads the previous params through the functional updater instead of closing over
  // `params`. This effect both READS and WRITES the search params, so simply adding
  // `params` to the dep array — what exhaustive-deps literally asks for — would loop:
  // the effect sets params, the new URLSearchParams identity re-triggers it, forever.
  // Taking `prev` removes the closure entirely, so there is nothing stale to track.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debouncedSearch) next.set('q', debouncedSearch);
        else next.delete('q');
        if (page > 1) next.set('page', String(page));
        else next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [debouncedSearch, page, setParams]);

  const { data, loading, error } = useCustomersData({ page, search: debouncedSearch, filter });
  const customers = data?.customers || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  function changeFilter(id) {
    const next = new URLSearchParams(params);
    if (id) next.set('filter', id);
    else next.delete('filter');
    next.delete('page');
    setPage(1);
    setParams(next);
  }

  function openCustomer(id) {
    navigate(
      '/customers/' + encodeURIComponent(id) + (params.toString() ? '?' + params.toString() : ''),
    );
  }

  return (
    <section className="customers-list">
      <div className="customer-toolbar">
        <div className="customer-search">
          <I.Search size={15} />
          <input
            className="input"
            placeholder="Search customers, phone, email"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="seg customer-filter" role="tablist" aria-label="Customer filters">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? 'on' : ''}
              onClick={() => changeFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="customer-list-head">
        <span>{loading ? 'Cargando…' : `${total.toLocaleString('es-MX')} clientes`}</span>
        <span>{data?.source || 'customer platform'}</span>
      </div>

      {error && (
        <div className="alert danger">
          <span className="strip" />
          <I.AlertTriangle className="ico" size={18} />
          <div className="body">
            <div className="ttl">Customer data unavailable</div>
            <div className="sub">{error}</div>
          </div>
        </div>
      )}

      <div className="customer-list-scroll">
        {customers.length === 0 && !loading && !error && (
          <div className="customer-empty">
            <I.Users2 size={28} />
            <strong>No customers found</strong>
            <span>Try another search or filter.</span>
          </div>
        )}
        {customers.map((customer) => (
          <CustomerRow
            key={customer.id}
            customer={customer}
            selected={selectedId === customer.id}
            onOpen={() => openCustomer(customer.id)}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div className="customer-pager">
          <button
            className="btn btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            <I.ChevronLeft size={14} /> Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            Next <I.ChevronRight size={14} />
          </button>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, note, icon }) {
  return (
    <div className="customer-metric">
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
        {note && <em>{note}</em>}
      </div>
    </div>
  );
}

function Timeline({ items }) {
  if (!items?.length)
    return (
      <EmptyState
        icon={<I.Activity size={24} />}
        title="No recent activity"
        detail="Orders, messages, memory, and data-quality events will appear here."
      />
    );
  return (
    <div className="customer-timeline">
      {items.map((item) => (
        <div className="timeline-row" key={item.type + ':' + item.id}>
          <span className="timeline-dot" />
          <div>
            <strong>{item.label || item.type}</strong>
            <span>{item.detail || item.product}</span>
          </div>
          <time>{fmtTime(item.occurredAt)}</time>
        </div>
      ))}
    </div>
  );
}

function ConversationList({ conversations }) {
  if (!conversations?.length)
    return (
      <EmptyState
        icon={<I.WhatsApp size={24} />}
        title="No WhatsApp conversations"
        detail="Conversation history is nested under each customer."
      />
    );
  return (
    <div className="profile-stack">
      {conversations.map((conversation) => (
        <div className="profile-row" key={conversation.id}>
          <span className="profile-row-icon">
            <I.WhatsApp size={17} />
          </span>
          <div>
            <strong>{conversation.summary || 'WhatsApp conversation'}</strong>
            <span>
              {conversation.messageCount || 0} messages <XSep /> last{' '}
              {fmtTime(conversation.lastMessageAt || conversation.updatedAt)}
            </span>
          </div>
          <span className={'badge ' + statusBadge(conversation.status)}>
            {conversation.status || 'unknown'}
          </span>
        </div>
      ))}
    </div>
  );
}

function OrdersList({ orders }) {
  if (!orders?.length)
    return (
      <EmptyState
        icon={<I.Receipt size={24} />}
        title="No linked orders"
        detail="Commerce orders linked to this contact will appear here."
      />
    );
  return (
    <div className="profile-stack">
      {orders.map((order) => (
        <div className="profile-row" key={order.id}>
          <span className="profile-row-icon">
            <I.Receipt size={17} />
          </span>
          <div>
            <strong>{order.orderNumber || order.id}</strong>
            <span>
              {order.channel || order.sourceProduct || 'order'} <XSep /> {fmtTime(order.placedAt)}
            </span>
          </div>
          <strong className="profile-money">{order.total || '$0.00'}</strong>
        </div>
      ))}
    </div>
  );
}

function SealsDialog({ account, onClose, onCredited }) {
  const [seals, setSeals] = useState(1);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const count = Number(seals);
  const valid = Number.isInteger(count) && count >= 1 && count <= 50;
  // One random nonce per dialog, composed with the intent (card + amount) into the
  // idempotency key: a retry of the same amount reuses the key so a credit that
  // commits but loses its response lands once, while a corrected amount yields a new
  // key so it is a new credit, not a deduped no-op.
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const idempotencyKey = `${nonce}:${account.loyaltyCardId}:${count}`;

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await creditLoyaltySeals({
        cardId: account.loyaltyCardId,
        seals: count,
        note: note.trim(),
        idempotencyKey,
      });
      onCredited();
    } catch (err) {
      setError(err?.message || 'No se pudieron acreditar los sellos.');
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Agregar sellos"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Agregar sellos</h3>
            <p style={{ color: 'var(--ink-3)' }}>
              Acredita sellos a la tarjeta {account.cardNumber || 'de lealtad'}. Úsalo para poner al
              día a un cliente que llega de otro programa.
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span>Sellos (1–50)</span>
          <input
            type="number"
            min={1}
            max={50}
            value={seals}
            onChange={(event) => setSeals(event.target.value)}
            disabled={pending}
          />
        </label>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span>Nota (opcional)</span>
          <input
            type="text"
            maxLength={200}
            value={note}
            placeholder="p. ej. migración de cartón físico"
            onChange={(event) => setNote(event.target.value)}
            disabled={pending}
          />
        </label>
        {error && (
          <p className="danger-state" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
            {pending ? 'Acreditando…' : `Acreditar ${valid ? count : ''} sellos`}
          </button>
        </div>
      </section>
    </div>
  );
}

function TopupDialog({ account, onClose, onCredited }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const pesos = Number(amount);
  const valid = Number.isFinite(pesos) && pesos >= 1;
  // Stable key per (card, amount): a retry of the same amount dedups so a top-up
  // that commits but loses its response lands once, not twice, on a money balance.
  const nonce = useMemo(() => crypto.randomUUID(), []);
  const idempotencyKey = `${nonce}:${account.loyaltyCardId}:${pesos}`;

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await topupWallet({
        cardId: account.loyaltyCardId,
        amountCentavos: Math.round(pesos * 100),
        note: note.trim(),
        idempotencyKey,
      });
      onCredited();
    } catch (err) {
      setError(err?.message || 'No se pudo recargar el saldo.');
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Recargar saldo"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Recargar saldo</h3>
            <p style={{ color: 'var(--ink-3)' }}>
              Agrega saldo al monedero de la tarjeta {account.cardNumber || 'de lealtad'}.
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span>Monto (MXN)</span>
          <input
            type="number"
            min={1}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={pending}
          />
        </label>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span>Nota (opcional)</span>
          <input
            type="text"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
          />
        </label>
        {error && (
          <p className="danger-state" style={{ marginTop: 12 }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
            {pending ? 'Recargando…' : `Recargar${valid ? ` $${pesos}` : ''}`}
          </button>
        </div>
      </section>
    </div>
  );
}

function LoyaltyPanel({ cash, onCredited }) {
  const [showSeals, setShowSeals] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  if (!cash?.available)
    return (
      <EmptyState
        icon={<I.Lock size={24} />}
        title="Umi Cash not active"
        detail="Los datos de lealtad y monedero se ocultan hasta activar el producto."
      />
    );
  const account = cash?.account;
  if (!account)
    return (
      <EmptyState
        icon={<I.Wallet size={24} />}
        title="No loyalty account"
        detail="This customer does not have an active loyalty account yet."
      />
    );

  function credited() {
    setShowSeals(false);
    onCredited?.();
  }

  return (
    <div className="loyalty-panel">
      <div className="loyalty-grid">
        <Metric
          label="Wallet balance"
          value={account.balance || '$0.00'}
          note={account.cardNumber || 'No card'}
          icon={<I.Wallet size={18} />}
        />
        <Metric
          label="Total visits"
          value={account.totalVisits || 0}
          note={`${account.visitsThisCycle || 0} this cycle`}
          icon={<I.Stamp size={18} />}
        />
        <Metric
          label="Pending rewards"
          value={account.pendingRewards || 0}
          note={account.status || 'loyalty'}
          icon={<I.Gift size={18} />}
        />
      </div>
      {account.loyaltyCardId && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => setShowSeals(true)}
          >
            <I.Plus size={14} /> Agregar sellos
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => setShowTopup(true)}
          >
            <I.Wallet size={14} /> Recargar saldo
          </button>
        </div>
      )}
      {showSeals && (
        <SealsDialog account={account} onClose={() => setShowSeals(false)} onCredited={credited} />
      )}
      {showTopup && (
        <TopupDialog account={account} onClose={() => setShowTopup(false)} onCredited={credited} />
      )}
    </div>
  );
}

function IdentityPanel({ customer, identity }) {
  const identities = identity?.identities || customer?.identities || [];
  const findings = identity?.findings || [];
  const candidates = identity?.mergeCandidates || [];
  return (
    <div className="profile-split">
      <section>
        <h3>Identities</h3>
        <div className="profile-stack">
          {identities.length === 0 && (
            <EmptyState
              icon={<I.Info size={22} />}
              title="No identity rows"
              detail="Phone or WhatsApp identities will appear here."
            />
          )}
          {identities.map((item) => (
            <div
              className="profile-row compact"
              key={item.id || `${item.identity_type}:${item.normalized_value}`}
            >
              <div>
                <strong>{item.identity_type || item.identityType || 'identity'}</strong>
                <span>
                  {item.normalized_value ||
                    item.normalizedValue ||
                    item.identity_value ||
                    item.identityValue ||
                    '-'}
                </span>
              </div>
              <span className="badge badge-neutral">
                {item.verification_status || item.verificationStatus || 'recorded'}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>Data quality</h3>
        <div className="profile-stack">
          {candidates.length === 0 && findings.length === 0 && (
            <EmptyState
              icon={<I.Check size={22} />}
              title="No open review items"
              detail="Ambiguous matches are surfaced here for owner review, never silently merged."
            />
          )}
          {candidates.map((item) => (
            <div className="profile-row compact" key={item.id}>
              <div>
                <strong>{item.match_type || 'merge candidate'}</strong>
                <span>{item.detail || 'Possible duplicate identity'}</span>
              </div>
              <span className="badge badge-trial">{item.confidence || 'candidate'}</span>
            </div>
          ))}
          {findings.map((item) => (
            <div className="profile-row compact" key={item.id}>
              <div>
                <strong>{item.finding_key || 'data finding'}</strong>
                <span>{item.detail || item.status || 'Needs review'}</span>
              </div>
              <span className={'badge ' + statusBadge(item.severity)}>
                {item.severity || 'open'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EmptyState({ icon, title, detail }) {
  return (
    <div className="profile-empty">
      {icon}
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function CustomerProfile({ customerId }) {
  const [tab, setTab] = useState('overview');
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error } = useCustomerDetail(customerId, refresh);
  const customer = data?.customer;

  if (!customerId) {
    return (
      <section className="customer-profile placeholder">
        <I.Users2 size={34} />
        <strong>Elige un cliente</strong>
        <span>
          Aquí verás su historial, sus conversaciones de WhatsApp, sus pedidos, su lealtad y tus
          notas, todo junto.
        </span>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="customer-profile placeholder">
        <span className="pulse" />
        <strong>Loading customer</strong>
      </section>
    );
  }

  if (error || !customer) {
    return (
      <section className="customer-profile placeholder danger-state">
        <I.AlertTriangle size={30} />
        <strong>Customer not found</strong>
        <span>{error || 'El cliente seleccionado no está disponible para este negocio.'}</span>
        <Link className="btn btn-secondary btn-sm" to="/customers">
          Back to Customers
        </Link>
      </section>
    );
  }

  const activeTab = TABS.find((item) => item.id === tab)?.id || 'overview';

  return (
    <section className="customer-profile">
      <header className="profile-head">
        <div className="profile-title">
          <span className="avatar-lg customer-avatar large">{initials(customer.displayName)}</span>
          <div>
            {' '}
            <h2>{customer.displayName || 'Unknown customer'}</h2>
            <p>
              {customer.normalizedPhone || customer.phone || '-'}
              {customer.email ? ` / ${customer.email}` : ''}
            </p>
          </div>
        </div>
        <div className="profile-actions">
          <span className={'badge ' + statusBadge(customer.status)}>
            {customer.status || 'active'}
          </span>
          {customer.dataQuality?.needsReview && <span className="badge badge-trial">Review</span>}
        </div>
      </header>

      <div className="profile-products">
        <ProductChip
          product={customer.products?.whatsapp}
          icon={<I.WhatsApp size={14} />}
          label="WhatsApp"
        />
        <ProductChip
          product={customer.products?.cash}
          icon={<I.Wallet size={14} />}
          label="Lealtad"
        />
        <ProductChip
          product={customer.products?.orders}
          icon={<I.Receipt size={14} />}
          label="Orders"
        />
        <ProductChip
          product={customer.products?.giftCards}
          icon={<I.Gift size={14} />}
          label="Gift cards"
        />
      </div>

      <div className="profile-tabs" role="tablist" aria-label="Customer profile">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={activeTab === item.id ? 'on' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="profile-body">
        {activeTab === 'overview' && (
          <>
            <div className="customer-metrics">
              <Metric
                label="Orders"
                value={customer.value?.orders || 0}
                note={customer.value?.totalSpend || '$0.00'}
                icon={<I.Receipt size={18} />}
              />
              <Metric
                label="Visits"
                value={customer.value?.visits || 0}
                note={customer.value?.walletBalance || '$0.00 wallet'}
                icon={<I.Activity size={18} />}
              />
              <Metric
                label="Memory facts"
                value={customer.memory?.factsCount || 0}
                note={customer.memory?.embeddingHealth || 'not indexed'}
                icon={<I.Sparkles size={18} />}
              />
            </div>
            <Timeline items={data?.timeline || []} />
          </>
        )}
        {activeTab === 'whatsapp' && <ConversationList conversations={data?.conversations || []} />}
        {activeTab === 'orders' && <OrdersList orders={data?.orders || []} />}
        {activeTab === 'loyalty' && (
          <LoyaltyPanel cash={data?.cash} onCredited={() => setRefresh((n) => n + 1)} />
        )}
        {activeTab === 'notes' && (
          <Timeline items={(data?.timeline || []).filter((item) => item.type === 'memory')} />
        )}
        {activeTab === 'data' && <IdentityPanel customer={customer} identity={data?.identity} />}
      </div>
    </section>
  );
}

export default function CustomersScreen() {
  const params = useParams();
  const customerId = params['*'] ? decodeURIComponent(params['*']) : '';
  const { data: insights } = useCustomerInsights();
  const metrics = insights?.metrics || {};

  return (
    <div className="customers-screen">
      <div className="ed-head">
        <div className="titles">
          {' '}
          <h2>Clientes</h2>
          <div className="en">
            Un perfil por cliente: WhatsApp, pedidos, lealtad, monedero y notas.
          </div>
        </div>
        <div className="customer-head-stats">
          <span>
            <b>{metrics.totalCustomers || 0}</b> total
          </span>
          <span>
            <b>{metrics.needsReview || 0}</b> review
          </span>
          <span>
            <b>{metrics.memoryReady || 0}</b> memory
          </span>
        </div>
      </div>

      <div className="customers-layout">
        <CustomersList selectedId={customerId} />
        <CustomerProfile customerId={customerId} />
      </div>
    </div>
  );
}
