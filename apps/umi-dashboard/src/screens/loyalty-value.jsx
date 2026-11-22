import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Trans, useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import {
  CASH_TABS,
  allowedCashTabs,
  cashTabConfig,
  hasCashPermission,
  resolveCashTabRoute,
} from '@/lib/cash-tabs.js';
import PermissionUnavailable from '@/components/permission-unavailable.jsx';
import { useMerchantData } from '@/data.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';
import CashHomeScreen from './cash-home.jsx';
import CashScanScreen from './cash-scan.jsx';
import MembersScreen from './members.jsx';
import GiftCardsScreen from './gift-cards.jsx';
import CashSettingsScreen from './cash-settings.jsx';
import './loyalty-value.css';

/**
 * Lealtad y valor — customer value under one roof.
 *
 * The tab is a ROUTE (`/loyalty-value/:tab`), not component state. Three
 * consequences, all wanted:
 *
 *   1. a bookmark opens the tab it names;
 *   2. the back button moves between tabs;
 *   3. an unauthorized tab is refused BEFORE its screen mounts, so it cannot
 *      fire the read that would 403. The old state-only tabs mounted every
 *      component behind a conditional and fetched on the first frame.
 */
export default function LoyaltyValueScreen() {
  const { t, i18n } = useLingui();
  const { tab: routeTab } = useParams();
  const navigate = useNavigate();
  const merchant = useMerchant();
  const { data: merchantData, loading: merchantDataLoading } = useMerchantData();
  const capabilities = merchant?.capabilities;
  const allowed = allowedCashTabs(capabilities);
  const fallbackTab = allowed[0] || null;
  const rewardConfig = merchantData?.rewardConfig;

  const summary = [];
  if (hasCashPermission(capabilities, 'loyalty.read')) {
    summary.push({
      id: 'reward',
      label: <Trans>Recompensa</Trans>,
      value: rewardConfig?.rewardName || t`Sin configurar`,
      meta: rewardConfig ? t`${rewardConfig.visitsRequired || 0} visitas` : t`Sin meta activa`,
    });
  }
  summary.push({
    id: 'access',
    label: <Trans>Secciones disponibles</Trans>,
    value: `${allowed.length}`,
    meta: t`de ${CASH_TABS.length} secciones`,
  });
  if (hasCashPermission(capabilities, 'wallet.read')) {
    summary.push({
      id: 'wallet',
      label: <Trans>Monedero</Trans>,
      value: t`Activo`,
      meta: t`Consulta y recargas`,
    });
  }

  if (!fallbackTab) {
    return (
      <div className="cash-screen">
        <PermissionUnavailable
          title={t`Lealtad y valor`}
          permissions={['loyalty.read', 'gift_card.read', 'wallet.read']}
        />
      </div>
    );
  }

  if (!routeTab) {
    return <Navigate to={`/loyalty-value/${fallbackTab.id}`} replace />;
  }

  const resolution = resolveCashTabRoute(routeTab, capabilities);

  if (resolution.kind === 'redirect') {
    return <Navigate to={`/loyalty-value/${fallbackTab.id}`} replace />;
  }

  if (resolution.kind === 'denied') {
    const requested = cashTabConfig(resolution.tab);
    return (
      <div className="cash-screen">
        <PermissionUnavailable
          title={requested ? i18n._(requested.label) : resolution.tab}
          permissions={requested?.permissions || []}
          backLabel={i18n._(fallbackTab.label)}
          onBack={() => navigate(`/loyalty-value/${fallbackTab.id}`, { replace: true })}
        />
      </div>
    );
  }

  const activeTab = resolution.tab;
  const tabs = allowed.map((item) => ({ ...item, label: i18n._(item.label) }));
  const showSummaryBanner = activeTab !== 'home' && activeTab !== 'scan';

  return (
    <div className="fade-up cash-hub" data-active-cash-tab={activeTab}>
      {showSummaryBanner ? (
        <section className="cash-summary" aria-label={t`Resumen de Lealtad y valor`}>
          {summary.map((item) => (
            <div className="cash-summary-item" key={item.id}>
              <span className="cash-kicker">{item.label}</span>
              <span className="cash-summary-value">{item.value}</span>
              <span className="cash-summary-meta">{item.meta}</span>
            </div>
          ))}
        </section>
      ) : null}
      <HubTabs
        tabs={tabs}
        active={activeTab}
        onChange={(id) => navigate(`/loyalty-value/${id}`)}
        ariaLabel={t`Lealtad y valor`}
      />
      {activeTab === 'home' && <CashHomeScreen />}
      {activeTab === 'scan' && <CashScanScreen />}
      {activeTab === 'members' && <MembersScreen />}
      {activeTab === 'gift-cards' && <GiftCardsScreen />}
      {activeTab === 'rewards' && <DomainWorkspace key="rewards" domain="rewards" />}
      {activeTab === 'wallet' && <DomainWorkspace key="wallet" domain="wallet" />}
      {activeTab === 'settings' &&
        (merchantData ? (
          <CashSettingsScreen
            key={merchant?.selectedMerchantId || merchantData.handle || 'cash-settings'}
            merchant={merchantData}
          />
        ) : (
          <CashSettingsScreen merchant={null} loading={merchantDataLoading} />
        ))}
    </div>
  );
}
