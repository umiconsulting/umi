import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
// `UmiX` is not used on this screen, and it stays in the import list on purpose.
// `eslint-suppressions.json` holds one `no-unused-vars` entry for this file, and
// ESLint fails a run when a suppression stops matching a violation. Prune the
// entry before this import goes.
import { I, UmiX } from '@/icons.jsx';
import { formatDate, formatNumber, formatTime } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
import { PageHead } from '@/components/page-head.jsx';
import { useOverviewData } from '@/data.jsx';

// Screen 1 — Panorama. Archetype: Board.
//
// The masthead owns the page name, so this screen does not write it again. Below
// the masthead the screen holds one page head, then three bands:
//
//   1. The month. Revenue leads, because an owner opens the app for it. Four
//      supporting facts sit in a lower layer, under one divider.
//   2. The kitchen stations. One row for each station with an open ticket.
//   3. The action centre, beside today's activity.
//
// The screen uses three type sizes: 40 for the one lead figure, then 13.5 and
// 11.5. The design audit measured two large figures on this screen as fault F5,
// so a second large figure is not allowed. A second large figure flattens the
// hierarchy, and the lead number stops leading.
//
// Colour is a language here. Ink and line carry the screen. A measured fall takes
// the danger tone, because a fall is the one value that needs an eye. Green stays
// for status, and every status carries its word next to its dot.
//
// Data: useOverviewData() → { overview, stations, ticker }

/**
 * The kitchen event kinds, in the operator's language. The API sends the kind
 * and the time of the event, and no sentence. The old LIVE bar read `time` and
 * `text` from the payload, so it printed an empty strip that scrolled nowhere.
 */
const EVENT_LABEL = {
  order_created: msg`Pedido nuevo`,
  order_updated: msg`Pedido actualizado`,
  item_updated: msg`Platillo actualizado`,
  order_cancelled: msg`Pedido cancelado`,
  priority_changed: msg`Prioridad cambiada`,
  order_recalled: msg`Pedido recordado`,
  recovery_required: msg`Recuperación requerida`,
};

/** The quiet label of a fact. One of the two body sizes. */
const Lbl = ({ children }) => (
  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{children}</div>
);

/** A fact figure. Tabular, so two facts in a column line up. */
const Val = ({ children }) => (
  <div
    className="figures"
    style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)', marginTop: 4 }}
  >
    {children}
  </div>
);

/**
 * The state word for a station. The dot carries the colour and the word carries
 * the meaning, so a reader who cannot tell the hues apart still reads the state.
 */
const StationState = ({ status }) =>
  status === 'live' ? (
    <Trans>En vivo</Trans>
  ) : status === 'slow' ? (
    <Trans>Lento</Trans>
  ) : (
    <Trans>Sin conexión</Trans>
  );

