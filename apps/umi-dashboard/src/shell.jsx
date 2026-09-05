import React from 'react';
import { I, UmiX } from './icons.jsx';

/** Section keys as an operator reads them. The key itself is the storage form. */
const SECTION_LABELS = {
  HOME: 'HOY',
  OPERATIONS: 'OPERACIÓN',
  CUSTOMERS: 'CLIENTES',
  BUSINESS: 'NEGOCIO',
  CONFIGURATION: 'CONFIGURACIÓN',
  PLATFORM: 'PLATAFORMA',
};

// Tiny X separator — the brand glyph as connective tissue between metadata bits
const XSep = ({ dark = false, size = 7 }) => (
  <span
    className="x-sep"
    aria-hidden="true"
    style={{ width: size, height: size, opacity: dark ? 0.4 : 0.55 }}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={dark ? '#f0f4ff' : 'currentColor'}
      strokeWidth="3"
      strokeLinecap="round"
    >
      <line x1="4" y1="4" x2="20" y2="20" />
      <line x1="20" y1="4" x2="4" y2="20" />
    </svg>
  </span>
);

const formatMerchantGreetingName = (merchantName, maxLength = 30) => {
  const name = String(merchantName || '')
    .trim()
    .replace(/\s+/g, ' ');
  return name.length > maxLength ? name.slice(0, maxLength) : name;
};

