import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * FROZEN KDS contract (spec §8.1). The iPad Swift client depends on these exact
 * header names, enum values, constants, and error bodies. They are ported
 * byte-for-byte from the legacy Deno edge functions
 * (`supabase/functions/kds-{pairing,board,command}` + `_shared/kds-device-auth.ts`)
 * and are contract-tested (`kds-contract.spec.ts`). Do NOT paraphrase — the app
 * keys off these strings (e.g. it clears Keychain on `device_revoked`).
 *
 * Underneath the frozen JSON the module reads/writes the build-v2 model
 * (`tenant.order_ticket` over `customer_order`/`order_item`, `tenant.station`,
 * `tenant.device` + `runtime.session`) — there is no `kds.*` schema and no
 * canonical transition RPC, so the logic lives in `KdsService`/`KdsRepository`,
 * not in the database.
 */

// ── Device auth (frozen) ───────────────────────────────────────────────────

export const KDS_DEVICE_TOKEN_HEADER = 'x-kds-device-token';

/**
 * The EXACT body returned for both `device_token_missing` (401) and
 * `device_revoked` (403). The app shows the message and returns to pairing.
 */
export const DEVICE_REVOKED_BODY = {
  error: 'device_revoked',
  message: 'This KDS device has been removed. Pair it again from the dashboard.',
} as const;

// ── Pairing constants (frozen) ─────────────────────────────────────────────

export const PIN_TTL_MINUTES = 10;
export const POLL_AFTER_SECONDS = 5;
export const MAX_ATTEMPTS = 5;
/** kds_start scans the newest N pending non-expired requests to match a PIN. */
export const PIN_SCAN_LIMIT = 50;
/** kds_pairing admin_list page size. */
export const PAIRING_LIST_LIMIT = 20;

// ── Device liveness thresholds (heartbeat folded into runtime.session) ──────

export const DEVICE_LIVE_MS = 10_000; // < 10s since last_used_at → live
export const DEVICE_OFFLINE_MS = 20_000; // < 20s → slow; else offline

// ── Enums (frozen) ─────────────────────────────────────────────────────────

export type PairingStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'used';

export type KitchenStatus =
  'new' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'partial_cancelled';

/** Statuses that keep a ticket on the live kitchen board (snapshot view). */
export const BOARD_ACTIVE_STATUSES: KitchenStatus[] = [
  'new',
  'accepted',
  'preparing',
  'ready',
  'partial_cancelled',
];

export const TERMINAL_STATUSES: KitchenStatus[] = ['completed', 'cancelled'];

/**
 * Allowed `kitchen_status` transitions (replaces the legacy RPC's state machine).
 * Any non-terminal status may go to `cancelled`. `partial_cancelled` is reached
 * only via `partial_cancel_items`, never `transition_ticket`.
 */
