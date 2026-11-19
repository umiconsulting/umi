/**
 * The Cash merchant hub: tabs and the permission each one needs.
 *
 * The module registry answers "may this café open Lealtad y valor at all?".
 * It does not answer "may this person open the gift-card tab?" — the module
 * grants any of `loyalty.read`, `gift_card.read`, `wallet.read`, and a viewer
 * can hold only one of them. This file is the second gate. It names the
 * `umi.permission` keys the seeded café roles already carry; it does not
 * invent a role vocabulary.
 *
 * THE TAB GATE IS NOT AUTHORIZATION. The API still decides each read and
 * write. This gate stops the client from mounting a screen that would fetch
 * data the person cannot read, and it gives the person a sentence that says
 * what is missing instead of an empty table.
 *
 * Order is the order the hub shows, and the first allowed tab is the landing
 * tab. Keep both facts here so a route builder, a test, and the screen cannot
 * disagree.
 */
import { msg } from '@lingui/core/macro';

export const CASH_TABS = [
  {
    id: 'members',
    label: msg`Lealtad`,
    // The member list and member detail read under `loyalty.read`.
    permissions: ['loyalty.read'],
    actions: {
      // The register dialog writes a customer. `customer.create` is the seeded
      // café key for that act; it is not a new permission.
      register: ['customer.create'],
      // Phone and email are contact data. Every other member field stays
      // visible when this key is absent.
      contact: ['customer.contact.read'],
    },
  },
  {
    id: 'rewards',
    label: msg`Recompensas`,
    // The reward configuration read is `loyalty.read`; its write is
    // `merchant.manage`. The tab is a read surface with a write action.
    permissions: ['loyalty.read'],
    actions: {
      configure: ['merchant.manage'],
    },
  },
  {
    id: 'gift-cards',
    label: msg`Tarjetas de regalo`,
    permissions: ['gift_card.read'],
    actions: {
      issue: ['gift_card.issue'],
      redeem: ['gift_card.redeem'],
    },
  },
  {
    id: 'wallet',
    label: msg`Monedero`,
    permissions: ['wallet.read'],
    actions: {
      topup: ['wallet.authorize'],
      purchase: ['wallet.redeem'],
    },
  },
];

/**
 * Route aliases. The old screens lived at `/members` and `/gift-cards`; their
 * bookmarks still arrive with those names. The hub itself uses the tab id.
 */
const ROUTE_ALIASES = {
  members: 'members',
  loyalty: 'members',
  rewards: 'rewards',
  'gift-cards': 'gift-cards',
  giftcards: 'gift-cards',
  gift_cards: 'gift-cards',
  wallet: 'wallet',
};

export function cashTabForRoute(route) {
  const key = String(route || '')
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '')
    .toLowerCase();
  return ROUTE_ALIASES[key] || null;
}

export function cashTabConfig(tabId) {
  return CASH_TABS.find((tab) => tab.id === tabId) || null;
}

/** Does the membership hold this exact key? `*` is the platform wildcard. */
export function hasCashPermission(capabilities, permission) {
  const permissions = capabilities?.membership?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}

/** A tab is visible when the membership holds ANY of the tab's read keys. */
export function canShowCashTab(tabId, capabilities) {
  const tab = cashTabConfig(tabId);
  if (!tab) return false;
  return tab.permissions.some((permission) => hasCashPermission(capabilities, permission));
}

/** Visible tabs, in hub order. */
export function allowedCashTabs(capabilities) {
  return CASH_TABS.filter((tab) => canShowCashTab(tab.id, capabilities));
}

/** The tab the hub opens when the URL names no tab. */
export function firstAllowedCashTab(capabilities) {
  return allowedCashTabs(capabilities)[0]?.id || null;
}

/** An action gate. The action name is unique across the hub. */
export function canCashAction(action, capabilities) {
  for (const tab of CASH_TABS) {
    const gate = tab.actions?.[action];
    if (gate) return gate.some((permission) => hasCashPermission(capabilities, permission));
  }
  return false;
}

/**
 * What a routed tab should do.
 *
 * - `render`  the tab is allowed; mount it and let it read.
 * - `denied`  the tab exists but this membership cannot read it. Do not mount
 *             the tab; show the denial state and the first allowed tab.
 * - `redirect` the URL names no known tab; send the person to the first
 *             allowed tab. An unknown segment is a wrong link, not a refusal.
 */
export function resolveCashTabRoute(route, capabilities) {
  const fallback = firstAllowedCashTab(capabilities);
  const tabId = cashTabForRoute(route);
  if (!tabId) return { kind: 'redirect', tab: fallback, fallback };
  if (!canShowCashTab(tabId, capabilities)) {
    return { kind: 'denied', tab: tabId, fallback };
  }
  return { kind: 'render', tab: tabId, fallback };
}
