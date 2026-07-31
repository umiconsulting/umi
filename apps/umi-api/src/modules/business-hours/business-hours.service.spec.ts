import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BusinessHoursService } from './business-hours.service';
import type { OpenHours } from './open-hours';

const ORDERING = {
  acceptsOrders: true,
  orderCutoffMinutes: 30,
  specialNotice: null,
  bypassPhones: [] as string[],
};

function make(stored: OpenHours = {}) {
  const repo = {
    read: vi.fn().mockResolvedValue({ hours: stored, level: 'business' }),
    readWorker: vi.fn().mockResolvedValue({ hours: stored, level: 'business' }),
    write: vi.fn().mockResolvedValue(undefined),
    setBranchOverride: vi.fn().mockResolvedValue(true),
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
    svc: new BusinessHoursService(repo as never, ordering as never, tenants as never),
    repo,
    ordering,
    tenants,
  };
}

describe('BusinessHoursService.getHours', () => {
  it('projects the document onto the grid, suggests unset days, and includes ordering', async () => {
    const h = make({
      mon: [{ open: '09:30', close: '21:00' }],
      sun: [],
    });
    h.ordering.read.mockResolvedValue({
      acceptsOrders: false,
      orderCutoffMinutes: 45,
      specialNotice: 'Hoy cerramos temprano',
      bypassPhones: ['+5216671234567'],
    });
    const r = await h.svc.getHours('t1', 'branch1', 'America/Mexico_City');
    expect(r.hours.mon).toEqual({ open: true, from: '09:30', to: '21:00' });
    // `[]` is a STATED closure, and reads as closed rather than as a suggestion.
    expect(r.hours.sun).toEqual({ open: false, from: '00:00', to: '00:00' });
    // Never set → the form's suggestion, which no consumer ever sees.
    expect(r.hours.tue).toEqual({ open: true, from: '08:00', to: '20:00' });
    expect(r.businessId).toBe('t1');
    expect(r.hoursLevel).toBe('business');
    expect(r.ordering.acceptsOrders).toBe(false);
    expect(r.ordering.orderCutoffMinutes).toBe(45);
  });

  it('reports when the branch keeps its own hours', async () => {
    const h = make();
    h.repo.read.mockResolvedValue({ hours: { mon: [] }, level: 'branch' });
    const r = await h.svc.getHours('t1', 'branch1', null);
    expect(r.hoursLevel).toBe('branch');
  });

  it('falls back to the default timezone when none given', async () => {
    const r = await make().svc.getHours('t1', null, null);
    expect(r.timezone).toBe('America/Mexico_City');
  });
});

describe('BusinessHoursService.updateHours', () => {
  it('writes the submitted days as intervals and a closed day as an empty list', async () => {
    const h = make();
    await h.svc.updateHours('t1', 'branch1', {
      mon: { open: true, from: '10:00', to: '18:00' },
      sun: { open: false, from: '00:00', to: '00:00' },
      bogus: { open: true, from: '1', to: '2' }, // not a day we model
    });
    const doc = h.repo.write.mock.calls[0][2];
    expect(doc.mon).toEqual([{ open: '10:00', close: '18:00' }]);
    expect(doc.sun).toEqual([]);
    expect(doc).not.toHaveProperty('bogus');
  });

  it('does not delete a holiday closure the grid cannot show', async () => {
    const h = make({
      mon: [{ open: '08:00', close: '20:00' }],
      exceptions: [{ date: '2026-12-25', closed: true }],
    });
    await h.svc.updateHours('t1', null, { mon: { open: true, from: '09:00', to: '17:00' } });
    const doc = h.repo.write.mock.calls[0][2];
    expect(doc.mon).toEqual([{ open: '09:00', close: '17:00' }]);
    expect(doc.exceptions).toEqual([{ date: '2026-12-25', closed: true }]);
  });

  it('does not delete the evening half of a split shift', async () => {
    const h = make({
      tue: [
        { open: '08:00', close: '14:00' },
        { open: '17:00', close: '22:00' },
      ],
    });
    await h.svc.updateHours('t1', null, { tue: { open: true, from: '09:00', to: '14:00' } });
    expect(h.repo.write.mock.calls[0][2].tue).toEqual([
      { open: '09:00', close: '14:00' },
      { open: '17:00', close: '22:00' },
    ]);
  });

  it('leaves days the grid did not mention alone', async () => {
    const h = make({ mon: [{ open: '08:00', close: '20:00' }], wed: [] });
    await h.svc.updateHours('t1', null, { mon: { open: true, from: '07:00', to: '15:00' } });
    const doc = h.repo.write.mock.calls[0][2];
    expect(doc.wed).toEqual([]);
  });

  it('rejects a missing hours payload', async () => {
    await expect(make().svc.updateHours('t1', null, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('BusinessHoursService.updateAll', () => {
  it('routes each block to its canonical home and skips absent blocks', async () => {
    const h = make();
    await h.svc.updateAll('t1', 'branch1', {
      timezone: 'America/Tijuana',
      ordering: { acceptsOrders: false, orderCutoffMinutes: 60 },
    });
    expect(h.repo.write).not.toHaveBeenCalled(); // no hours block
    expect(h.tenants.updateTenantSettings).toHaveBeenCalledWith('t1', {
      timezone: 'America/Tijuana',
    });
    expect(h.ordering.updateOrdering).toHaveBeenCalledWith('t1', {
      acceptsOrders: false,
      orderCutoffMinutes: 60,
    });
  });
});

describe('BusinessHoursService.getEffectiveHoursForBot', () => {
  it('resolves the branch and hands back the document, not a flattened summary', async () => {
    const stored: OpenHours = { mon: [{ open: '07:00', close: '19:00' }] };
    const h = make(stored);
    h.tenants.resolveLocationIdWorker.mockResolvedValue('branch-9');
    const bot = await h.svc.getEffectiveHoursForBot('t1', null);
    expect(h.repo.readWorker).toHaveBeenCalledWith('t1', 'branch-9');
    expect(bot.timezone).toBe('America/Mexico_City');
    expect(bot.hours).toEqual(stored);
    expect(bot.ordering.acceptsOrders).toBe(true);
  });
});
