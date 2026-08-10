import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';

import { useAuth, signOut } from '@/lib/auth.jsx';
import { MerchantProvider, useMerchant } from '@/lib/merchant-context.jsx';
import {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakColor,
  TweakRadio,
  TweakToggle,
} from './tweaks-panel.jsx';
import { useMerchantData, useKdsConnection } from './data.jsx';
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
import OperationsScreen from '@/screens/operations.jsx';

const TWEAK_DEFAULTS = { merchantHue: '#1A5632', density: 'comfy', lang: 'es' };

function ProductUnavailable({ moduleName = 'Modulo', product = 'producto' }) {
  return (
    <div
      className="card fade-up"
      style={{
        padding: '38px 34px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 24,
      }}
    >
      <div>
        <div className="sec-index" style={{ marginBottom: 12 }}>
          <span className="nn">OFF</span>
          <span>/</span>
          <span>PRODUCTO NO ACTIVO</span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 24 }}>
          {moduleName} no esta activo para este merchant
        </h2>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', maxWidth: 620 }}>
          Este modulo depende de {product}. El super admin puede revisarlo en Products & Billing,
          pero no hay controles operativos hasta activar el producto.
        </div>
      </div>
    </div>
  );
}

function GuardedScreen({ moduleKey, moduleName, product, children }) {
  const merchantState = useMerchant();
  if (!merchantState?.canShowModule?.(moduleKey)) {
    return <ProductUnavailable moduleName={moduleName} product={product} />;
  }
  return children;
}

function DashboardLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
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

  const nav = (id) => navigate('/' + (id === 'overview' ? '' : id));

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
        Cargando merchant...
      </div>
    );
  }

  return (
    <div className={'app' + (collapsed ? ' collapsed' : '')}>
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
          status="ACTIVE"
          screen={screen}
          merchantName={merchantName}
          locations={merchantState?.capabilities?.locations || []}
          selectedLocationId={merchantState?.selectedLocationId}
          onLocationChange={merchantState?.setSelectedLocationId}
          connection={connection}
        />
        <div className="screen-body" key={screen}>
          <Routes>
            <Route
              index
              element={
                <OverviewScreen
                  onNavigate={nav}
                  ordersPaused={ordersPaused}
                  setOrdersPaused={setOrdersPaused}
                />
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
                <GuardedScreen moduleKey="orders" moduleName="Pedidos" product="KDS">
                  <OrdersScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="devices"
              element={
                <GuardedScreen moduleKey="devices" moduleName="Devices" product="Dashboard">
                  <DevicesScreen />
                </GuardedScreen>
              }
            />
            <Route path="staff" element={<StaffScreen />} />
            <Route
              path="customers/*"
              element={
                <GuardedScreen moduleKey="customers" moduleName="Customers" product="Dashboard">
                  <CustomersScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="members"
              element={
                <GuardedScreen moduleKey="members" moduleName="Loyalty" product="Umi Cash">
                  <MembersScreen />
                </GuardedScreen>
              }
            />
            <Route
              path="gift-cards"
              element={
                <GuardedScreen moduleKey="gift-cards" moduleName="Gift Cards" product="Umi Cash">
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
                <GuardedScreen moduleKey="hours" moduleName="Hours" product="ConversaFlow">
                  <HoursScreen ordersPaused={ordersPaused} setOrdersPaused={setOrdersPaused} />
                </GuardedScreen>
              }
            />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="products-billing" element={<ProductsBillingScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      <TweaksPanel title="Tweaks">
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
