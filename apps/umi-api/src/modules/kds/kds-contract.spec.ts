import { describe, expect, it } from 'vitest';
import {
  asSixDigitPin,
  asUuid,
  BOARD_ACTIVE_STATUSES,
  DEVICE_LIVE_MS,
  DEVICE_OFFLINE_MS,
  DEVICE_REVOKED_BODY,
  hashPin,
  KDS_DEVICE_TOKEN_HEADER,
  mapKitchenToOrderStatus,
  MAX_ATTEMPTS,
  PAIRING_LIST_LIMIT,
  PIN_SCAN_LIMIT,
  PIN_TTL_MINUTES,
  POLL_AFTER_SECONDS,
  randomHex,
  randomPin,
  sha256Hex,
  STATUS_TRANSITIONS,
} from './dto/kds-contract';
import { partialCancelNotificationBody, statusNotificationBody } from './kds-notify.copy';

/**
 * Contract freeze tests (spec §8.1). These pin the byte-exact strings/constants
 * the iPad Swift client depends on — a failure here means a breaking change to
 * an already-shipped native client.
 */
describe('KDS frozen contract', () => {
  it('device_revoked body is byte-exact (used for both 401 and 403)', () => {
    expect(DEVICE_REVOKED_BODY).toEqual({
      error: 'device_revoked',
      message:
        'This KDS device has been removed. Pair it again from the dashboard.',
    });
  });

  it('freezes the device-token header name', () => {
    expect(KDS_DEVICE_TOKEN_HEADER).toBe('x-kds-device-token');
  });

  it('freezes the pairing constants', () => {
    expect(PIN_TTL_MINUTES).toBe(10);
    expect(POLL_AFTER_SECONDS).toBe(5);
    expect(MAX_ATTEMPTS).toBe(5);
    expect(PIN_SCAN_LIMIT).toBe(50);
    expect(PAIRING_LIST_LIMIT).toBe(20);
    expect(DEVICE_LIVE_MS).toBe(10_000);
    expect(DEVICE_OFFLINE_MS).toBe(20_000);
  });

  it('keeps terminal statuses off the live board', () => {
    expect(BOARD_ACTIVE_STATUSES).not.toContain('completed');
    expect(BOARD_ACTIVE_STATUSES).not.toContain('cancelled');
    expect(BOARD_ACTIVE_STATUSES).toContain('new');
    expect(BOARD_ACTIVE_STATUSES).toContain('partial_cancelled');
  });

  it('terminal statuses allow no further transition', () => {
    expect(STATUS_TRANSITIONS.completed).toEqual([]);
    expect(STATUS_TRANSITIONS.cancelled).toEqual([]);
    expect(STATUS_TRANSITIONS.new).toContain('accepted');
    expect(STATUS_TRANSITIONS.new).toContain('cancelled');
  });

  it('maps kitchen_status → ops.orders.status', () => {
    expect(mapKitchenToOrderStatus('new')).toBe('pending');
    expect(mapKitchenToOrderStatus('preparing')).toBe('in_progress');
    expect(mapKitchenToOrderStatus('ready')).toBe('ready');
    expect(mapKitchenToOrderStatus('completed')).toBe('completed');
    expect(mapKitchenToOrderStatus('cancelled')).toBe('cancelled');
    expect(mapKitchenToOrderStatus('partial_cancelled')).toBe('in_progress');
  });
});

describe('KDS crypto helpers (ported algorithms)', () => {
  it('hashPin is deterministic and salt:pin sha256', () => {
    expect(hashPin('123456', 'salt')).toBe(sha256Hex('salt:123456'));
    expect(hashPin('123456', 'salt')).toBe(hashPin('123456', 'salt'));
    expect(hashPin('123456', 'other')).not.toBe(hashPin('123456', 'salt'));
  });

  it('randomPin is always 6 digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomPin()).toMatch(/^\d{6}$/);
    }
  });

  it('randomHex(n) returns 2n hex chars', () => {
    expect(randomHex(32)).toMatch(/^[0-9a-f]{64}$/);
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('KDS input validators', () => {
  it('asUuid accepts uuids and rejects junk', () => {
    expect(asUuid('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    );
    expect(asUuid('not-a-uuid')).toBeNull();
    expect(asUuid(123)).toBeNull();
  });

  it('asSixDigitPin strips whitespace and validates 6 digits', () => {
    expect(asSixDigitPin(' 12 34 56 ')).toBe('123456');
    expect(asSixDigitPin('12345')).toBeNull();
    expect(asSixDigitPin('abcdef')).toBeNull();
  });
});

describe('KDS notification copy (ported byte-for-byte)', () => {
  it('matches the legacy status bodies', () => {
    expect(statusNotificationBody('accepted')).toBe(
      'Tu pedido fue aceptado y está en cola en cocina.',
    );
    expect(statusNotificationBody('preparing')).toBe(
      'Tu pedido se está preparando.',
    );
    expect(statusNotificationBody('ready')).toBe(
      'Tu pedido está listo para recoger.',
    );
    expect(statusNotificationBody('completed')).toBe(
      'Tu pedido fue completado. ¡Gracias!',
    );
    expect(statusNotificationBody('cancelled')).toBe('Tu pedido fue cancelado.');
    expect(statusNotificationBody('new')).toBeNull();
  });

  it('builds the partial-cancel body with cancelled + remaining lines', () => {
    const body = partialCancelNotificationBody(
      [{ quantity: 2, name: 'Latte' }],
      [{ quantity: 1, name: 'Croissant' }],
    );
    expect(body).toContain('Se modificó tu pedido:');
    expect(body).toContain('❌ Cancelado:');
    expect(body).toContain('• 2× Latte');
    expect(body).toContain('• Croissant');
  });

  it('shows "Sin artículos restantes" when nothing remains', () => {
    const body = partialCancelNotificationBody([{ name: 'Latte' }], []);
    expect(body).toContain('• Sin artículos restantes');
  });
});
