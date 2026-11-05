import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import type { CashPlatformUpdateDto } from './dto/cash-platform-update.dto';
import { DAY_KEYS, fromGrid, parseOpenHours, timeToMinutes } from '../business-hours/open-hours';

@Injectable()
export class CashPlatformRepository {
  constructor(private readonly pg: PgService) {}

  async announcement(reference: string, message: string, dryRun: boolean) {
    return this.pg.workerTx(async (c) => {
      const { rows } = await c.query(
        'SELECT id::text,name FROM merchant.merchant WHERE id::text=$1 OR handle=$1',
        [reference],
      );
      if (!rows[0]) throw new NotFoundException({ error: 'Cafetería no encontrada.' });
      const id = rows[0].id as string;
      const where = `card.merchant_id=$1::uuid AND EXISTS(SELECT 1 FROM merchant.loyalty_wallet_pass wp WHERE wp.card_id=card.id)`;
      const count = await c.query(
        `SELECT count(*)::int AS total FROM merchant.loyalty_card card WHERE ${where}`,
        [id],
      );
      if (!dryRun)
        await c.query(
          `UPDATE merchant.loyalty_card card SET lifecycle_message=$2,lifecycle_message_at=now(),updated_at=now() WHERE ${where}`,
          [id, message],
        );
      return { id, total: count.rows[0].total as number };
    });
  }

  list(id: string | null = null) {
    return this.pg.workerTx(
      async (c) =>
        (
          await c.query(
            `SELECT m.id::text, m.name, m.city, coalesce(m.handle,m.id::text) AS slug,
          m.timezone, coalesce(p.card_prefix,'') AS "cardPrefix",
          coalesce(p.primary_color,m.brand_color,'#B5605A') AS "primaryColor",
          CASE WHEN m.status <> 'active' OR s.id IS NULL OR s.status NOT IN ('active','trialing') THEN 'SUSPENDED'
               WHEN s.status = 'trialing' THEN 'TRIAL' ELSE 'ACTIVE' END AS "subscriptionStatus",
          CASE WHEN s.status = 'trialing' THEN s.current_period_end END AS "trialEndsAt",
          NULL::timestamptz AS "suspendedAt",
          json_build_object('users',(SELECT count(*)::int FROM merchant.staff WHERE merchant_id=m.id),
                            'cards',(SELECT count(*)::int FROM merchant.loyalty_card WHERE merchant_id=m.id)) AS "_count",
          coalesce((SELECT json_agg(json_build_object('rewardName',r.name,'visitsRequired',r.stamps_required))
                    FROM merchant.loyalty_reward r WHERE r.merchant_id=m.id AND r.active AND r.kind='standard' AND r.type='stamps_free_item'),'[]') AS "rewardConfigs"
       FROM merchant.merchant m
       LEFT JOIN merchant.loyalty_program p ON p.merchant_id=m.id
       LEFT JOIN umi.subscription s ON s.merchant_id=m.id
       WHERE ($1::uuid IS NULL OR m.id=$1::uuid) ORDER BY m.created_at,m.id`,
            [id],
          )
        ).rows,
    );
  }

