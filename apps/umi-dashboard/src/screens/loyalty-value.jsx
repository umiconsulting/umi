import { useState } from 'react';
import { HubTabs } from '@/shell.jsx';
import { DomainWorkspace } from './operations-workspace.jsx';
import MembersScreen from './members.jsx';
import GiftCardsScreen from './gift-cards.jsx';

// Lealtad y valor — customer value under one roof. Loyalty and gift cards keep their
// full screens as tabs; rewards and wallet get their first real home from the
// authorized workspace. Wallet funding stays read-only by product policy.
const TABS = [
  { id: 'members', label: 'Lealtad' },
  { id: 'rewards', label: 'Recompensas' },
  { id: 'gift-cards', label: 'Gift cards' },
  { id: 'wallet', label: 'Wallet' },
];

export default function LoyaltyValueScreen() {
  const [tab, setTab] = useState('members');
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <HubTabs tabs={TABS} active={tab} onChange={setTab} ariaLabel="Lealtad y valor" />
      {tab === 'members' && <MembersScreen />}
      {tab === 'gift-cards' && <GiftCardsScreen />}
      {tab === 'rewards' && <DomainWorkspace key="rewards" domain="rewards" />}
      {tab === 'wallet' && <DomainWorkspace key="wallet" domain="wallet" />}
    </div>
  );
}
