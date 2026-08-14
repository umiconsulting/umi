import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface StaffRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: 'ADMIN' | 'STAFF';
  status: string;
  permissions: Record<string, boolean> | null;
  invitedAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

// `role` comes from the real grant now — merchant.staff.role_id joined to the
// umi.role catalog — not from `lower(name) = 'admin'`. It is still narrowed to the
// two values the wire contract declares, so the dashboard renders unchanged: the
// catalog has four café roles and the DTO has two.
//
// `permissions` and `invitedAt` stay synthesized. The permission set is derivable
// (umi.role_permission), but the dashboard has always received null here and widening
// it is a contract change, not a repair. `invitedAt` has no source at all: an
// invitation belongs to umi.user, and that table records no timestamp for it.
//
// Every column is aliased `s.`, because the projection is used with a join.
const PROJECTION = `
  s.id::text,
  s.name,
  s.phone,
  s.email,
  CASE WHEN r.key IN ('owner','admin') THEN 'ADMIN' ELSE 'STAFF' END AS role,
  s.status,
  NULL::jsonb AS permissions,
  NULL::timestamptz AS "invitedAt",
  s.created_at AS "createdAt",
  s.updated_at AS "updatedAt"`;

// A staff member added from the dashboard gets the LEAST café role. Anything more is
// an explicit act by someone who already holds `merchant.manage`.
const DEFAULT_ROLE = `(SELECT id FROM umi.role WHERE key = 'staff')`;

@Injectable()
export class StaffRepository {
  constructor(private readonly pg: PgService) {}

  async list(merchantId: string): Promise<StaffRow[]> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<StaffRow>(
        `SELECT ${PROJECTION}, NULL::timestamptz AS "disabledAt"
         FROM merchant.staff AS s
         LEFT JOIN umi.role AS r ON r.id = s.role_id
         WHERE s.merchant_id = $1::uuid
         ORDER BY
           CASE WHEN r.key IN ('owner','admin') THEN 0 ELSE 1 END,
           CASE s.status WHEN 'active' THEN 0 ELSE 1 END,
           s.created_at ASC`,
        [merchantId],
      ),
    );
    return rows;
  }

  async insert(
    merchantId: string,
    locationId: string | null,
    data: {
      name: string;
      phone: string | null;
      email: string | null;
      status: string;
      pinSalt: string | null;
      pinHash: string | null;
      pinLookup: string | null;
    },
  ): Promise<StaffRow> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<StaffRow>(
        // An employment is always backed by a umi.user (merchant.staff.user_id is NOT
        // NULL), so this statement mints one. Everything is one statement, so a failure
        // cannot leave a user with no employment.
        //
        // IT NEVER LINKS TO AN EXISTING ACCOUNT, and that is the whole point of `taken`.
        // An earlier version looked up umi.user by email and reused the match, so a café
        // could type any known address — hola@umiconsulting.co included — and silently
        // employ that person. Membership is not something one party grants themselves
        // over another; it needs an invitation the recipient accepts, and no such flow
        // exists yet.
        //
        // So when the address is already claimed, the new umi.user is created WITHOUT an
        // email. The typed address still lands on merchant.staff.email, which is the
        // employment contact and was never the login. The behaviour is identical whether
        // or not the address exists, so this also cannot be used to probe for accounts.
        //
        // The cost, stated: one human working at two cafés holds two umi.user rows until
        // an invitation flow reconciles them. That is the honest position — we cannot
        // prove two employments are the same person from a typed string.
        //
        // The new user gets no password. Its status follows the only door it has:
        //   no email (or taken) -> 'active'   the person exists to hold a till PIN
        //   a free email        -> 'invited'  a dashboard invitation is still owed
        // 'active' + email + no hash is precisely what security_gate.sql refuses.
        //
        // RETURNING cannot join, so the write is wrapped in a CTE and the role catalog
        // is joined to its output. One round trip.
        `WITH taken AS (
           SELECT 1 FROM umi.user
            WHERE $5::text IS NOT NULL AND lower(email) = lower($5::text)
            LIMIT 1
         ), created AS (
           INSERT INTO umi.user (email, full_name, status)
           SELECT
             CASE WHEN EXISTS (SELECT 1 FROM taken) THEN NULL ELSE $5::text END,
             $3::text,
             CASE WHEN $5::text IS NULL OR EXISTS (SELECT 1 FROM taken)
                  THEN 'active' ELSE 'invited' END
           RETURNING id
         ), person AS (
           SELECT id FROM created
         ), ins AS (
           INSERT INTO merchant.staff
             (merchant_id, location_id, user_id, role_id, name, phone, email, status,
              operator_pin_salt, operator_pin_hash, operator_pin_lookup)
           SELECT $1::uuid, $2::uuid, person.id, ${DEFAULT_ROLE}, $3, $4, $5, $6,
                  $7, $8, $9
             FROM person
           RETURNING *
         )
         SELECT ${PROJECTION}, NULL::timestamptz AS "disabledAt"
         FROM ins AS s
         LEFT JOIN umi.role AS r ON r.id = s.role_id`,
        [
          merchantId,
          locationId,
          data.name,
          data.phone,
          data.email,
          data.status,
          data.pinSalt,
          data.pinHash,
          data.pinLookup,
        ],
      ),
    );
    return rows[0];
  }

  async update(
    merchantId: string,
    staffId: string,
    patch: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      status?: string | null;
    },
  ): Promise<StaffRow | null> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<StaffRow>(
        `WITH upd AS (
           UPDATE merchant.staff
           SET name = COALESCE($3, name),
               phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
               email = CASE WHEN $6::boolean THEN $7 ELSE email END,
               status = COALESCE($8, status),
               updated_at = now()
           WHERE id = $2::uuid AND merchant_id = $1::uuid
           RETURNING *
         )
         SELECT ${PROJECTION},
           CASE WHEN s.status = 'disabled' THEN s.updated_at ELSE NULL END AS "disabledAt"
         FROM upd AS s
         LEFT JOIN umi.role AS r ON r.id = s.role_id`,
        [
          merchantId,
          staffId,
          patch.name ?? null,
          patch.phone !== undefined,
          patch.phone ?? null,
          patch.email !== undefined,
          patch.email ?? null,
          patch.status ?? null,
        ],
      ),
    );
    return rows[0] ?? null;
  }

  async softDelete(merchantId: string, staffId: string): Promise<boolean> {
    const { rows } = await this.pg.withMerchant((c) =>
      c.query<{ id: string }>(
        `UPDATE merchant.staff
         SET status = 'disabled', updated_at = now()
         WHERE id = $2::uuid AND merchant_id = $1::uuid
         RETURNING id::text`,
        [merchantId, staffId],
      ),
    );
    return rows.length > 0;
  }
}
