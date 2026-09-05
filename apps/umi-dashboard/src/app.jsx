import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { applyMerchantLocale, activateLocale } from '@/lib/i18n.js';

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
import LoyaltyValueScreen from '@/screens/loyalty-value.jsx';
import CustomersScreen from '@/screens/customers.jsx';
import HoursScreen from '@/screens/hours.jsx';
import SettingsScreen from '@/screens/settings.jsx';
import ProductsBillingScreen from '@/screens/products-billing.jsx';
import CafesScreen from '@/screens/cafes.jsx';
import OperationsScreen from '@/screens/operations.jsx';
import CashShiftsScreen from '@/screens/cash-shifts.jsx';
import CatalogInventoryScreen from '@/screens/catalog-inventory.jsx';
import DiagnosticsScreen from '@/screens/diagnostics.jsx';
import CocinaScreen from '@/screens/cocina.jsx';
import ProfileScreen from '@/screens/profile.jsx';

const TWEAK_DEFAULTS = { merchantHue: '#1A5632', density: 'comfy' };

const msgCloseMenu = msg`Cerrar el menú`;

/** Product keys as an operator reads them, not as the entitlement table stores them. */
const PRODUCT_LABELS = {
  dashboard: 'Umi Dashboard',
  kds: 'KDS',
  cash: 'Umi Cash',
  conversaflow: 'ConversaFlow',
};

/** Refusal for a screen the café does not own the product for. */
function ProductUnavailable({ moduleName, product }) {
  const { t } = useLingui();
  const name = moduleName || t`Módulo`;
  const productName = product || t`producto`;
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
          <Trans>{name} no está activo en este café</Trans>
        </h2>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 620 }}>
          <Trans>
            Esta sección necesita {productName}. El super admin lo puede revisar en Productos y
            facturación; no hay controles hasta activar el producto.
          </Trans>
        </div>
      </div>
    </div>
  );
}

/** Refusal for a screen that needs a platform grant — an axis cafés do not carry. */
function PlatformOnly({ moduleName }) {
  const { t } = useLingui();
  const name = moduleName || t`Esta pantalla`;
  return (
    <div className="alert danger">
      <span className="strip" />
      <I.AlertTriangle className="ico" size={18} />
      <div className="body">
        <div className="ttl">
          <Trans>Acceso de plataforma requerido</Trans>
        </div>
        <div className="sub">
          <Trans>{name} es para operadores de Umi.</Trans>
        </div>
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
  const { i18n } = useLingui();
  if (!merchantState?.canShowModule?.(moduleKey)) {
    const mod = MODULES[moduleKey] || {};
    const label = mod.label ? i18n._(mod.label) : moduleKey;
    return mod.platform && !mod.product ? (
      <PlatformOnly moduleName={label} />
    ) : (
      <ProductUnavailable
        moduleName={label}
        product={PRODUCT_LABELS[mod.product] || mod.product || undefined}
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
  const { i18n } = useLingui();
  const { session } = useAuth();
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

  // The café record carries a locale ("es-MX"). It only speaks when the owner has
  // not picked a language in this browser; a saved choice always wins.
  const merchantLocale = merchantState?.selectedMerchant?.locale || merchant?.locale;
  useEffect(() => {
    if (merchantLocale) applyMerchantLocale(merchantLocale);
  }, [merchantLocale]);

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
        <Trans>Cargando negocio…</Trans>
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
        aria-label={i18n._(msgCloseMenu)}
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
          canSwitchLocations={merchantState?.capabilities?.canSwitchLocations === true}
          selectedLocationId={merchantState?.selectedLocationId}
          onLocationChange={merchantState?.setSelectedLocationId}
          connection={connection}
          onProfile={() => nav('profile')}
          profileActive={screen === 'profile'}
          userName={session?.user?.displayName}
          userEmail={session?.user?.email}
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
                <GuardedScreen moduleKey="operations">
                  <OperationsScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="cash-shifts"
              element={
                <GuardedScreen moduleKey="cash-shifts">
                  <CashShiftsScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="catalog-inventory"
              element={
                <GuardedScreen moduleKey="catalog-inventory">
                  <CatalogInventoryScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="diagnostics"
              element={
                <GuardedScreen moduleKey="diagnostics">
                  <DiagnosticsScreen />
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
              path="kitchen"
              element={
                <GuardedScreen moduleKey="kitchen">
                  <CocinaScreen />
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
              path="loyalty-value"
              element={
                <GuardedScreen moduleKey="loyalty-value">
                  <LoyaltyValueScreen />
                </GuardedScreen>
              }
            />
            {/* Old single-domain routes fold into the Lealtad y valor hub. Keep the
                paths as redirects so no bookmark 404s. */}
            <Route path="members" element={<Navigate to="/loyalty-value" replace />} />
            <Route path="gift-cards" element={<Navigate to="/loyalty-value" replace />} />
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
            {/* Personal, not café-scoped: every signed-in operator reaches their
                own profile, whatever product the selected café owns. RequireAuth
                already gates it, so it needs no GuardedScreen. */}
            <Route path="profile" element={<ProfileScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      {/* Developer-only panel: its labels are not owner copy, so they stay in English. */}
      {/* eslint-disable lingui/no-unlocalized-strings */}
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
              label="Locale"
              value={i18n.locale}
              options={['es', 'en']}
              onChange={(v) => activateLocale(v)}
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
      {/* eslint-enable lingui/no-unlocalized-strings */}
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
        <Trans>Cargando…</Trans>
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
