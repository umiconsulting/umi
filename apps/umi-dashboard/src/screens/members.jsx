import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Select } from '@/components/select.jsx';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate, formatMoney, formatNumber } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { canCashAction, canShowCashTab } from '@/lib/cash-tabs.js';
import PermissionUnavailable from '@/components/permission-unavailable.jsx';
import { registerMember, useMembersData } from '@/data.jsx';

// Dial codes the register form offers. Mexico first; the API validates the national
// digit count per country (Mexico = exactly 10), so the picker and the check agree.
const DIAL_CODES = [
  { dial: '+52', label: '🇲🇽 +52' },
  { dial: '+1', label: '🇺🇸 +1' },
  { dial: '+34', label: '🇪🇸 +34' },
  { dial: '+57', label: '🇨🇴 +57' },
];

const SORT_OPTIONS = [
  { value: 'recent', label: msg`Más recientes` },
  { value: 'visits', label: msg`Más visitas` },
  { value: 'balance', label: msg`Mayor saldo` },
  { value: 'ltv', label: msg`Mayor gasto` },
  { value: 'inactive', label: msg`Más inactivos` },
];

function RegisterMemberDialog({ onClose, onRegistered }) {
  const { t } = useLingui();
  const [name, setName] = useState('');
  const [dial, setDial] = useState('+52');
  const [national, setNational] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const digits = national.replace(/\D/g, '');
  const valid =
    name.trim().length >= 2 && digits.length >= 6 && /^\d{4}-\d{2}-\d{2}$/.test(birthDate);

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await registerMember({ name: name.trim(), phone: `${dial}${digits}`, birthDate });
      setResult(res);
      // A verification challenge creates no member yet. Refreshing the list
      // would imply one exists, and the next click would chase a row that is not
      // there.
      if (!res?.verificationRequired) onRegistered();
    } catch (err) {
      setError(err?.message || t`No se pudo registrar al miembro.`);
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Registrar miembro`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <Trans>Registrar miembro</Trans>
            </h3>
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>Inscribe a un cliente en el programa de lealtad.</Trans>
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        {result ? (
          <div className="cash-register-result" style={{ marginTop: 16 }}>
            {result.verificationRequired ? (
              <div className="cash-note" role="status">
                <I.Lock size={14} aria-hidden="true" />
                <span>
                  {result.message ||
                    t`Enviamos un paso de verificación al cliente. El miembro se crea cuando lo completa.`}
                </span>
              </div>
            ) : (
              <p>
                {result.message || t`Miembro registrado.`}{' '}
                {result.cardNumber ? (
                  <Trans>
                    Tarjeta: <strong className="cash-mono">{result.cardNumber}</strong>.
                  </Trans>
                ) : null}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" type="button" onClick={onClose}>
                <Trans>Listo</Trans>
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>
                <Trans>Nombre</Trans>
              </span>
              <input
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Select value={dial} onChange={(e) => setDial(e.target.value)} disabled={pending}>
                {DIAL_CODES.map((d) => (
                  <option key={d.dial} value={d.dial}>
                    {d.label}
                  </option>
                ))}
              </Select>
              <input
                style={{ flex: 1 }}
                type="tel"
                placeholder={t`Número, sin código de país`}
                value={national}
                onChange={(e) => setNational(e.target.value)}
                disabled={pending}
              />
            </div>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>
                <Trans>Fecha de nacimiento</Trans>
              </span>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                disabled={pending}
              />
            </label>
            {error && (
              <p className="danger-state" style={{ marginTop: 12 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={onClose}
                disabled={pending}
              >
                <Trans>Cancelar</Trans>
              </button>
              <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
                {pending ? <Trans>Registrando…</Trans> : <Trans>Registrar</Trans>}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// Screen 7 — Miembros / Loyalty Members
// Data: umi-cash GET /api/[merchantRef]/admin/customers (role: CUSTOMER)
// Schema: User + LoyaltyCard (balanceCentavos, totalVisits, visitsThisCycle, pendingRewards)

const MembersScreen = () => {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities;
  const canRegister = canCashAction('register', capabilities);
  const canSeeContact = canCashAction('contact', capabilities);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('recent');
  const [detail, setDetail] = useState(null); // member id for slide-out
  const [showRegister, setShowRegister] = useState(false);
  const [refresh, setRefresh] = useState(0);

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: result,
    loading,
    error,
    errorStatus,
  } = useMembersData({
    page,
    search: debouncedSearch,
    sort,
    refresh,
  });
  const customers = (result && result.customers) || [];
  const total = (result && result.total) || 0;
  const totalPages = (result && result.totalPages) || 1;

  const detailMember = detail ? customers.find((c) => c.id === detail) : null;

  // A 403 here is the server refusing a read the client thought was allowed.
  // It is a permission refusal, not an empty café: do not draw the empty table.
  if (errorStatus === 403) {
    return <PermissionUnavailable title={t`Lealtad`} permissions={['loyalty.read']} />;
  }

  function fmtBalance(centavos) {
    if (!centavos && centavos !== 0) return '—';
    return formatMoney(centavos, 'MXN', { minimumFractionDigits: 0 });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtAgo(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 3600000) return t`hace ${Math.floor(ms / 60000)} min`;
    if (ms < 86400000) return t`hace ${Math.floor(ms / 3600000)} h`;
    return t`hace ${Math.floor(ms / 86400000)} d`;
  }

  return (
    <div className="cash-screen">
      <RegionHead
        title={t`Miembros activos`}
        note={t`Clientes inscritos en el programa de lealtad.`}
        count={{ value: formatNumber(total), label: t`miembros` }}
        actions={
          canRegister ? (
            <button className="btn" type="button" onClick={() => setShowRegister(true)}>
              <I.Plus size={14} /> <Trans>Registrar miembro</Trans>
            </button>
          ) : (
            <span
              className="cash-readonly"
              title={t`Tu rol no incluye registrar miembros`}
              data-read-only="members"
            >
              <I.Eye size={13} aria-hidden="true" />
              <Trans>Solo consulta</Trans>
            </span>
          )
        }
      />

      {showRegister && (
        <RegisterMemberDialog
          onClose={() => setShowRegister(false)}
          onRegistered={() => setRefresh((n) => n + 1)}
        />
      )}

      <div className="cash-toolbar">
        <div className="cash-search">
          <I.Search size={15} aria-hidden="true" />
          <input
            className="input"
            placeholder={t`Buscar por nombre, teléfono o tarjeta…`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          aria-label={t`Ordenar clientes`}
          className="select"
          style={{ height: 'var(--control-min)', fontSize: 13, padding: '0 32px 0 12px' }}
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {i18n._(o.label)}
            </option>
          ))}
        </Select>
        {loading ? (
          <span className="cash-loading" role="status">
            <span className="pulse" aria-hidden="true" />
            <Trans>Cargando…</Trans>
          </span>
        ) : null}
        <span className="cash-toolbar-count">
          <Trans>
            {customers.length} de {formatNumber(total)} miembros
          </Trans>
        </span>
      </div>

      {error ? (
        <div className="alert danger" role="alert">
          <span className="strip" />
          <div className="body">
            <div className="ttl">
              <Trans>No se pudieron cargar los miembros</Trans>
            </div>
            <div className="sub">{error}</div>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => setRefresh((n) => n + 1)}
            >
              <Trans>Reintentar</Trans>
            </button>
          </div>
        </div>
      ) : null}

      <section className="cash-panel" aria-label={t`Miembros`}>
        <table className="cash-table cash-table--members">
          <thead>
            <tr>
              <th style={{ width: '24%' }}>
                <Trans>Miembro</Trans>
              </th>
              <th>
                <Trans>Tarjeta</Trans>
              </th>
              <th style={{ textAlign: 'right' }}>
                <Trans>Saldo</Trans>
              </th>
              <th style={{ textAlign: 'center' }}>
                <Trans>Visitas</Trans>
              </th>
              <th>
                <Trans>Progreso</Trans>
              </th>
              <th style={{ textAlign: 'center' }}>
                <Trans>Pendientes</Trans>
              </th>
              <th>
                <Trans>Última visita</Trans>
              </th>
              <th style={{ textAlign: 'right' }}>
                <Trans>Gasto total</Trans>
              </th>
              <th style={{ width: 44 }}></th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="cash-empty-cell">
                  <Trans>Sin miembros en este filtro.</Trans>
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <MemberRow
                key={c.id}
                customer={c}
                fmtBalance={fmtBalance}
                fmtAgo={fmtAgo}
                canSeeContact={canSeeContact}
                onDetail={() => setDetail(detail === c.id ? null : c.id)}
                isSelected={detail === c.id}
              />
            ))}
          </tbody>
        </table>
      </section>

      {totalPages > 1 && (
        <div className="cash-pagination">
          <button
            className="btn btn-ghost btn-sm focusable"
            disabled={page <= 1}
            style={{ opacity: page <= 1 ? 0.4 : 1 }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <I.ChevronLeft size={14} /> <Trans>Anterior</Trans>
          </button>
          <span className="cash-pagination-count">
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm focusable"
            disabled={page >= totalPages}
            style={{ opacity: page >= totalPages ? 0.4 : 1 }}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <Trans>Siguiente</Trans> <I.ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Member detail slide-out */}
      {detailMember && (
        <MemberDetail
          member={detailMember}
          fmtBalance={fmtBalance}
          fmtDate={fmtDate}
          canSeeContact={canSeeContact}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

const StampMeter = ({ current = 0, target }) => {
  const { t } = useLingui();
  const total = Number(target) || 0;
  const done = Math.max(0, Math.min(total, Number(current) || 0));
  if (!total) return <span className="cash-muted">{t`Sin meta`}</span>;
  const segmented = total <= 12;
  return (
    <div className="cash-stamp" aria-label={t`${done} de ${total} visitas para la recompensa`}>
      {segmented ? (
        <span className="cash-stamp-segs" aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={'cash-stamp-seg' + (index < done ? ' is-on' : '')} />
          ))}
        </span>
      ) : (
        <span className="cash-stamp-bar" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (done / total) * 100)}%` }} />
        </span>
      )}
      <span className="cash-stamp-label">
        {done}/{total}
      </span>
    </div>
  );
};

