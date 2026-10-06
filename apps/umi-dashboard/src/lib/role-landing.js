/**
 * Which screen a role opens, and what that screen must show.
 *
 * The rule this file implements is workstream C of the plan of record
 * (`docs/plans/2026-09-15-ultimate-platform-plan.md` §8C):
 *
 *   "Every role opens the screen that role needs, not the owner screen with
 *    fewer buttons."
 *
 * The authority for WHICH screen is the sibling research file
 * (`docs/research/2026-09-15-ux-patterns-and-design-north-star.md` §3.2, "First
 * screen per role"). Every entry below cites the row it answers from, and where
 * the product does not have the screen the research names, it says what was
 * chosen instead and why.
 *
 * TWO AXES, both already in the app, neither re-derived here:
 *
 *   roleKey      `capabilities.membership.role` — the CAFÉ role the API
 *                normalized for this membership (apps/umi-api/src/modules/auth/
 *                roles.ts, `normalizeRoleKey`, highest precedence first:
 *                super_admin > owner > admin > manager > supervisor > cashier >
 *                developer > staff > viewer). A CUSTOM key is a supported case
 *                there (`RoleKey` keeps `(string & {})`), so this file treats an
 *                unknown key as a first-class input rather than an error. The
 *                vocabulary is READ, not imported: the Dashboard must not pull
 *                an API source file into its browser bundle.
 *   permissions  `capabilities.membership.permissions` — the same list the
 *                module registry gates on.
 *
 * NOTHING HERE IS A SECOND GATE. `landingRouteFor` asks the module registry
 * whether the role can see the module, and a caller that has the full capability
 * set hands in the registry's own `canShowModule` (product entitlement and
 * platform grant included). A route this file returns is therefore a route
 * `GuardedScreen` would admit — the client hides, and the API still decides.
 *
 * WHERE THE RESOLVER SPEAKS AND WHERE IT IS SILENT. It returns a route to open,
 * or `null`. `null` means "no screen this file can place the role on" — the
 * caller must then leave the operator where they are rather than invent a
 * destination. `/` is deliberately unreachable from the fallback chain below,
 * so a role with no cited first screen is never parked on the owner's home.
 */

import { MODULES, hasRequiredPermission } from './module-registry.js';

/**
 * The module behind a route, and the route a module lives at.
 *
 * Derived from the module id instead of a second hand-written table: the shell
 * navigates with `navigate('/' + id)` (`app.jsx`, `nav()`), and `overview` is the
 * one module whose route is the bare root. A route with no module behind it is
 * not a landing this file will return — `landingRouteFor` can only answer for a
 * module the registry gates, so an invented path can never leak out of it.
 */
export function moduleForRoute(route) {
  const key = String(route || '')
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '');
  return key === '' ? 'overview' : key;
}

export function routeForModule(moduleKey) {
  return moduleKey === 'overview' ? '/' : `/${moduleKey}`;
}

/**
 * One first screen per role, as a route.
 *
 * NOT IN THIS MAP, on purpose — and each omission is a finding, not an oversight:
 *
 *   viewer (`Consulta`) and any role this map does not name. §3.2 carries no
 *   read-only row, so there is no first screen to cite. These roles take
 *   `FALLBACK_ORDER` below, which cannot reach `/`.
 *
 *   staff — the legacy catch-all café role. Neither §3.2 nor the plan's §8C step
 *   2 role table (Dueño / Encargado / Supervisor / Cajero / Mesero / Cocina /
 *   Anfitrión / Consulta / Plataforma) names it, so there is nothing to cite.
 *   It takes the fallback too.
 *
 *   super_admin and developer — platform grants, "Umi staff, never a merchant
 *   role" (§8C step 2, Plataforma). §3.2 names no first screen for them, and
 *   their own screens (`/cafes`, `/products-billing`) are not a role's first
 *   screen in that table. They take the fallback.
 *
 * Waiter, kitchen and host are POS roles. §3.2's "Table map with the assigned
 * section", "Kitchen board for one station" and "Wait list and table map" are
 * POS surfaces — workstreams D and H — and must not be faked with a Dashboard
 * route here.
 */
export const ROLE_LANDING = {
  // §3.2 Owner — "Dashboard home". §8C step 2, Dueño: "reads money and trend,
  // not operations". `/` is the Dashboard home (the `overview` module).
  owner: '/',
  // §3.2 has no administrator row. The vendor models this table is built from
  // give the café one authority level (Square's "Full"), §8C step 2 names no
  // screen above Encargado, and the registry treats owner and admin alike: the
  // administrator opens the same home.
  admin: '/',
  // §3.2 "Manager on shift — Shift board" (labor against plan, open draws, voids
  // and refunds, low stock, unresolved alerts) and §3.2 "Supervisor — Floor and
  // service board". The Dashboard ships NEITHER: the floor map is workstream D
  // and has no route yet. `/operations` (Centro operativo) is the nearest
  // existing surface — the hub the registry already points at for exactly these
  // domains (audit, inventory, sale exceptions, the cash shift, the kitchen) —
  // so both roles land there until the shift board and the floor board exist.
  manager: '/operations',
  supervisor: '/operations',
  // §3.2 "Cashier — Tender screen with the current cart". That screen is the
  // POS's job (§8C step 2, Cajero: "takes money, opens and closes the till");
  // the till in the Dashboard is `cash-shifts`, which the cashier holds through
  // `cash.shift.read`.
  cashier: '/cash-shifts',
};

