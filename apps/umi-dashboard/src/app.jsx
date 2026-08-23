import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';

import { useAuth, signOut } from '@/lib/auth.jsx';
import { MerchantProvider, useMerchant } from '@/lib/merchant-context.jsx';
import { MODULES } from '@/lib/module-registry.js';
import { I } from '@/icons.jsx';
import {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakColor,
  TweakRadio,
  TweakToggle,
} from './tweaks-panel.jsx';
import { useMerchantData, useKdsConnection } from './data.jsx';
import { CFG } from './lib/config.js';
import { Sidebar, Topbar } from './shell.jsx';

import LoginScreen from '@/screens/login.jsx';
import ResetPasswordScreen from '@/screens/reset-password.jsx';
import OverviewScreen from '@/screens/overview.jsx';
import OrdersScreen from '@/screens/orders.jsx';
import DevicesScreen from '@/screens/devices.jsx';
import StaffScreen from '@/screens/staff.jsx';
import MembersScreen from '@/screens/members.jsx';
import GiftCardsScreen from '@/screens/gift-cards.jsx';
import CustomersScreen from '@/screens/customers.jsx';
import HoursScreen from '@/screens/hours.jsx';
import SettingsScreen from '@/screens/settings.jsx';
import ProductsBillingScreen from '@/screens/products-billing.jsx';
import CafesScreen from '@/screens/cafes.jsx';
import OperationsScreen from '@/screens/operations.jsx';

const TWEAK_DEFAULTS = { merchantHue: '#1A5632', density: 'comfy', lang: 'es' };

/** Product keys as an operator reads them, not as the entitlement table stores them. */
const PRODUCT_LABELS = {
  dashboard: 'Umi Dashboard',
  kds: 'KDS',
  cash: 'Umi Cash',
  conversaflow: 'ConversaFlow',
};

/** Refusal for a screen the café does not own the product for. */
function ProductUnavailable({ moduleName = 'Modulo', product = 'producto' }) {
  return (
    <div
      className="card"
      style={{
        padding: '38px 34px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div>
        <h2 style={{ margin: '0 0 8px', fontSize: 24 }}>
          {moduleName} no está activo en este café
        </h2>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 620 }}>
          Esta sección necesita {product}. El super admin lo puede revisar en Productos y
          facturación; no hay controles hasta activar el producto.
        </div>
      </div>
    </div>
  );
}

/** Refusal for a screen that needs a platform grant — an axis cafés do not carry. */
function PlatformOnly({ moduleName = 'Esta pantalla' }) {
  return (
    <div className="alert danger">
      <span className="strip" />
      <I.AlertTriangle className="ico" size={18} />
      <div className="body">
        <div className="ttl">Acceso de plataforma requerido</div>
        <div className="sub">{moduleName} es para operadores de Umi.</div>
      </div>
    </div>
  );
}

/**
 * Refuses a screen the selected café is not entitled to.
 *
 * The label and the product name come from MODULES, not from the route: they were
 * hand-copied at each call site, which is a second place for them to drift from the
 * registry that actually decides. A route now names only its module key.
 */
function GuardedScreen({ moduleKey, children }) {
  const merchantState = useMerchant();
  if (!merchantState?.canShowModule?.(moduleKey)) {
    const mod = MODULES[moduleKey] || {};
    const label = mod.label || moduleKey;
    return mod.platform && !mod.product ? (
      <PlatformOnly moduleName={label} />
    ) : (
      <ProductUnavailable
        moduleName={label}
        product={PRODUCT_LABELS[mod.product] || mod.product || 'este producto'}
      />
    );
  }
  return children;
}

