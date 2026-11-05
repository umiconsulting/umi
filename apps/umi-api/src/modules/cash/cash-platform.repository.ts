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
      await c.query(
        `UPDATE merchant.merchant SET name=coalesce($2,name),city=coalesce($3,city),
           timezone=coalesce($4,timezone),brand_color=coalesce($5,brand_color),
           secondary_color=CASE WHEN $6::boolean THEN $7 ELSE secondary_color END,
           open_hours=CASE WHEN $8::boolean THEN $9::jsonb ELSE open_hours END,
           status=coalesce($10,status),updated_at=now() WHERE id=$1::uuid`,
        [
          id,
          dto.name,
          dto.city,
          dto.timezone,
          dto.primaryColor,
          dto.secondaryColor !== undefined,
          dto.secondaryColor,
          dto.businessHours !== undefined,
          dto.businessHours === undefined
            ? null
            : JSON.stringify(
                fromGrid(dto.businessHours ?? {}, parseOpenHours(merchant.rows[0].open_hours)),
              ),
          dto.subscriptionStatus
            ? dto.subscriptionStatus === 'SUSPENDED'
              ? 'suspended'
              : 'active'
            : null,
        ],
      );
      if (
        [dto.primaryColor, dto.secondaryColor, dto.selfRegistration, dto.topupEnabled].some(
          (value) => value !== undefined,
        )
      ) {
        const result = await c.query(
          `UPDATE merchant.loyalty_program SET primary_color=coalesce($2,primary_color),
             secondary_color=CASE WHEN $3::boolean THEN $4 ELSE secondary_color END,
             self_registration=coalesce($5,self_registration),topup_enabled=coalesce($6,topup_enabled),
             updated_at=now() WHERE merchant_id=$1::uuid`,
          [
            id,
            dto.primaryColor,
            dto.secondaryColor !== undefined,
            dto.secondaryColor,
            dto.selfRegistration,
            dto.topupEnabled,
          ],
        );
        if (!result.rowCount)
          throw new ConflictException({
            error: 'La configuración de la cafetería está incompleta.',
          });
      }
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
      if (
        (dto.subscriptionStatus && dto.subscriptionStatus !== 'SUSPENDED') ||
        dto.trialEndsAt !== undefined
      ) {
        const result = await c.query(
          `UPDATE umi.subscription SET status=coalesce($2,status),
             current_period_end=CASE WHEN $3::boolean THEN $4::timestamptz ELSE current_period_end END,
             updated_at=now() WHERE merchant_id=$1::uuid`,
          [
            id,
            dto.subscriptionStatus && dto.subscriptionStatus !== 'SUSPENDED'
              ? trial
                ? 'trialing'
                : 'active'
              : null,
            dto.trialEndsAt !== undefined,
            dto.trialEndsAt,
          ],
        );
        if (!result.rowCount)
          throw new ConflictException({ error: 'La suscripción de la cafetería está incompleta.' });
      }
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
