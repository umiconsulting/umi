import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FloorPlanState, type FloorPlanDocument, type PosFloorPlanQuery } from '@umi/contract';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import { occupiedTablesDisturbed } from '../../shared/floor-plan/plan-tables';
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

/**
 * THE OCCUPIED-TABLE PUBLISH GUARD (workstream D; the floor-plan foundation
 * document's closing line).
 *
 * A layout is what every till draws, and what the seating rules were applied
 * against. Publishing one that removes or moves a table with a party on it would
 * tell the room a false thing about where people are, so it is refused here —
 * before the UPDATE, in the same transaction — and the refusal names the tables.
 *
 * WHAT IT COMPARES AGAINST: the PUBLISHED document, because that is the layout
 * the floor is operated against (`table-map` resolves every table against
 * `coalesce(published, draft)`, and the POS only ever draws the published one).
 * Two cases fall out of that:
 *
 *   - Nothing published yet and a party is on the floor. There is no layout to
 *     compare against, so the safe answer is to refuse rather than publish over a
 *     seated room: the document the party was seated against is gone (a save
 *     replaces the draft), and "no baseline" cannot be read as "unchanged". In
 *     practice this is unreachable through a till — a location with nothing
 *     published draws no map, so nobody can be seated there — which is exactly
 *     why refusing costs nothing and guessing would.
 *   - Nothing published and nobody seated: publishing is free, nobody to disturb.
 *
 * WHAT IS REFUSED, precisely: an occupied table's element that has been removed,
 * moved to another area, moved, resized or rotated, and a change to its capacity
 * or label. `shape` may change. The reasoning for each is in
 * `shared/floor-plan/plan-tables.ts`.
 */
async function assertOccupiedTablesUndisturbed(
  client: PoolClient,
  merchantId: string,
  locationId: string,
  current: Row,
) {
  const occupied = await client.query<{ table_id: string }>(
    `SELECT table_id::text AS table_id FROM merchant.table_state
     WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND seated_at IS NOT NULL
     ORDER BY table_id`,
    [merchantId, locationId],
  );
  const tableIds = occupied.rows.map((row) => row.table_id);
  if (tableIds.length === 0) return;
  if (current.published === null)
    throw new ConflictException({
      code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
      message:
        'A party is on the floor and this location has no published layout to compare the draft against.',
      fieldErrors: { tableIds },
    });
  const disturbed = occupiedTablesDisturbed(current.published, current.draft, tableIds);
  if (disturbed.length > 0)
    throw new ConflictException({
      code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
      message: 'A table with a party on it would be removed or moved by this layout.',
      fieldErrors: { tableIds: disturbed },
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
    // Publishing is the moment a layout becomes what every till draws, so it is
    // the moment to refuse a layout that would move or drop a table a party is
    // sitting at. THE RULE IS THE FOUNDATION DOCUMENT'S closing line
    // (docs/architecture/2026-09-13-floor-plan-foundation.md): occupied-table
    // publication checks must exist before the map carries visits. This is that
    // check, and it runs BEFORE the UPDATE, inside the same transaction, so a
    // refusal leaves both the draft and the published document untouched.
    if (!document) await assertOccupiedTablesUndisturbed(client, merchantId, locationId, current);
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
