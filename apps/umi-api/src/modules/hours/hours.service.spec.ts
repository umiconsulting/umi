import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { HoursService } from './hours.service';

function make() {
  const repo = { read: vi.fn(), replace: vi.fn().mockResolvedValue(undefined) };
  return { svc: new HoursService(repo as never), repo };
}

describe('HoursService.getHours', () => {
  let h: ReturnType<typeof make>;
  beforeEach(() => (h = make()));

  it('fills defaults for missing days and trims time to HH:MM', async () => {
    h.repo.read.mockResolvedValue([
      { day_of_week: 1, opens_at: '09:30:00', closes_at: '21:00:00', is_closed: false },
      { day_of_week: 0, opens_at: null, closes_at: null, is_closed: true },
    ]);
    const r = await h.svc.getHours('t1', 'loc1', 'America/Mexico_City');
    expect(r.hours.mon).toEqual({ open: true, from: '09:30', to: '21:00' });
    expect(r.hours.sun).toEqual({ open: false, from: '00:00', to: '00:00' });
    expect(r.hours.tue).toEqual({ open: true, from: '08:00', to: '20:00' }); // default
    expect(r.timezone).toBe('America/Mexico_City');
    expect(r.businessId).toBe('t1');
  });

  it('falls back to the default timezone when none given', async () => {
    h.repo.read.mockResolvedValue([]);
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
    await expect(h.svc.updateHours('t1', null, null)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
