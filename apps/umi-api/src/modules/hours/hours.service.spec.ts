import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { HoursService } from './hours.service';

const ORDERING = {
  acceptsOrders: true,
  orderCutoffMinutes: null,
  specialNotice: null,
  bypassPhones: [] as string[],
};

function make() {
  const repo = {
    read: vi.fn().mockResolvedValue([]),
    readWorker: vi.fn().mockResolvedValue([]),
    replace: vi.fn().mockResolvedValue(undefined),
  };
  const ordering = {
    read: vi.fn().mockResolvedValue({ ...ORDERING }),
    readWorker: vi.fn().mockResolvedValue({ ...ORDERING }),
    updateOrdering: vi.fn().mockResolvedValue(undefined),
  };
  const tenants = {
    resolveLocationIdWorker: vi.fn().mockResolvedValue(null),
    getTenantTimezoneWorker: vi.fn().mockResolvedValue('America/Mexico_City'),
    updateTenantSettings: vi.fn().mockResolvedValue(undefined),
  };
  return {
    svc: new HoursService(repo as never, ordering as never, tenants as never),
    repo,
    ordering,
    tenants,
  };
}

describe('HoursService.getHours', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('fills defaults for missing days, trims time to HH:MM, and includes ordering', async () => {
    h.repo.read.mockResolvedValue([
      { day_of_week: 1, opens_at: '09:30:00', closes_at: '21:00:00', is_closed: false },
      { day_of_week: 0, opens_at: null, closes_at: null, is_closed: true },
    ]);
    h.ordering.read.mockResolvedValue({
      acceptsOrders: false,
      orderCutoffMinutes: 45,
      specialNotice: 'Hoy cerramos temprano',
      bypassPhones: ['+5216671234567'],
    });
    const r = await h.svc.getHours('t1', 'loc1', 'America/Mexico_City');
    expect(r.hours.mon).toEqual({ open: true, from: '09:30', to: '21:00' });
    expect(r.hours.sun).toEqual({ open: false, from: '00:00', to: '00:00' });
    expect(r.hours.tue).toEqual({ open: true, from: '08:00', to: '20:00' }); // default
    expect(r.timezone).toBe('America/Mexico_City');
    expect(r.businessId).toBe('t1');
    expect(r.ordering.acceptsOrders).toBe(false);
    expect(r.ordering.orderCutoffMinutes).toBe(45);
  });

  it('falls back to the default timezone when none given', async () => {
    const r = await h.svc.getHours('t1', null, null);
    expect(r.timezone).toBe('America/Mexico_City');
  });
});

describe('HoursService.updateHours', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('maps day ids → day_of_week and closed days to 00:00', async () => {
    await h.svc.updateHours('t1', 'loc1', {
      mon: { open: true, from: '10:00', to: '18:00' },
      sun: { open: false, from: '00:00', to: '00:00' },
      bogus: { open: true, from: '1', to: '2' }, // ignored
    });
    const days = h.repo.replace.mock.calls[0][2];
    expect(days).toContainEqual({ dow: 1, opens: '10:00', closes: '18:00', isClosed: false });
    expect(days).toContainEqual({ dow: 0, opens: '00:00', closes: '00:00', isClosed: true });
    expect(days).toHaveLength(2); // bogus dropped
  });

  it('rejects a missing hours payload', async () => {
    await expect(h.svc.updateHours('t1', null, null)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('HoursService.updateAll', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('routes each block to its canonical home and skips absent blocks', async () => {
    await h.svc.updateAll('t1', 'loc1', {
      timezone: 'America/Tijuana',
      ordering: { acceptsOrders: false, orderCutoffMinutes: 60 },
    });
    expect(h.repo.replace).not.toHaveBeenCalled(); // no hours block
    expect(h.tenants.updateTenantSettings).toHaveBeenCalledWith('t1', {
      timezone: 'America/Tijuana',
    });
    expect(h.ordering.updateOrdering).toHaveBeenCalledWith('t1', {
      acceptsOrders: false,
      orderCutoffMinutes: 60,
    });
  });
});

describe('HoursService.getEffectiveHoursForBot', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('resolves location, maps rows to windows, and fails closed on null times', async () => {
    h.tenants.resolveLocationIdWorker.mockResolvedValue('loc-9');
    h.repo.readWorker.mockResolvedValue([
      { day_of_week: 1, opens_at: '07:00:00', closes_at: '19:00:00', is_closed: false },
      { day_of_week: 2, opens_at: null, closes_at: null, is_closed: false },
    ]);
    const bot = await h.svc.getEffectiveHoursForBot('t1', null);
    expect(h.repo.readWorker).toHaveBeenCalledWith('t1', 'loc-9');
    expect(bot.timezone).toBe('America/Mexico_City');
    expect(bot.days.find((d) => d.dow === 1)).toEqual({
      dow: 1,
      isClosed: false,
      openMinutes: 420,
      closeMinutes: 1140,
    });
    // null times → fail closed even though is_closed=false.
    expect(bot.days.find((d) => d.dow === 2)?.isClosed).toBe(true);
  });
});