const MemberRow = ({ customer: c, fmtBalance, fmtAgo, canSeeContact, onDetail, isSelected }) => {
  const { t } = useLingui();
  const hue = Math.abs(c.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % 360;
  const initials = (c.name || 'UN')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const visitsRequired = c.visitsRequired || null;
  // The server is the authority. It returns `contactRestricted: true` and null
  // contact fields when the membership lacks `customer.contact.read`. Trust that
  // flag even if a cached capability list still says the key is present.
  const contactRestricted = !canSeeContact || c.contactRestricted === true;

  return (
    <tr className={'cash-row' + (isSelected ? ' is-selected' : '')}>
      <td>
        <div className="cash-member">
          <div className="cash-avatar" style={{ '--cash-avatar-hue': hue }} aria-hidden="true">
            {initials}
          </div>
          <div className="cash-member-id">
            <span className="cash-member-name">{c.name || t`Sin nombre`}</span>
            {contactRestricted ? (
              <span className="cash-masked" data-masked-contact="">
                <I.Lock size={11} aria-hidden="true" />
                <Trans>Contacto restringido</Trans>
              </span>
            ) : (
              <span className="cash-member-phone">{c.phone || '—'}</span>
            )}
          </div>
        </div>
      </td>
      <td data-label={t`Tarjeta`}>
        <span className="cash-card-number">{c.cardNumber || '—'}</span>
      </td>
      <td data-label={t`Saldo`} className="cash-num">
        <span className="cash-money">{fmtBalance(c.balanceCentavos)}</span>
        <span className="cash-unit">MXN</span>
      </td>
      <td data-label={t`Visitas`} className="cash-center">
        <span className="cash-visits">{c.totalVisits || 0}</span>
        <span className="cash-unit">
          <Trans>visitas</Trans>
        </span>
      </td>
      <td data-label={t`Progreso`}>
        <StampMeter current={c.visitsThisCycle} target={visitsRequired} />
      </td>
      <td data-label={t`Pendientes`} className="cash-center">
        {c.pendingRewards > 0 ? (
          <span className="cash-badge cash-badge--attention">
            {c.pendingRewards} <Trans>por canjear</Trans>
          </span>
        ) : (
          <span className="no-value" style={{ fontSize: 12 }}>
            <span aria-hidden="true">—</span>
            <span className="sr-only">{t`Sin dato`}</span>
          </span>
        )}
      </td>
      <td data-label={t`Última visita`} className="cash-muted">
        {c.lastVisit ? fmtAgo(c.lastVisit) : t`Nunca`}
      </td>
      <td data-label={t`Gasto total`} className="cash-num cash-strong">
        {c.ltvMXN || '—'}
      </td>
      <td className="cash-cell-action">
        <button
          className={'btn-icon focusable' + (isSelected ? ' active' : '')}
          onClick={onDetail}
          aria-label={t`Ver detalle`}
        >
          <I.ChevronRight size={15} />
        </button>
      </td>
    </tr>
  );
};

const MemberDetail = ({ member: c, fmtBalance, fmtDate, canSeeContact, onClose }) => {
  const { t } = useLingui();
  const navigate = useNavigate();
  const merchant = useMerchant();
  const [copied, setCopied] = useState(false);
  const canOpenGiftCards = canShowCashTab('gift-cards', merchant?.capabilities);
  const hue = Math.abs(c.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % 360;
  const initials = (c.name || 'UN')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const activity = Array.isArray(c.activity)
    ? c.activity
    : Array.isArray(c.history)
      ? c.history
      : [];
  const contactRestricted = !canSeeContact || c.contactRestricted === true;

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copyCard() {
    if (!c.cardNumber) return;
    try {
      await navigator.clipboard.writeText(c.cardNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard permission is a browser decision; the number stays visible.
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside
        className="sheet cash-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-detail-title"
      >
        <div className="sheet-head cash-sheet-head">
          <div className="cash-sheet-person">
            <div
              className="cash-avatar cash-avatar--lg"
              style={{ '--cash-avatar-hue': hue }}
              aria-hidden="true"
            >
              {initials}
            </div>
            <div>
              <div className="eyebrow">
                <Trans>Miembro · Umi Cash</Trans>
              </div>
              <h2 id="member-detail-title" className="cash-sheet-name">
                {c.name || t`Sin nombre`}
              </h2>
              <div className="cash-mono cash-muted">{c.cardNumber || '—'}</div>
            </div>
          </div>
          <button
            className="btn-icon focusable"
            type="button"
            onClick={onClose}
            aria-label={t`Cerrar`}
          >
            <I.X size={16} />
          </button>
        </div>

        <div className="sheet-body cash-sheet-body">
          <section className="cash-drawer-hero" aria-label={t`Resumen del miembro`}>
            <div className="cash-hero-cell">
              <div className="cash-kicker">
                <Trans>Saldo del monedero</Trans>
              </div>
              <div className="cash-drawer-balance">
                {fmtBalance(c.balanceCentavos)}
                <span>MXN</span>
              </div>
            </div>
            <div className="cash-hero-cell">
              <div className="cash-kicker">
                <Trans>Progreso de sellos</Trans>
              </div>
              <StampMeter current={c.visitsThisCycle} target={c.visitsRequired} />
              <div className="cash-muted cash-hero-note">
                <Trans>Recompensas pendientes</Trans>: <strong>{c.pendingRewards || 0}</strong>
              </div>
            </div>
          </section>

          <section className="cash-drawer-section">
            <h3 className="cash-section-title">
              <Trans>Identidad y contacto</Trans>
            </h3>
            <div className="cash-rows">
              <div className="cash-row-line">
                <span>
                  <Trans>Tarjeta</Trans>
                </span>
                <span className="cash-mono">{c.cardNumber || '—'}</span>
              </div>
              <div className="cash-row-line">
                <span>
                  <Trans>Teléfono</Trans>
                </span>
                {contactRestricted ? (
                  <span className="cash-masked" data-masked-contact="">
                    <I.Lock size={11} aria-hidden="true" />
                    <Trans>Contacto restringido</Trans>
                  </span>
                ) : (
                  <span className="cash-mono">{c.phone || '—'}</span>
                )}
              </div>
              {c.email ? (
                <div className="cash-row-line">
                  <span>
                    <Trans>Correo</Trans>
                  </span>
                  <span className="cash-mono">{contactRestricted ? '••••••••' : c.email}</span>
                </div>
              ) : null}
              <div className="cash-row-line">
                <span>
                  <Trans>Miembro desde</Trans>
                </span>
                <span>{fmtDate(c.createdAt)}</span>
              </div>
              <div className="cash-row-line">
                <span>
                  <Trans>Última visita</Trans>
                </span>
                <span>{c.lastVisit ? fmtDate(c.lastVisit) : t`Nunca`}</span>
              </div>
            </div>
            {contactRestricted ? (
              <p className="cash-note">
                <I.Lock size={13} aria-hidden="true" />
                <Trans>
                  Tu rol puede operar la lealtad, pero no ver los datos de contacto del cliente.
                </Trans>
              </p>
            ) : null}
          </section>

          <section className="cash-drawer-section">
            <h3 className="cash-section-title">
              <Trans>Acciones rápidas</Trans>
            </h3>
            <div className="cash-quick-actions">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={copyCard}
                disabled={!c.cardNumber}
              >
                {copied ? <I.Check size={14} /> : <I.CreditCard size={14} />}
                {copied ? <Trans>Copiado</Trans> : <Trans>Copiar tarjeta</Trans>}
              </button>
              {canOpenGiftCards ? (
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    onClose();
                    navigate('/loyalty-value/gift-cards');
                  }}
                >
                  <I.Gift size={14} />
                  <Trans>Tarjetas de regalo</Trans>
                </button>
              ) : null}
            </div>
          </section>

          <section className="cash-drawer-section">
            <h3 className="cash-section-title">
              <Trans>Actividad</Trans>
            </h3>
            {activity.length ? (
              <div className="cash-activity">
                {activity.map((item, index) => (
                  <div className="cash-activity-row" key={item.id || index}>
                    <span className="cash-activity-label">
                      {item.label || item.type || t`Movimiento`}
                    </span>
                    <span className="cash-activity-meta">
                      {item.date ? fmtDate(item.date) : ''}
                    </span>
                    <span className="cash-activity-value">
                      {item.amountMXN || item.value || ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="cash-empty">
                <Trans>Sin visitas, canjes o recargas recientes en este panel.</Trans>
              </p>
            )}
          </section>
        </div>

        <div className="sheet-foot">
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            <Trans>Cerrar</Trans>
          </button>
        </div>
      </aside>
    </>
  );
};

export default MembersScreen;
