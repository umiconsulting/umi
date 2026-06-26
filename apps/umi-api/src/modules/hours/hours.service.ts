import { BadRequestException, Injectable } from '@nestjs/common';
import { HoursRepository, type DayInput } from './hours.repository';

const DAY_NUM_TO_ID: Record<string, string> = {
  '0': 'sun',
  '1': 'mon',
  '2': 'tue',
  '3': 'wed',
  '4': 'thu',
  '5': 'fri',
  '6': 'sat',
};
const DAY_ID_TO_NUM: Record<string, string> = {
  sun: '0',
  mon: '1',
  tue: '2',
  wed: '3',
  thu: '4',
  fri: '5',
  sat: '6',
};

const DEFAULT_TZ = 'America/Mexico_City';

export interface DayHours {
  open: boolean;
  from: string;
  to: string;
}
export type HoursMap = Record<string, DayHours>;

function defaultHours(): HoursMap {
  const out: HoursMap = {};
  for (const id of Object.values(DAY_NUM_TO_ID)) {
    out[id] = { open: true, from: '08:00', to: '20:00' };
  }
  return out;
}

@Injectable()
export class HoursService {
  constructor(private readonly repo: HoursRepository) {}

  async getHours(
    tenantId: string,
    locationId: string | null,
    tenantTimezone: string | null,
  ): Promise<{ hours: HoursMap; timezone: string; businessId: string }> {
    const rows = await this.repo.read(tenantId, locationId);
    const hours = defaultHours();
    for (const r of rows) {
      const id = DAY_NUM_TO_ID[String(r.day_of_week)];
      if (!id) continue;
      hours[id] = r.is_closed
        ? { open: false, from: '00:00', to: '00:00' }
        : {
            open: true,
            from: (r.opens_at || '08:00').slice(0, 5),
            to: (r.closes_at || '20:00').slice(0, 5),
          };
    }
    return { hours, timezone: tenantTimezone || DEFAULT_TZ, businessId: tenantId };
  }

  async updateHours(
    tenantId: string,
    locationId: string | null,
    hours: unknown,
  ): Promise<void> {
    if (!hours || typeof hours !== 'object') {
      throw new BadRequestException('hours required');
    }
    const days: DayInput[] = [];
    for (const [id, raw] of Object.entries(hours as Record<string, DayHours>)) {
      const num = DAY_ID_TO_NUM[id];
      if (num === undefined) continue;
      const h = raw ?? ({} as DayHours);
      days.push({
        dow: parseInt(num, 10),
        opens: h.open ? h.from || '08:00' : '00:00',
        closes: h.open ? h.to || '20:00' : '00:00',
        isClosed: !h.open,
      });
    }
    await this.repo.replace(tenantId, locationId, days);
  }
}
