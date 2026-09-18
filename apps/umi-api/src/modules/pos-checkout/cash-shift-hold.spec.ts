import { describe, expect, it, vi } from 'vitest';
import { CashRefusal } from '../pos-cash/cash-refusal';
import { deviceRegisterHoldDetails, resolveDeviceRegisterHold } from './cash-shift-hold';
import { PosCheckoutRepository } from './pos-checkout.repository';

const id = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const scope = { merchantId: id(1), locationId: id(2), deviceId: id(3) };

const row = (overrides: Record<string, unknown> = {}) => ({
  registerId: id(10),
  registerName: 'Caja 1',
  registerPublicReference: 'CAJA-1',
  shiftId: id(20),
  shiftStatus: 'open',
  openedAt: '2026-09-16T20:52:56.649669+00:00',
  holdingDeviceId: id(3),
  holdingOperatorSessionId: id(30),
  deviceName: 'Tablet mostrador',
  deviceStatus: 'active',
  deviceUsable: true,
  ...overrides,
});

describe('device register hold', () => {
  it('reads a shift open on THIS device as held_by_this_device and not reclaimable', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row()] });
    const resolved = await resolveDeviceRegisterHold({ query } as never, scope);
    expect(resolved.hold).toMatchObject({
      state: 'held_by_this_device',
      shiftId: id(20),
      deviceId: id(3),
      reclaimable: false,
    });
    expect(query.mock.calls[0][0]).toContain('s.holding_device_id=$3::uuid');
    expect(resolved.registerId).toBe(id(10));
  });

  it('reads a shift held by a terminal that is gone as held_by_orphaned_till and reclaimable', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [row({ deviceUsable: false, deviceStatus: 'revoked' })] });
    const resolved = await resolveDeviceRegisterHold({ query } as never, scope);
    expect(resolved.hold.state).toBe('held_by_orphaned_till');
    expect(resolved.hold.reclaimable).toBe(true);
  });

  it('keeps a live other terminal managing the drawer instead of freeing it', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [row({ holdingDeviceId: id(4), deviceUsable: true })] });
    const resolved = await resolveDeviceRegisterHold({ query } as never, scope);
    expect(resolved.hold.state).toBe('held_by_active_till');
    expect(resolved.hold.reclaimable).toBe(false);
  });

  it('names no register when the device is assigned none', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const resolved = await resolveDeviceRegisterHold({ query } as never, scope);
    expect(resolved.registerId).toBeNull();
    expect(resolved.hold.state).toBe('free');
    expect(deviceRegisterHoldDetails(resolved)).toMatchObject({
      holdState: 'free',
      registerId: null,
    });
  });
});

describe('CASH_SHIFT_REQUIRED refusal', () => {
  // The commit call site is 15 positional arguments wide; only the ones the
  // refusal reads (the cart scope, the tender summary, the device, the shift)
  // need to be real, so the rest are stubs cast at the boundary.
  const commitWith = (repository: PosCheckoutRepository, client: unknown) =>
    repository.commit(
      client as never,
      { merchantId: id(1), locationId: id(2) } as never,
      { totals: { grandTotal: { currency: 'MXN' } } } as never,
      [] as never,
      { tenders: [{ type: 'cash' }] } as never,
      id(40),
      {} as never,
      {} as never,
      null,
      id(41),
      { deviceId: id(3) } as never,
      'correlation',
      id(42),
      'fingerprint',
      null,
    );

  it('is a typed 409 that carries the register and the hold', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [row()] }) };
    const repository = new PosCheckoutRepository({} as never);
    await expect(commitWith(repository, client)).rejects.toMatchObject({
      code: 'CASH_SHIFT_REQUIRED',
      status: 409,
      details: {
        registerId: id(10),
        registerName: 'Caja 1',
        holdState: 'held_by_this_device',
        shiftId: id(20),
        reclaimable: false,
      },
    });
  });

  it('raises a CashRefusal so the service can answer 409 instead of a 500', async () => {
    const repository = new PosCheckoutRepository({} as never);
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(commitWith(repository, client)).rejects.toBeInstanceOf(CashRefusal);
  });
});
