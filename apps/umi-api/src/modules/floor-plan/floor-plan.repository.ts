import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FloorPlanState, type FloorPlanDocument, type PosFloorPlanQuery } from '@umi/contract';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import type { AuthUser } from '../auth/auth.types';

type Row = {
  version: number;
  draft: unknown;
  published_version: number;
  published: unknown;
  published_at: Date | null;
};
export function floorPlanState(locationId: string, row?: Row): FloorPlanState {
  return FloorPlanState.parse({
    locationId,
    version: row?.version ?? 0,
    draft: row?.draft ?? null,
    publishedVersion: row?.published_version ?? 0,
    published: row?.published ?? null,
    publishedAt: row?.published_at?.toISOString() ?? null,
  });
}

@Injectable()
export class FloorPlanRepository {
  constructor(private readonly pg: PgService) {}

  async assertLocation(client: PoolClient, merchantId: string, locationId: string) {
    const result = await client.query(
      `SELECT id FROM merchant.location WHERE merchant_id=$1::uuid AND id=$2::uuid AND status='active' FOR SHARE`,
      [merchantId, locationId],
    );
    if (!result.rowCount) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
  }

  async read(merchantId: string, locationId: string) {
    return this.pg.withMerchant(async (client) => {
      await this.assertLocation(client, merchantId, locationId);
      const result = await client.query<Row>(
        'SELECT version,draft,published_version,published,published_at FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid',
        [merchantId, locationId],
      );
      return floorPlanState(locationId, result.rows[0]);
    });
  }

  async readForPos(user: AuthUser, merchantId: string, query: PosFloorPlanQuery) {
    return this.pg.runWithMerchant(
      merchantId,
      user.id,
      async (client) => {
        const authorization = await client.query(
          `SELECT 1 FROM runtime.operator_session os
        JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
        WHERE os.id=$1::uuid AND os.user_id=$2::uuid AND os.durable_session_id=$3::uuid
          AND os.device_id=$4::uuid AND os.merchant_id=$5::uuid AND os.location_id=$6::uuid
          AND os.state='active' AND os.expires_at>now() AND d.status='active'
          AND ('sale.lifecycle'=ANY(os.permissions) OR '*'=ANY(os.permissions))
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
            WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))`,
          [
            query.operatorSessionId,
            user.id,
            user.sessionId,
            user.deviceId,
            merchantId,
            query.locationId,
          ],
        );
        if (!authorization.rowCount) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
        await this.assertLocation(client, merchantId, query.locationId);
        const result = await client.query<
          Pick<Row, 'published_version' | 'published' | 'published_at'>
        >(
          'SELECT published_version,published,published_at FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid',
          [merchantId, query.locationId],
        );
        const row = result.rows[0];
        return {
          locationId: query.locationId,
          publishedVersion: row?.published_version ?? 0,
          published: row?.published ?? null,
          publishedAt: row?.published_at?.toISOString() ?? null,
        };
      },
      query.locationId,
    );
  }

  async change(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    expectedVersion: number,
    document?: FloorPlanDocument,
  ) {
    await this.assertLocation(client, merchantId, locationId);
    if (document)
      await client.query(
        `INSERT INTO merchant.floor_plan (merchant_id,location_id,draft)
      VALUES ($1::uuid,$2::uuid,$3::jsonb) ON CONFLICT (merchant_id,location_id) DO NOTHING`,
        [merchantId, locationId, JSON.stringify(document)],
      );
    const locked = await client.query<Row>(
      'SELECT version,draft,published_version,published,published_at FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid FOR UPDATE',
      [merchantId, locationId],
    );
    const current = locked.rows[0];
    if (!current || current.version !== expectedVersion)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: current?.version ?? 0,
      });
    if (!document && current.version === 0)
      throw new ConflictException({ code: 'FLOOR_PLAN_DRAFT_REQUIRED' });
    const result = document
      ? await client.query<Row>(
          `UPDATE merchant.floor_plan SET draft=$3::jsonb,version=version+1,updated_at=now()
          WHERE merchant_id=$1::uuid AND location_id=$2::uuid RETURNING *`,
          [merchantId, locationId, JSON.stringify(document)],
        )
      : await client.query<Row>(
          `UPDATE merchant.floor_plan SET published=draft,published_version=version+1,
          version=version+1,published_at=now(),updated_at=now()
          WHERE merchant_id=$1::uuid AND location_id=$2::uuid RETURNING *`,
          [merchantId, locationId],
        );
    return floorPlanState(locationId, result.rows[0]);
  }
}
