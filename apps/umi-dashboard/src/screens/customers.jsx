import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format.js';
import { XSep } from '@/shell.jsx';
import {
  creditLoyaltySeals,
  loyaltyScan,
  topupWallet,
  useCustomerDetail,
  useCustomerInsights,
  useCustomersData,
} from '@/data.jsx';

const FILTERS = [
  { id: '', label: msg`Todos` },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'cash', label: msg`Lealtad` },
  { id: 'memory', label: msg`Notas` },
  { id: 'review', label: msg`Revisión` },
];

const TABS = [
  { id: 'overview', label: msg`Resumen` },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'orders', label: msg`Pedidos` },
  { id: 'loyalty', label: msg`Lealtad` },
  { id: 'notes', label: msg`Notas` },
  { id: 'data', label: msg`Datos` },
];

/** Brand names stay as strings; everything else is a message descriptor. */
const text = (i18n, value) => (typeof value === 'string' ? value : i18n._(value));

function fmtDate(value) {
  if (!value) return '-';
  return formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(value) {
  if (!value) return '-';
  return formatDateTime(value, {
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
  const { t } = useLingui();
  return (
    <button className={'customer-row focusable' + (selected ? ' selected' : '')} onClick={onOpen}>
      <span className="avatar-lg customer-avatar">{initials(customer.displayName)}</span>
      <span className="customer-main">
        <span className="customer-name">{customer.displayName || t`Cliente sin nombre`}</span>
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
        <small>
          <Plural value={customer.value?.visits || 0} one="# visita" other="# visitas" />
        </small>
      </span>
    </button>
  );
}

function CustomersList({ selectedId }) {
  const { t, i18n } = useLingui();
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
            placeholder={t`Buscar clientes, teléfono, correo`}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="seg customer-filter" role="tablist" aria-label={t`Filtros de clientes`}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className={filter === item.id ? 'on' : ''}
              onClick={() => changeFilter(item.id)}
            >
              {text(i18n, item.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="customer-list-head">
        <span>
          {loading ? (
            <Trans>Cargando…</Trans>
          ) : (
            <Plural value={total} one="# cliente" other="# clientes" />
          )}
        </span>
        <span>{data?.source || t`plataforma de clientes`}</span>
      </div>

      {error && (
        <div className="alert danger">
          <span className="strip" />
          <I.AlertTriangle className="ico" size={18} />
          <div className="body">
            <div className="ttl">
              <Trans>Datos de clientes no disponibles</Trans>
            </div>
            <div className="sub">{error}</div>
          </div>
        </div>
      )}

      <div className="customer-list-scroll">
        {customers.length === 0 && !loading && !error && (
          <div className="customer-empty">
            <I.Users2 size={28} />
            <strong>
              <Trans>No hay clientes</Trans>
            </strong>
            <span>
              <Trans>Prueba otra búsqueda u otro filtro.</Trans>
            </span>
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
            <I.ChevronLeft size={14} /> <Trans>Anterior</Trans>
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          >
            <Trans>Siguiente</Trans> <I.ChevronRight size={14} />
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
  const { t } = useLingui();
  if (!items?.length)
    return (
      <EmptyState
        icon={<I.Activity size={24} />}
        title={t`Sin actividad reciente`}
        detail={t`Aquí aparecerán pedidos, mensajes, memoria y eventos de calidad de datos.`}
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
  const { t } = useLingui();
  if (!conversations?.length)
    return (
      <EmptyState
        icon={<I.WhatsApp size={24} />}
        title={t`Sin conversaciones de WhatsApp`}
        detail={t`El historial de conversaciones vive dentro de cada cliente.`}
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
            <strong>{conversation.summary || t`Conversación de WhatsApp`}</strong>
            <span>
              <Plural value={conversation.messageCount || 0} one="# mensaje" other="# mensajes" />{' '}
              <XSep />{' '}
              <Trans>último {fmtTime(conversation.lastMessageAt || conversation.updatedAt)}</Trans>
            </span>
          </div>
          <span className={'badge ' + statusBadge(conversation.status)}>
            {conversation.status || t`desconocido`}
          </span>
        </div>
      ))}
    </div>
  );
}

function OrdersList({ orders }) {
  const { t } = useLingui();
  if (!orders?.length)
    return (
      <EmptyState
        icon={<I.Receipt size={24} />}
        title={t`Sin pedidos vinculados`}
        detail={t`Aquí aparecerán los pedidos vinculados a este contacto.`}
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
              {order.channel || order.sourceProduct || t`pedido`} <XSep /> {fmtTime(order.placedAt)}
            </span>
          </div>
          <strong className="profile-money">{order.total || '$0.00'}</strong>
        </div>
      ))}
    </div>
  );
}

function SealsDialog({ account, onClose, onCredited }) {
  const { t } = useLingui();
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
      setError(err?.message || t`No se pudieron acreditar los sellos.`);
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Agregar sellos`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <Trans>Agregar sellos</Trans>
            </h3>
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>
                Acredita sellos a la tarjeta {account.cardNumber || t`de lealtad`}. Úsalo para poner
                al día a un cliente que llega de otro programa.
              </Trans>
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span>
            <Trans>Sellos (1–50)</Trans>
          </span>
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
          <span>
            <Trans>Nota (opcional)</Trans>
          </span>
          <input
            type="text"
            maxLength={200}
            value={note}
            placeholder={t`p. ej. migración de cartón físico`}
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
            <Trans>Cancelar</Trans>
          </button>
          <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
            {pending ? (
              <Trans>Acreditando…</Trans>
            ) : valid ? (
              <Plural value={count} one="Acreditar # sello" other="Acreditar # sellos" />
            ) : (
              <Trans>Acreditar sellos</Trans>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function TopupDialog({ account, onClose, onCredited }) {
  const { t } = useLingui();
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
      setError(err?.message || t`No se pudo recargar el saldo.`);
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Recargar saldo`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <Trans>Recargar saldo</Trans>
            </h3>
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>
                Agrega saldo al monedero de la tarjeta {account.cardNumber || t`de lealtad`}.
              </Trans>
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        <label style={{ display: 'block', marginTop: 12 }}>
          <span>
            <Trans>Monto (MXN)</Trans>
          </span>
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
          <span>
            <Trans>Nota (opcional)</Trans>
          </span>
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
            <Trans>Cancelar</Trans>
          </button>
          <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
            {pending ? (
              <Trans>Recargando…</Trans>
            ) : valid ? (
              <Trans>Recargar ${pesos}</Trans>
            ) : (
              <Trans>Recargar</Trans>
            )}
          </button>
        </div>
      </section>
    </div>
  );
}

function LoyaltyPanel({ cash, onCredited }) {
  const { t } = useLingui();
  const [showSeals, setShowSeals] = useState(false);
  const [showTopup, setShowTopup] = useState(false);
  const [scanBusy, setScanBusy] = useState(null); // 'VISIT' | 'REDEEM' | null
  const [scanError, setScanError] = useState(null);
  if (!cash?.available)
    return (
      <EmptyState
        icon={<I.Lock size={24} />}
        title={t`Umi Cash no está activo`}
        detail={t`Los datos de lealtad y monedero se ocultan hasta activar el producto.`}
      />
    );
  const account = cash?.account;
  if (!account)
    return (
      <EmptyState
        icon={<I.Wallet size={24} />}
        title={t`Sin cuenta de lealtad`}
        detail={t`Este cliente todavía no tiene una cuenta de lealtad activa.`}
      />
    );

  function credited() {
    setShowSeals(false);
    setShowTopup(false);
    onCredited?.();
  }

  async function runScan(action) {
    if (scanBusy) return;
    setScanBusy(action);
    setScanError(null);
    try {
      await loyaltyScan({ cardNumber: account.cardNumber, action });
      onCredited?.();
    } catch (err) {
      setScanError(err?.message || t`No se pudo registrar la acción.`);
    } finally {
      setScanBusy(null);
    }
  }

  return (
    <div className="loyalty-panel">
      <div className="loyalty-grid">
        <Metric
          label={t`Saldo del monedero`}
          value={account.balance || '$0.00'}
          note={account.cardNumber || t`Sin tarjeta`}
          icon={<I.Wallet size={18} />}
        />
        <Metric
          label={t`Visitas totales`}
          value={account.totalVisits || 0}
          note={t`${account.visitsThisCycle || 0} en este ciclo`}
          icon={<I.Stamp size={18} />}
        />
        <Metric
          label={t`Recompensas pendientes`}
          value={account.pendingRewards || 0}
          note={account.status || t`lealtad`}
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
            <I.Plus size={14} /> <Trans>Agregar sellos</Trans>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => setShowTopup(true)}
          >
            <I.Wallet size={14} /> <Trans>Recargar saldo</Trans>
          </button>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={scanBusy != null}
            onClick={() => runScan('VISIT')}
          >
            <I.Activity size={14} />{' '}
            {scanBusy === 'VISIT' ? <Trans>Registrando…</Trans> : <Trans>Registrar visita</Trans>}
          </button>
          {account.pendingRewards > 0 && (
            <button
              className="btn btn-sm"
              type="button"
              disabled={scanBusy != null}
              onClick={() => runScan('REDEEM')}
            >
              <I.Gift size={14} />{' '}
              {scanBusy === 'REDEEM' ? (
                <Trans>Canjeando…</Trans>
              ) : (
                <Trans>Canjear recompensa</Trans>
              )}
            </button>
          )}
        </div>
      )}
      {scanError && (
        <p className="danger-state" style={{ marginTop: 8 }}>
          {scanError}
        </p>
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
  const { t } = useLingui();
  const identities = identity?.identities || customer?.identities || [];
  const findings = identity?.findings || [];
  const candidates = identity?.mergeCandidates || [];
  return (
    <div className="profile-split">
      <section>
        <h3>
          <Trans>Identidades</Trans>
        </h3>
        <div className="profile-stack">
          {identities.length === 0 && (
            <EmptyState
              icon={<I.Info size={22} />}
              title={t`Sin identidades`}
              detail={t`Aquí aparecerán las identidades de teléfono o WhatsApp.`}
            />
          )}
          {identities.map((item) => (
            <div
              className="profile-row compact"
              key={item.id || `${item.identity_type}:${item.normalized_value}`}
            >
              <div>
                <strong>{item.identity_type || item.identityType || t`identidad`}</strong>
                <span>
                  {item.normalized_value ||
                    item.normalizedValue ||
                    item.identity_value ||
                    item.identityValue ||
                    '-'}
                </span>
              </div>
              <span className="badge badge-neutral">
                {item.verification_status || item.verificationStatus || t`registrada`}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3>
          <Trans>Calidad de datos</Trans>
        </h3>
        <div className="profile-stack">
          {candidates.length === 0 && findings.length === 0 && (
            <EmptyState
              icon={<I.Check size={22} />}
              title={t`Sin pendientes de revisión`}
              detail={t`Las coincidencias ambiguas se muestran aquí para que el dueño las revise; nunca se fusionan en silencio.`}
            />
          )}
          {candidates.map((item) => (
            <div className="profile-row compact" key={item.id}>
              <div>
                <strong>{item.match_type || t`candidato a fusión`}</strong>
                <span>{item.detail || t`Posible identidad duplicada`}</span>
              </div>
              <span className="badge badge-trial">{item.confidence || t`candidato`}</span>
            </div>
          ))}
          {findings.map((item) => (
            <div className="profile-row compact" key={item.id}>
              <div>
                <strong>{item.finding_key || t`hallazgo de datos`}</strong>
                <span>{item.detail || item.status || t`Necesita revisión`}</span>
              </div>
              <span className={'badge ' + statusBadge(item.severity)}>
                {item.severity || t`abierto`}
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
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState('overview');
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error } = useCustomerDetail(customerId, refresh);
  const customer = data?.customer;

  if (!customerId) {
    return (
      <section className="customer-profile placeholder">
        <I.Users2 size={34} />
        <strong>
          <Trans>Elige un cliente</Trans>
        </strong>
        <span>
          <Trans>
            Aquí verás su historial, sus conversaciones de WhatsApp, sus pedidos, su lealtad y tus
            notas, todo junto.
          </Trans>
        </span>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="customer-profile placeholder">
        <span className="pulse" />
        <strong>
          <Trans>Cargando cliente</Trans>
        </strong>
      </section>
    );
  }

  if (error || !customer) {
    return (
      <section className="customer-profile placeholder danger-state">
        <I.AlertTriangle size={30} />
        <strong>
          <Trans>Cliente no encontrado</Trans>
        </strong>
        <span>{error || t`El cliente seleccionado no está disponible para este negocio.`}</span>
        <Link className="btn btn-secondary btn-sm" to="/customers">
          <Trans>Volver a Clientes</Trans>
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
            <h2>{customer.displayName || t`Cliente sin nombre`}</h2>
            <p>
              {customer.normalizedPhone || customer.phone || '-'}
              {customer.email ? ` / ${customer.email}` : ''}
            </p>
          </div>
        </div>
        <div className="profile-actions">
          <span className={'badge ' + statusBadge(customer.status)}>
            {customer.status || t`activo`}
          </span>
          {customer.dataQuality?.needsReview && (
            <span className="badge badge-trial">
              <Trans>Revisión</Trans>
            </span>
          )}
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
          label={t`Lealtad`}
        />
        <ProductChip
          product={customer.products?.orders}
          icon={<I.Receipt size={14} />}
          label={t`Pedidos`}
        />
        <ProductChip
          product={customer.products?.giftCards}
          icon={<I.Gift size={14} />}
          label={t`Tarjetas de regalo`}
        />
      </div>

      <div className="profile-tabs" role="tablist" aria-label={t`Perfil del cliente`}>
        {TABS.map((item) => (
          <button
            key={item.id}
            className={activeTab === item.id ? 'on' : ''}
            onClick={() => setTab(item.id)}
          >
            {text(i18n, item.label)}
          </button>
        ))}
      </div>

      <div className="profile-body">
        {activeTab === 'overview' && (
          <>
            <div className="customer-metrics">
              <Metric
                label={t`Pedidos`}
                value={customer.value?.orders || 0}
                note={customer.value?.totalSpend || '$0.00'}
                icon={<I.Receipt size={18} />}
              />
              <Metric
                label={t`Visitas`}
                value={customer.value?.visits || 0}
                note={customer.value?.walletBalance || t`$0.00 en monedero`}
                icon={<I.Activity size={18} />}
              />
              <Metric
                label={t`Datos de memoria`}
                value={customer.memory?.factsCount || 0}
                note={customer.memory?.embeddingHealth || t`sin indexar`}
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
          <h2>
            <Trans>Clientes</Trans>
          </h2>
          <div className="en">
            <Trans>Un perfil por cliente: WhatsApp, pedidos, lealtad, monedero y notas.</Trans>
          </div>
        </div>
        <div className="customer-head-stats">
          <span>
            <Trans>
              <b>{formatNumber(metrics.totalCustomers || 0)}</b> en total
            </Trans>
          </span>
          <span>
            <Trans>
              <b>{formatNumber(metrics.needsReview || 0)}</b> por revisar
            </Trans>
          </span>
          <span>
            <Trans>
              <b>{formatNumber(metrics.memoryReady || 0)}</b> con memoria
            </Trans>
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