/**
 * Where a role with no cited first screen lands, and where a role whose cited
 * screen it cannot see falls back to.
 *
 * Ordered from the narrowest read surface to the widest operational one, and the
 * first entry the role can actually see wins. `/` is NOT in this list: the
 * Dashboard home is the owner's cited first screen, and a role that §3.2 gives
 * no screen to must not be parked there.
 */
export const FALLBACK_ORDER = [
  'customers', // customer.read — one customer record at a time
  'products', // catalog.read — what the shop sells
  'inventory', // inventory.read — what the shop holds
  'orders', // kitchen.read — the order list, read side
  'kitchen', // kitchen.read — the station board
  'loyalty-value', // loyalty.read / gift_card.read / wallet.read
  'cash-shifts', // cash.shift.read — the till and its records
  'reportes', // sale.lifecycle / sale.exception.read — the sales record
  'operations', // the widest read set in the registry; last for that reason
];

/** Trim and case-fold only: the API sends these keys lower-cased already. */
function normalizeRoleKey(roleKey) {
  return typeof roleKey === 'string' ? roleKey.trim().toLowerCase() : '';
}

/**
 * The permission-only availability check, for a caller with no capability set
 * yet (a unit test, or a shell that has not resolved the merchant).
 *
 * It is the registry's own gate — `hasRequiredPermission` against the module's
 * declared permissions — so no permission list is written twice.
 */
function permissionGate(permissions) {
  const capabilities = {
    membership: { permissions: Array.isArray(permissions) ? permissions : [] },
  };
  return (moduleKey) =>
    Boolean(MODULES[moduleKey]) && hasRequiredPermission(MODULES[moduleKey], capabilities);
}

/**
 * The first screen for this role.
 *
 * @param {object} input
 * @param {string} [input.roleKey]      normalized café role (`membership.role`)
 * @param {string[]} [input.permissions] `membership.permissions`
 * @param {(moduleKey: string) => boolean} [input.canShow] the registry's full
 *   availability check (`canShowModule`). Preferred when the caller has it: it
 *   adds product entitlement and the platform grant to the permission test.
 * @returns {string|null} a route to open, or null when nothing is admissible.
 */
export function landingRouteFor({ roleKey, permissions, canShow } = {}) {
  const isVisible = typeof canShow === 'function' ? canShow : permissionGate(permissions);
  // A route is only ever returned for a module the registry knows, so the answer
  // is always a screen `GuardedScreen` can name.
  const admitted = (moduleKey) => Boolean(MODULES[moduleKey]) && isVisible(moduleKey) === true;

  const cited = ROLE_LANDING[normalizeRoleKey(roleKey)];
  if (cited && admitted(moduleForRoute(cited))) return cited;

  for (const moduleKey of FALLBACK_ORDER) {
    if (admitted(moduleKey)) return routeForModule(moduleKey);
  }
  return null;
}

/*
 * §8C step 3 — ONE FIRST SCREEN PER ROLE, three numbers and three actions in the
 * first five seconds. Derived from §3.2's "Data shown at once" and "Data kept
 * hidden" columns, in the research file's own words. Where a cell names fewer
 * than three of a kind the gap is stated rather than filled: a missing third
 * action is a design decision, not a research finding, and inventing it here
 * would hide that from the plan.
 *
 *   Owner       numbers: sales today · sales this week · cash variance.
 *               actions: none named. Its screen must offer NO line-item entry,
 *               NO tender step and NO device pairing — the hidden column names
 *               all three, and they are the owner's forbidden actions.
 *               §8C step 2: reads money and trend, not operations.
 *   Manager     numbers: labor against plan · open draws · voids and refunds.
 *               actions: none named. §8C step 2: runs the shift, approves
 *               exceptions. Hidden: owner finance and payroll.
 *   Supervisor  numbers: late tickets · unserved items · void approvals.
 *               actions: staff assignment · void approvals (§8C step 2: approves
 *               inside a limit, cannot change policy). Hidden: full finance
 *               reports, permission setup.
 *   Cashier     numbers: total · change due · shift drawer state.
 *               actions: takes money · opens the till · closes the till (§8C
 *               step 2). Hidden: inventory cost, other staff shifts, permission
 *               setup.
 *   Waiter      numbers: guest count · time at table · unserved items.
 *               actions: serves tables · owns a section (§8C step 2). A POS
 *               surface — workstreams D and H, not a Dashboard route.
 *   Kitchen     numbers: tickets for the station · item counts · elapsed time.
 *               actions: advances each ticket to its next state (§3.2's "next
 *               state"); §8C step 2: works the board. A POS surface.
 *   Host        numbers: free tables · party size · wait time.
 *               actions: seats guests · manages the wait (§8C step 2) · next
 *               seating (§3.2). A POS surface.
 *   Consulta    numbers: none — §3.2 carries no read-only row. Actions: reads,
 *               changes nothing (§8C step 2). Takes FALLBACK_ORDER.
 *   Plataforma  not named by §3.2 at all; §8C step 2 calls Plataforma "Umi
 *               staff, never a merchant role". No first screen is defined here,
 *               so none is invented. Takes FALLBACK_ORDER.
 */