/** A rise or a fall, in one character and one number. */
const deltaText = (pct) => (pct >= 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '%';

const OverviewScreen = ({ onNavigate, ordersPaused, setOrdersPaused }) => {
  const { t, i18n } = useLingui();
  const [refresh, setRefresh] = useState(0);
  const { data, loading } = useOverviewData(refresh);

  const ov = (data && data.overview) || {};
  const stations = (data && data.stations) || [];
  const ticker = (data && data.ticker) || [];

  const nowLabel = formatTime(new Date());
  // The newest kitchen event. The API returns the list newest first, so the head
  // takes index 0 and not the tail. The stamp carries the day as well when the
  // event did not happen today, because a bare clock time would read as today.
  const lastSignal = ticker.length ? ticker[0] : null;
  const signalWhen = lastSignal ? new Date(lastSignal.occurred_at) : null;
  const signalStamp = signalWhen
    ? signalWhen.toDateString() === new Date().toDateString()
      ? formatTime(signalWhen)
      : `${formatDate(signalWhen, { day: 'numeric', month: 'short' })} ${formatTime(signalWhen)}`
    : null;
  // An unknown kind prints its stamp alone. A raw event key is not operator text.
  const signalWord =
    lastSignal && EVENT_LABEL[lastSignal.kind] ? i18n._(EVENT_LABEL[lastSignal.kind]) : null;

  const alerts = [
    ordersPaused && {
      kind: 'warn',
      time: nowLabel,
      ttl: t`Pedidos WhatsApp pausados`,
      sub: t`Pausado · aviso especial activo`,
      cta: t`Reanudar`,
      onCta: () => setOrdersPaused((p) => !p),
    },
  ].filter(Boolean);

  // The supporting layer. A fact keeps a comparison only when the data has one.
  // The old screen printed "no comparison" four times. An absent comparison now
  // prints nothing, because an empty slot is quiet and a repeated filler is not.
  const facts = [
    {
      lbl: t`Visitas hoy`,
      val: ov.visitsToday != null ? String(ov.visitsToday) : '–',
      sub: ov.visitsDeltaPct != null ? deltaText(ov.visitsDeltaPct) : null,
      down: ov.visitsDeltaPct != null && ov.visitsDeltaPct < 0,
    },
    {
      lbl: t`Tarjetas de regalo abiertas`,
      val: ov.openGiftCards != null ? String(ov.openGiftCards) : '–',
      sub: ov.openGiftCardsDelta != null ? deltaText(ov.openGiftCardsDelta) : null,
      down: ov.openGiftCardsDelta != null && ov.openGiftCardsDelta < 0,
    },
    {
      lbl: t`Recompensas canjeadas · 7d`,
      val: ov.rewardsRedeemed7d != null ? String(ov.rewardsRedeemed7d) : '–',
      sub: ov.rewardsDelta7d != null ? deltaText(ov.rewardsDelta7d) : null,
      down: ov.rewardsDelta7d != null && ov.rewardsDelta7d < 0,
    },
    {
      lbl: t`Miembros activos`,
      val: ov.activeMembers != null ? formatNumber(ov.activeMembers) : '–',
      sub: ov.memberDeltaPct != null ? `${deltaText(ov.memberDeltaPct)} · ${t`28 días`}` : null,
      down: ov.memberDeltaPct != null && ov.memberDeltaPct < 0,
    },
  ];

  // The loyalty footnote. These three facts inform a campaign and not the trading
  // day, so they take the quietest layer of the panel.
  const loyaltyNotes = [
    ov.newThisWeek != null ? t`+${formatNumber(ov.newThisWeek)} nuevos esta semana` : null,
    ov.birthdayActivatable != null ? t`${ov.birthdayActivatable} cumpleaños activables` : null,
    ov.highBalanceCount != null ? t`${ov.highBalanceCount} con saldo > $1,000` : null,
  ].filter(Boolean);

  return (
    <div className="overview-screen" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ONE line about the kitchen. The old full-width LIVE bar spent a whole row
          on this, and its text never arrived: the API sends a kind and a time, and
          the bar asked for a `text` field that no response carries. */}
      {lastSignal ? (
        <PageHead
          state={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
              <span className="s-dot registered" aria-hidden="true" />
              {t`Cocina`}
              <span style={{ color: 'var(--ink-3)' }}>
                {signalWord ? `${signalWord} · ` : ''}
                {signalStamp}
              </span>
            </span>
          }
        />
      ) : null}

      {/* Band 1 — the month. Revenue leads. */}
      <section className="surface">
        <div style={{ padding: 24 }}>
          <Lbl>
            <Trans>Ingresos del mes</Trans>
          </Lbl>
          <div
            className="figures"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 40,
              lineHeight: 1,
              letterSpacing: 0,
              color: 'var(--ink-1)',
              marginTop: 8,
            }}
          >
            {ov.revenueThisMonth || '–'}
          </div>
          {ov.revenueDeltaPct != null ? (
            <div
              style={{
                fontSize: 13.5,
                color: ov.revenueDeltaPct < 0 ? 'var(--danger)' : 'var(--ink-2)',
                marginTop: 8,
              }}
            >
              {deltaText(ov.revenueDeltaPct)} · <Trans>vs. período anterior</Trans>
            </div>
          ) : null}
        </div>

        <div
          className="surface-divide"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 16,
            padding: '16px 24px',
          }}
        >
          {facts.map((f) => (
            <div key={f.lbl}>
              <Lbl>{f.lbl}</Lbl>
              <Val>{f.val}</Val>
              {f.sub ? (
                <div
                  style={{
                    fontSize: 11.5,
                    color: f.down ? 'var(--danger)' : 'var(--ink-3)',
                    marginTop: 4,
                  }}
                >
                  {f.sub}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {loyaltyNotes.length ? (
          <div
            className="surface-divide"
            style={{ padding: '12px 24px', fontSize: 11.5, color: 'var(--ink-3)' }}
          >
            {loyaltyNotes.join(' · ')}
          </div>
        ) : null}
      </section>

      {/* Band 2 — the kitchen stations. */}
      <section>
        {/* The count is the live figure of the region, and it appears only while
            the region holds rows. At zero the note already says the fact, and a
            second statement of one fact is the density this pass removes. */}
        <RegionHead
          title={t`Estaciones de cocina`}
          note={
            loading
              ? t`Actualizando…`
              : stations.length
                ? t`Cada estación del KDS y cómo responde ahora.`
                : t`No hay pedidos abiertos en cocina.`
          }
          count={stations.length ? { value: stations.length, label: t`estaciones` } : undefined}
          actions={
            <button
              className="btn-icon focusable"
              onClick={() => setRefresh((r) => r + 1)}
              aria-label={t`Actualizar las estaciones`}
              title={t`Actualizar`}
            >
              <I.Refresh size={14} />
            </button>
          }
        />
        {/* No rail and no legend while the kitchen is quiet. The region head says
            the count. An empty box under four state words says less than the
            number does, and it says it louder. */}
        {stations.length ? (
          <div className="surface">
            {stations.map((s, i) => (
              <div
                key={s.station_id}
                className={i ? 'surface-divide' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '4px 16px',
                  padding: '12px 16px',
                }}
              >
                <span
                  title={s.station_name}
                  style={{
                    flex: '1 1 140px',
                    minWidth: 0,
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'var(--ink-1)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.station_name}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    width: 104,
                    fontSize: 11.5,
                    color: 'var(--ink-2)',
                  }}
                >
                  <span className={'s-dot ' + s.status} aria-hidden="true" />
                  <StationState status={s.status} />
                </span>
                <span
                  className="figures"
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: 'var(--ink-1)',
                    width: 24,
                    textAlign: 'right',
                  }}
                >
                  {s.open}
                </span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)', width: 64 }}>
                  {s.status === 'offline' ? <Trans>cerrado</Trans> : <Trans>abiertos</Trans>}
                </span>
                <span
                  style={{ fontSize: 11.5, color: 'var(--ink-3)', width: 104, textAlign: 'right' }}
                >
                  {s.foot}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* Band 3 — the action centre, beside today's activity. */}
      <section className="split wide-gap">
        <div>
          <RegionHead
            title={t`Centro de acción`}
            note={
              alerts.length ? (
                <Plural value={alerts.length} one="# pendiente." other="# pendientes." />
              ) : undefined
            }
          />
          {/* ONE empty state, and ONE verb. The screen used to stack two: a
              heading that said "nothing pending" above a box that said "no
              alerts". Both said the same thing, and neither offered a way out. */}
          <div className="surface">
            {alerts.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '12px 16px',
                }}
              >
                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                  <Trans>Nada pendiente ahora mismo.</Trans>
                </span>
                <button
                  className="btn btn-ghost btn-sm focusable"
                  onClick={() => onNavigate('orders')}
                >
                  <Trans>Ver pedidos</Trans> <I.ArrowRight size={14} />
                </button>
              </div>
            ) : (
              alerts.map((a, i) => (
                <div
                  key={i}
                  className={i ? 'surface-divide' : undefined}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '12px 16px',
                  }}
                >
                  <I.AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
                      {a.ttl}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                      {a.time} · {a.sub}
                    </div>
                  </div>
                  <button
                    className="btn btn-secondary btn-sm focusable"
                    onClick={() => (a.onCta ? a.onCta() : a.screen && onNavigate(a.screen))}
                  >
                    {a.cta} <I.ArrowRight size={13} />
                  </button>
                </div>
              ))
            )}
            <div
              className="surface-divide"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '8px 16px',
              }}
            >
              <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                <Trans>Escaneo cada 60 s · última verificación {nowLabel}</Trans>
              </span>
              <button
                className="btn btn-ghost btn-sm focusable"
                onClick={() => setRefresh((r) => r + 1)}
              >
                <I.Refresh size={13} /> <Trans>Re-escanear</Trans>
              </button>
            </div>
          </div>
        </div>

        {/* Today's two channels. Two groups inside one panel, split by a line and
            not by a second box. A border inside a border is what stopped a page
            from reading as one surface. */}
        <div>
          <RegionHead title={t`Hoy`} />
          <div className="surface">
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
                <Trans>Pedidos WhatsApp</Trans>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 8 }}>
                <span className="figures" style={{ fontWeight: 600, color: 'var(--ink-1)' }}>
                  {ov.ordersToday != null ? String(ov.ordersToday) : '–'}
                </span>{' '}
                {ov.avgTicketMXN != null ? (
                  <Trans>pedidos · ticket promedio $ {ov.avgTicketMXN}</Trans>
                ) : (
                  <Trans>pedidos · ticket promedio sin calcular</Trans>
                )}
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
                <div>
                  <Lbl>
                    <Trans>Aceptados</Trans>
                  </Lbl>
                  <Val>{ov.ordersAccepted != null ? String(ov.ordersAccepted) : '–'}</Val>
                </div>
                <div>
                  <Lbl>
                    <Trans>Cancelados</Trans>
                  </Lbl>
                  <Val>{ov.ordersCancelled != null ? String(ov.ordersCancelled) : '–'}</Val>
                </div>
              </div>
            </div>

            <div className="surface-divide" style={{ padding: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1)' }}>
                <Trans>Actividad del monedero</Trans>
              </div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginTop: 8 }}>
                <span className="figures" style={{ fontWeight: 600, color: 'var(--ink-1)' }}>
                  {ov.walletProcessedToday || '–'}
                </span>{' '}
                <Trans>MXN procesado hoy</Trans>
              </div>
              <div style={{ display: 'flex', gap: 24, marginTop: 12 }}>
                <div>
                  <Lbl>
                    <Trans>Recargas</Trans>
                  </Lbl>
                  <Val>{ov.topupsTodayMXN || '–'}</Val>
                  {ov.topupsTodayCount != null ? (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                      {ov.topupsTodayCount} <Trans>movimientos</Trans>
                    </div>
                  ) : null}
                </div>
                <div>
                  <Lbl>
                    <Trans>Canjes</Trans>
                  </Lbl>
                  <Val>{ov.redemptionsTodayMXN || '–'}</Val>
                  {ov.redemptionsTodayCount != null ? (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>
                      {ov.redemptionsTodayCount} <Trans>movimientos</Trans>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default OverviewScreen;
