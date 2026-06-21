import React, { useState, useEffect, useRef } from 'react'
import { I, UmiX } from './icons.jsx'

const NAV = [
  { id: 'overview', label: 'Overview',            icon: 'Home',       section: 'OPERATIONS'    },
  { id: 'orders',   label: 'Pedidos',              icon: 'Receipt',    section: 'OPERATIONS'    },
  { id: 'devices',  label: 'Devices',              icon: 'Tablet',     section: 'OPERATIONS', badge: '4' },
  { id: 'staff',    label: 'Staff & Access',       icon: 'Users',      section: 'OPERATIONS'    },
  { id: 'customers', label: 'Customers',            icon: 'Users2',     section: 'OPERATIONS'    },
  { id: 'members',  label: 'Loyalty',               icon: 'CreditCard', section: 'GROWTH'        },
  { id: 'gift-cards', label: 'Gift Cards',          icon: 'Gift',       section: 'GROWTH'        },
  { id: 'hours',    label: 'Hours & Availability', icon: 'Clock',      section: 'CONFIGURATION', badge: 'PAUSED', badgeKind: 'warn' },
  { id: 'settings', label: 'Settings',             icon: 'Settings',   section: 'CONFIGURATION' },
];

// Tiny X separator — the brand glyph as connective tissue between metadata bits
const XSep = ({ dark = false, size = 7 }) => (
  <span className="x-sep" aria-hidden="true" style={{width: size, height: size, opacity: dark ? 0.4 : 0.55}}>
    <svg viewBox="0 0 24 24" fill="none" stroke={dark ? "#f0f4ff" : "currentColor"} strokeWidth="3" strokeLinecap="round">
      <line x1="4" y1="4" x2="20" y2="20"/>
      <line x1="20" y1="4" x2="4" y2="20"/>
    </svg>
  </span>
);

const formatTenantGreetingName = (tenantName, maxLength = 30) => {
  const name = String(tenantName || '').trim().replace(/\s+/g, ' ');
  return name.length > maxLength ? name.slice(0, maxLength) : name;
};

