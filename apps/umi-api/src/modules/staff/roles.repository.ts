import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface PermissionRow {
  id: string;
  key: string;
  description: string | null;
  productKey: string;
  groupKey: string;
  riskLevel: 'low' | 'medium' | 'high';
  delegable: boolean;
}

export interface MerchantRoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  revision: number;
  isSystem: boolean;
  sourceTemplateKey: string | null;
  sourceTemplateVersion: number | null;
  permissionKeys: string[];
  assignedCount: number;
  updatedAt: Date | string;
}

@Injectable()
export class RolesRepository {
  constructor(private readonly pg: PgService) {}

  async accessModel(merchantId: string): Promise<{
    roles: MerchantRoleRow[];
    permissions: PermissionRow[];
  }> {
    return this.pg.withMerchant(async (client) => {
      const [roles, permissions] = await Promise.all([
        client.query<MerchantRoleRow>(
          `SELECT mr.id::text,mr.key,mr.name,mr.description,mr.status,mr.revision,
                  mr.is_system AS "isSystem",rt.key AS "sourceTemplateKey",
                  mr.source_template_version AS "sourceTemplateVersion",
                  COALESCE(array_agg(p.key ORDER BY p.key)
                    FILTER (WHERE p.key IS NOT NULL),'{}') AS "permissionKeys",
                  count(DISTINCT s.id)::int AS "assignedCount",
                  mr.updated_at AS "updatedAt"
             FROM merchant.role mr
             LEFT JOIN umi.role_template rt ON rt.id=mr.source_template_id
             LEFT JOIN merchant.role_permission rp
               ON rp.merchant_id=mr.merchant_id AND rp.role_id=mr.id
             LEFT JOIN umi.permission p ON p.id=rp.permission_id
             LEFT JOIN merchant.staff s
               ON s.merchant_id=mr.merchant_id AND s.merchant_role_id=mr.id
                  AND s.status='active'
            WHERE mr.merchant_id=$1::uuid
            GROUP BY mr.id,rt.key
            ORDER BY mr.status='archived',mr.is_system DESC,mr.name`,
          [merchantId],
        ),
        client.query<PermissionRow>(
          `SELECT id::text,key,description,product_key AS "productKey",
                  group_key AS "groupKey",risk_level AS "riskLevel",delegable
             FROM umi.permission
            WHERE status='active'
            ORDER BY product_key,group_key,key`,
        ),
      ]);
      return { roles: roles.rows, permissions: permissions.rows };
    });
  }

  async find(merchantId: string, roleId: string): Promise<MerchantRoleRow | null> {
    const model = await this.accessModel(merchantId);
    return model.roles.find((role) => role.id === roleId) ?? null;
  }

  async create(
    merchantId: string,
    actorUserId: string,
    input: { key: string; name: string; description: string | null; permissionKeys: string[] },
  ): Promise<string> {
    return this.pg.withMerchant(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO merchant.role(
           merchant_id,key,name,description,legacy_role_id,created_by,updated_by
         ) VALUES (
           $1::uuid,$2,$3,$4,(SELECT id FROM umi.role WHERE key='staff'),$5::uuid,$5::uuid
         ) RETURNING id::text`,
        [merchantId, input.key, input.name, input.description, actorUserId],
      );
      const roleId = rows[0].id;
      await this.replacePermissions(client, merchantId, roleId, input.permissionKeys);
      await this.audit(client, merchantId, actorUserId, roleId, 'access.role.created', {
        name: input.name,
        permissionCount: input.permissionKeys.length,
      });
      return roleId;
    });
  }

  async update(
    merchantId: string,
    roleId: string,
    actorUserId: string,
    input: {
      name: string;
      description: string | null;
      permissionKeys: string[];
      expectedRevision: number;
    },
  ): Promise<boolean> {
    return this.pg.withMerchant(async (client) => {
      const result = await client.query(
        `UPDATE merchant.role
            SET name=$3,description=$4,revision=revision+1,
                updated_by=$5::uuid,updated_at=now()
          WHERE merchant_id=$1::uuid AND id=$2::uuid AND status='active'
            AND revision=$6 AND NOT is_system`,
        [merchantId, roleId, input.name, input.description, actorUserId, input.expectedRevision],
      );
      if (result.rowCount !== 1) return false;
      await this.replacePermissions(client, merchantId, roleId, input.permissionKeys);
      await this.audit(client, merchantId, actorUserId, roleId, 'access.role.updated', {
        name: input.name,
        revision: input.expectedRevision + 1,
        permissionCount: input.permissionKeys.length,
      });
      return true;
    });
  }

  async archive(
    merchantId: string,
    roleId: string,
    actorUserId: string,
    expectedRevision: number,
  ): Promise<'archived' | 'assigned' | 'conflict'> {
    return this.pg.withMerchant(async (client) => {
      const assigned = await client.query(
        `SELECT 1 FROM merchant.staff
          WHERE merchant_id=$1::uuid AND merchant_role_id=$2::uuid AND status='active'
          LIMIT 1`,
        [merchantId, roleId],
      );
      if (assigned.rowCount) return 'assigned';
      const result = await client.query(
        `UPDATE merchant.role
            SET status='archived',revision=revision+1,updated_by=$3::uuid,updated_at=now()
          WHERE merchant_id=$1::uuid AND id=$2::uuid AND revision=$4 AND NOT is_system`,
        [merchantId, roleId, actorUserId, expectedRevision],
      );
      if (result.rowCount !== 1) return 'conflict';
      await this.audit(client, merchantId, actorUserId, roleId, 'access.role.archived', {});
      return 'archived';
    });
  }

  private async replacePermissions(
    client: import('pg').PoolClient,
    merchantId: string,
    roleId: string,
    keys: string[],
  ): Promise<void> {
    await client.query(
      `DELETE FROM merchant.role_permission
        WHERE merchant_id=$1::uuid AND role_id=$2::uuid`,
      [merchantId, roleId],
    );
    if (!keys.length) return;
    await client.query(
      `INSERT INTO merchant.role_permission(merchant_id,role_id,permission_id)
       SELECT $1::uuid,$2::uuid,p.id
         FROM umi.permission p
        WHERE p.key=ANY($3::text[]) AND p.status='active' AND p.delegable`,
      [merchantId, roleId, keys],
    );
  }

  private async audit(
    client: import('pg').PoolClient,
    merchantId: string,
    actorUserId: string,
    roleId: string,
    eventType: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO merchant.audit_event(
         merchant_id,actor_user_id,event_type,entity_type,entity_id,outcome,
         public_data,correlation_id,event_hash
       ) VALUES ($1::uuid,$2::uuid,$3,'merchant_role',$4::uuid,'success',$5::jsonb,$6,'')`,
      [merchantId, actorUserId, eventType, roleId, JSON.stringify(data), randomUUID()],
    );
  }
}
