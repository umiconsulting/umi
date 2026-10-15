import { Injectable } from '@nestjs/common';
import { PgService } from '../../shared/database/pg.service';

export interface PushRecipient {
  token: string;
  cartId: string;
  accountFolio: string;
  tableName: string | null;
  productName: string;
}

@Injectable()
export class PosPushRepository {
  constructor(private readonly pg: PgService) {}

  async register(input: {
    merchantId: string;
    userId: string;
    durableSessionId: string;
    deviceId: string;
    operatorSessionId: string;
    environment: string;
    projectId: string;
    token: string;
  }): Promise<boolean> {
    return this.pg.workerTx(async (client) => {
      const session = await client.query<{ location_id: string }>(
        `SELECT os.location_id::text
           FROM runtime.operator_session os
           JOIN runtime.session s ON s.id=os.durable_session_id
           JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=os.merchant_id
          WHERE os.id=$1::uuid AND os.merchant_id=$2::uuid AND os.user_id=$3::uuid
            AND os.device_id=$4::uuid AND os.durable_session_id=$5::uuid
            AND os.state IN ('active','locked') AND os.expires_at>now()
            AND s.is_active AND s.expires_at>now() AND d.status='active'`,
        [
          input.operatorSessionId,
          input.merchantId,
          input.userId,
          input.deviceId,
          input.durableSessionId,
        ],
      );
      const locationId = session.rows[0]?.location_id;
      if (!locationId) return false;

      await client.query(
        `UPDATE runtime.pos_push_token SET revoked_at=now()
          WHERE merchant_id=$1::uuid AND device_id=$2::uuid AND environment=$3
            AND project_id=$4 AND revoked_at IS NULL AND token<>$5`,
        [input.merchantId, input.deviceId, input.environment, input.projectId, input.token],
      );
      await client.query(
        `INSERT INTO runtime.pos_push_token
           (merchant_id,location_id,user_id,device_id,operator_session_id,
            environment,project_id,platform,token)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,'android',$8)
         ON CONFLICT (token) DO UPDATE SET
           merchant_id=excluded.merchant_id,location_id=excluded.location_id,
           user_id=excluded.user_id,device_id=excluded.device_id,
           operator_session_id=excluded.operator_session_id,
           environment=excluded.environment,project_id=excluded.project_id,
           registered_at=now(),last_seen_at=now(),revoked_at=NULL`,
        [
          input.merchantId,
          locationId,
          input.userId,
          input.deviceId,
          input.operatorSessionId,
          input.environment,
          input.projectId,
          input.token,
        ],
      );
      return true;
    });
  }

  async revoke(input: {
    merchantId: string;
    userId: string;
    deviceId: string;
    token: string;
  }): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.pos_push_token SET revoked_at=now()
        WHERE merchant_id=$1::uuid AND user_id=$2::uuid AND device_id=$3::uuid
          AND token=$4 AND revoked_at IS NULL`,
      [input.merchantId, input.userId, input.deviceId, input.token],
    );
  }

  async revokeInvalid(token: string, projectId: string): Promise<void> {
    await this.pg.query(
      `UPDATE runtime.pos_push_token SET revoked_at=now()
        WHERE token=$1 AND project_id=$2 AND revoked_at IS NULL`,
      [token, projectId],
    );
  }

  /**
   * A quién se le avisa que un platillo está listo: **a los meseros**.
   *
   * No a quien capturó el pedido. Antes esta consulta elegía al operador que había
   * enviado la línea a cocina (`pos_cart_line.fired_by_user_id`), y eso significa
   * que si el cajero mandaba una cuenta de mesa, el aviso de cocina le llegaba al
   * cajero — que no va a llevar el plato — mientras el mesero que trae el POS
   * portátil no se enteraba de nada.
   *
   * El aviso va a los operadores que llevan el POS portátil en esa sucursal: los
   * que tienen un rol de mesero activo y un token vivo de este entorno y proyecto.
   * Un token sin sesión abierta, revocado o de otro aparato no recibe nada.
   */
  async recipients(input: {
    merchantId: string;
    kitchenOrderId: string;
    itemId: string;
    environment: string;
    projectId: string;
  }): Promise<PushRecipient[]> {
    const result = await this.pg.query<PushRecipient>(
      `SELECT DISTINCT p.token,c.id::text AS "cartId",
         'Cuenta '||lpad(COALESCE(c.daily_account_number,c.account_number)::text,
           greatest(3,length(COALESCE(c.daily_account_number,c.account_number)::text)),'0') AS "accountFolio",
         c.table_name AS "tableName",ki.product_name AS "productName"
         FROM merchant.kitchen_order ko
         JOIN merchant.kitchen_order_item ki ON ki.kitchen_order_id=ko.id
           AND ki.merchant_id=ko.merchant_id AND ki.id=$3::uuid
         JOIN merchant.pos_cart c ON c.fired_order_id=ko.source_order_id
           AND c.merchant_id=ko.merchant_id AND c.location_id=ko.location_id
         JOIN runtime.pos_push_token p ON p.merchant_id=ko.merchant_id
           AND p.location_id=ko.location_id
         JOIN merchant.staff st ON st.merchant_id=p.merchant_id
           AND st.user_id=p.user_id AND st.status='active'
         JOIN merchant.role waiter ON waiter.id=st.merchant_role_id
           AND waiter.merchant_id=st.merchant_id AND waiter.key='waiter'
         JOIN runtime.operator_session os ON os.id=p.operator_session_id
           AND os.merchant_id=p.merchant_id AND os.user_id=p.user_id
           AND os.device_id=p.device_id AND os.location_id=p.location_id
         JOIN runtime.session s ON s.id=os.durable_session_id
         JOIN merchant.device d ON d.id=p.device_id AND d.merchant_id=p.merchant_id
        WHERE ko.merchant_id=$1::uuid AND ko.id=$2::uuid
          AND ki.status='ready' AND c.lifecycle_state<>'cancelled'
          AND p.environment=$4 AND p.project_id=$5
          AND p.revoked_at IS NULL AND p.last_seen_at>now()-interval '30 days'
          AND os.state IN ('active','locked') AND os.expires_at>now()
          AND s.is_active AND s.expires_at>now() AND d.status='active'`,
      [input.merchantId, input.kitchenOrderId, input.itemId, input.environment, input.projectId],
    );
    return result.rows;
  }
}
