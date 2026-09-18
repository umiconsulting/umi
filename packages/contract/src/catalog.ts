// The contract manifest: what every route accepts, returns, requires and can fail
// with, plus the model and invariant catalogues the artifact is generated from.
//
// `routeCatalog` is DERIVED from `ROUTE_TABLE` (./route-table.ts). It used to be a
// second hand-maintained list of paths, and it had already drifted from `routes.ts`
// on four routes. Paths are authored in exactly one place now.

import { API_ERROR_CODES, contractModels } from './platform';
import { httpModels } from './schemas';
import { deviceModels } from './device';
import { posCatalogModels } from './pos-catalog';
import { posCartModels } from './pos-cart';
import { posCheckoutModels } from './pos-checkout';
import { posOfflineModels } from './pos-offline';
import { posSaleModels } from './pos-sale';
import { posCashModels } from './pos-cash';
import { posExceptionModels } from './pos-exception';
import { posInventoryModels } from './pos-inventory';
import { procurementModels } from './procurement';
import { inventoryCostingModels } from './inventory-costing';
import { recipesModels } from './recipes';
import { posCustomerValueModels } from './pos-customer-value';
import { posHardwareModels } from './pos-hardware';
import { floorPlanModels } from './floor-plan';
import { tableStateModels } from './table-state';
import { tableOrderModels } from './table-order';
import { posKitchenModels } from './pos-kitchen';
import { dashboardOperationsModels } from './dashboard-operations';
import { tenderModels } from './tender';
import { mercadoPagoModels } from './mercado-pago';
import { realtimeModels } from './realtime';
import { ROUTE_TABLE, type RouteContract } from './route-table';
import type { ZodTypeAny } from 'zod';

/**
 * Semantic version of the generated artifact. This is NOT the URL major — see
 * `API_MAJOR_VERSION`. The two axes are deliberately separate: the artifact can go
 * to 3.x while the URL stays `/api/v1`, because the artifact versions the *shape of
 * the description* and the URL versions the *behaviour a field client depends on*.
 *
 * 2.0.0 — the POS, device and POS-auth surfaces moved under `/api/v1`. That is a
 * breaking change to the described paths, so the artifact major moves, even though
 * no client is pinned in the field yet and the URL major is unchanged at 1.
 */
/**
 * 2.20.0 — the POS kitchen command route (`pos.kitchenCommand`) and its request
 * shape, plus the four kitchen refusal codes a station-less till needs to tell
 * one refusal from another (§8H step 3, defect D33). Additive to the artifact:
 * no described path changed meaning, so the URL major stays at 1.
 */
/**
 * 2.21.0 — the console's inventory costing reads (`inventoryCosting.*`, workstream E
 * steps 5 and 6): per-item cost basis, per-plate cost and margin, per-day revenue
 * and cost of goods, and the low-stock forecast. Additive to the artifact: no
 * described path changed meaning, so the URL major stays at 1.
 */
/**
 * 2.22.0 — table-order intake (§8I step 2, ADR 2026-09-13 §9): the guest menu, the
 * place-an-order body and its answer, and the issue/revoke shapes for a table's
 * revocable QR credential. Additive to the artifact: the described path is public and
 * new, so nothing existing changed meaning and the URL major stays at 1.
 */
/**
 * 2.23.0 — the recipes and inventory authoring surface (recipes module plan §6): the
 * item, unit-conversion, allergen, recipe and supplier-invoice writes, and the
 * usage-variance, recipe-cost, menu-engineering and prep-list reads. Additive to the
 * artifact: no described path changed meaning, so the URL major stays at 1.
 */
export const CONTRACT_VERSION = '2.23.0';

/** The major in the URL. A v1 client never silently receives v2 behaviour. */
export const API_MAJOR_VERSION = 1;

export const errorCatalog = Object.fromEntries(
  API_ERROR_CODES.map((code) => [
    code,
    {
      public: true,
      retryable:
        code === 'RATE_LIMITED' || code === 'INTERNAL_ERROR' || code === 'PAYMENT_OUTCOME_UNKNOWN',
    },
  ]),
);

