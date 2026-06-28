import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * FROZEN KDS contract (spec §8.1). The iPad Swift client depends on these exact
 * header names, enum values, constants, and error bodies. They are ported
 * byte-for-byte from the legacy Deno edge functions
 * (`supabase/functions/kds-{pairing,board,command}` + `_shared/kds-device-auth.ts`)
 * and are contract-tested (`kds-contract.spec.ts`). Do NOT paraphrase — the app
 * keys off these strings (e.g. it clears Keychain on `device_revoked`).
 *
 * Underneath the frozen JSON the module reads/writes the CANONICAL model
 * (`ops.*` via `v_kds_tickets`, `device.*`, `kitchen.stations`) — there is no
 * `kds.*` schema and no canonical transition RPC, so the logic lives in
 * `KdsService`/`KdsRepository`, not in the database.
 */

// ── Device auth (frozen) ───────────────────────────────────────────────────

export const KDS_DEVICE_TOKEN_HEADER = 'x-kds-device-token';

/**
 * The EXACT body returned for both `device_token_missing` (401) and
 * `device_revoked` (403). The app shows the message and returns to pairing.
 */
export const DEVICE_REVOKED_BODY = {
  error: 'device_revoked',
  message:
    'This KDS device has been removed. Pair it again from the dashboard.',
} as const;

// ── Pairing constants (frozen) ─────────────────────────────────────────────

export const PIN_TTL_MINUTES = 10;
export const POLL_AFTER_SECONDS = 5;
export const MAX_ATTEMPTS = 5;
/** kds_start scans the newest N pending non-expired requests to match a PIN. */
export const PIN_SCAN_LIMIT = 50;
/** kds_pairing admin_list page size. */
export const PAIRING_LIST_LIMIT = 20;

// ── Device liveness thresholds (heartbeat folded into device.sessions) ──────

export const DEVICE_LIVE_MS = 10_000; // < 10s since last_used_at → live
export const DEVICE_OFFLINE_MS = 20_000; // < 20s → slow; else offline

// ── Enums (frozen) ─────────────────────────────────────────────────────────

export type PairingStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'used';

export type KitchenStatus =
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'partial_cancelled';

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

/** Map a KDS `kitchen_status` to the `ops.orders.status` lifecycle value. */
export function mapKitchenToOrderStatus(k: KitchenStatus): string {
  switch (k) {
    case 'new':
      return 'pending';
    case 'accepted':
    case 'preparing':
    case 'partial_cancelled':
      return 'in_progress';
    case 'ready':
      return 'ready';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
  }
}

// ── Device session (normalized from device.sessions) ───────────────────────

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
