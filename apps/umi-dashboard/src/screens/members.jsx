import React, { useState, useEffect } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate, formatMoney, formatNumber } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
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
      onRegistered();
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
          <div style={{ marginTop: 16 }}>
            <p>
              {result.message || t`Miembro registrado.`}{' '}
              <Trans>
                Tarjeta: <strong>{result.cardNumber}</strong>.
              </Trans>
            </p>
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
              <select value={dial} onChange={(e) => setDial(e.target.value)} disabled={pending}>
                {DIAL_CODES.map((d) => (
                  <option key={d.dial} value={d.dial}>
                    {d.label}
                  </option>
                ))}
              </select>
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

  const { data: result, loading } = useMembersData({
    page,
    search: debouncedSearch,
    sort,
    refresh,
  });
  const customers = (result && result.customers) || [];
  const total = (result && result.total) || 0;
  const totalPages = (result && result.totalPages) || 1;

  const detailMember = detail ? customers.find((c) => c.id === detail) : null;

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title={t`Miembros activos`}
        note={t`Clientes inscritos en el programa de lealtad.`}
        count={{ value: formatNumber(total), label: t`miembros` }}
        actions={
          <>
            <select
              aria-label={t`Ordenar clientes`}
              className="select"
              style={{ height: 38, fontSize: 13, padding: '0 32px 0 12px' }}
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
            </select>
            <button className="btn" type="button" onClick={() => setShowRegister(true)}>
              <I.Plus size={14} /> <Trans>Registrar miembro</Trans>
            </button>
          </>
        }
      />

      {showRegister && (
        <RegisterMemberDialog
          onClose={() => setShowRegister(false)}
          onRegistered={() => setRefresh((n) => n + 1)}
        />
      )}

      {/* Search + summary strip */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <I.Search
            size={15}
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--ink-3)',
              pointerEvents: 'none',
            }}
          />
          <input
            className="input"
            style={{ height: 40, paddingLeft: 36, fontSize: 13 }}
            placeholder={t`Buscar por nombre, teléfono o tarjeta…`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        {loading && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--ink-3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              className="pulse"
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--umi-blue)',
              }}
            />
            <Trans>Cargando…</Trans>
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)' }}>
          <Trans>
            {customers.length} de {formatNumber(total)} miembros
          </Trans>
        </span>
      </div>

      {/* Members table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: '22%' }}>
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
              <th style={{ textAlign: 'center' }}>
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
                <td
                  colSpan={9}
                  style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-3)' }}
                >
                  <Trans>Sin miembros en este filtro.</Trans>
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <MemberRow
                key={c.id}
                customer={c}
                fmtBalance={fmtBalance}
                fmtDate={fmtDate}
                fmtAgo={fmtAgo}
                onDetail={() => setDetail(detail === c.id ? null : c.id)}
                isSelected={detail === c.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10 }}>
          <button
            className="btn btn-ghost btn-sm focusable"
            disabled={page <= 1}
            style={{ opacity: page <= 1 ? 0.4 : 1 }}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <I.ChevronLeft size={14} /> <Trans>Anterior</Trans>
          </button>
          <span style={{ fontSize: 13, color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>
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
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
};

const MemberRow = ({ customer: c, fmtBalance, fmtDate, fmtAgo, onDetail, isSelected }) => {
  const { t } = useLingui();
  const hue = Math.abs(c.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % 360;
  const initials = (c.name || 'UN')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const visitsRequired = c.visitsRequired || null;
  const progress = visitsRequired ? Math.min(1, (c.visitsThisCycle || 0) / visitsRequired) : 0;

  return (
    <tr style={{ background: isSelected ? 'var(--canvas)' : undefined }}>
      {/* Name */}
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            className="avatar-lg"
            style={{
              background: `oklch(0.78 0.08 ${hue})`,
              color: `oklch(0.28 0.08 ${hue})`,
            }}
          >
            {initials}
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.name || t`Sin nombre`}</div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
              {c.phone || '—'}
            </div>
          </div>
        </div>
      </td>
      {/* Card */}
      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-2)' }}>
        {c.cardNumber || '—'}
      </td>
      {/* Balance */}
      <td
        style={{
          textAlign: 'right',
          fontWeight: 600,
          fontSize: 14,
          fontFamily: 'var(--font-display)',
          letterSpacing: '-0.01em',
        }}
      >
        {fmtBalance(c.balanceCentavos)}
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 400 }}>MXN</div>
      </td>
      {/* Visits */}
      <td style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{c.totalVisits || 0}</div>
        <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>
          <Trans>total</Trans>
        </div>
      </td>
      {/* Cycle progress bar */}
      <td style={{ textAlign: 'center', minWidth: 80 }}>
        <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4, color: 'var(--ink-2)' }}>
          {visitsRequired
            ? `${c.visitsThisCycle || 0} / ${visitsRequired}`
            : t`${c.visitsThisCycle || 0} ciclo`}
        </div>
        <div
          style={{ height: 5, borderRadius: 3, background: 'var(--line-soft)', overflow: 'hidden' }}
        >
          <div
            style={{
              height: '100%',
              width: progress * 100 + '%',
              background: visitsRequired && progress >= 1 ? 'var(--success)' : 'var(--umi-blue)',
              borderRadius: 3,
              transition: 'width 0.3s',
            }}
          />
        </div>
      </td>
      {/* Pending rewards */}
      <td style={{ textAlign: 'center' }}>
        {c.pendingRewards > 0 ? (
          <span
            className="chip"
            style={{
              background: 'var(--success-soft)',
              color: 'var(--success)',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {c.pendingRewards} 🎁
          </span>
        ) : (
          <span className="no-value" style={{ fontSize: 12 }} aria-label={t`Sin dato`} />
        )}
      </td>
      {/* Last visit */}
      <td style={{ color: 'var(--ink-2)', fontSize: 13 }}>
        {c.lastVisit ? fmtAgo(c.lastVisit) : t`Nunca`}
      </td>
      {/* LTV */}
      <td style={{ textAlign: 'right', fontWeight: 600, fontSize: 13, color: 'var(--ink-2)' }}>
        {c.ltvMXN || '—'}
      </td>
      {/* Actions */}
      <td>
        <button
          className={'btn-icon focusable' + (isSelected ? ' active' : '')}
          onClick={onDetail}
          aria-label={t`Ver detalle`}
          style={{ opacity: isSelected ? 1 : undefined }}
        >
          <I.ChevronRight size={15} />
        </button>
      </td>
    </tr>
  );
};

