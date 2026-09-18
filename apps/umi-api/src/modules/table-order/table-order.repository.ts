import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { InventoryAllergenRef } from '@umi/contract';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';
import { planTables } from '../../shared/floor-plan/plan-tables';

/**
 * sha256 hex — the ONE way a table-order token is turned into the value this platform
 * stores. Exported because two callers must agree on it exactly: the guard that
 * RESOLVES a guest's token, and the service that ISSUES one. A second implementation
 * that hashed the token differently (base64, a salt, a trim) would mint credentials
 * nothing can look up, and it would do it silently — the insert would succeed.
 *
 * The shape matches `merchant.device.credential_hash` and
 * `runtime.device_pairing_session.setup_code_hash`, which is also what the column's
 * CHECK constraint enforces.
 */
export const hashTableOrderToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** The facts a table-order request may act on. Every one of them is the CREDENTIAL'S,
 * never the request's: this is the whole point of resolving a token rather than taking
 * a table id from the body. */
export interface ResolvedTableOrderCredential {
  credentialId: string;
  merchantId: string;
  locationId: string;
  tableId: string;
}

export interface CredentialRow {
  credentialId: string;
  locationId: string;
  tableId: string;
  createdAt: string;
  revokedAt: string | null;
}

/**
 * The two tables build-v3-75 adds, read and written directly.
 *
 * ONE QUERY RUNS ON THE BYPASSRLS POOL AND IT HAS TO: resolving the token to a
 * merchant is the step that happens BEFORE a merchant context exists. `pg.query` (the
 * worker pool) is the documented home for "work that RESOLVES which merchant a request
 * belongs to" — the same call `AuthRepository.merchantByHandle` makes for the public
 * gift-card routes — and everything after it runs through `runWithMerchant` with the
 * merchant and location seeded from the row it returned. Nothing else here reaches for
 * the unscoped pool: a read that forgot its merchant predicate on that pool would
 * return every café's rows rather than none.
 */