const Sidebar = ({
  active,
  onChange,
  collapsed,
  onToggleCollapse,
  merchantName,
  navItems,
  merchants,
  selectedMerchantId,
  onMerchantChange,
  onSignOut,
}) => {
  const sections = [];
  let current = null;
  const items = navItems || [];
  items.forEach((item) => {
    if (item.section !== current) {
      current = item.section;
      sections.push({ name: current, items: [] });
    }
    sections[sections.length - 1].items.push(item);
  });

  return (
    <aside className="side">
      <button
        className="collapse-btn focusable"
        onClick={onToggleCollapse}
        aria-label="Toggle sidebar"
      >
        {collapsed ? <I.ChevronRight size={14} /> : <I.ChevronLeft size={14} />}
      </button>

      <div className="side-head">
        <UmiX size={32} color="#7692CB" />
        {!collapsed && (
          <div>
            <div className="side-brand-name">
              umi<em>· dash</em>
            </div>
            <div className="side-brand-sub">Owner Console</div>
          </div>
        )}
      </div>

      {sections.map((sec) => (
        <React.Fragment key={sec.name}>
          {/* No `0{si+1} /`. The groups are not a sequence — Configuración does not
              follow Crecimiento, and reordering the nav would not renumber
              anything. The number was there to look considered. */}
          {!collapsed && <div className="side-section">{SECTION_LABELS[sec.name] || sec.name}</div>}
          {sec.items.map((item) => {
            const Ic = I[item.icon] || I.Settings;
            return (
              <button
                key={item.id}
                type="button"
                className={'side-item focusable x-active' + (active === item.id ? ' active' : '')}
                onClick={() => onChange(item.id)}
                aria-current={active === item.id ? 'page' : undefined}
                title={collapsed ? item.label : undefined}
              >
                <span className="ic">
                  <Ic />
                </span>
                <span className="label">{item.label}</span>
                {item.badge && (
                  <span className={'badge-side' + (item.badgeKind === 'warn' ? ' warn' : '')}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </React.Fragment>
      ))}

      <div className="side-foot" style={{ flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
          <div className="avatar">OW</div>
          {!collapsed && (
            <div className="uname" style={{ flex: 1 }}>
              <div>Owner</div>
              <div className="sm">Admin · {merchantName || '—'}</div>
            </div>
          )}
          {!collapsed && onSignOut && (
            <button
              className="btn-icon"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Cerrar sesión"
              style={{ opacity: 0.6 }}
            >
              <I.Power size={14} />
            </button>
          )}
        </div>
        {!collapsed && merchants?.length > 1 && (
          <select
            className="select"
            value={selectedMerchantId || ''}
            onChange={(e) => onMerchantChange?.(e.target.value)}
            aria-label="Merchant"
            style={{ width: '100%', height: 34, borderRadius: 8, fontSize: 12 }}
          >
            {merchants.map((merchant) => (
              <option key={merchant.id} value={merchant.id}>
                {merchant.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!collapsed && (
        <div style={{ paddingTop: 10, marginTop: 6, borderTop: '1px solid var(--side-line)' }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--side-text-3)',
              marginBottom: 6,
            }}
          >
            v1.0 <XSep dark /> Abril 2026
          </div>
          <div className="brand-mod" aria-hidden="true">
            {Array.from({ length: 24 }).map((_, i) => (
              <span key={i} className={[2, 5, 8, 11, 14, 17, 20].includes(i) ? 'lit' : ''} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

// Network connectivity indicator — shows API health and allows manual retry.

/**
 * The masthead.
 *
 * One shape for every screen: the page's name, its actions, and — between two
 * hairlines beneath — THE DATELINE. Which café, which branch, whether the till
 * is answering, today's date, the clock. Every field is live.
 *
 * It replaces three separate devices: the `01 / OPERACIONES` ordinal that opened
 * every screen without ever being a sequence, the uppercase English gloss under
 * every Spanish title, and the status chips that floated loose in the bar. The
 * operator now reads their whole context on one line, in one place, always the
 * same place.
 */
const Topbar = ({
  merchant,
  onMenu,
  screen,
  merchantName,
  locations = [],
  canSwitchLocations = false,
  selectedLocationId,
  onLocationChange,
  connection = {},
}) => {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const greetingName = formatMerchantGreetingName(merchantName);

  // Titles only. The ordinal and the English gloss are gone: neither told the
  // operator anything the title did not already say.
  const titles = {
    overview: 'Panorama',
    operations: 'Centro operativo',
    'cash-shifts': 'Caja y turnos',
    'catalog-inventory': 'Catálogo e inventario',
    'loyalty-value': 'Lealtad y valor',
    kitchen: 'Cocina',
    orders: 'Pedidos',
    devices: 'Dispositivos',
    staff: 'Equipo y permisos',
    customers: 'Clientes',
    members: 'Lealtad',
    'gift-cards': 'Tarjetas de regalo',
    hours: 'Horario y disponibilidad',
    settings: 'Ajustes',
    'products-billing': 'Productos y facturación',
    diagnostics: 'Diagnóstico',
    cafes: 'Cafés',
  };

  // ⚠️ FALLS BACK, and it did not before. A route with no entry here read
  // `undefined.eyebrow` and took the WHOLE shell down — sidebar, topbar and
  // screen — not merely its own header. A missing title is a small omission;
  // a white page is not.
  const title = titles[screen] || screen;

  const locationScoped = [
    'orders',
    'devices',
    'hours',
    'cash-shifts',
    'catalog-inventory',
    'kitchen',
  ].includes(screen);
  const activeLocations = locations.filter((l) => l.status === 'active');
  const showLocationSelect =
    locationScoped && canSwitchLocations && activeLocations.length > 1;
  const branchName =
    activeLocations.find((l) => l.id === selectedLocationId)?.name ||
    (activeLocations.length === 1 ? activeLocations[0].name : null);

  const netStatus = connection.status || 'connecting';
  const isOnline = netStatus === 'online';
  const isChecking = netStatus === 'connecting';
  const netWord = isOnline ? 'En línea' : isChecking ? 'Conectando' : 'Sin conexión';
  const netTone = isOnline ? 'ok' : isChecking ? 'warn' : 'bad';

  const today = new Date();
  const dateWord = today.toLocaleDateString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const clock = today.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  return (
    <header className="topbar">
      <div className="masthead">
        <div className="masthead-row">
          <h1 className="h-page">
            {screen === 'overview' ? (
              <>
                {greet}
                {greetingName ? (
                  <>
                    , <b title={merchantName}>{greetingName}</b>
                  </>
                ) : (
                  ''
                )}
                .
              </>
            ) : (
              title
            )}
          </h1>
          <div className="top-actions">
            {onMenu ? (
              <button className="btn btn-ghost btn-sm focusable nav-toggle" onClick={onMenu}>
                Menú
              </button>
            ) : null}
            {showLocationSelect ? (
              <select
                className="select"
                value={selectedLocationId || ''}
                onChange={(e) => onLocationChange?.(e.target.value)}
                aria-label="Sucursal"
                style={{ height: 38, borderRadius: 10, minWidth: 160, fontSize: 13 }}
              >
                {activeLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>

        {/* The dateline. */}
        <div className="dateline">
          {/* The state is a button only when there is something to do about it,
              so the operator never clicks a control that cannot act. */}
          {isOnline || isChecking ? (
            <span
              title={
                isOnline && connection.latency != null ? `${connection.latency} ms` : undefined
              }
            >
              <span className={'dot ' + netTone} />
              {netWord}
            </span>
          ) : (
            <button
              className="as-text focusable"
              onClick={connection.retry}
              title="Reintentar la conexión"
            >
              <span className={'dot ' + netTone} />
              {netWord} · reintentar
            </button>
          )}
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="live" title={merchantName || merchant}>
            {merchantName || merchant}
          </span>
          {branchName ? (
            <>
              <span className="sep" aria-hidden="true">
                ·
              </span>
              <span>{branchName}</span>
            </>
          ) : null}
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span>{dateWord}</span>
          <span className="clock">{clock}</span>
        </div>
      </div>
    </header>
  );
};

/**
 * The head of a region inside a screen.
 *
 * Every region used to open with an ordinal — `A /`, `B /`, `E /` — above its
 * title, and an English gloss beneath. Twenty-one of them, and the ordinals were
 * never a sequence: nothing followed A to B, and reordering the page would not
 * have changed a letter. A label that appears on everything ranks nothing.
 *
 * So this component has no slot for one. What a region gets is its name, one
 * plain line when the name is not enough, the live figure that region is about,
 * and its actions. If a caller wants an ordinal back, it has to add the slot —
 * which is the point.
 *
 *   title    the region's name
 *   note     one sentence, only when it says something the title does not
 *   count    { value, label } — a live figure, set in mono on the figure axis
 *   actions  the region's controls
 */
const RegionHead = ({ title, note, count, actions, children }) => (
  <div className="ed-head">
    <div className="titles">
      <h2>{title}</h2>
      {note ? <div className="en">{note}</div> : null}
      {children}
    </div>
    {count || actions ? (
      <div className="actions">
        {count ? (
          <span className="head-count">
            <b>{count.value}</b> {count.label}
          </span>
        ) : null}
        {actions}
      </div>
    ) : null}
  </div>
);

// Tiny sparkline component
const Spark = ({ data, up = true, width = 96, height = 28 }) => {
  const max = Math.max(...data),
    min = Math.min(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const path = data
    .map(
      (v, i) =>
        `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${(height - ((v - min) / range) * height).toFixed(1)}`,
    )
    .join(' ');
  // area fill
  const areaPath = path + ` L ${width} ${height} L 0 ${height} Z`;
  const color = up ? 'var(--success)' : 'var(--danger)';
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id={`g-${up ? 'u' : 'd'}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#g-${up ? 'u' : 'd'})`} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

// Mini bar chart
const MiniBars = ({ data, accent = 'var(--info)' }) => {
  const max = Math.max(...data);
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 28 }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: `${(v / max) * 100}%`,
            background: i === data.length - 1 ? accent : 'rgba(118,146,203,0.35)',
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
};

/**
 * HubTabs — the second level of the two-tier IA. A hub screen groups several
 * operational domains and shows one at a time. The tabs are the in-page navigation
 * that keeps the sidebar flat: a new feature becomes a tab here, not a sidebar row.
 */
const HubTabs = ({ tabs, active, onChange, ariaLabel = 'Secciones' }) => (
  <div className="hub-tabs" role="tablist" aria-label={ariaLabel}>
    {tabs.map((tab) => (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={active === tab.id}
        className={'hub-tab focusable' + (active === tab.id ? ' active' : '')}
        onClick={() => onChange(tab.id)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export { Sidebar, Topbar, RegionHead, Spark, MiniBars, XSep, HubTabs };
