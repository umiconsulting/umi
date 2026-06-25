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

// The role/permissions/invited/disabled columns aren't stored on
// core.staff_members — role is derived from name, the rest are DTO-synthesized.
// Kept identical to server.js so the dashboard renders unchanged.
const PROJECTION = `
  id::text,
  name,
  phone,
  email,
  CASE WHEN lower(name) = 'admin' THEN 'ADMIN' ELSE 'STAFF' END AS role,
  status,
  NULL::jsonb AS permissions,
  NULL::timestamptz AS "invitedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

@Injectable()
export class StaffRepository {
  constructor(private readonly pg: PgService) {}

  async list(tenantId: string): Promise<StaffRow[]> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<StaffRow>(
        `SELECT ${PROJECTION}, NULL::timestamptz AS "disabledAt"
         FROM core.staff_members
         WHERE tenant_id = $1::uuid
         ORDER BY
           CASE WHEN lower(name) = 'admin' THEN 0 ELSE 1 END,
           CASE status WHEN 'active' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END,
           created_at ASC`,
        [tenantId],
      ),
    );
    return rows;
  }

  async insert(
    tenantId: string,
    locationId: string | null,
    data: { name: string; phone: string | null; email: string | null; status: string },
  ): Promise<StaffRow> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<StaffRow>(
        `INSERT INTO core.staff_members (tenant_id, location_id, name, phone, email, status)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
         RETURNING ${PROJECTION}, NULL::timestamptz AS "disabledAt"`,
        [tenantId, locationId, data.name, data.phone, data.email, data.status],
      ),
    );
    return rows[0];
  }

  async update(
    tenantId: string,
    staffId: string,
    patch: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      status?: string | null;
    },
  ): Promise<StaffRow | null> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<StaffRow>(
        `UPDATE core.staff_members
         SET name = COALESCE($3, name),
             phone = CASE WHEN $4::boolean THEN $5 ELSE phone END,
             email = CASE WHEN $6::boolean THEN $7 ELSE email END,
             status = COALESCE($8, status),
             updated_at = now()
         WHERE id = $2::uuid AND tenant_id = $1::uuid
         RETURNING ${PROJECTION},
           CASE WHEN status = 'disabled' THEN updated_at ELSE NULL END AS "disabledAt"`,
        [
          tenantId,
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

  async softDelete(tenantId: string, staffId: string): Promise<boolean> {
    const { rows } = await this.pg.withTenant((c) =>
      c.query<{ id: string }>(
        `UPDATE core.staff_members
         SET status = 'disabled', updated_at = now()
         WHERE id = $2::uuid AND tenant_id = $1::uuid
         RETURNING id::text`,
        [tenantId, staffId],
      ),
    );
    return rows.length > 0;
  }
}