/**
 * `"METHOD /path"` → contract facts, for every route that has been specified.
 * Routes in `ROUTE_TABLE` without a `contract` block are real endpoints whose
 * request/response shapes are not yet described; they are absent here rather than
 * described wrongly.
 */
export const routeCatalog: Readonly<Record<string, RouteContract>> = Object.freeze(
  Object.fromEntries(
    ROUTE_TABLE.filter((r) => r.contract !== undefined).map((r) => [
      `${r.method} ${r.path}`,
      r.contract as RouteContract,
    ]),
  ),
);

export const modelCatalog: Readonly<Record<string, ZodTypeAny>> = {
  ...httpModels,
  ...contractModels,
  ...deviceModels,
  ...posCatalogModels,
  ...posCartModels,
  ...posCheckoutModels,
  ...posOfflineModels,
  ...posSaleModels,
  ...posCashModels,
  ...posExceptionModels,
  ...posInventoryModels,
  ...procurementModels,
  ...inventoryCostingModels,
  // Recipes and inventory authoring (workstream E step 4, build-v3-76). No name
  // here is also named by `posInventoryModels`: the console's item is
  // `InventoryAuthoringItem`, so the POS stock view keeps the plain `InventoryItem`
  // and the barrel has no ambiguity to resolve.
  ...recipesModels,
  ...posCustomerValueModels,
  ...posHardwareModels,
  ...posKitchenModels,
  ...floorPlanModels,
  ...tableStateModels,
  ...tableOrderModels,
  ...dashboardOperationsModels,
  // The tender path and the fiscal record (workstream G): the attempt model with its
  // three outcomes, and the CFDI state machine with its deadline.
  ...tenderModels,
  ...mercadoPagoModels,
  ...realtimeModels,
};

export const invariantCatalog = {
  PaymentAmbiguity:
    'When status is unknown, queryOnly must be true and canRetryAsNew must be false.',
  Money: 'minorUnits is an integer and currency is an uppercase ISO 4217 code.',
  OfflineCommandEnvelope: 'sequence is positive and fingerprint is a SHA-256 hexadecimal value.',
  /**
   * Idempotency retention. A recorded command result is replayable for this long.
   * The IETF Idempotency-Key draft requires an expiration policy; Stripe's precedent
   * is 24 hours. A POS device can be offline for a whole trading day and replays on
   * reconnect, so 24 hours is too short: the window is one day plus a full shift of
   * slack. Past the window a replay returns IDEMPOTENCY_EXPIRED and never a second
   * charge — the client must query the command result instead.
   */
  IdempotencyRetention: 'A command result replays for 72 hours, then returns IDEMPOTENCY_EXPIRED.',
  PostSaleCompensation:
    'Original sale facts stay immutable. Each exception creates linked append-only compensation facts.',
  RefundLimit:
    'Cumulative line, tax, discount, tip, tender, and cash compensation cannot exceed original facts.',
  RefundAmbiguity: 'An unknown terminal refund is query-only and blocks a replacement refund.',
  InventoryLedger:
    'Every stock effect is an immutable ledger fact. A projection is never the sole authority.',
  InventoryAtomicity:
    'A stock-tracked sale and its inventory effects commit in one database transaction.',
  InventoryRestockLimit:
    'A restock cannot exceed the refunded quantity or the original stock consumption.',
  CustomerPrivacy:
    'Customer identity is merchant scoped. Receipt delivery never grants marketing consent.',
  LoyaltyLedger:
    'Every points effect is an immutable ledger fact. A projection is never the sole authority.',
  StoredValueAtomicity: 'A stored-value debit and its committed sale are one database transaction.',
  HardwareSideEffect:
    'A hardware command has stable identity. An unknown physical outcome is never retried blindly.',
  KitchenAuthority:
    'A kitchen projection references one committed sale. A KDS command cannot change a financial fact.',
  KitchenEventOrder:
    'A client applies only a newer aggregate version. It recovers a gap from the authoritative snapshot.',
} as const;

/** Hours a recorded command result stays replayable. Mirrored by `business_command.expires_at`. */
export const IDEMPOTENCY_RETENTION_HOURS = 72;