const MemberDetail = ({ member: c, fmtBalance, fmtDate, onClose }) => {
  const { t } = useLingui();
  const hue = Math.abs(c.id.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % 360;
  const initials = (c.name || 'UN')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet">
        <div className="sheet-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              className="avatar-lg"
              style={{
                width: 48,
                height: 48,
                fontSize: 17,
                background: `oklch(0.78 0.08 ${hue})`,
                color: `oklch(0.28 0.08 ${hue})`,
              }}
            >
              {initials}
            </div>
            <div>
              <div className="eyebrow">
                <Trans>Miembro · Umi Cash</Trans>
              </div>
              <h2 className="h-section" style={{ marginTop: 2, fontSize: 17 }}>
                {c.name || t`Sin nombre`}
              </h2>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>

        <div className="sheet-body">
          {/* Key stats */}
          <div className="split even tight">
            <StatCard
              label={t`Saldo · monedero`}
              value={fmtBalance(c.balanceCentavos)}
              unit="MXN"
              accent="var(--umi-blue)"
            />
            <StatCard
              label={t`Visitas totales`}
              value={c.totalVisits || 0}
              accent="var(--success)"
            />
            <StatCard label={t`LTV estimado`} value={c.ltvMXN || '—'} accent="var(--ink-2)" />
            <StatCard
              label={t`Recompensas pendientes`}
              value={c.pendingRewards || 0}
              accent={c.pendingRewards > 0 ? 'var(--warning)' : 'var(--ink-3)'}
            />
          </div>

          {/* Info rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 4 }}>
            {[
              { label: t`Teléfono`, value: c.phone || '—', mono: true },
              { label: t`Número de tarjeta`, value: c.cardNumber || '—', mono: true },
              { label: t`Última visita`, value: c.lastVisit ? fmtDate(c.lastVisit) : t`Nunca` },
              { label: t`Miembro desde`, value: fmtDate(c.createdAt) },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)', letterSpacing: '0.04em' }}>
                  {row.label}
                </span>
                <span
                  style={{
                    fontSize: row.mono ? 12 : 13.5,
                    fontWeight: row.mono ? 400 : 600,
                    fontFamily: row.mono ? 'var(--font-mono)' : undefined,
                    color: 'var(--ink-1)',
                  }}
                >
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {/* Cycle progress */}
          <div style={{ marginTop: 8 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              <Trans>Progreso en ciclo actual</Trans>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: 6,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <span>
                <Plural
                  value={c.visitsThisCycle || 0}
                  one="# visita completada"
                  other="# visitas completadas"
                />
              </span>
              <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
                {c.visitsRequired ? t`meta: ${c.visitsRequired}` : t`meta sin configurar`}
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: 'var(--line-soft)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: c.visitsRequired
                    ? Math.min(100, ((c.visitsThisCycle || 0) / c.visitsRequired) * 100) + '%'
                    : '0%',
                  background: 'var(--umi-blue)',
                  borderRadius: 4,
                  transition: 'width 0.4s',
                }}
              />
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>
            <Trans>Cerrar</Trans>
          </button>
        </div>
      </aside>
    </>
  );
};

const StatCard = ({ label, value, unit, accent }) => (
  <div className="card" style={{ padding: '14px 16px' }}>
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 22,
        color: accent || 'var(--ink-1)',
        letterSpacing: '-0.02em',
      }}
    >
      {value}
    </div>
    {unit && <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>{unit}</div>}
  </div>
);

export default MembersScreen;