const Sidebar = ({
  active,
  onChange,
  collapsed,
  onToggleCollapse,
  tenantName,
  navItems,
  tenants,
  selectedTenantId,
  onTenantChange,
  onSignOut,
}) => {
  const sections = [];
  let current = null;
  const items = navItems?.length ? navItems : NAV;
  items.forEach(item => {
    if (item.section !== current) {
      current = item.section;
      sections.push({ name: current, items: [] });
    }
    sections[sections.length - 1].items.push(item);
  });

  return (
    <aside className="side">
      <button className="collapse-btn focusable" onClick={onToggleCollapse} aria-label="Toggle sidebar">
        {collapsed ? <I.ChevronRight size={14}/> : <I.ChevronLeft size={14}/>}
      </button>

      <div className="side-head">
        <UmiX size={32} color="#7692CB" />
        {!collapsed && (
          <div>
            <div className="side-brand-name">umi<em>· dash</em></div>
            <div className="side-brand-sub">Owner Console</div>
          </div>
        )}
      </div>

      {sections.map((sec, si) => (
        <React.Fragment key={sec.name}>
          {!collapsed && (
            <div className="side-section" style={{display:'flex', alignItems:'baseline', gap:8}}>
              <span style={{fontFamily:'var(--font-mono)', color:'var(--umi-blue)'}}>0{si+1}</span>
              <span>/</span>
              <span>{sec.name}</span>
            </div>
          )}
          {sec.items.map(item => {
            const Ic = I[item.icon] || I.Settings;
            return (
              <div
                key={item.id}
                className={"side-item focusable x-active" + (active === item.id ? " active" : "")}
                onClick={() => onChange(item.id)}
                tabIndex={0}
                role="button"
                aria-current={active === item.id ? 'page' : undefined}
              >
                <span className="ic"><Ic /></span>
                <span className="label">{item.label}</span>
                {item.badge && <span className={"badge-side" + (item.badgeKind === 'warn' ? ' warn' : '')}>{item.badge}</span>}
              </div>
            );
          })}
        </React.Fragment>
      ))}

      <div className="side-foot" style={{flexDirection:'column', gap:8}}>
        <div style={{display:'flex', alignItems:'center', gap:10, width:'100%'}}>
          <div className="avatar">OW</div>
          {!collapsed && (
            <div className="uname" style={{flex:1}}>
              <div>Owner</div>
              <div className="sm">Admin <XSep dark/> {tenantName || '—'}</div>
            </div>
          )}
          {!collapsed && onSignOut && (
            <button
              className="btn-icon"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Cerrar sesión"
              style={{opacity:0.6}}
            >
              <I.Power size={14}/>
            </button>
          )}
        </div>
        {!collapsed && tenants?.length > 1 && (
          <select
            className="select"
            value={selectedTenantId || ''}
            onChange={e => onTenantChange?.(e.target.value)}
            aria-label="Tenant"
            style={{width:'100%', height:34, borderRadius:8, fontSize:12}}
          >
            {tenants.map(tenant => (
              <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
            ))}
          </select>
        )}
      </div>
      {!collapsed && (
        <div style={{paddingTop:10, marginTop:6, borderTop:'1px solid var(--side-line)'}}>
          <div style={{fontSize:9, letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--side-text-3)', marginBottom:6}}>
            v1.0 <XSep dark/> Abril 2026
          </div>
          <div className="brand-mod" aria-hidden="true">
            {Array.from({length: 24}).map((_, i) => (
              <span key={i} className={[2,5,8,11,14,17,20].includes(i) ? 'lit' : ''}/>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

// Network connectivity indicator — shows API health and allows manual retry.
const NetIndicator = ({ status, latency, onRetry }) => {
  const [spinning, setSpinning] = useState(false)
  const timerRef = useRef(null)

  // Brief spin animation when retrying
  function handleRetry() {
    setSpinning(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSpinning(false), 1200)
    onRetry?.()
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  const isOnline    = status === 'online'
  const isChecking  = status === 'connecting'

  const bg    = isOnline ? 'var(--success-soft)' : isChecking ? 'var(--canvas-2)' : 'var(--danger-soft)'
  const color  = isOnline ? 'var(--success)'      : isChecking ? 'var(--ink-3)'    : 'var(--danger)'
  const label  = isOnline
    ? (latency != null ? `${latency} ms` : 'Online')
    : isChecking ? 'Conectando…' : 'Sin conexión'
  const title  = isOnline
    ? `API responde en ${latency} ms`
    : isChecking ? 'Verificando conexión con el servidor…'
    : 'Sin conexión al servidor — click para reintentar'

  return (
    <button
      onClick={!isOnline ? handleRetry : undefined}
      title={title}
      aria-label={title}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 20,
        fontSize: 11.5, fontWeight: 500, letterSpacing: '0.01em',
        background: bg, color,
        border: 'none', cursor: isOnline ? 'default' : 'pointer',
        transition: 'background 0.2s, color 0.2s',
        flexShrink: 0,
      }}
    >
      {isChecking || spinning
        ? <span style={{width:7, height:7, borderRadius:'50%', background: color, opacity:0.55, animation:'pulse-kds-check 1s ease-in-out infinite'}}/>
        : <span className={'s-dot ' + (isOnline ? 'live' : 'offline')} style={{flexShrink:0}}/>
      }
      {label}
      {!isOnline && !isChecking && (
        <I.Refresh size={11} style={{marginLeft:1, opacity: spinning ? 0.4 : 0.8, transition:'opacity 0.2s'}}/>
      )}
    </button>
  )
}

const Topbar = ({ business, status, onMenu, screen, tenantName, locations = [], selectedLocationId, onLocationChange, connection = {} }) => {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const greetingName = formatTenantGreetingName(tenantName);
  const titles = {
    overview:  { eyebrow: '01 / OPERACIONES',    title: 'Panorama',                  en: 'Overview'           },
    orders:    { eyebrow: '02 / OPERACIONES',    title: 'Pedidos WhatsApp',          en: 'KDS tickets'        },
    devices:   { eyebrow: '03 / OPERACIONES',    title: 'Dispositivos KDS',          en: 'Kitchen displays'   },
    staff:     { eyebrow: '04 / OPERACIONES',    title: 'Equipo y permisos',         en: 'Staff & Access'     },
    customers: { eyebrow: '05 / OPERACIONES',    title: 'Customers',                 en: 'Customer platform'  },
    members:   { eyebrow: '06 / GROWTH',         title: 'Loyalty',                   en: 'Umi Cash members'   },
    'gift-cards': { eyebrow: '07 / GROWTH',      title: 'Gift cards',                en: 'Umi Cash cards'     },
    hours:     { eyebrow: '08 / CONFIGURACIÓN',  title: 'Horario y disponibilidad',  en: 'Hours & Availability' },
    settings:  { eyebrow: '09 / CONFIGURACIÓN',  title: 'Ajustes',                   en: 'Settings'           },
    'products-billing': { eyebrow: '10 / CONFIGURACIÓN', title: 'Products & Billing', en: 'Subscription'       },
  };

  const branchScoped = ['orders', 'devices', 'hours'].includes(screen);
  const showLocationSelect = branchScoped && locations.length > 1;
  const LocationSelect = () => showLocationSelect ? (
    <select
      className="select"
      value={selectedLocationId || ''}
      onChange={e => onLocationChange?.(e.target.value)}
      aria-label="Branch"
      style={{height:42, borderRadius:10, minWidth:170, fontSize:13}}
    >
      {locations.filter(l => l.status === 'active').map(location => (
        <option key={location.id} value={location.id}>{location.name}</option>
      ))}
    </select>
  ) : null;

  if (screen === 'overview') {
    return (
      <header className="topbar fade-up" style={{alignItems:'flex-end', paddingBottom:12, borderBottom:'1px solid var(--ink-1)'}}>
        <div className="greet">
          <div className="sec-index" style={{marginBottom:14}}>
            <span className="nn">01</span>
            <span>/</span>
            <span>OPERACIONES <XSep/> PANORAMA <XSep/> {new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase()}</span>
          </div>
          <h1 className="edit-display" style={{fontSize:54}}>{greet}{greetingName ? <>, <b title={tenantName}>{greetingName}</b></> : ''}.</h1>
          <div className="meta" style={{marginTop:14, fontSize:13.5}}>
            <span>{business}</span>
            <XSep/>
            <span className="sub-pill"><span className="sd"></span> {status}</span>
            <XSep/>
            <span style={{fontFamily:'var(--font-mono)', fontSize:12, color:'var(--ink-3)'}}>{new Date().toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})} CST</span>
          </div>
        </div>
        <div className="top-actions">
          <LocationSelect/>
          <NetIndicator status={connection.status || 'connecting'} latency={connection.latency} onRetry={connection.retry}/>
          <button className="btn-icon focusable" aria-label="Search"><I.Search size={18}/></button>
          <button className="btn-icon focusable" aria-label="Notifications" style={{position:'relative'}}>
            <I.Bell size={18}/>
            <span style={{position:'absolute', top:6, right:6, width:6, height:6, borderRadius:'50%', background:'var(--danger)'}}></span>
          </button>
        </div>
      </header>
    );
  }

  const t = titles[screen];
  return (
    <header className="topbar fade-up" style={{alignItems:'flex-end', paddingBottom:12, borderBottom:'1px solid var(--ink-1)'}}>
      <div className="greet">
        <div className="sec-index" style={{marginBottom:10}}>
          <span className="nn">{t.eyebrow.split(' / ')[0]}</span>
          <span>/</span>
          <span>{t.eyebrow.split(' / ')[1]} <XSep/> {t.en.toUpperCase()}</span>
        </div>
        <h1 className="edit-display" style={{fontSize:44}}>{t.title}</h1>
      </div>
      <div className="top-actions">
        <LocationSelect/>
        <NetIndicator status={connection.status || 'connecting'} latency={connection.latency} onRetry={connection.retry}/>
        <button className="btn-icon focusable" aria-label="Search"><I.Search size={18}/></button>
        <button className="btn-icon focusable" aria-label="Notifications"><I.Bell size={18}/></button>
      </div>
    </header>
  );
};

// Tiny sparkline component
const Spark = ({ data, up = true, width = 96, height = 28 }) => {
  const max = Math.max(...data), min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const path = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i*stepX).toFixed(1)} ${(height - ((v - min)/range) * height).toFixed(1)}`).join(' ');
  // area fill
  const areaPath = path + ` L ${width} ${height} L 0 ${height} Z`;
  const color = up ? 'var(--success)' : 'var(--danger)';
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`g-${up?'u':'d'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#g-${up?'u':'d'})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

// Mini bar chart
const MiniBars = ({ data, accent = 'var(--info)' }) => {
  const max = Math.max(...data);
  return (
    <div style={{display:'flex', gap:3, alignItems:'flex-end', height:28}}>
      {data.map((v, i) => (
        <div key={i} style={{
          width: 6,
          height: `${(v/max)*100}%`,
          background: i === data.length - 1 ? accent : 'rgba(118,146,203,0.35)',
          borderRadius: 2,
        }}/>
      ))}
    </div>
  );
};

export { Sidebar, Topbar, Spark, MiniBars, XSep }