  async update(
    id: string,
    dto: CashPlatformUpdateDto,
    updateRewards: (client: PoolClient) => Promise<void>,
  ) {
    if (dto.businessHours)
      for (const [day, hours] of Object.entries(dto.businessHours)) {
        if (
          !DAY_KEYS.includes(day as (typeof DAY_KEYS)[number]) ||
          !hours ||
          typeof hours.open !== 'boolean' ||
          (hours.open && (timeToMinutes(hours.from) === null || timeToMinutes(hours.to) === null))
        ) {
          throw new BadRequestException({ error: 'Horario inválido.' });
        }
      }
    return this.pg.workerTx(async (c) => {
      const merchant = await c.query(
        'SELECT id,open_hours FROM merchant.merchant WHERE id=$1::uuid FOR UPDATE',
        [id],
      );
      if (!merchant.rowCount) throw new NotFoundException({ error: 'Cafetería no encontrada.' });
      const patch = async (
        table: 'merchant.merchant' | 'merchant.loyalty_program' | 'umi.subscription',
        key: string,
        values: Record<string, unknown>,
      ) => {
        const entries = Object.entries(values).filter(([, value]) => value !== undefined);
        if (!entries.length) return;
        const assignments = entries.map(([column], i) => `${column}=$${i + 2}`).join(',');
        const result = await c.query(
          `UPDATE ${table} SET ${assignments},updated_at=now() WHERE ${key}=$1::uuid`,
          [id, ...entries.map(([, value]) => value)],
        );
        if (!result.rowCount)
          throw new ConflictException({
            error: 'La configuración de la cafetería está incompleta.',
          });
      };
      await patch('merchant.merchant', 'id', {
        name: dto.name,
        city: dto.city,
        timezone: dto.timezone,
        brand_color: dto.primaryColor,
        secondary_color: dto.secondaryColor,
        open_hours:
          dto.businessHours === undefined
            ? undefined
            : JSON.stringify(
                fromGrid(dto.businessHours ?? {}, parseOpenHours(merchant.rows[0].open_hours)),
              ),
        status: dto.subscriptionStatus
          ? dto.subscriptionStatus === 'SUSPENDED'
            ? 'suspended'
            : 'active'
          : undefined,
      });
      await patch('merchant.loyalty_program', 'merchant_id', {
        primary_color: dto.primaryColor,
        secondary_color: dto.secondaryColor,
        self_registration: dto.selfRegistration,
        topup_enabled: dto.topupEnabled,
      });
      const trial = dto.subscriptionStatus === 'TRIAL';
      if (trial) {
        const existing = await c.query(
          'SELECT current_period_end FROM umi.subscription WHERE merchant_id=$1::uuid',
          [id],
        );
        const end =
          dto.trialEndsAt === undefined ? existing.rows[0]?.current_period_end : dto.trialEndsAt;
        if (!end) throw new BadRequestException({ error: 'La prueba necesita una fecha de fin.' });
      }
      await patch('umi.subscription', 'merchant_id', {
        status:
          dto.subscriptionStatus && dto.subscriptionStatus !== 'SUSPENDED'
            ? trial
              ? 'trialing'
              : 'active'
            : undefined,
        current_period_end: dto.trialEndsAt,
      });
      if (dto.locations) {
        const ids = dto.locations.flatMap((location) => (location.id ? [location.id] : []));
        await c.query(
          "UPDATE merchant.location SET status='closed',updated_at=now() WHERE merchant_id=$1::uuid AND NOT(id=ANY($2::uuid[]))",
          [id, ids],
        );
        for (const location of dto.locations) {
          const values = [
            id,
            location.name,
            location.address ?? null,
            location.latitude ?? null,
            location.longitude ?? null,
            location.isActive === false ? 'closed' : 'active',
          ];
          if (location.id) {
            const result = await c.query(
              'UPDATE merchant.location SET name=$2,address=$3,lat=$4,lng=$5,status=$6,updated_at=now() WHERE merchant_id=$1::uuid AND id=$7::uuid',
              [...values, location.id],
            );
            if (!result.rowCount)
              throw new BadRequestException({
                error: 'La sucursal no pertenece a esta cafetería.',
              });
          } else
            await c.query(
              'INSERT INTO merchant.location (merchant_id,name,address,lat,lng,status) VALUES ($1::uuid,$2,$3,$4,$5,$6)',
              values,
            );
        }
      }
      await updateRewards(c);
    });
  }

  async delete(id: string) {
    try {
      await this.pg.workerTx(async (c) => {
        const result = await c.query('DELETE FROM merchant.merchant WHERE id=$1::uuid', [id]);
        if (!result.rowCount) throw new NotFoundException({ error: 'Cafetería no encontrada.' });
      });
    } catch (error) {
      if (
        (error as { code?: string }).code === '23503' ||
        (error as { code?: string }).code === 'P0001'
      ) {
        throw new ConflictException({
          error: 'Esta cafetería tiene registros que requieren conservación. Suspende el servicio.',
        });
      }
      throw error;
    }
  }
}
