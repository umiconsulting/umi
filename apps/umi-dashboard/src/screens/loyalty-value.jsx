import { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';
import MembersScreen from './members.jsx';
import GiftCardsScreen from './gift-cards.jsx';

// Lealtad y valor — customer value under one roof. Loyalty and gift cards keep their
// full screens as tabs; rewards and wallet get their first real home from the
// authorized workspace. Wallet funding stays read-only by product policy.
const TABS = [
  { id: 'members', label: msg`Lealtad` },
  { id: 'rewards', label: msg`Recompensas` },
  { id: 'gift-cards', label: msg`Tarjetas de regalo` },
  { id: 'wallet', label: msg`Monedero` },
];

export default function LoyaltyValueScreen() {
  const { t, i18n } = useLingui();
  const [tab, setTab] = useState('members');
  const tabs = TABS.map((item) => ({ ...item, label: i18n._(item.label) }));
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={tabs} active={tab} onChange={setTab} ariaLabel={t`Lealtad y valor`} />
      {tab === 'members' && <MembersScreen />}
      {tab === 'gift-cards' && <GiftCardsScreen />}
      {tab === 'rewards' && <DomainWorkspace key="rewards" domain="rewards" />}
      {tab === 'wallet' && <DomainWorkspace key="wallet" domain="wallet" />}
    </div>
  );
}
