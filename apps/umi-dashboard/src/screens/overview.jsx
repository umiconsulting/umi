import { useState } from 'react';
import { I, UmiX } from '@/icons.jsx';
import { RegionHead, Spark, XSep } from '@/shell.jsx';
import { useOverviewData } from '@/data.jsx';

// Screen 1 — Overview / Panorama
// Data: useOverviewData() → { overview, stations }
//   overview: umi-cash stats + analytics
//   stations: kds.tickets + kds.device_sessions from Supabase

const OverviewScreen = ({ onNavigate, ordersPaused, setOrdersPaused }) => {
  const [refresh, setRefresh] = useState(0);
  const { data, loading } = useOverviewData(refresh);

  const ov = (data && data.overview) || {};
  const stations = (data && data.stations) || [];
  const ticker = (data && data.ticker) || [];

  const supportMetrics = [
    {
      lbl: 'Ingresos del mes',
      val: ov.revenueThisMonth || '–',
      delta:
        ov.revenueDeltaPct != null
          ? (ov.revenueDeltaPct > 0 ? '+' : '') + ov.revenueDeltaPct + '%'
          : '–',
      up: ov.revenueDeltaPct == null || ov.revenueDeltaPct >= 0,
    },
    {
      lbl: 'Visitas hoy',
      val: ov.visitsToday != null ? String(ov.visitsToday) : '–',
      delta:
        ov.visitsDeltaPct != null
          ? (ov.visitsDeltaPct > 0 ? '+' : '') + ov.visitsDeltaPct + '%'
          : '–',
      up: ov.visitsDeltaPct == null || ov.visitsDeltaPct >= 0,
    },
    {
      lbl: 'Tarjetas de regalo abiertas',
      val: ov.openGiftCards != null ? String(ov.openGiftCards) : '–',
      delta:
        ov.openGiftCardsDelta != null
          ? (ov.openGiftCardsDelta > 0 ? '+' : '') + ov.openGiftCardsDelta
          : '–',
      up: ov.openGiftCardsDelta == null || ov.openGiftCardsDelta >= 0,
    },
    {
      lbl: 'Recompensas canjeadas · 7d',
      val: ov.rewardsRedeemed7d != null ? String(ov.rewardsRedeemed7d) : '–',
      delta:
        ov.rewardsDelta7d != null ? (ov.rewardsDelta7d > 0 ? '+' : '') + ov.rewardsDelta7d : '–',
      up: ov.rewardsDelta7d == null || ov.rewardsDelta7d >= 0,
    },
  ];

  const nowLabel = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const alerts = [
    ordersPaused && {
      kind: 'warn',
      time: nowLabel,
      ttl: 'Pedidos WhatsApp pausados',
      sub: 'Pausado · aviso especial activo',
      cta: ordersPaused ? 'Reanudar' : 'Pausar',
      onCta: () => setOrdersPaused((p) => !p),
    },
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* An empty ticker rendered as a full-width bar with a lone EN VIVO tag and
          nothing running past it — a container advertising that it has nothing to
          say. It appears when there is something to report, and not before. */}
      {ticker?.length ? <LiveTicker events={ticker} /> : null}

      {/* Hero metric + supporting strip */}
      <section className="split">
        {/* Hero — Active Members */}
        <div className="hero-metric">
          <div className="h-head">
            <div>
              <div className="lbl-es">Miembros activos</div>
              <div className="lbl-en">Inscritos en el programa de lealtad</div>
            </div>
            {ov.memberHistory?.length > 1 && (
              <Spark data={ov.memberHistory} up={true} width={140} height={36} />
            )}
          </div>
          <div className="big">
            {ov.activeMembers != null ? ov.activeMembers.toLocaleString('es-MX') : '–'}
            <span className="unit">total</span>
          </div>
          <div className="h-foot">
            {/* `delta up` is the GREEN pill. "Sin cambio calculado" is not good news
                — it is the absence of news — so it does not get to wear the colour
                that means growth. */}
            <span
              className={'delta ' + (ov.memberDeltaPct == null ? 'none' : 'up')}
              style={{ padding: '4px 10px', fontSize: 13 }}
            >
              {ov.memberDeltaPct != null ? `↑ ${ov.memberDeltaPct}%` : 'Sin cambio calculado'}
              <span style={{ fontWeight: 400, opacity: 0.7, marginLeft: 4 }}>· 28 días</span>
            </span>
            <span className="compare">
              {ov.newThisWeek != null
                ? '+' + ov.newThisWeek.toLocaleString('es-MX') + ' nuevos esta semana'
                : 'Nuevos sin calcular'}
              {' · '}
              {ov.birthdayActivatable != null
                ? ov.birthdayActivatable + ' cumpleaños activables'
                : 'Cumpleaños sin calcular'}
              {' · '}
              {ov.highBalanceCount != null
                ? ov.highBalanceCount + ' con saldo > $1,000'
                : 'Saldos altos sin calcular'}
            </span>
          </div>
        </div>

        {/* Supporting strip metrics */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {supportMetrics.map((m) => (
            <div className="strip-metric" key={m.lbl}>
              <div className="lbl">{m.lbl}</div>
              <div className="val">{m.val}</div>
              {/* An arrow next to an unknown delta claims a direction the data does
                  not have. When there is no comparison, the slot stays empty. */}
              {m.delta === '–' ? (
                <span className="delta-mini none">sin comparar</span>
              ) : (
                <span className={'delta-mini ' + (m.up ? 'up' : 'down')}>
                  {m.up ? '↑' : '↓'} {m.delta}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* KDS station rail */}
      <section>
        <RegionHead
          title="Estaciones de cocina"
          note={loading ? 'Actualizando…' : 'Cada estación del KDS y cómo responde ahora.'}
          count={{ value: stations.length, label: 'estaciones' }}
          actions={
            <>
              {/* The legend for the dots the rail below uses. Each pairs the dot
                  with its word, so the state does not depend on telling the hues
                  apart. */}
              <span className="dot-legend">
                <span>
                  <span className="s-dot live" /> En vivo
                </span>
                <span>
                  <span className="s-dot slow" /> Lento
                </span>
                <span>
                  <span className="s-dot offline" /> Sin conexión
                </span>
              </span>
              <button
                className="btn-icon focusable"
                onClick={() => setRefresh((r) => r + 1)}
                aria-label="Actualizar las estaciones"
                title="Actualizar"
              >
                <I.Refresh size={13} />
              </button>
            </>
          }
        />
        <div className="station-rail">
          {(stations.length ? stations : []).map((s) => (
            <div className={'station-cell ' + s.status} key={s.station_id}>
              <div
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span className="station-label">{s.label}</span>
                <span className={'s-dot ' + s.status} />
              </div>
              <div className="station-name">{s.station_name}</div>
              <div className="station-num">
                {s.open}
                <em>{s.status === 'offline' ? 'cerrado' : 'abiertos'}</em>
              </div>
              <div className="station-foot">{s.foot}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Action center + context panels */}
      <section className="split wide-gap">
        <div>
          <div className="ed-head">
            <div className="titles">
              <h2>Centro de acción</h2>
              <div className="en">
                {alerts.length === 0
                  ? 'Nada pendiente ahora mismo.'
                  : `${alerts.length} pendiente${alerts.length === 1 ? '' : 's'}.`}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('orders')}>
              Ver pedidos <I.ArrowRight size={14} />
            </button>
          </div>

          <div className="log-list">
            {alerts.length === 0 && (
              <div className="card" style={{ padding: '28px 22px', color: 'var(--ink-3)' }}>
                Sin alertas operativas.
              </div>
            )}
            {alerts.map((a, i) => (
              <div className="log-row" key={i}>
                <span className="t">{a.time}</span>
                <span className={'marker ' + a.kind} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                  >
                    <line x1="4" y1="4" x2="20" y2="20" />
                    <line x1="20" y1="4" x2="4" y2="20" />
                  </svg>
                </span>
                <div className="body">
                  <div>
                    <b>{a.ttl}</b>
                  </div>
                  <div className="meta">{a.sub}</div>
                </div>
                <button
                  className="btn btn-secondary btn-sm focusable"
                  onClick={() => (a.onCta ? a.onCta() : a.screen && onNavigate(a.screen))}
                >
                  {a.cta} <I.ArrowRight size={13} />
                </button>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid var(--line-soft)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                fontSize: 12.5,
                color: 'var(--ink-3)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              Escaneo cada 60 s · última verificación{' '}
              {new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setRefresh((r) => r + 1)}>
              <I.Refresh size={13} /> Re-escanear
            </button>
          </div>
        </div>

        {/* Context panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ContextPanel
            eyebrow="Hoy · ConversaFlow"
            title="Pedidos WhatsApp"
            primary={ov.ordersToday != null ? String(ov.ordersToday) : '–'}
            sub={
              'pedidos · ticket promedio ' +
              (ov.avgTicketMXN != null ? '$ ' + ov.avgTicketMXN : 'sin calcular')
            }
            rows={[
              {
                lbl: 'Aceptados',
                val: ov.ordersAccepted != null ? String(ov.ordersAccepted) : '–',
                sub: ov.ordersToday
                  ? Math.round(((ov.ordersAccepted || 0) / ov.ordersToday) * 100) + '%'
                  : '–',
              },
              {
                lbl: 'Cancelados',
                val: ov.ordersCancelled != null ? String(ov.ordersCancelled) : '–',
                sub: ov.ordersToday
                  ? Math.round(((ov.ordersCancelled || 0) / ov.ordersToday) * 100) + '%'
                  : '–',
              },
            ]}
          />
          <ContextPanel
            eyebrow="Hoy · Umi Cash"
            title="Actividad del monedero"
            primary={ov.walletProcessedToday || '–'}
            sub="MXN procesado hoy"
            rows={[
              {
                lbl: 'Top-ups',
                val: ov.topupsTodayMXN || '–',
                sub: ov.topupsTodayCount != null ? ov.topupsTodayCount + ' tx' : '–',
              },
              {
                lbl: 'Canjes',
                val: ov.redemptionsTodayMXN || '–',
                sub: ov.redemptionsTodayCount != null ? ov.redemptionsTodayCount + ' tx' : '–',
              },
            ]}
          />
        </div>
      </section>
    </div>
  );
};

const LiveTicker = ({ events }) => {
  const items = [...events, ...events];
  return (
    <div className="ticker">
      <div className="ticker-tag">
        <span className="pulse" />
        EN VIVO
      </div>
      <div className="ticker-rail">
        <div className="ticker-track">
          {items.map((e, i) => (
            <span className="ticker-item" key={i}>
              <span className="ticker-time">{e.time}</span>
              <span className={'tdot ' + e.kind} />
              <span>
                {e.text}
                {e.actor && (
                  <>
                    {' '}
                    <XSep /> <b>{e.actor}</b>
                  </>
                )}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const ContextPanel = ({ eyebrow, title, primary, sub, rows }) => (
  <div className="card" style={{ padding: 18 }}>
    <div className="eyebrow" style={{ marginBottom: 10 }}>
      {eyebrow}
    </div>
    <div
      style={{
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 15,
        letterSpacing: '-0.01em',
        marginBottom: 6,
      }}
    >
      {title}
    </div>
    <div className="edit-display" style={{ fontSize: 38 }}>
      {primary}
    </div>
    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4, marginBottom: 14 }}>{sub}</div>
    <div
      style={{ display: 'flex', gap: 14, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}
    >
      {rows.map((r) => (
        <div key={r.lbl} style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--ink-3)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 3,
            }}
          >
            {r.lbl}
          </div>
          <div
            className="num"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: '-0.012em',
            }}
          >
            {r.val}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.sub}</div>
        </div>
      ))}
    </div>
  </div>
);

export default OverviewScreen;