export const STATUS_TRANSITIONS: Record<KitchenStatus, KitchenStatus[]> = {
  new: ['accepted', 'preparing', 'cancelled'],
  accepted: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'completed', 'cancelled'],
  ready: ['completed', 'cancelled'],
  partial_cancelled: ['preparing', 'ready', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * The two status vocabularies, and the only place they meet.
 *
 * The iPad app is FROZEN: `KitchenStatus` in apps/umi-kds is a Swift enum with seven
 * raw values, and `KDSSnapshotRow.asKitchenOrder()` does `guard let … else { throw }`
 * on it. The call site is `try rows.map { try $0.asKitchenOrder() }`, so `try` inside
 * `map` propagates on the FIRST failure — one unmappable ticket blanks the WHOLE board.
 *
 * build-v3 speaks a different, business-neutral vocabulary
 * (`placed·preparing·ready·completed·canceled`), and the two disagree on exactly the
 * states that matter: `placed` (the default for every new order) and `canceled` (the
 * iPad spells it with two l's). Measured on the prod snapshot: 27 of 51 orders carry a
 * status the iPad cannot map, and going forward every newly-placed order would.
 *
 * No gate can see this. `o.status` resolves fine under sql-preflight — it is a Postgres
 * CHECK disagreeing with a Swift enum, and nothing in the repo reads both. So the
 * mapping is pinned here, in one typed bidirectional place, and unit-tested.
 */

/** Statuses `tenant.customer_order.status` may hold (the CHECK, in code). */
export type OrderStatus = 'placed' | 'preparing' | 'ready' | 'completed' | 'canceled';

/**
 * KDS → build-v3, for the write path.
 *
 * `accepted` and `partial_cancelled` COLLAPSE onto `preparing`: build-v3 models one
 * status axis, not two (ORDER_MODEL.md §5 — the order-level and line-level
 * kitchen_status never once diverged across all 51 source orders), and neither state
 * was ever used in production (0 of 51; `partial_*` used 0×). The visible cost is that
 * a barista's "accept" tap round-trips as `preparing`, so the ticket settles one column
 * over on the next poll. Accepted deliberately (owner, 2026-07-24) rather than adding a
 * status to the schema whose only consumer is one screen of one frozen client.
 */
export function mapKitchenToOrderStatus(k: KitchenStatus): OrderStatus {
  switch (k) {
    case 'new':
      return 'placed';
    case 'accepted':
    case 'preparing':
    case 'partial_cancelled':
      return 'preparing';
    case 'ready':
      return 'ready';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'canceled';
  }
}

/**
 * build-v3 → KDS, for the read path. Total: every value the CHECK permits maps to
 * something the frozen Swift enum accepts, which is the property that keeps the board
 * alive. `accepted` and `partial_cancelled` are never produced — they have no build-v3
 * counterpart to come back from (see the collapse above).
 */
export function mapOrderToKitchenStatus(s: string): KitchenStatus {
  switch (s) {
    case 'placed':
      return 'new';
    case 'preparing':
      return 'preparing';
    case 'ready':
      return 'ready';
    case 'completed':
      return 'completed';
    case 'canceled':
      return 'cancelled';
    default:
      // Unreachable while the CHECK and this switch agree. Falling back to a value the
      // iPad CAN decode is the safe failure: a mislabelled ticket beats a blank board.
      return 'new';
  }
}

const KITCHEN_STATUS_SET = new Set<KitchenStatus>([
  'new',
  'accepted',
  'preparing',
  'ready',
  'completed',
  'cancelled',
  'partial_cancelled',
]);

/**
 * Returns an error string for an invalid transition, or null if allowed. Lives
 * in the contract module so both the service (pre-check) and the repository
 * (authoritative re-check inside the locked transaction) share one matrix.
 */
export function validateTransition(from: KitchenStatus | null, to: KitchenStatus): string | null {
  if (!KITCHEN_STATUS_SET.has(to)) return `invalid_target_status: ${to}`;
  const current = from ?? 'new';
  if (!STATUS_TRANSITIONS[current].includes(to)) {
    return `invalid_transition: ${current} -> ${to}`;
  }
  return null;
}

// ── Device session (normalized from runtime.session) ───────────────────────

export interface KdsDeviceSession {
  deviceId: string;
  tenantId: string;
  /** Legacy field — equals tenantId in the canonical model. */
  businessId: string;
  locationId: string | null;
  stationId: string | null;
  deviceName: string | null;
}

// ── Result envelope for the byte-exact iPad responses ──────────────────────

export interface KdsResult {
  status: number;
  body: unknown;
}

/**
 * Thrown for known device-auth failures. The controller (which owns the
 * `@Res()` reply) maps it to the frozen body+status — it must NEVER flow through
 * the global AllExceptionsFilter, which would wrap it in `{statusCode,error,…}`
 * and break the contract.
 */
export class KdsHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === 'object' ? JSON.stringify(body) : String(body));
    this.name = 'KdsHttpError';
  }
}

// ── Crypto helpers (ported from the Deno functions — same algorithms) ──────

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** Unbiased 6-digit PIN (Node's randomInt is rejection-sampled, no modulo bias). */
export function randomPin(): string {
  return String(randomInt(1_000_000)).padStart(6, '0');
}

export function hashPin(pin: string, salt: string): string {
  return sha256Hex(`${salt}:${pin}`);
}

// ── Small validators (mirror the Deno helpers) ─────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function asUuid(value: unknown): string | null {
  const input = asText(value);
  return UUID_RE.test(input) ? input : null;
}

export function asSixDigitPin(value: unknown): string | null {
  const input = asText(value).replace(/\s+/g, '');
  return /^\d{6}$/.test(input) ? input : null;
}
