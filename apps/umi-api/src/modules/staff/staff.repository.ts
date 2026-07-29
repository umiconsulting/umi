import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface StaffRow {
  id: string;
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  permissions: Record<string, boolean> | null;
  invitedAt: Date | null;
  disabledAt: Date | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

const PROJECTION = `
  s.id::text,
  s.user_id::text AS "userId",
  u.full_name AS name,
  NULL::text AS phone,
  u.email,
  COALESCE((array_agg(DISTINCT r.key) FILTER (WHERE r.key IS NOT NULL))[1], 'staff') AS role,
  s.status,
  COALESCE(jsonb_object_agg(p.key, true) FILTER (WHERE p.key IS NOT NULL), '{}'::jsonb)
    AS permissions,
  CASE WHEN u.status = 'invited' THEN u.created_at ELSE NULL END AS "invitedAt",
  s.created_at AS "createdAt",
  s.updated_at AS "updatedAt"`;

@Injectable()
export class StaffRepository {
  constructor(private readonly pg: PgService) {}

  async list(tenantId: string): Promise<StaffRow[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<StaffRow>(
        `SELECT ${PROJECTION}, NULL::timestamptz AS "disabledAt"
         FROM tenant.staff AS s
         JOIN umi.user AS u ON u.id = s.user_id
         LEFT JOIN umi.user_role AS ur
           ON ur.user_id = s.user_id AND ur.business_id = s.business_id
         LEFT JOIN umi.role AS r ON r.id = ur.role_id
         LEFT JOIN umi.role_permission AS rp ON rp.role_id = r.id
         LEFT JOIN umi.permission AS p ON p.id = rp.permission_id
         WHERE s.business_id = $1::uuid
         GROUP BY s.id, u.id
         ORDER BY
           CASE WHEN bool_or(r.key IN ('owner', 'admin')) THEN 0 ELSE 1 END,
           s.created_at ASC`,
        [tenantId],
      ),
    );
    return rows;
  }

  async insert(
    tenantId: string,
    locationId: string | null,
    data: {
      name: string;
      email: string;
      role: string;
      position: string | null;
      actorUserId: string;
      pinSalt: string | null;
      pinHash: string | null;
      pinLookupHash: string | null;
    },
  ): Promise<StaffRow> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const user = await client.query<{ id: string }>(
        `WITH inserted AS (
           INSERT INTO umi.user (email, full_name, status)
           VALUES (lower($1), $2, 'invited')
           ON CONFLICT ((lower(email))) DO NOTHING
           RETURNING id
         )
         SELECT id::text FROM inserted
         UNION ALL
         SELECT id::text FROM umi.user
         WHERE lower(email) = lower($1) AND status <> 'suspended'
         LIMIT 1`,
        [data.email, data.name],
      );
      if (!user.rows[0]) throw new Error('staff_identity_not_available');
      const userId = user.rows[0].id;
      const role = await client.query<{ id: string }>(
        `SELECT id::text FROM umi.role WHERE key = $1 AND NOT is_platform LIMIT 1`,
        [data.role],
      );
      if (!role.rows[0]) throw new Error('invalid_staff_role');
      const staff = await client.query<{ id: string }>(
        `INSERT INTO tenant.staff
           (business_id, branch_id, user_id, position, status,
            operator_pin_salt, operator_pin_hash, operator_pin_lookup_hash)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'active', $5, $6, $7)
         RETURNING id::text`,
        [
          tenantId,
          locationId,
          userId,
          data.position,
          data.pinSalt,
          data.pinHash,
          data.pinLookupHash,
        ],
      );
      await client.query(
        `INSERT INTO umi.user_role (user_id, role_id, business_id, branch_id, granted_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)
         ON CONFLICT DO NOTHING`,
        [userId, role.rows[0].id, tenantId, locationId, data.actorUserId],
      );
      await client.query('COMMIT');
      const row = await this.findById(tenantId, staff.rows[0].id);
      if (!row) throw new Error('created_staff_not_found');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(
    tenantId: string,
    staffId: string,
    patch: {
      status?: string | null;
    },
  ): Promise<StaffRow | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<StaffRow>(
        `UPDATE tenant.staff
         SET status = COALESCE($3, status), updated_at = now()
         WHERE id = $2::uuid AND business_id = $1::uuid
         RETURNING id::text`,
        [tenantId, staffId, patch.status ?? null],
      ),
    );
    if (!rows[0]) return null;
    return this.findById(tenantId, staffId);
  }

  async updateOperatorPin(
    tenantId: string,
    staffId: string,
    pin: { salt: string; hash: string; lookupHash: string } | null,
  ): Promise<boolean> {
    const { rowCount } = await this.pg.withTenant((c) =>
      c.query(
        `UPDATE tenant.staff
         SET operator_pin_salt = $3,
             operator_pin_hash = $4,
             operator_pin_lookup_hash = $5,
             pin_failed_attempts = 0,
             pin_locked_until = null,
             updated_at = now()
         WHERE business_id = $1::uuid AND id = $2::uuid`,
        [tenantId, staffId, pin?.salt ?? null, pin?.hash ?? null, pin?.lookupHash ?? null],
      ),
    );
    return (rowCount ?? 0) === 1;
  }

  async softDelete(tenantId: string, staffId: string): Promise<boolean> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `UPDATE tenant.staff
         SET status = 'inactive', updated_at = now()
         WHERE id = $2::uuid AND business_id = $1::uuid
         RETURNING id::text`,
        [tenantId, staffId],
      ),
    );
    return rows.length > 0;
  }

  async updateAuthorization(
    tenantId: string,
    staffId: string,
    patch: {
      branchId?: string | null;
      position?: string | null;
      role?: string;
      actorUserId: string;
    },
  ): Promise<boolean> {
    const client = await this.pg.worker.connect();
    try {
      await client.query('BEGIN');
      const staff = await client.query<{ userId: string; branchId: string | null }>(
        `UPDATE tenant.staff
         SET branch_id = CASE WHEN $3::boolean THEN $4::uuid ELSE branch_id END,
             position = CASE WHEN $5::boolean THEN $6 ELSE position END,
             updated_at = now()
         WHERE id = $2::uuid AND business_id = $1::uuid
         RETURNING user_id::text AS "userId", branch_id::text AS "branchId"`,
        [
          tenantId,
          staffId,
          patch.branchId !== undefined,
          patch.branchId ?? null,
          patch.position !== undefined,
          patch.position ?? null,
        ],
      );
      if (!staff.rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      if (patch.role !== undefined) {
        const role = await client.query<{ id: string }>(
          `SELECT id::text FROM umi.role WHERE key = $1 AND NOT is_platform LIMIT 1`,
          [patch.role],
        );
        if (!role.rows[0]) throw new Error('invalid_staff_role');
        await client.query(
          `DELETE FROM umi.user_role
           WHERE user_id = $1::uuid AND business_id = $2::uuid`,
          [staff.rows[0].userId, tenantId],
        );
        await client.query(
          `INSERT INTO umi.user_role (user_id, role_id, business_id, branch_id, granted_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
          [
            staff.rows[0].userId,
            role.rows[0].id,
            tenantId,
            staff.rows[0].branchId,
            patch.actorUserId,
          ],
        );
      } else if (patch.branchId !== undefined) {
        await client.query(
          `UPDATE umi.user_role
           SET branch_id = $3::uuid, granted_by = $4::uuid
           WHERE user_id = $1::uuid AND business_id = $2::uuid`,
          [staff.rows[0].userId, tenantId, staff.rows[0].branchId, patch.actorUserId],
        );
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(tenantId: string, staffId: string): Promise<StaffRow | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<StaffRow>(
        `SELECT ${PROJECTION},
           CASE WHEN s.status = 'inactive' THEN s.updated_at ELSE NULL END AS "disabledAt"
         FROM tenant.staff AS s
         JOIN umi.user AS u ON u.id = s.user_id
         LEFT JOIN umi.user_role AS ur
           ON ur.user_id = s.user_id AND ur.business_id = s.business_id
         LEFT JOIN umi.role AS r ON r.id = ur.role_id
         LEFT JOIN umi.role_permission AS rp ON rp.role_id = r.id
         LEFT JOIN umi.permission AS p ON p.id = rp.permission_id
         WHERE s.business_id = $1::uuid AND s.id = $2::uuid
         GROUP BY s.id, u.id`,
        [tenantId, staffId],
      ),
    );
    return rows[0] ?? null;
  }
}
