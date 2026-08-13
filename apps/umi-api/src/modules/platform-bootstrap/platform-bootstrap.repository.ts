import { ConflictException, Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';
import type { PlatformBootstrapResult } from './platform-bootstrap.types';

export interface PlatformBootstrapInput {
  commandId: string;
  idempotencyKey: string;
  fingerprint: string;
  merchantName: string;
  merchantId: string | null;
  timezone: string;
  currency: string;
  locale: string;
  locationName: string;
  locationId: string | null;
  ownerEmail: string;
  ownerUserId: string | null;
  ownerStaffId: string | null;
  ownerFullName: string;
  passwordSalt: string;
  passwordHash: string;
}

@Injectable()
export class PlatformBootstrapRepository {
  constructor(private readonly pg: PgService) {}

  async execute(input: PlatformBootstrapInput): Promise<PlatformBootstrapResult> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query<{ fingerprint: string; result: PlatformBootstrapResult }>(
        `SELECT fingerprint, result FROM runtime.platform_bootstrap_command
          WHERE command_id=$1::uuid OR idempotency_key=$2 FOR UPDATE`,
        [input.commandId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].fingerprint !== input.fingerprint)
          throw new ConflictException('bootstrap_fingerprint_conflict');
        await client.query('COMMIT');
        return { ...existing.rows[0].result, replayed: true };
      }

      const merchantCount = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM merchant.merchant`,
      );
      if (merchantCount.rows[0]?.count !== '0')
        throw new ConflictException('initial_bootstrap_already_completed');

      const ids = await client.query<{
        merchantId: string;
        locationId: string;
        ownerUserId: string;
      }>(
        `WITH owner_user AS (
           INSERT INTO umi.user(id,email,full_name,status,password_algorithm,password_salt,password_hash)
           VALUES(coalesce($12::uuid,gen_random_uuid()),lower($1),$2,'active','scrypt-sha256-v1',$3,$4)
           RETURNING id
         ), merchant_row AS (
           INSERT INTO merchant.merchant(id,name,timezone,currency,locale)
           VALUES(coalesce($5::uuid,gen_random_uuid()),$6,$7,$8,$9) RETURNING id
         ), location_row AS (
           INSERT INTO merchant.location(id,merchant_id,name,timezone,status)
           SELECT coalesce($10::uuid,gen_random_uuid()),id,$11,$7,'active' FROM merchant_row RETURNING id,merchant_id
         ), owner_staff AS (
           INSERT INTO merchant.staff(id,merchant_id,location_id,user_id,role_id,name,email,position,status)
           SELECT coalesce($13::uuid,gen_random_uuid()),l.merchant_id,l.id,u.id,r.id,$2,lower($1),'owner','active'
             FROM location_row l CROSS JOIN owner_user u
             JOIN umi.role r ON r.key='owner'
           RETURNING merchant_id,location_id,user_id
         ), subscription_row AS (
           INSERT INTO umi.subscription(merchant_id,plan_id,status,current_period_start,current_period_end)
           SELECT o.merchant_id,p.id,'active',now(),now()+interval '365 days'
             FROM owner_staff o JOIN umi.plan p ON p.key='pilot-foundation'
           RETURNING merchant_id
         )
         SELECT o.merchant_id::text AS "merchantId",o.location_id::text AS "locationId",
                o.user_id::text AS "ownerUserId"
           FROM owner_staff o JOIN subscription_row s ON s.merchant_id=o.merchant_id`,
        [
          input.ownerEmail,
          input.ownerFullName,
          input.passwordSalt,
          input.passwordHash,
          input.merchantId,
          input.merchantName,
          input.timezone,
          input.currency,
          input.locale,
          input.locationId,
          input.locationName,
          input.ownerUserId,
          input.ownerStaffId,
        ],
      );
      const created = ids.rows[0];
      if (!created) throw new Error('bootstrap_atomic_creation_failed');
      const result: PlatformBootstrapResult = {
        ...created,
        commandId: input.commandId,
        replayed: false,
      };
      await client.query(
        `INSERT INTO runtime.platform_bootstrap_command(command_id,idempotency_key,fingerprint,result)
         VALUES($1::uuid,$2,$3,$4::jsonb)`,
        [input.commandId, input.idempotencyKey, input.fingerprint, JSON.stringify(result)],
      );
      await client.query(
        `INSERT INTO umi.audit_log(action,entity,entity_id,merchant_id,request_id,after)
         VALUES('create','initial_merchant',$1::uuid,$1::uuid,$2,$3::jsonb)`,
        [
          created.merchantId,
          input.commandId,
          JSON.stringify({ ownerUserId: created.ownerUserId, source: 'platform_bootstrap' }),
        ],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