function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [ordersPaused, setOrdersPaused] = useState(false);
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const merchantState = useMerchant();
  const { data: merchant } = useMerchantData();
  const merchantName = merchantState?.selectedMerchant?.name || merchant?.name;
  const connection = useKdsConnection();

  const rawScreen = location.pathname.split('/').filter(Boolean)[0] || 'overview';
  const screen =
    rawScreen === 'conversations' || rawScreen === 'insights' ? 'customers' : rawScreen;

  useEffect(() => {
    if (merchant?.primaryColor)
      document.documentElement.style.setProperty('--merchant-brand', merchant.primaryColor);
  }, [merchant?.primaryColor]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--density-pad',
      tweaks.density === 'cozy' ? '0.92' : '1',
    );
  }, [tweaks.density]);

  const nav = (id) => {
    setNavOpen(false);
    navigate('/' + (id === 'overview' ? '' : id));
  };

  if (merchantState?.loading && !merchantState?.capabilities) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-3)',
          fontSize: 14,
        }}
      >
        Cargando negocio…
      </div>
    );
  }

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '') + (navOpen ? ' nav-open' : '')}>
      {/* Below 1080 the sidebar leaves the grid and becomes a drawer. The scrim
          both dims the page and gives the drawer a dismiss target — a drawer you
          can only close from its own button is a trap on a touch screen. */}
      <div
        className="side-scrim"
        onClick={() => setNavOpen(false)}
        role="button"
        tabIndex={-1}
        aria-label="Cerrar el menú"
      />
      <Sidebar
        active={screen}
        onChange={nav}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        merchantName={merchantName}
        navItems={merchantState?.visibleModules}
        merchants={merchantState?.merchants}
        selectedMerchantId={merchantState?.selectedMerchantId}
        onMerchantChange={merchantState?.setSelectedMerchantId}
        onSignOut={signOut}
      />
      <main className="main">
        <Topbar
          merchant={merchantName || 'Umi Dash'}
          onMenu={() => setNavOpen(true)}
          screen={screen}
          merchantName={merchantName}
          locations={merchantState?.capabilities?.locations || []}
          selectedLocationId={merchantState?.selectedLocationId}
          onLocationChange={merchantState?.setSelectedLocationId}
          connection={connection}
        />
        <div className="screen-body" key={screen}>
          <Routes>
            {/* `index` was the ONE route with no guard. An un-entitled café landed
                on a live-looking Overview — "EN VIVO · UMI CASH" over empty dashes —
                which reads as "no activity today" rather than "you do not have this
                product". `staff` and `settings` had the same hole. */}
            <Route
              index
              element={
                <GuardedScreen moduleKey="overview">
                  <OverviewScreen
                    onNavigate={nav}
                    ordersPaused={ordersPaused}
                    setOrdersPaused={setOrdersPaused}
                  />
                </GuardedScreen>
              }
            />
            <Route
              path="operations"
              element={
                <GuardedScreen
                  moduleKey="operations"
                  moduleName="Centro operativo"
                  product="Dashboard"
                >
                  <OperationsScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="orders"
              element={
                <GuardedScreen moduleKey="orders">
                  <OrdersScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="devices"
              element={
                <GuardedScreen moduleKey="devices">
                  <DevicesScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="staff"
              element={
                <GuardedScreen moduleKey="staff">
                  <StaffScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="customers/*"
              element={
                <GuardedScreen moduleKey="customers">
                  <CustomersScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="members"
              element={
                <GuardedScreen moduleKey="members">
                  <MembersScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="gift-cards"
              element={
                <GuardedScreen moduleKey="gift-cards">
                  <GiftCardsScreen />
                </GuardedScreen>
              }
            />
            <Route path="insights" element={<Navigate to="/customers" replace />} />
            <Route
              path="conversations/*"
              element={<Navigate to="/customers?filter=whatsapp" replace />}
            />
            <Route
              path="hours"
              element={
                <GuardedScreen moduleKey="hours">
                  <HoursScreen ordersPaused={ordersPaused} setOrdersPaused={setOrdersPaused} />
                </GuardedScreen>
              }
            />
            <Route
              path="settings"
              element={
                <GuardedScreen moduleKey="settings">
                  <SettingsScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="products-billing"
              element={
                <GuardedScreen moduleKey="products-billing">
                  <ProductsBillingScreen />
                </GuardedScreen>
              }
            />
            {/* Platform, not café. The screen also re-checks the grant itself: a route
                is reachable by URL whether or not the sidebar offers it, and the two
                checks read the same `platformRole`. */}
            <Route
              path="cafes"
              element={
                <GuardedScreen moduleKey="cafes">
                  <CafesScreen />
                </GuardedScreen>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      {CFG.environment === 'development' && (
        <TweaksPanel title="Ajustes de desarrollo">
          <TweakSection title="Wallet card brand">
            <TweakColor
              label="Quick merchant"
              value={tweaks.merchantHue}
              options={['#B5605A', '#223979', '#5B7A4C', '#B5812A', '#7692CB', '#1F1410']}
              onChange={(v) => {
                setTweak('merchantHue', v);
                document.documentElement.style.setProperty('--merchant-brand', v);
              }}
            />
          </TweakSection>
          <TweakSection title="Density">
            <TweakRadio
              label="Spacing"
              value={tweaks.density}
              options={['cozy', 'comfy']}
              onChange={(v) => setTweak('density', v)}
            />
          </TweakSection>
          <TweakSection title="Language">
            <TweakRadio
              label="Greeting"
              value={tweaks.lang}
              options={['es', 'en']}
              onChange={(v) => setTweak('lang', v)}
            />
          </TweakSection>
          <TweakSection title="Sidebar">
            <TweakToggle
              label="Collapsed"
              value={collapsed}
              onChange={() => setCollapsed((c) => !c)}
            />
          </TweakSection>
          <TweakSection title="Operations">
            <TweakToggle
              label="WhatsApp orders paused"
              value={ordersPaused}
              onChange={() => setOrdersPaused((p) => !p)}
            />
          </TweakSection>
        </TweaksPanel>
      )}
    </div>
  );
}

function RequireAuth({ children }) {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-3)',
          fontSize: 14,
        }}
      >
        Cargando…
      </div>
    );
  return session ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <MerchantProvider>
              <DashboardLayout />
            </MerchantProvider>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
