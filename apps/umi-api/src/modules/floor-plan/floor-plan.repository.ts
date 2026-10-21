import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  FloorPlanState,
  FloorPlanDocument,
  PublishedFloorPlan,
  floorElementBounds,
  type AddPosTableRequest,
  type PosFloorPlanQuery,
  type InitializePosTablesRequest,
} from '@umi/contract';
import { randomUUID } from 'node:crypto';
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
  const blockers = await occupiedBlockers(client, merchantId, locationId, current);
  if (blockers.length === 0) return;
  const tableIds = blockers.map((blocker) => blocker.tableId);
  throw new ConflictException({
    code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED',
    message: 'A table with a party or an open account would be removed or moved by this layout.',
    fieldErrors: {
      tableIds,
      blockers: blockers.slice(0, 20).map((blocker) => blocker.label),
      blockerAccounts: blockers
        .filter((blocker) => blocker.accountId)
        .slice(0, 20)
        .map(
          (blocker) =>
            `${blocker.tableId}|${blocker.accountId}|${blocker.accountVersion}|${blocker.accountReference}`,
        ),
    },
  });
}

type OccupiedBlocker = {
  tableId: string;
  label: string;
  accountId: string | null;
  accountVersion: number | null;
  accountReference: string | null;
};

async function occupiedBlockers(
  client: PoolClient,
  merchantId: string,
  locationId: string,
  current: Row,
): Promise<OccupiedBlocker[]> {
  const occupied = await client.query<{ table_id: string }>(
    `SELECT table_id::text AS table_id FROM merchant.table_state
     WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND seated_at IS NOT NULL
     UNION
     SELECT table_id::text AS table_id FROM merchant.pos_cart
     WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id IS NOT NULL
       AND status IN ('draft','prepared')
     ORDER BY table_id`,
    [merchantId, locationId],
  );
  const tableIds = occupied.rows.map((row) => row.table_id);
  if (tableIds.length === 0) return [];
  const disturbed =
    current.published === null
      ? tableIds
      : occupiedTablesDisturbed(current.published, current.draft, tableIds);
  if (disturbed.length === 0) return [];

  const draft = current.draft ? FloorPlanDocument.safeParse(current.draft).data : null;
  const published = current.published
    ? FloorPlanDocument.safeParse(current.published).data
    : null;
  const labels = new Map<string, string>();
  for (const document of [published, draft]) {
    for (const area of document?.areas ?? []) {
      for (const element of area.elements) {
        if (element.kind === 'table') labels.set(element.id, element.label);
      }
    }
  }
  const accounts = await client.query<{
    id: string;
    version: number;
    tableId: string;
    accountNumber: number;
    dailyAccountNumber: number | null;
  }>(
    `SELECT c.id::text,c.version,c.table_id::text AS "tableId",
            c.account_number AS "accountNumber",
            c.daily_account_number AS "dailyAccountNumber"
       FROM merchant.pos_cart c
      WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid
        AND c.table_id=ANY($3::uuid[]) AND c.status IN ('draft','prepared')
      ORDER BY c.daily_account_number NULLS LAST,c.account_number`,
    [merchantId, locationId, disturbed],
  );
  const accountByTable = new Map(accounts.rows.map((account) => [account.tableId, account]));
  return disturbed.map((tableId) => {
    const account = accountByTable.get(tableId);
    return {
      tableId,
      label: labels.get(tableId) ?? `Mesa ${tableId.slice(0, 8)}`,
      accountId: account?.id ?? null,
      accountVersion: account?.version ?? null,
      accountReference: account
        ? String(account.dailyAccountNumber ?? account.accountNumber).padStart(3, '0')
        : null,
    };
  });
}

