import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CASH_TABS,
  allowedCashTabs,
  canCashAction,
  canShowCashTab,
  cashTabForRoute,
  firstAllowedCashTab,
  preferredCashLandingTab,
  resolveCashTabRoute,
} from './cash-tabs.js';

/**
 * The fixtures are the seeded café role grants, not a hand-written permission
 * list. `config/umipos-pilot-role-grants.json` is the same matrix the live
 * role-surface gate reads; a test that invents a shorter list proves a UI, not
 * the product.
 */
const roleGrants = JSON.parse(
  readFileSync(new URL('../../../../config/umipos-pilot-role-grants.json', import.meta.url)),
);

function permissionsFor(role) {
  const profile = roleGrants.profiles.find((item) => item.role === role);
  if (!profile) throw new Error(`missing seeded role: ${role}`);
  return profile.permissions;
}

function capabilitiesFor(role) {
  return {
    products: { cash: { status: 'active' } },
    membership: { role, permissions: permissionsFor(role) },
  };
}

const owner = capabilitiesFor('owner');
const cashier = capabilitiesFor('cashier');
const viewer = capabilitiesFor('viewer');
const nonmember = { products: {}, membership: null };

const ids = (capabilities) => allowedCashTabs(capabilities).map((tab) => tab.id);

describe('Cash hub tab gates', () => {
  it('shows every tab to the owner', () => {
    expect(ids(owner)).toEqual([
      'home',
      'scan',
      'members',
      'rewards',
      'gift-cards',
      'wallet',
      'settings',
    ]);
  });

  it('shows operational tabs (including scan) to the cashier but not the issue command', () => {
    expect(ids(cashier)).toEqual(['home', 'scan', 'members', 'rewards', 'gift-cards', 'wallet']);
    expect(canCashAction('issue', cashier)).toBe(false);
    expect(canCashAction('redeem', cashier)).toBe(true);
    expect(canCashAction('scan', cashier)).toBe(true);
    expect(canCashAction('seals', cashier)).toBe(false);
  });

  it('hides scan and gift cards from a viewer, who is read-only', () => {
    // The seeded viewer holds loyalty.read and wallet.read, not loyalty.reward.redeem or gift_card.read.
    expect(ids(viewer)).toEqual(['home', 'members', 'rewards', 'wallet']);
    expect(canShowCashTab('gift-cards', viewer)).toBe(false);
    expect(canShowCashTab('scan', viewer)).toBe(false);
  });

  it('shows no tab to a nonmember, even with the product key present', () => {
    expect(ids(nonmember)).toEqual([]);
    expect(firstAllowedCashTab(nonmember)).toBeNull();
  });

  it('lets a merchant.manage-only membership enter the settings tab', () => {
    const settingsOnly = {
      products: { cash: { status: 'active' } },
      membership: { role: 'owner', permissions: ['merchant.manage'] },
    };
    expect(ids(settingsOnly)).toEqual(['settings']);
    expect(firstAllowedCashTab(settingsOnly)).toBe('settings');
  });

  it('opens the first allowed tab, in hub order, and lands mobile baristas on scan', () => {
    expect(firstAllowedCashTab(owner)).toBe('home');
    expect(firstAllowedCashTab(viewer)).toBe('home');
    expect(preferredCashLandingTab(owner, { isMobile: true })).toBe('home');
    expect(preferredCashLandingTab(cashier, { isMobile: false })).toBe('home');
    expect(preferredCashLandingTab(cashier, { isMobile: true })).toBe('scan');
  });

  it('keeps the hub order stable when a tab is filtered out', () => {
    expect(CASH_TABS.map((tab) => tab.id)).toEqual([
      'home',
      'scan',
      'members',
      'rewards',
      'gift-cards',
      'wallet',
      'settings',
    ]);
  });
});

describe('Cash action gates', () => {
  it('lets the owner register, see contact, bulk-credit seals and issue a gift card', () => {
    expect(canCashAction('register', owner)).toBe(true);
    expect(canCashAction('contact', owner)).toBe(true);
    expect(canCashAction('issue', owner)).toBe(true);
    expect(canCashAction('redeem', owner)).toBe(true);
    expect(canCashAction('seals', owner)).toBe(true);
  });

  it('lets the cashier register and redeem, but not see contact or issue', () => {
    expect(canCashAction('register', cashier)).toBe(true);
    expect(canCashAction('contact', cashier)).toBe(false);
    expect(canCashAction('issue', cashier)).toBe(false);
    expect(canCashAction('redeem', cashier)).toBe(true);
  });

  it('keeps the viewer read-only', () => {
    expect(canCashAction('register', viewer)).toBe(false);
    expect(canCashAction('contact', viewer)).toBe(false);
    expect(canCashAction('issue', viewer)).toBe(false);
    expect(canCashAction('redeem', viewer)).toBe(false);
  });

  it('answers false for an unknown action rather than opening it', () => {
    expect(canCashAction('not-a-cash-action', owner)).toBe(false);
  });
});

describe('routed Cash tabs', () => {
  it('renders a tab the membership may read', () => {
    expect(resolveCashTabRoute('gift-cards', cashier)).toEqual({
      kind: 'render',
      tab: 'gift-cards',
      fallback: 'home',
    });
  });

  it('renders the settings tab for merchant.manage and denies it to a cashier', () => {
    expect(resolveCashTabRoute('settings', owner)).toEqual({
      kind: 'render',
      tab: 'settings',
      fallback: 'home',
    });
    expect(resolveCashTabRoute('settings', cashier)).toEqual({
      kind: 'denied',
      tab: 'settings',
      fallback: 'home',
    });
  });

  it('denies a known tab with a safe fallback instead of mounting it', () => {
    expect(resolveCashTabRoute('gift-cards', viewer)).toEqual({
      kind: 'denied',
      tab: 'gift-cards',
      fallback: 'home',
    });
  });

  it('redirects an unknown segment to the first allowed tab', () => {
    expect(resolveCashTabRoute('not-a-tab', owner)).toEqual({
      kind: 'redirect',
      tab: 'home',
      fallback: 'home',
    });
  });

  it('accepts the old bookmark names and umi-cash admin segments', () => {
    expect(cashTabForRoute('/gift-cards/')).toBe('gift-cards');
    expect(cashTabForRoute('giftcards')).toBe('gift-cards');
    expect(cashTabForRoute('members')).toBe('members');
    expect(cashTabForRoute('customers')).toBe('members');
    expect(cashTabForRoute('scan')).toBe('scan');
    expect(cashTabForRoute('topup')).toBe('wallet');
    expect(cashTabForRoute('unknown')).toBeNull();
  });

  it('returns no route for a membership with no tab', () => {
    expect(resolveCashTabRoute('members', nonmember)).toEqual({
      kind: 'denied',
      tab: 'members',
      fallback: null,
    });
  });
});
