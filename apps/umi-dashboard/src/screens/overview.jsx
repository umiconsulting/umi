import React, { useState } from 'react'
import { I, UmiX } from '../icons.jsx'
import { XSep, Spark } from '../shell.jsx'
import { useOverviewData } from '../data.jsx'

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
      lbl: 'Ingresos del mes', en: 'Revenue',
      val: ov.revenueThisMonth || '–',
      delta: ov.revenueDeltaPct != null ? (ov.revenueDeltaPct > 0 ? '+' : '') + ov.revenueDeltaPct + '%' : '–',
      up: ov.revenueDeltaPct == null || ov.revenueDeltaPct >= 0,
    },
    {
      lbl: 'Visitas hoy', en: 'Visits today',
      val: ov.visitsToday != null ? String(ov.visitsToday) : '–',
      delta: ov.visitsDeltaPct != null ? (ov.visitsDeltaPct > 0 ? '+' : '') + ov.visitsDeltaPct + '%' : '–',
      up: ov.visitsDeltaPct == null || ov.visitsDeltaPct >= 0,
    },
    {
      lbl: 'Gift cards abiertas', en: 'Open gift cards',
      val: ov.openGiftCards != null ? String(ov.openGiftCards) : '–',
      delta: ov.openGiftCardsDelta != null ? (ov.openGiftCardsDelta > 0 ? '+' : '') + ov.openGiftCardsDelta : '–',
      up: ov.openGiftCardsDelta == null || ov.openGiftCardsDelta >= 0,
    },
    {
      lbl: 'Recompensas canjeadas · 7d', en: 'Rewards redeemed',
      val: ov.rewardsRedeemed7d != null ? String(ov.rewardsRedeemed7d) : '–',
      delta: ov.rewardsDelta7d != null ? (ov.rewardsDelta7d > 0 ? '+' : '') + ov.rewardsDelta7d : '–',
      up: ov.rewardsDelta7d == null || ov.rewardsDelta7d >= 0,
    },
  ];

  const nowLabel = new Date().toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' });
  const alerts = [
    ordersPaused && {
      kind: 'warn', time: nowLabel,
      ttl: 'Pedidos WhatsApp pausados',
      sub: 'Pausado · aviso especial activo',
      cta: ordersPaused ? 'Reanudar' : 'Pausar',
      onCta: () => setOrdersPaused(p => !p),
    },
  ].filter(Boolean);

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>

      {/* Live ticker */}
      <div className="fade-up d1">
        <LiveTicker events={ticker || []}/>
      </div>

      {/* Hero metric + supporting strip */}
      <section className="fade-up d2" style={{display:'grid', gridTemplateColumns:'1.25fr 1fr', gap:18}}>
        {/* Hero — Active Members */}
        <div className="hero-metric">
          <UmiX size={320} color="#1F1410" strokeWidth={10} className="x-mark"/>
          <div className="h-head">
            <div>
              <div className="lbl-es">Miembros activos</div>
              <div className="lbl-en">Active members <XSep/> Umi Cash</div>
            </div>
            {ov.memberHistory?.length > 1 && <Spark data={ov.memberHistory} up={true} width={140} height={36}/>}
          </div>
          <div className="big">
            {ov.activeMembers != null ? ov.activeMembers.toLocaleString('es-MX') : '–'}
            <span className="unit">total</span>
          </div>
          <div className="h-foot">
            <span className="delta up" style={{padding:'4px 10px', fontSize:13}}>
              {ov.memberDeltaPct != null ? `↑ ${ov.memberDeltaPct}%` : 'Sin cambio calculado'}
              <span style={{fontWeight:400, opacity:0.7, marginLeft:4}}>· 28 días</span>
            </span>
            <span className="compare">
              {ov.newThisWeek != null ? '+' + ov.newThisWeek.toLocaleString('es-MX') + ' nuevos esta semana' : 'Nuevos sin calcular'}
              <XSep/>
              {ov.birthdayActivatable != null ? ov.birthdayActivatable + ' cumpleaños activables' : 'Cumpleaños sin calcular'}
              <XSep/>
              {ov.highBalanceCount != null ? ov.highBalanceCount + ' con saldo > $1,000' : 'Saldos altos sin calcular'}
            </span>
          </div>
        </div>

        {/* Supporting strip metrics */}
        <div style={{display:'flex', flexDirection:'column', gap:10}}>
          {supportMetrics.map(m => (
            <div className="strip-metric" key={m.lbl}>
              <div>
                <div className="lbl">{m.lbl}</div>
                <div className="en">{m.en}</div>
              </div>
              <div className="val">{m.val}</div>
              <span className={'delta-mini ' + (m.up ? 'up' : 'down')}>{m.up ? '↑' : '↓'} {m.delta}</span>
            </div>
          ))}
        </div>
      </section>

      {/* KDS station rail */}
      <section className="fade-up d3">
        <div className="ed-head">
          <div className="titles">
            <div className="sec-index">
              <span className="nn">A</span><span>/</span>
              <span>EN VIVO <XSep/> {stations.length} ESTACIONES</span>
            </div>
            <h2>Estaciones de cocina <span style={{color:'var(--ink-3)', fontWeight:300}}>· KDS</span></h2>
            <div className="en">Live kitchen stations</div>
          </div>
          <div style={{display:'flex', gap:16, fontSize:11, color:'var(--ink-3)', letterSpacing:'0.08em', textTransform:'uppercase', alignItems:'center'}}>
            <span><span className="s-dot live" style={{verticalAlign:'middle', marginRight:6}}/> Live</span>
            <span><span className="s-dot slow" style={{verticalAlign:'middle', marginRight:6}}/> Slow</span>
            <span><span className="s-dot offline" style={{verticalAlign:'middle', marginRight:6}}/> Offline</span>
            {loading && <span style={{fontSize:10, opacity:0.6}}>actualizando…</span>}
            <button className="btn-icon" onClick={() => setRefresh(r => r+1)} aria-label="Refresh"><I.Refresh size={13}/></button>
          </div>
        </div>
        <div className="station-rail">
          {(stations.length ? stations : []).map(s => (
            <div className={'station-cell ' + s.status} key={s.station_id}>
              <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                <span className="station-label">{s.label}</span>
                <span className={'s-dot ' + s.status}/>
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
      <section className="fade-up d4" style={{display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:24}}>
        <div>
          <div className="ed-head">
            <div className="titles">
              <div className="sec-index"><span className="nn">B</span><span>/</span><span>NEXT BEST ACTION</span></div>
              <h2>Centro de acción</h2>
              <div className="en">Action center <XSep/> {alerts.length} pendientes</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('orders')}>
              Ver pedidos <I.ArrowRight size={14}/>
            </button>
          </div>

          <div className="log-list">
            {alerts.length === 0 && (
              <div className="card" style={{padding:'28px 22px', color:'var(--ink-3)'}}>
                Sin alertas operativas.
              </div>
            )}
            {alerts.map((a, i) => (
              <div className="log-row" key={i}>
                <span className="t">{a.time}</span>
                <span className={'marker ' + a.kind} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                    <line x1="4" y1="4" x2="20" y2="20"/>
                    <line x1="20" y1="4" x2="4" y2="20"/>
                  </svg>
                </span>
                <div className="body">
                  <div><b>{a.ttl}</b></div>
                  <div className="meta">{a.sub}</div>
                </div>
                <button
                  className="btn btn-secondary btn-sm focusable"
                  onClick={() => a.onCta ? a.onCta() : (a.screen && onNavigate(a.screen))}
                >
                  {a.cta} <I.ArrowRight size={13}/>
                </button>
              </div>
            ))}
          </div>

          <div style={{marginTop:14, paddingTop:14, borderTop:'1px solid var(--line-soft)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div style={{fontSize:12.5, color:'var(--ink-3)', display:'flex', alignItems:'center', gap:8}}>
              Escaneo cada 60 s <XSep/> última verificación {new Date().toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setRefresh(r => r+1)}>
              <I.Refresh size={13}/> Re-escanear
            </button>
          </div>
        </div>

        {/* Context panels */}
        <div style={{display:'flex', flexDirection:'column', gap:14}}>
          <ContextPanel
            section="C" eyebrow="Hoy · ConversaFlow"
            title="Pedidos WhatsApp"
            primary={ov.ordersToday != null ? String(ov.ordersToday) : '–'}
            sub={'pedidos · ticket promedio ' + (ov.avgTicketMXN != null ? '$ ' + ov.avgTicketMXN : 'sin calcular')}
            rows={[
              { lbl: 'Aceptados',  val: ov.ordersAccepted != null ? String(ov.ordersAccepted) : '–', sub: ov.ordersToday ? Math.round((ov.ordersAccepted || 0) / ov.ordersToday * 100) + '%' : '–' },
              { lbl: 'Cancelados', val: ov.ordersCancelled != null ? String(ov.ordersCancelled) : '–', sub: ov.ordersToday ? Math.round((ov.ordersCancelled || 0) / ov.ordersToday * 100) + '%' : '–'  },
            ]}
          />
          <ContextPanel
            section="D" eyebrow="Hoy · Umi Cash"
            title="Actividad del monedero"
            primary={ov.walletProcessedToday || '–'}
            sub="MXN procesado hoy"
            rows={[
              { lbl: 'Top-ups', val: ov.topupsTodayMXN || '–', sub: ov.topupsTodayCount != null ? ov.topupsTodayCount + ' tx' : '–' },
              { lbl: 'Canjes',  val: ov.redemptionsTodayMXN || '–', sub: ov.redemptionsTodayCount != null ? ov.redemptionsTodayCount + ' tx' : '–' },
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
        <span className="pulse"/>
        EN VIVO
      </div>
      <div className="ticker-rail">
        <div className="ticker-track">
          {items.map((e, i) => (
            <span className="ticker-item" key={i}>
              <span className="ticker-time">{e.time}</span>
              <span className={'tdot ' + e.kind}/>
              <span>{e.text}{e.actor && <> <XSep/> <b>{e.actor}</b></>}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

const ContextPanel = ({ section, eyebrow, title, primary, sub, rows }) => (
  <div className="card" style={{padding:18}}>
    <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom:10}}>
      <div className="sec-index"><span className="nn">{section}</span><span>/</span><span>{eyebrow.toUpperCase()}</span></div>
    </div>
    <div style={{fontFamily:'var(--font-display)', fontWeight:600, fontSize:15, letterSpacing:'-0.01em', marginBottom:6}}>{title}</div>
    <div className="edit-display" style={{fontSize:38}}>{primary}</div>
    <div style={{fontSize:12, color:'var(--ink-3)', marginTop:4, marginBottom:14}}>{sub}</div>
    <div style={{display:'flex', gap:14, paddingTop:12, borderTop:'1px solid var(--line-soft)'}}>
      {rows.map(r => (
        <div key={r.lbl} style={{flex:1}}>
          <div style={{fontSize:10.5, color:'var(--ink-3)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:3}}>{r.lbl}</div>
          <div className="num" style={{fontFamily:'var(--font-display)', fontWeight:600, fontSize:16, letterSpacing:'-0.012em'}}>{r.val}</div>
          <div style={{fontSize:11, color:'var(--ink-3)'}}>{r.sub}</div>
        </div>
      ))}
    </div>
  </div>
);

export default OverviewScreen