@Injectable()
export class FloorPlanRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Accounts currently preventing this draft from being published.
   *
   * Used only by the dashboard's explicit "close accounts and publish" choice.
   * The publish itself still runs the same occupied-table guard afterwards, so a
   * race that creates another account refuses instead of publishing over it.
   */
  async blockingAccounts(client: PoolClient, merchantId: string, locationId: string) {
    const locked = await client.query<Row>(
      `SELECT version,draft,published_version,published,published_at
         FROM merchant.floor_plan
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid
        FOR UPDATE`,
      [merchantId, locationId],
    );
    const current = locked.rows[0];
    if (!current) return [];
    return occupiedBlockers(client, merchantId, locationId, current);
  }

  async assertLocation(client: PoolClient, merchantId: string, locationId: string) {
    const result = await client.query(
      `SELECT id FROM merchant.location WHERE merchant_id=$1::uuid AND id=$2::uuid AND status='active' FOR SHARE`,
      [merchantId, locationId],
    );
    if (!result.rowCount) throw new NotFoundException({ code: 'LOCATION_NOT_FOUND' });
  }

  private async assertBootstrapOperator(
    client: PoolClient,
    user: AuthUser,
    merchantId: string,
    dto: PosFloorPlanQuery,
  ) {
    const result = await client.query(
      `SELECT os.id FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
       WHERE os.id=$1::uuid AND os.user_id=$2::uuid AND os.durable_session_id=$3::uuid
         AND os.device_id=$4::uuid AND os.merchant_id=$5::uuid AND os.location_id=$6::uuid
         AND os.state='active' AND os.expires_at>now() AND d.status='active'
         AND ('cart.write'=ANY(os.permissions) OR '*'=ANY(os.permissions))
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos' AND coalesce((e->>'enabled')::boolean,false))
       FOR SHARE OF os,d`,
      [dto.operatorSessionId, user.id, user.sessionId, user.deviceId, merchantId, dto.locationId],
    );
    if (!result.rowCount) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
  }

  authorizeBootstrap(user: AuthUser, merchantId: string, dto: PosFloorPlanQuery) {
    return this.pg.runWithMerchant(
      merchantId,
      user.id,
      (client) => this.assertBootstrapOperator(client, user, merchantId, dto),
      dto.locationId,
    );
  }

  async bootstrapTables(
    client: PoolClient,
    user: AuthUser,
    merchantId: string,
    dto: InitializePosTablesRequest,
  ) {
    await this.assertBootstrapOperator(client, user, merchantId, dto);
    await this.assertLocation(client, merchantId, dto.locationId);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `floor_plan:${merchantId}:${dto.locationId}`,
    ]);
    const slots = [...dto.slots].sort((a, b) => a - b);
    const area = {
      id: randomUUID(),
      name: 'Mesas',
      width: 720,
      height: Math.max(480, (Math.floor(slots.at(-1)! / 4) + 1) * 160 + 40),
      elements: slots.map((slot, index) => ({
        id: randomUUID(),
        kind: 'table' as const,
        shape: 'square' as const,
        label: `Mesa ${index + 1}`,
        capacity: 4,
        x: 100 + (slot % 4) * 160,
        y: 100 + Math.floor(slot / 4) * 160,
        width: 120,
        height: 120,
        rotation: 0,
      })),
    };
    const empty = { schemaVersion: 1, areas: [{ ...area, elements: [] }] };
    await client.query(
      `INSERT INTO merchant.floor_plan(merchant_id,location_id,draft)
      VALUES ($1::uuid,$2::uuid,$3::jsonb) ON CONFLICT(merchant_id,location_id) DO NOTHING`,
      [merchantId, dto.locationId, JSON.stringify(empty)],
    );
    const locked = await client.query<Row>(
      `SELECT version,draft,published_version,published,published_at
      FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid FOR UPDATE`,
      [merchantId, dto.locationId],
    );
    const current = locked.rows[0];
    if (!current || current.published_version !== dto.expectedPublishedVersion)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: current?.published_version ?? 0,
      });
    const draft = current.draft == null ? null : FloorPlanDocument.parse(current.draft);
    const published = current.published == null ? null : FloorPlanDocument.parse(current.published);
    if (published?.areas.some((room) => room.elements.some((element) => element.kind === 'table')))
      throw new ConflictException({ code: 'FLOOR_PLAN_ALREADY_CONFIGURED' });
    const hasDraftElements = draft?.areas.some((room) => room.elements.length > 0) ?? false;
    if (
      (published != null && JSON.stringify(draft) !== JSON.stringify(published)) ||
      (published == null && hasDraftElements)
    )
      throw new ConflictException({ code: 'FLOOR_PLAN_DRAFT_PENDING' });
    const occupied = await client.query(
      `SELECT 1 FROM merchant.table_state WHERE merchant_id=$1::uuid
      AND location_id=$2::uuid AND seated_at IS NOT NULL UNION ALL SELECT 1 FROM merchant.pos_cart
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id IS NOT NULL
        AND status IN ('draft','prepared') LIMIT 1`,
      [merchantId, dto.locationId],
    );
    if (occupied.rowCount)
      throw new ConflictException({ code: 'FLOOR_PLAN_OCCUPIED_TABLE_CHANGED' });
    const base = published ?? draft;
    const priorAreas = base?.areas.filter((room) => room.id !== area.id) ?? [];
    if (priorAreas.length >= 20)
      throw new ConflictException({ code: 'FLOOR_PLAN_ALREADY_CONFIGURED' });
    const names = new Set(priorAreas.map((room) => room.name.toLowerCase()));
    let suffix = 2;
    while (names.has(area.name.toLowerCase())) area.name = `Mesas ${suffix++}`;
    const document = FloorPlanDocument.parse({ schemaVersion: 1, areas: [area, ...priorAreas] });
    const result = await client.query<Row>(
      `UPDATE merchant.floor_plan SET draft=$3::jsonb,published=$3::jsonb,
      version=version+1,published_version=version+1,published_at=now(),updated_at=now()
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid RETURNING *`,
      [merchantId, dto.locationId, JSON.stringify(document)],
    );
    const row = result.rows[0];
    return PublishedFloorPlan.parse({
      locationId: dto.locationId,
      publishedVersion: row.published_version,
      published: row.published,
      publishedAt: row.published_at?.toISOString() ?? null,
    });
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

  async addTable(client: PoolClient, user: AuthUser, merchantId: string, dto: AddPosTableRequest) {
    await this.assertBootstrapOperator(client, user, merchantId, dto);
    await this.assertLocation(client, merchantId, dto.locationId);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `floor_plan:${merchantId}:${dto.locationId}`,
    ]);
    const locked = await client.query<Row>(
      `SELECT version,draft,published_version,published,published_at FROM merchant.floor_plan
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid FOR UPDATE`,
      [merchantId, dto.locationId],
    );
    const current = locked.rows[0];
    if (!current?.published) throw new ConflictException({ code: 'FLOOR_PLAN_NOT_PUBLISHED' });
    if (current.published_version !== dto.expectedPublishedVersion)
      throw new ConflictException({
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        currentVersion: current.published_version,
      });
    const published = FloorPlanDocument.parse(current.published);
    const draft = FloorPlanDocument.parse(current.draft);
    const areas = [published, draft].map((doc) => doc.areas.find((area) => area.id === dto.areaId));
    if (areas.some((area) => !area))
      throw new ConflictException({ code: 'FLOOR_PLAN_DRAFT_PENDING' });
    const rooms = areas.map((area) => area!);
    if (
      rooms.some((area) =>
        area.elements.some(
          (element) =>
            element.kind === 'table' &&
            element.label.toLocaleLowerCase('en-US') === dto.label.toLocaleLowerCase('en-US'),
        ),
      )
    )
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        fieldErrors: { label: ['A table already has this name.'] },
      });

    // Add in the first free position of BOTH snapshots. Never publish unrelated draft edits.
    const width = Math.min(...rooms.map((area) => area.width));
    let position: { x: number; y: number } | null = null;
    for (let y = 80; y <= 4920 && !position; y += 160) {
      for (let x = 80; x <= width - 80; x += 160) {
        const overlaps = rooms.some((area) =>
          area.elements.some((element) => {
            const bounds = floorElementBounds(element);
            return (
              Math.abs(element.x - x) < bounds.halfWidth + 80 &&
              Math.abs(element.y - y) < bounds.halfHeight + 80
            );
          }),
        );
        if (!overlaps) {
          position = { x, y };
          break;
        }
      }
    }
    if (!position)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        fieldErrors: { areaId: ['No space remains in this area.'] },
      });
    const table = {
      id: randomUUID(),
      kind: 'table' as const,
      shape: 'square' as const,
      label: dto.label,
      capacity: dto.capacity,
      ...position,
      width: 120,
      height: 120,
      rotation: 0,
    };
    for (const area of rooms) {
      area.elements.push(table);
      area.height = Math.max(area.height, position.y + 80);
    }
    for (const document of [published, draft]) {
      if (!FloorPlanDocument.safeParse(document).success)
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          fieldErrors: { areaId: ['The floor plan has reached its limit.'] },
        });
    }
    const result = await client.query<Row>(
      `UPDATE merchant.floor_plan SET published=$3::jsonb,draft=$4::jsonb,
       version=version+1,published_version=version+1,published_at=now(),updated_at=now()
       WHERE merchant_id=$1::uuid AND location_id=$2::uuid RETURNING *`,
      [merchantId, dto.locationId, JSON.stringify(published), JSON.stringify(draft)],
    );
    const row = result.rows[0];
    return PublishedFloorPlan.parse({
      locationId: dto.locationId,
      publishedVersion: row.published_version,
      published: row.published,
      publishedAt: row.published_at?.toISOString() ?? null,
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
          AND ('sale.lifecycle'=ANY(os.permissions) OR 'cart.write'=ANY(os.permissions)
            OR '*'=ANY(os.permissions))
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