@Injectable()
export class TableOrderRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * The credential a guest's token names, or null.
   *
   * A REVOKED CREDENTIAL IS NULL, not a row with a flag. The caller has one refusal to
   * make ("this code does not order here"), and returning the revoked row so the caller
   * can tell the guest it was revoked would hand an attacker confirmation that the
   * token was once real. The owner still sees the revocation in `listCredentials`.
   */
  async resolveCredential(tokenHash: string): Promise<ResolvedTableOrderCredential | null> {
    const { rows } = await this.pg.query<{
      credentialId: string;
      merchantId: string;
      locationId: string;
      tableId: string;
    }>(
      `SELECT c.id::text AS "credentialId", c.merchant_id::text AS "merchantId",
              c.location_id::text AS "locationId", c.table_id::text AS "tableId"
         FROM merchant.table_order_credential c
         JOIN merchant.merchant m ON m.id = c.merchant_id
         JOIN merchant.location l ON l.id = c.location_id AND l.merchant_id = c.merchant_id
        WHERE c.token_hash = $1
          AND c.revoked_at IS NULL
          AND l.status = 'active'
        LIMIT 1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /**
   * The two names the guest reads at the top of the page, plus the currency every
   * amount on it is in. The currency comes from the MERCHANT (one café, one currency)
   * rather than from a product, so an empty menu still states its prices' currency.
   */
  async context(
    merchantId: string,
    locationId: string,
  ): Promise<{ merchantName: string; locationName: string; currency: string } | null> {
    const { rows } = await this.pg.tquery<{
      merchantName: string;
      locationName: string;
      currency: string;
    }>(
      merchantId,
      `SELECT m.name AS "merchantName", l.name AS "locationName", m.currency
         FROM merchant.merchant m
         JOIN merchant.location l ON l.merchant_id = m.id
        WHERE m.id = $1::uuid AND l.id = $2::uuid`,
      [merchantId, locationId],
    );
    return rows[0] ?? null;
  }

  /**
   * The floor-plan label of a table, and whether the table is in the served plan at
   * all. Read through the SHARED reader (`shared/floor-plan/plan-tables.ts`) rather
   * than a second parse of the document: table-map resolves capacity and the publish
   * guard compares occupied elements with the same function, and a third, slightly
   * different reader is how two screens come to disagree about what "the same table"
   * means.
   *
   * `null` means the table is not in the plan the room is being operated against — a
   * stale credential for a table that has since been removed. The caller refuses.
   */
  async tableLabel(
    merchantId: string,
    locationId: string,
    tableId: string,
  ): Promise<string | null> {
    const { rows } = await this.pg.tquery<{ plan: unknown }>(
      merchantId,
      `SELECT coalesce(published, draft) AS plan FROM merchant.floor_plan
        WHERE merchant_id = $1::uuid AND location_id = $2::uuid`,
      [merchantId, locationId],
    );
    const plan = rows[0]?.plan;
    if (plan === null || plan === undefined) return null;
    const table = planTables(plan).get(tableId);
    if (!table) return null;
    return table.label || table.tableId.slice(0, 8);
  }

  /**
   * §8.5, and D8: the allergen labels each of `productIds` carries, DERIVED from the
   * product's recipe by the ONE explosion (`merchant.product_allergen_labels`).
   *
   * ONE query for the whole menu, never one per product: a `JOIN LATERAL` over the id
   * array is the set-based form of the same question. A product that maps to no stock,
   * such as a `non_stock` product or one with no mapping at all, gets NO key. The caller
   * answers `[]` for it. That empty list says "no ingredient is recorded", which is the
   * honest answer; it does not claim the dish is free of an allergen.
   */
  async allergensByProduct(
    merchantId: string,
    productIds: string[],
  ): Promise<Map<string, InventoryAllergenRef[]>> {
    const byProduct = new Map<string, InventoryAllergenRef[]>();
    if (productIds.length === 0) return byProduct;
    const { rows } = await this.pg.tquery<{ productId: string; code: string; label: string }>(
      merchantId,
      `SELECT p.id::text AS "productId", a.code, a.label
         FROM unnest($2::uuid[]) AS p(id)
         JOIN LATERAL merchant.product_allergen_labels($1::uuid, p.id, null) a ON true
        ORDER BY p.id, a.code`,
      [merchantId, productIds],
    );
    for (const row of rows) {
      const labels = byProduct.get(row.productId) ?? [];
      labels.push({ code: row.code, label: row.label });
      byProduct.set(row.productId, labels);
    }
    return byProduct;
  }

  /**
   * The table's live state, LOCKED, or null when the table has no row at all.
   *
   * `FOR UPDATE` rather than a plain read because the write path decides whether a
   * party is present from this row, and a waiter clearing the table one millisecond
   * later must not produce an order on a table that is by then empty. The lock is
   * released at the caller's COMMIT, which is the same transaction that writes the
   * order — so the two facts cannot disagree.
   *
   * NOTE what is NOT tested here: `state = 'open'`. That state means "nobody is on it
   * and it is ready" (build-v3-67), so testing for it would refuse every seated guest.
   * A party is present exactly when `seated_at` is set, which is the equivalence
   * `table_state_party_presence` enforces and `table-map.repository.transition` uses.
   */
  async lockTableState(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    tableId: string,
  ): Promise<{ state: string; seatedAt: string | null } | null> {
    const { rows } = await client.query<{ state: string; seatedAt: string | null }>(
      `SELECT state, seated_at::text AS "seatedAt" FROM merchant.table_state
        WHERE merchant_id = $1::uuid AND location_id = $2::uuid AND table_id = $3::uuid
        FOR UPDATE`,
      [merchantId, locationId, tableId],
    );
    return rows[0] ?? null;
  }

  /** The order's own derived total, in centavos, as the platform computes it. */
  async orderTotal(client: PoolClient, orderId: string): Promise<number> {
    const { rows } = await client.query<{ total: string | number }>(
      `SELECT total FROM merchant.order_total WHERE order_id = $1::uuid`,
      [orderId],
    );
    return rows[0] ? Number(rows[0].total) : 0;
  }

  /**
   * The intake's own record of an order. Written in the same transaction as the order
   * and its kitchen ticket, so a committed order always has a link and a refused one
   * always has none.
   */
  async insertLink(
    client: PoolClient,
    input: {
      orderId: string;
      merchantId: string;
      locationId: string;
      tableId: string;
      credentialId: string;
      guestName: string | null;
      guestPhone: string | null;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO merchant.table_order
         (order_id, merchant_id, location_id, table_id, credential_id, guest_name, guest_phone)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7)`,
      [
        input.orderId,
        input.merchantId,
        input.locationId,
        input.tableId,
        input.credentialId,
        input.guestName,
        input.guestPhone,
      ],
    );
  }

  // ── The owner's door (issue / revoke) ───────────────────────────────────────

  async listCredentials(
    merchantId: string,
    locationId: string,
  ): Promise<Array<CredentialRow & { tableLabel: string }>> {
    // The timestamps come back as `Date` and are converted here, NOT with `::text` in the
    // SQL. Postgres renders a timestamptz as `2026-09-17 08:51:26.123+00` — a space and a
    // two-digit offset — which is not the ISO-8601 the contract declares, so a `::text`
    // column would make every one of these responses fail its own schema.
    const { rows } = await this.pg.tquery<{
      credentialId: string;
      locationId: string;
      tableId: string;
      createdAt: Date;
      revokedAt: Date | null;
    }>(
      merchantId,
      `SELECT id::text AS "credentialId", location_id::text AS "locationId",
              table_id::text AS "tableId", created_at AS "createdAt",
              revoked_at AS "revokedAt"
         FROM merchant.table_order_credential
        WHERE merchant_id = $1::uuid AND location_id = $2::uuid
        ORDER BY created_at DESC, id DESC`,
      [merchantId, locationId],
    );
    const label = await this.tableLabels(merchantId, locationId);
    return rows.map((row) => ({
      credentialId: row.credentialId,
      locationId: row.locationId,
      tableId: row.tableId,
      createdAt: row.createdAt.toISOString(),
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      tableLabel: label.get(row.tableId) ?? '',
    }));
  }

  /** Every label in the served plan, once, for a list read. */
  private async tableLabels(merchantId: string, locationId: string): Promise<Map<string, string>> {
    const { rows } = await this.pg.tquery<{ plan: unknown }>(
      merchantId,
      `SELECT coalesce(published, draft) AS plan FROM merchant.floor_plan
        WHERE merchant_id = $1::uuid AND location_id = $2::uuid`,
      [merchantId, locationId],
    );
    const plan = rows[0]?.plan;
    if (plan === null || plan === undefined) return new Map();
    return new Map(
      [...planTables(plan).values()].map((table) => [
        table.tableId,
        table.label || table.tableId.slice(0, 8),
      ]),
    );
  }

  async insertCredential(
    client: PoolClient,
    input: {
      credentialId: string;
      merchantId: string;
      locationId: string;
      tableId: string;
      tokenHash: string;
      createdByUserId: string | null;
    },
  ): Promise<{ createdAt: string } | null> {
    const { rows } = await client.query<{ createdAt: Date }>(
      `INSERT INTO merchant.table_order_credential
         (id, merchant_id, location_id, table_id, token_hash, created_by_user_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::uuid)
       ON CONFLICT (merchant_id, location_id, table_id) WHERE revoked_at IS NULL
         DO NOTHING
       RETURNING created_at AS "createdAt"`,
      [
        input.credentialId,
        input.merchantId,
        input.locationId,
        input.tableId,
        input.tokenHash,
        input.createdByUserId,
      ],
    );
    return rows[0] ? { createdAt: rows[0].createdAt.toISOString() } : null;
  }

  /**
   * Revoke one credential. Idempotent: revoking twice returns the row it already
   * revoked rather than moving `revoked_at`, because the timestamp is the record of
   * when the code STOPPED working and a retry did not change that.
   */
  async revokeCredential(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    credentialId: string,
    revokedByUserId: string | null,
  ): Promise<{ revokedAt: string | null; tableId: string } | null> {
    const { rows } = await client.query<{ revokedAt: Date | null; tableId: string }>(
      `UPDATE merchant.table_order_credential
          SET revoked_at = COALESCE(revoked_at, now()),
              revoked_by_user_id = COALESCE(revoked_by_user_id, $4::uuid)
        WHERE merchant_id = $1::uuid AND location_id = $2::uuid AND id = $3::uuid
        RETURNING revoked_at AS "revokedAt", table_id::text AS "tableId"`,
      [merchantId, locationId, credentialId, revokedByUserId],
    );
    const row = rows[0];
    return row
      ? { revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null, tableId: row.tableId }
      : null;
  }
}
