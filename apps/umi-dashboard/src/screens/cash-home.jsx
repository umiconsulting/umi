import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trans, useLingui } from '@lingui/react/macro';
import { I, UmiFish } from '@/icons.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { canCashAction, canShowCashTab } from '@/lib/cash-tabs.js';
import { loyaltyScan, useCashStatsData, useMembersData, useMerchantData } from '@/data.jsx';
import { formatDate, formatMoney, formatNumber } from '@/lib/format.js';

export default function CashHomeScreen() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities;
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('recent');
  const [selectedId, setSelectedId] = useState(null);
  const [quickStatus, setQuickStatus] = useState(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [mountNow] = useState(() => Date.now());

  const { data: merchantData } = useMerchantData();
  const { data: stats } = useCashStatsData({ refresh });
  const { data: membersResult, loading: membersLoading } = useMembersData({
    page: 1,
    search,
    sort: filterMode === 'balance' ? 'balance' : 'recent',
    refresh,
  });

  const cafeName = merchant?.selectedMerchant?.name || merchantData?.name || t`Tu cafetería`;
  const rewardConfig = merchantData?.rewardConfig;
  const visitsBase = Number(rewardConfig?.visitsRequired) || 10;
  const rewardBase = rewardConfig?.rewardName || t`Bebida de cortesía`;
  const upgrade = rewardConfig?.upgrade;
  const visitsTop = Number(upgrade?.visitsRequired) || visitsBase;
  const rewardTop = upgrade?.rewardName || null;
  const hasSecondTier = Boolean(rewardTop && visitsTop > visitsBase);
  const totalSlots = Math.max(visitsBase, visitsTop);

  const rawCustomers = membersResult?.customers || [];
  const customers =
    filterMode === 'ready'
      ? rawCustomers.filter((c) => Number(c.pendingRewards) > 0)
      : rawCustomers;
  const totalMembers = membersResult?.total || rawCustomers.length || 0;
  const selectedMember = customers.find((c) => c.id === selectedId) || customers[0] || null;

  const canScan = canShowCashTab('scan', capabilities);
  const canRegister = canCashAction('register', capabilities);
  const canOpenRewards = canShowCashTab('rewards', capabilities);
  const canOpenWallet = canShowCashTab('wallet', capabilities);
  const canOpenGiftCards = canShowCashTab('gift-cards', capabilities);

  const todayLabel = formatDate(new Date(), {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });

  function fmtBalance(centavos) {
    if (!centavos && centavos !== 0) return '$0';
    return formatMoney(centavos, 'MXN', { minimumFractionDigits: 0 });
  }

  function fmtAgo(iso) {
    if (!iso) return t`Nunca`;
    const ms = Math.max(0, mountNow - new Date(iso).getTime());
    if (ms < 3600000) return t`hace ${Math.max(1, Math.floor(ms / 60000))} min`;
    if (ms < 86400000) return t`hace ${Math.floor(ms / 3600000)} h`;
    return t`hace ${Math.floor(ms / 86400000)} d`;
  }

  async function handleQuickVisit(member) {
    if (!member?.cardNumber || quickBusy) return;
    setQuickBusy(true);
    setQuickStatus(null);
    try {
      await loyaltyScan({
        cardNumber: member.cardNumber,
        action: 'VISIT',
        idempotencyKey: crypto.randomUUID(),
      });
      setQuickStatus(t`+1 sello registrado para ${member.name || member.cardNumber}`);
      setRefresh((n) => n + 1);
    } catch (err) {
      setQuickStatus(err?.message || t`No se pudo registrar la visita.`);
    } finally {
      setQuickBusy(false);
    }
  }

  const exampleFilled = Math.min(Math.max(1, Math.round(totalSlots * 0.55)), totalSlots);

  return (
    <div className="naive-cash-home" data-cash-home>
      <header className="naive-iso-masthead">
        <div>
          <div className="naive-iso-eyebrow">
            <span className="naive-live-dot" aria-hidden="true" />
            <span>
              {todayLabel} · {cafeName}
            </span>
          </div>
          <h2 className="naive-iso-h1">
            <span>
              <Trans>Panel de</Trans>
            </span>{' '}
            <span className="naive-pill-highlight">
              <Trans>lealtad</Trans>
            </span>
            <UmiFish width={30} />
          </h2>
        </div>
        <div className="naive-context-note">
          <I.Users2 size={14} aria-hidden="true" />
          <span>
            <Trans>{formatNumber(totalMembers)} clientes activos</Trans>
          </span>
        </div>
      </header>

      <svg
        className="naive-wave-rule"
        viewBox="0 0 320 12"
        preserveAspectRatio="none"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 6 C18 2, 34 10, 50 6 C66 2, 82 10, 98 6 C114 2, 130 10, 146 6 C162 2, 178 10, 194 6 C210 2, 226 10, 242 6 C258 2, 274 10, 290 6 C302 3, 312 9, 318 6"
          stroke="var(--naive-accent, #132642)"
          strokeWidth="2"
          strokeOpacity="0.65"
          strokeLinecap="round"
        />
      </svg>

      <div className="naive-cockpit-grid">
        <div className="naive-cockpit-left">
          {canScan ? (
            <button
              type="button"
              className="naive-scan-hero-btn"
              onClick={() => navigate('/loyalty-value/scan')}
            >
              <span className="naive-scan-hero-icon" aria-hidden="true">
                <I.QrScan size={24} />
              </span>
              <div className="naive-scan-hero-copy">
                <div className="naive-scan-hero-kicker">
                  <Trans>Acción principal · Barra</Trans>
                </div>
                <div className="naive-scan-hero-title">
                  <Trans>Escanear cliente</Trans>
                </div>
                <div className="naive-scan-hero-sub">
                  <Trans>Sumar sello, canjear o recargar saldo</Trans>
                </div>
              </div>
              <I.ArrowRight size={20} aria-hidden="true" />
            </button>
          ) : null}

          <div className="naive-kpi-trio">
            <div className="naive-kpi-box">
              <span className="naive-kpi-lbl">
                <Trans>Visitas hoy</Trans>
              </span>
              <span className="naive-kpi-num">{stats?.visitsToday ?? 0}</span>
              <span className="naive-kpi-delta">
                <Trans>En barra hoy</Trans>
              </span>
            </div>
            <div className="naive-kpi-box">
              <span className="naive-kpi-lbl">
                <Trans>Recargado</Trans>
              </span>
              <span className="naive-kpi-num">{stats?.topupsTodayMXN ?? '$0'}</span>
              <span className="naive-kpi-meta">
                <Trans>{stats?.topupsTodayCount ?? 0} abonos</Trans>
              </span>
            </div>
            <div className="naive-kpi-box">
              <span className="naive-kpi-lbl">
                <Trans>Por canjear</Trans>
              </span>
              <span className="naive-kpi-num accent">{stats?.pendingRewards ?? 0}</span>
              <span className="naive-kpi-meta">
                <Trans>Listas hoy</Trans>
              </span>
            </div>
          </div>

          <section className="naive-reward-card" aria-label={t`Recompensa activa`}>
            <div className="naive-reward-head">
              <div>
                <div className="naive-eyebrow-row">
                  <span className="naive-tenant-dot" aria-hidden="true" />
                  <span>
                    <Trans>Recompensa activa</Trans>
                  </span>
                </div>
                <div className="naive-reward-name">{rewardBase}</div>
                <div className="naive-reward-rule">
                  {hasSecondTier ? (
                    <Trans>
                      A las <strong>{visitsBase} visitas</strong> · o sigue a {visitsTop} por{' '}
                      <strong>{rewardTop}</strong>
                    </Trans>
                  ) : (
                    <Trans>
                      Cada <strong>{visitsBase} visitas</strong> acumuladas en su tarjeta
                    </Trans>
                  )}
                </div>
              </div>
              {canOpenRewards ? (
                <button
                  type="button"
                  className="naive-mini-link-btn"
                  onClick={() => navigate('/loyalty-value/rewards')}
                >
                  <Trans>Cambiar</Trans>
                </button>
              ) : null}
            </div>
            <div className="naive-mini-stamps-bar">
              <div className="naive-stamp-dots-row" aria-hidden="true">
                {Array.from({ length: Math.min(totalSlots, 12) }, (_, idx) => {
                  const isBonus = hasSecondTier && idx >= visitsBase;
                  const isFilled = idx < exampleFilled;
                  return (
                    <span
                      key={idx}
                      className={
                        'naive-s-dot' + (isBonus ? ' bonus' : '') + (isFilled ? ' filled' : '')
                      }
                    >
                      {isFilled ? '✓' : ''}
                    </span>
                  );
                })}
              </div>
              <span className="naive-stamp-meta">
                {hasSecondTier ? <Trans>2 niveles</Trans> : <Trans>{visitsBase} sellos</Trans>}
              </span>
            </div>
          </section>

          <div className="naive-quick-tiles">
            {canOpenWallet ? (
              <button
                type="button"
                className="naive-quick-tile"
                onClick={() => navigate('/loyalty-value/wallet')}
              >
                <div className="naive-quick-tile-top">
                  <I.Wallet size={18} />
                  <I.ArrowRight size={14} />
                </div>
                <div className="naive-quick-tile-title">
                  <Trans>Recargar saldo</Trans>
                </div>
                <div className="naive-quick-tile-sub">
                  <Trans>Monedero y abonos</Trans>
                </div>
              </button>
            ) : null}
            {canOpenGiftCards ? (
              <button
                type="button"
                className="naive-quick-tile"
                onClick={() => navigate('/loyalty-value/gift-cards')}
              >
                <div className="naive-quick-tile-top">
                  <I.Gift size={18} />
                  <I.ArrowRight size={14} />
                </div>
                <div className="naive-quick-tile-title">
                  <Trans>Tarjetas regalo</Trans>
                </div>
                <div className="naive-quick-tile-sub">
                  <Trans>Emitir o canjear código</Trans>
                </div>
              </button>
            ) : null}
          </div>
        </div>

        <div className="naive-cockpit-right">
          <section className="naive-card" aria-label={t`Miembros recientes`}>
            <div className="naive-panel-head">
              <div>
                <div className="naive-eyebrow-row">
                  <Trans>Programa de lealtad</Trans>
                </div>
                <h3 className="naive-panel-title">
                  <Trans>Miembros recientes</Trans>
                </h3>
              </div>
              <div className="naive-panel-actions">
                <button
                  type="button"
                  className="naive-btn naive-btn-secondary"
                  onClick={() => navigate('/loyalty-value/members')}
                >
                  <Trans>Ver todos</Trans>
                </button>
                {canRegister ? (
                  <button
                    type="button"
                    className="naive-btn naive-btn-primary"
                    onClick={() => navigate('/loyalty-value/members')}
                  >
                    <I.Plus size={14} />
                    <span>
                      <Trans>Registrar</Trans>
                    </span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="naive-search-row">
              <div className="naive-search-box">
                <I.Search size={14} aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t`Buscar por nombre, teléfono o tarjeta…`}
                  aria-label={t`Buscar miembro`}
                />
              </div>
              <div className="naive-filter-chips">
                <button
                  type="button"
                  className={'naive-chip' + (filterMode === 'recent' ? ' active' : '')}
                  onClick={() => setFilterMode('recent')}
                >
                  <Trans>Recientes</Trans>
                </button>
                <button
                  type="button"
                  className={'naive-chip' + (filterMode === 'ready' ? ' active' : '')}
                  onClick={() => setFilterMode('ready')}
                >
                  <Trans>Por canjear</Trans>
                </button>
                <button
                  type="button"
                  className={'naive-chip' + (filterMode === 'balance' ? ' active' : '')}
                  onClick={() => setFilterMode('balance')}
                >
                  <Trans>Mayor saldo</Trans>
                </button>
              </div>
            </div>

            <div className="naive-table-wrap">
              <table className="naive-members-table">
                <thead>
                  <tr>
                    <th>
                      <Trans>Miembro</Trans>
                    </th>
                    <th>
                      <Trans>Sellos</Trans>
                    </th>
                    <th>
                      <Trans>Saldo</Trans>
                    </th>
                    <th>
                      <Trans>Estado</Trans>
                    </th>
                    <th>
                      <Trans>Última visita</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {customers.length === 0 && !membersLoading ? (
                    <tr>
                      <td colSpan={5} className="naive-empty-row">
                        <Trans>Sin miembros para mostrar en este filtro.</Trans>
                      </td>
                    </tr>
                  ) : null}
                  {customers.slice(0, 6).map((m) => {
                    const isSelected = selectedMember?.id === m.id;
                    const target = Number(m.visitsRequired) || totalSlots;
                    const current = Math.min(Number(m.visitsThisCycle) || 0, target);
                    const initials = (m.name || 'UN')
                      .split(' ')
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase();
                    const hue =
                      Math.abs(
                        String(m.id || '')
                          .split('')
                          .reduce((s, ch) => s + ch.charCodeAt(0), 0),
                      ) % 360;

                    return (
                      <tr
                        key={m.id}
                        className={isSelected ? 'selected' : ''}
                        onClick={() => setSelectedId(m.id)}
                      >
                        <td>
                          <div className="naive-member-cell">
                            <div
                              className="naive-avatar"
                              style={{
                                background: `oklch(0.92 0.04 ${hue})`,
                                color: `oklch(0.3 0.06 ${hue})`,
                              }}
                              aria-hidden="true"
                            >
                              {initials}
                            </div>
                            <div>
                              <div className="naive-m-name">{m.name || t`Sin nombre`}</div>
                              <div className="naive-m-code">{m.cardNumber || '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="naive-stamp-meter">
                            <span className="naive-stamp-pips" aria-hidden="true">
                              {Array.from({ length: Math.min(target, 12) }, (_, idx) => {
                                const on = idx < current;
                                const bonus = hasSecondTier && idx >= visitsBase;
                                return (
                                  <span
                                    key={idx}
                                    className={
                                      'naive-pip' + (bonus ? ' bonus' : '') + (on ? ' on' : '')
                                    }
                                  />
                                );
                              })}
                            </span>
                            <span className="naive-stamp-txt">
                              {current}/{target}
                            </span>
                          </div>
                        </td>
                        <td className="naive-m-money">{fmtBalance(m.balanceCentavos)}</td>
                        <td>
                          {Number(m.pendingRewards) > 0 ? (
                            <span className="naive-status-pill ready">
                              <Trans>{m.pendingRewards} por canjear</Trans>
                            </span>
                          ) : hasSecondTier && current >= visitsBase ? (
                            <span className="naive-status-pill base">
                              <Trans>Base listo</Trans>
                            </span>
                          ) : (
                            <span className="naive-muted-dash">—</span>
                          )}
                        </td>
                        <td className="naive-m-ago">{fmtAgo(m.lastVisit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {quickStatus ? (
              <div className="naive-quick-feedback" role="status">
                {quickStatus}
              </div>
            ) : null}

            {selectedMember ? (
              <div className="naive-member-quick-bar">
                <div className="naive-member-cell">
                  <div className="naive-m-info">
                    <div className="naive-m-name">
                      {selectedMember.name || t`Sin nombre`} ·{' '}
                      <span className="naive-m-code">{selectedMember.cardNumber || '—'}</span>
                    </div>
                    <div className="naive-m-sub">
                      <Trans>
                        {selectedMember.totalVisits || 0} visitas totales · Saldo{' '}
                        {fmtBalance(selectedMember.balanceCentavos)}
                      </Trans>
                    </div>
                  </div>
                </div>
                {canScan ? (
                  <div className="naive-quick-bar-btns">
                    <button
                      type="button"
                      className="naive-btn naive-btn-secondary"
                      onClick={() =>
                        navigate(
                          `/loyalty-value/scan?card=${encodeURIComponent(selectedMember.cardNumber || '')}`,
                        )
                      }
                    >
                      <Trans>Abrir en escáner</Trans>
                    </button>
                    <button
                      type="button"
                      className="naive-btn naive-btn-primary"
                      disabled={quickBusy}
                      onClick={() => handleQuickVisit(selectedMember)}
                    >
                      <Trans>+1 Visita</Trans>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
