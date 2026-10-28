import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type {
  Cart,
  CartLineInput,
  PosIncomingOrder,
  SuspendCartRequest,
  SetCartAccountDetailsRequest,
  AssignCartTableRequest,
  RemoveSentCartLineRequest,
} from '@umi/contract';
import { syncCartOrderContext } from '../../shared/orders/cart-order-context';
import { planTables } from '../../shared/floor-plan/plan-tables';
import { availabilityStateSql } from '../../shared/catalog/availability';
import { PgService } from '../../shared/database/pg.service';
import { cancelSentOrderLine } from '../../shared/orders/cancel-sent-order-line';
import { appendOrderItems, writeOrder } from '../../shared/orders/order-writer';
import {
  VOID_AFTER_PREPARATION_PERMISSION,
  voidAfterPreparationFingerprint,
} from '../../shared/orders/void-after-preparation-fingerprint';

/**
 * What `price()` needs to price a line: the product, the variant (if any) and the
 * modifier selections. Narrower than `CartLineInput` on purpose — a cart line carries
 * the operator session, the expected version and an idempotency key, and none of those
 * is a fact about what a product costs.
 */
export interface PriceableSelection {
  productId: string;
  variantId: string | null;
  modifierSelections: Array<{ modifierId: string; quantity: number }>;
}

export interface PricedSelection {
  productId: string;
  productName: string;
  saleAction: 'merchandise' | 'gift_card';
  variantId: string | null;
  variantName: string | null;
  variantAttributes: Record<string, string>;
  basePrice: number;
  variantDelta: number;
  taxRateBasisPoints: number;
  currency: string;
  modifiers: Array<{
    modifierId: string;
    groupId: string;
    name: string;
    quantity: number;
    priceDelta: number;
  }>;
}

@Injectable()
export class PosCartRepository {
  constructor(private readonly pg: PgService) {}

  async authorize(
    userId: string,
    sessionId: string,
    deviceId: string,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    /**
     * Which permission the operator session must hold. `cart.write` by default, because
     * that is what building and editing a cart needs; the fired order passes its own
     * (`order.fire`), which is a different act — see `fire()`.
     */
    permission = 'cart.write',
  ): Promise<{ allowed: boolean; permissions: string[] }> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        // The session's OWN permissions come back with the verdict, exactly as
        // `KdsRepository.authorizePos` does and for the same reason: a bare boolean cannot
        // tell "there is no live session" from "the session is live and lacks this
        // permission". The first asks the operator to sign in again; the second is a role
        // gap that signing in will not change. A commissioning session showed what the
        // difference costs — the app treated a permission gap as a lost session, locked
        // the till and dropped to the PIN on every operator switch.
        //
        // An empty array means no live session: nothing matched, or the device, the
        // location, the entitlement or the expiry did not hold.
        const result = await client.query<{ permissions: string[] }>(
          `SELECT os.permissions FROM runtime.operator_session os
       JOIN merchant.device d ON d.id=os.device_id
       WHERE os.id=$6::uuid AND os.durable_session_id=$2::uuid AND os.user_id=$1::uuid
         AND os.device_id=$3::uuid AND os.merchant_id=$4::uuid AND os.location_id=$5::uuid
         AND os.state='active' AND os.expires_at>now() AND d.status='active'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(os.entitlements) e
           WHERE e->>'featureKey'='pos' AND COALESCE((e->>'enabled')::boolean,false))`,
          [userId, sessionId, deviceId, merchantId, locationId, operatorSessionId],
        );
        const row = result.rows[0];
        if (!row) return { allowed: false, permissions: [] as string[] };
        const permissions = Array.isArray(row.permissions) ? row.permissions : [];
        return {
          allowed: permissions.includes(permission) || permissions.includes('*'),
          permissions,
        };
      },
      locationId,
    );
  }

  async create(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    accountName?: string,
  ): Promise<string> {
    // "Create" is the explicit request for another account. The active account is
    // saved first, never returned in place of the new one. Returning it here made
    // `Nueva venta` reopen the invisible account from the previous session.
    await this.parkActiveActorCartForNewAccount(client, merchantId, locationId, operatorSessionId);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO merchant.pos_cart
         (merchant_id,location_id,operator_session_id,original_operator_session_id,
          original_operator_user_id,operator_user_id,display_label)
       SELECT $1::uuid,$2::uuid,$3::uuid,$3::uuid,os.user_id,os.user_id,$4
       FROM merchant.location b
       JOIN runtime.operator_session os ON os.id=$3::uuid
       WHERE b.id=$2::uuid AND b.merchant_id=$1::uuid AND b.status='active'
         AND os.merchant_id=$1::uuid AND os.location_id=$2::uuid
       ON CONFLICT (merchant_id,location_id,operator_user_id) WHERE lifecycle_state IN
         ('building_cart','ready_for_checkout','recovered')
       DO UPDATE SET operator_session_id=excluded.operator_session_id,
                     lifecycle_state='recovered',
                     version=merchant.pos_cart.version + CASE WHEN merchant.pos_cart.operator_session_id=excluded.operator_session_id THEN 0 ELSE 1 END,
                     updated_at=now()
       WHERE merchant.pos_cart.operator_session_id=excluded.operator_session_id
          OR (merchant.pos_cart.table_id IS NULL AND NOT EXISTS (SELECT 1 FROM runtime.operator_session prior
            WHERE prior.id=merchant.pos_cart.operator_session_id AND prior.state='active' AND prior.expires_at>now()))
       RETURNING id::text`,
      [merchantId, locationId, operatorSessionId, accountName ?? null],
    );
    if (!rows[0]) throw new ConflictException({ code: 'CART_ACTOR_BUSY' });
    return rows[0].id;
  }

  async openAccountIds(merchantId: string, locationId: string): Promise<string[]> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const result = await client.query<{ id: string }>(
          `SELECT id::text FROM merchant.pos_cart WHERE merchant_id=$1::uuid
         AND location_id=$2::uuid AND status IN ('draft','prepared')
         AND (table_id IS NOT NULL OR display_label IS NOT NULL OR EXISTS (SELECT 1 FROM merchant.pos_cart_line l
           WHERE l.merchant_id=pos_cart.merchant_id AND l.cart_id=pos_cart.id))
         ORDER BY updated_at DESC,id LIMIT 250`,
          [merchantId, locationId],
        );
        return result.rows.map((row) => row.id);
      },
      locationId,
    );
  }

  /**
   * LO QUE EL CIERRE DEL DÍA HACE CON UNA CUENTA QUE SIGUE ABIERTA.
   *
   * Copia la configuración de Toast (`Finance > Related > Settings > Auto-close orders`):
   * por fábrica no se toca nada —la resolución es de una persona— y, si el comercio
   * enciende la opción, lo que no se cobró antes del corte del día de negocio se anula.
   * Toast corre ese barrido en el reloj del servidor, a las 04:00 locales; aquí corre
   * **la primera vez que alguien mira las cuentas después del corte**, que es el momento
   * en que el asunto importa, y por eso el barrido no necesita un registro de "ya corrí":
   * una cuenta anulada deja de estar abierta y no hay segunda pasada que la vuelva a ver.
   *
   * Dos reglas que sí se copian literales:
   *
   * 1. **Solo cuentas sin dinero en juego.** `status in ('draft','prepared')` con un
   *    estado abierto (`building_cart`, `ready_for_checkout`, `recovered`, `suspended`) —
   *    exactamente los que acepta la anulación de una persona después de la migración
   *    037. Una venta cobrada es un hecho y el cierre del día no la toca. Las cuentas
   *    guardadas con "Guardar y salir" sí se resuelven al corte: dejarlas vivas hacía
   *    que "todo queda cerrado a las 04:00" dependiera de que alguien recordara abrir
   *    cada una. Si existe un pago, una tentativa o un resultado incierto, la cuenta se
   *    conserva para revisión y nunca se abandona en silencio.
   * 2. **Solo cuentas que ya no son de hoy.** El corte del día de negocio las dejó atrás;
   *    una cuenta del día en curso está viva y nadie la anula por reloj.
   *
   * La diferencia con Toast, dicha en voz alta: Toast anula las del día que acaba de
   * terminar y deja las más viejas para resolución manual. Aquí se barren todas las que
   * quedaron atrás, porque este barrido es perezoso —si nadie abre la pantalla, nadie
   * barre— y una garantía que se cae cuando nadie mira no es una garantía. Es más
   * estricto que Toast, nunca más permisivo: ninguna cuenta que Toast anularía sobrevive.
   *
   * La mesa se libera como en cualquier otra salida (`dirty`, sin comensal), porque una
   * cuenta anulada que deja la mesa ocupada es el defecto que ya conocemos: tres mesas
   * `seated` sin cuenta detrás.
   *
   * Devuelve cuántas anuló, que es lo que el log y el reporte necesitan.
   */
  async sweepCarriedOverAccounts(merchantId: string, locationId: string): Promise<number> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const policy = await client.query<{ policy: string }>(
          `SELECT pos_day_close_policy AS policy FROM merchant.merchant WHERE id=$1::uuid`,
          [merchantId],
        );
        // `manual` is Toast's factory setting and the default here: the day close is a
        // person's decision, and this method is the only place that would overrule it.
        if (policy.rows[0]?.policy !== 'auto_void') return 0;

        const voided = await client.query<{
          id: string;
          tableId: string | null;
          firedOrderId: string | null;
        }>(
          `WITH today AS (
             SELECT (((now() at time zone m.timezone) - m.business_day_start::interval))::date AS value
               FROM merchant.merchant m
              WHERE m.id=$1::uuid
           )
           UPDATE merchant.pos_cart
              SET status='abandoned',
                  lifecycle_state='cancelled',
                  cancellation_reason_code='other',
                  cancellation_reason=$3,
                  cancelled_at=now(),
                  version=version+1,
                  updated_at=now()
            WHERE merchant_id=$1::uuid
              AND location_id=$2::uuid
              AND business_date < (SELECT value FROM today)
              AND status IN ('draft','prepared')
              AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered','suspended')
              AND (table_id IS NOT NULL OR display_label IS NOT NULL OR EXISTS (
                    SELECT 1 FROM merchant.pos_cart_line l
                     WHERE l.merchant_id=pos_cart.merchant_id AND l.cart_id=pos_cart.id))
              AND NOT EXISTS (
                SELECT 1 FROM merchant.pos_checkout_draft d
                 WHERE d.cart_id=pos_cart.id AND d.merchant_id=pos_cart.merchant_id
                   AND d.state IN ('payment_accepted','payment_unknown','receipt_available','completed'))
              AND NOT EXISTS (
                SELECT 1 FROM merchant.pos_payment_attempt a
                 WHERE a.cart_id=pos_cart.id AND a.merchant_id=pos_cart.merchant_id
                   AND a.status NOT IN ('declined','cancelled'))
              AND NOT EXISTS (
                SELECT 1 FROM merchant.pos_partial_payment p
                 WHERE p.cart_id=pos_cart.id AND p.merchant_id=pos_cart.merchant_id
                   AND p.status IN ('confirmed_success','outcome_unknown'))
              AND NOT EXISTS (
                SELECT 1 FROM merchant.pos_tender_fact t
                 WHERE t.cart_id=pos_cart.id AND t.merchant_id=pos_cart.merchant_id
                   AND t.status IN ('operator_processing_externally','awaiting_operator_confirmation',
                                    'confirmed_success','outcome_unknown','committed'))
            RETURNING id::text AS id, table_id::text AS "tableId",
                      fired_order_id::text AS "firedOrderId"`,
          [merchantId, locationId, 'Anulada por el cierre del día (auto-void)'],
        );
        const tableIds = voided.rows
          .map((row) => row.tableId)
          .filter((id): id is string => typeof id === 'string');
        if (tableIds.length > 0) {
          await client.query(
            `UPDATE merchant.table_state
                SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
              WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=ANY($3::uuid[])
                AND NOT EXISTS (
                  SELECT 1 FROM merchant.pos_cart active
                   WHERE active.merchant_id=table_state.merchant_id
                     AND active.location_id=table_state.location_id
                     AND active.table_id=table_state.table_id
                     AND active.status IN ('draft','prepared'))`,
            [merchantId, locationId, tableIds],
          );
        }
        if (voided.rows.some((row) => row.firedOrderId != null)) {
          await client.query(
            `SELECT pg_notify('umi_kitchen_board',jsonb_build_object(
              'merchant_id',$1::uuid,'location_id',$2::uuid,'kitchen_order_id',NULL)::text)`,
            [merchantId, locationId],
          );
        }
        return voided.rowCount ?? 0;
      },
      locationId,
    );
  }

  async readAccount(merchantId: string, locationId: string, cartId: string): Promise<Cart | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) => {
        const result = await client.query(
          `SELECT 1 FROM merchant.pos_cart
        WHERE id=$3::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid
        AND status IN ('draft','prepared')`,
          [merchantId, locationId, cartId],
        );
        return result.rowCount ? this.snapshotWithClient(client, merchantId, cartId) : null;
      },
      locationId,
    );
  }

  async openTable(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    tableId: string,
    expectedVersion?: number,
    partySize = 1,
  ): Promise<Cart | null> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${merchantId}:${locationId}:${tableId}`,
    ]);
    const plan = await client.query<{ plan: unknown }>(
      `SELECT published AS plan
      FROM merchant.floor_plan WHERE merchant_id=$1::uuid AND location_id=$2::uuid FOR SHARE`,
      [merchantId, locationId],
    );
    const table = planTables(plan.rows[0]?.plan).get(tableId);
    if (!table) throw new ConflictException({ code: 'TABLE_NOT_IN_PLAN' });
    await client.query(
      `INSERT INTO merchant.table_state
      (merchant_id,location_id,table_id,state,seated_at,party_size)
      VALUES ($1::uuid,$2::uuid,$3::uuid,'seated',now(),$4)
      ON CONFLICT (merchant_id,location_id,table_id) DO UPDATE
        SET state='seated',seated_at=now(),party_size=$4,updated_at=now()
        WHERE merchant.table_state.seated_at IS NULL`,
      [merchantId, locationId, tableId, partySize],
    );
    const visit = await client.query<{ id: string }>(
      `SELECT visit_id::text AS id FROM merchant.table_state
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid FOR UPDATE`,
      [merchantId, locationId, tableId],
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id::text FROM merchant.pos_cart
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid
      AND status IN ('draft','prepared') FOR UPDATE`,
      [merchantId, locationId, tableId],
    );
    if (existing.rows[0])
      return this.claimAccount(
        client,
        merchantId,
        locationId,
        operatorSessionId,
        existing.rows[0].id,
        expectedVersion,
      );
    // A table action is also an explicit request to leave the current account.
    // A fresh login can intentionally keep that account out of the till while
    // the server still has it active; park it here before creating the table
    // account instead of answering CART_ACTOR_BUSY.
    await this.parkActiveActorCartForNewAccount(client, merchantId, locationId, operatorSessionId);
    await this.assertActorAvailable(client, merchantId, locationId, operatorSessionId);
    let inserted: { rows: Array<{ id: string }> };
    try {
      inserted = await client.query<{ id: string }>(
        `INSERT INTO merchant.pos_cart
        (merchant_id,location_id,operator_session_id,original_operator_session_id,
         original_operator_user_id,operator_user_id,table_id,table_name,table_visit_id,fulfillment_type)
        SELECT $1::uuid,$2::uuid,os.id,os.id,os.user_id,os.user_id,$4::uuid,$5,$6::uuid,'dine_in'
        FROM runtime.operator_session os WHERE os.id=$3::uuid AND os.merchant_id=$1::uuid
        AND os.location_id=$2::uuid RETURNING id::text`,
        [merchantId, locationId, operatorSessionId, tableId, table.label, visit.rows[0]?.id],
      );
    } catch (error) {
      // Two opens that pass the read check at the same moment still collide on
      // the unique index. Report the business refusal, never a raw 500.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({ code: 'CART_ACTOR_BUSY' });
      }
      throw error;
    }
    return inserted.rows[0]
      ? this.snapshotWithClient(client, merchantId, inserted.rows[0].id)
      : null;
  }

  private async parkActiveActorCartForNewAccount(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ) {
    await client.query(`SELECT id FROM runtime.operator_session WHERE id=$1::uuid FOR UPDATE`, [
      operatorSessionId,
    ]);
    const active = await client.query<{ id: string; empty: boolean }>(
      `SELECT c.id::text AS id,
              NOT (
                c.table_id IS NOT NULL OR c.display_label IS NOT NULL
                OR c.fired_order_id IS NOT NULL
                OR EXISTS (
                  SELECT 1 FROM merchant.pos_cart_line line
                   WHERE line.merchant_id=c.merchant_id AND line.cart_id=c.id
                )
              ) AS empty
         FROM merchant.pos_cart c
         JOIN runtime.operator_session actor ON actor.id=$3::uuid
        WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid
          AND c.operator_user_id=actor.user_id
          AND c.lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
        FOR UPDATE OF c`,
      [merchantId, locationId, operatorSessionId],
    );
    const current = active.rows[0];
    if (!current) return;
    await this.assertAccountPaymentSafe(client, merchantId, current.id, 'account_switch');
    await client.query(
      `UPDATE merchant.pos_cart
          SET status=CASE WHEN $4::boolean THEN 'abandoned' ELSE status END,
              lifecycle_state=CASE WHEN $4::boolean THEN 'cancelled' ELSE 'suspended' END,
              suspended_at=CASE WHEN $4::boolean THEN NULL ELSE now() END,
              cancellation_reason_code=CASE WHEN $4::boolean THEN 'other' ELSE NULL END,
              cancellation_reason=CASE WHEN $4::boolean THEN $5 ELSE NULL END,
              cancelled_at=CASE WHEN $4::boolean THEN now() ELSE NULL END,
              version=version+1,
              updated_at=now()
        WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid`,
      [
        merchantId,
        locationId,
        current.id,
        current.empty,
        'Cuenta vacía: se cierra al abrir otra cuenta.',
      ],
    );
  }

  private async assertActorAvailable(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    exceptCartId?: string,
  ) {
    // Serialize claims by the actor as well as by the account.
    await client.query(`SELECT id FROM runtime.operator_session WHERE id=$1::uuid FOR UPDATE`, [
      operatorSessionId,
    ]);
    // An ended or expired session leaves its active cart behind. The unique
    // index that keeps one active cart per operator does not read the session
    // table, so that cart must move to suspended before a new one can exist.
    // The account stays readable and resumable; no row is deleted.
    await client.query(
      `UPDATE merchant.pos_cart c
       SET lifecycle_state='suspended', updated_at=now()
       FROM runtime.operator_session actor
       WHERE actor.id=$3::uuid
         AND c.merchant_id=$1::uuid AND c.location_id=$2::uuid
         AND c.operator_user_id=actor.user_id
         AND c.lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
         AND NOT EXISTS (
           SELECT 1 FROM runtime.operator_session prior
           WHERE prior.id=c.operator_session_id
             AND prior.state IN ('active','locked')
             AND prior.expires_at>now()
         )`,
      [merchantId, locationId, operatorSessionId],
    );
    const occupied = await client.query(
      `SELECT 1 FROM merchant.pos_cart c
      JOIN runtime.operator_session actor ON actor.id=$3::uuid
      WHERE c.merchant_id=$1::uuid AND c.location_id=$2::uuid AND c.operator_user_id=actor.user_id
      AND c.lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
      -- A cart belongs to a session, and a session that ended or expired must
      -- not block the same person on the next shift. Without this condition an
      -- ended session leaves an orphaned building cart and every later attempt
      -- to open an account returns CART_ACTOR_BUSY with no way out.
      AND EXISTS (
        SELECT 1 FROM runtime.operator_session prior
        WHERE prior.id=c.operator_session_id
          AND prior.state IN ('active','locked')
          AND prior.expires_at>now()
      )
      AND ($4::uuid IS NULL OR c.id<>$4::uuid)`,
      [merchantId, locationId, operatorSessionId, exceptCartId ?? null],
    );
    if (occupied.rowCount) throw new ConflictException({ code: 'CART_ACTOR_BUSY' });
  }

  async assertFinanciallyMutable(client: PoolClient, merchantId: string, cartId: string) {
    await client.query(
      `SELECT id FROM merchant.pos_cart WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, cartId],
    );
    await this.assertAccountPaymentSafe(client, merchantId, cartId, 'line_mutation');
  }

  private async assertAccountPaymentSafe(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    blockedBy: string,
  ) {
    const payment = await client.query(
      `SELECT 1 FROM merchant.pos_cart c WHERE c.id=$2::uuid AND c.merchant_id=$1::uuid
      AND (EXISTS (SELECT 1 FROM merchant.pos_checkout_draft d WHERE d.cart_id=c.id AND d.merchant_id=c.merchant_id
        AND d.state IN ('payment_accepted','payment_unknown','receipt_available','completed'))
      OR EXISTS (SELECT 1 FROM merchant.pos_payment_attempt a WHERE a.cart_id=c.id AND a.merchant_id=c.merchant_id
        AND a.status NOT IN ('declined','cancelled'))
      OR EXISTS (SELECT 1 FROM merchant.pos_partial_payment p WHERE p.cart_id=c.id AND p.merchant_id=c.merchant_id
        AND p.status IN ('confirmed_success','outcome_unknown'))
      OR EXISTS (SELECT 1 FROM merchant.pos_tender_fact t WHERE t.cart_id=c.id AND t.merchant_id=c.merchant_id
        AND t.status IN ('operator_processing_externally','awaiting_operator_confirmation','confirmed_success','outcome_unknown','committed')))`,
      [merchantId, cartId],
    );
    if (payment.rowCount)
      throw new ConflictException({
        code: 'CART_PAYMENT_UNRESOLVED',
        details: { blockedBy },
      });
  }

  /**
   * Spend the manager's elevation that authorizes cancelling an already-started line.
   *
   * It is spent HERE, inside the command's own transaction, and not when the PIN was
   * checked: a grant that survives its command is a standing permission, and the whole
   * point of asking for a manager is that the authorization covers one act.
   *
   * `method='manager_approval'` on purpose — an operator's own PIN elevation is a
   * different grant type and must not be usable to void their own mistake.
   */
  private async consumeVoidApproval(
    client: PoolClient,
    merchantId: string,
    lineId: string,
    dto: RemoveSentCartLineRequest,
    commandId: string,
  ) {
    const expectedFingerprint = voidAfterPreparationFingerprint({
      merchantId,
      locationId: dto.locationId,
      cartId: dto.cartId,
      lineId,
      reasonCode: dto.reasonCode,
      expectedVersion: dto.expectedVersion,
    });
    if (!dto.approvalFingerprint || dto.approvalFingerprint !== expectedFingerprint) {
      // The manager approved a DIFFERENT act — another line, another reason, or a cart
      // that has since moved. Asking again is the fix, so this reads as a refusal, not
      // as a broken request.
      throw new ConflictException({
        code: 'APPROVAL_FINGERPRINT_MISMATCH',
        fieldErrors: { approvalFingerprint: [expectedFingerprint] },
      });
    }
    const consumed = await client.query(
      `UPDATE runtime.elevation_grant
          SET consumed_at=clock_timestamp(),consumed_by_command_id=$6::uuid
        WHERE id=$1::uuid AND merchant_id=$2::uuid AND location_id=$3::uuid
          AND permission_key=$4 AND command_fingerprint=$5
          AND method='manager_approval' AND expires_at>clock_timestamp()
          AND consumed_at IS NULL`,
      [
        dto.approvalId,
        merchantId,
        dto.locationId,
        VOID_AFTER_PREPARATION_PERMISSION,
        expectedFingerprint,
        commandId,
      ],
    );
    if (consumed.rowCount !== 1) throw new ConflictException({ code: 'APPROVAL_INVALID' });
  }

  async claimAccount(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
    cartId: string,
    expectedVersion?: number,
  ): Promise<Cart | null> {
    const result = await client.query<{
      version: number;
      operatorSessionId: string;
      sameSession: boolean;
      lifecycleState: string;
      ownerActive: boolean;
      ownerName: string;
      deviceName: string;
    }>(
      `SELECT c.version,c.operator_session_id::text AS "operatorSessionId",
        (c.operator_session_id=$4::uuid) AS "sameSession",c.lifecycle_state AS "lifecycleState",
        (os.state='active' AND os.expires_at>now() AND d.status='active') AS "ownerActive",
        owner.name AS "ownerName",d.name AS "deviceName"
       FROM merchant.pos_cart c JOIN runtime.operator_session os ON os.id=c.operator_session_id
       LEFT JOIN merchant.staff owner ON owner.id=os.staff_id AND owner.merchant_id=c.merchant_id
       JOIN merchant.device d ON d.id=os.device_id WHERE c.id=$3::uuid AND c.merchant_id=$1::uuid
       AND c.location_id=$2::uuid AND c.status IN ('draft','prepared') FOR UPDATE OF c`,
      [merchantId, locationId, cartId, operatorSessionId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (expectedVersion !== undefined && row.version !== expectedVersion)
      throw new ConflictException({ code: 'CART_VERSION_CONFLICT' });
    // Reopening the account already held by this operator is a READ of its
    // current state, not permission to rewrite it. A confirmed partial payment
    // must block edits and hand-offs, but it must not stop the same operator
    // from recovering the screen that can finish checkout. Blocking this path
    // left the POS retrying resume against its own paid part forever.
    if (row.sameSession && row.lifecycleState !== 'suspended')
      return this.snapshotWithClient(client, merchantId, cartId);
    // Taking over another operator's account remains protected while money is
    // in flight. The same-owner case above is deliberately narrower.
    if (!row.sameSession)
      await this.assertAccountPaymentSafe(client, merchantId, cartId, 'account_resume');
    if (!row.sameSession && row.lifecycleState !== 'suspended' && row.ownerActive)
      throw new ConflictException({
        code: 'CART_ACCOUNT_BUSY',
        details: {
          operatorName: row.ownerName,
          deviceName: row.deviceName,
        },
      });
    // Resuming another account is also an explicit account switch. A login can
    // deliberately leave the current cart out of the till while the server still
    // considers it active; without parking it here, the selected account is
    // refused with CART_ACTOR_BUSY even though it is the account the operator
    // asked for. Empty hidden carts are closed; carts with content are saved and
    // remain resumable from Cuentas.
    await this.parkActiveActorCartForNewAccount(client, merchantId, locationId, operatorSessionId);
    await this.assertActorAvailable(client, merchantId, locationId, operatorSessionId, cartId);
    await client.query(
      `UPDATE merchant.pos_cart SET operator_session_id=$4::uuid,
      operator_user_id=(SELECT user_id FROM runtime.operator_session WHERE id=$4::uuid),
      lifecycle_state='recovered',version=version+1,updated_at=now()
      WHERE id=$3::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid`,
      [merchantId, locationId, cartId, operatorSessionId],
    );
    return this.snapshotWithClient(client, merchantId, cartId);
  }

  async removeSent(
    client: PoolClient,
    merchantId: string,
    lineId: string,
    dto: RemoveSentCartLineRequest,
    /**
     * Who the command belongs to, so the elevation a manager gave can be consumed by the
     * exact command that used it (migration 026). Absent when the cancel needs no
     * authorization — which is every cancel of a line the kitchen has not started.
     */
    commandId?: string,
  ): Promise<Cart | null> {
    // The outcome of whichever attempt actually cancelled the line. It is NOT `state` from
    // the first call: a forced cancel succeeds where the plain one was refused, and the
    // line below that skips the cart write would otherwise report the success as a failure
    // — the envelope commits a business failure, so the void would stand while the till
    // was told nothing happened.
    let state = await cancelSentOrderLine(client, {
      merchantId,
      locationId: dto.locationId,
      cartId: dto.cartId,
      lineId,
      operatorSessionId: dto.operatorSessionId,
      expectedVersion: dto.expectedVersion,
      reasonCode: dto.reasonCode,
      correlationId: dto.idempotencyKey,
    });
    // The account belongs to a business day that already closed. No elevation opens it —
    // the reason is money, not the kitchen: the day's takings and counts were read
    // already — so the refusal is its own answer rather than "the kitchen started it",
    // which would send the operator after a manager who cannot help.
    if (state === 'day_closed') throw new ConflictException({ code: 'CART_LINE_DAY_CLOSED' });
    if (state === 'preparation_started') {
      // The kitchen owns the line. The operator asked for it anyway, and the only way
      // that is an answer rather than a refusal is a manager's elevation, bound to THIS
      // cancel and consumed here — in the same transaction as the void it authorizes, so
      // a failure below leaves the grant unspent.
      //
      // The ordinary attempt runs FIRST and unchanged: a cancel the kitchen has not
      // reached never needs an approval, so no elevation is burned on the easy case.
      if (!dto.approvalId || !commandId) {
        throw new ConflictException({
          code: 'KITCHEN_PREPARATION_STARTED',
          fieldErrors: {
            approvalPermission: [VOID_AFTER_PREPARATION_PERMISSION],
            approvalFingerprint: [
              voidAfterPreparationFingerprint({
                merchantId,
                locationId: dto.locationId,
                cartId: dto.cartId,
                lineId,
                reasonCode: dto.reasonCode,
                expectedVersion: dto.expectedVersion,
              }),
            ],
          },
        });
      }
      await this.consumeVoidApproval(client, merchantId, lineId, dto, commandId);
      const forced = await cancelSentOrderLine(client, {
        merchantId,
        locationId: dto.locationId,
        cartId: dto.cartId,
        lineId,
        operatorSessionId: dto.operatorSessionId,
        expectedVersion: dto.expectedVersion,
        reasonCode: dto.reasonCode,
        correlationId: dto.idempotencyKey,
        forced: true,
      });
      // Un rechazo concurrente conserva la cuenta y deja la autorización sin consumir.
      if (forced === 'preparation_started')
        throw new ConflictException({ code: 'KITCHEN_PREPARATION_STARTED' });
      state = forced;
    }
    if (state !== 'cancelled') return null;
    await client.query(
      `DELETE FROM merchant.pos_cart_line WHERE id=$1::uuid AND cart_id=$2::uuid
      AND merchant_id=$3::uuid`,
      [lineId, dto.cartId, merchantId],
    );
    await client.query(
      `UPDATE merchant.pos_cart SET version=version+1,updated_at=now()
      WHERE id=$1::uuid AND merchant_id=$2::uuid`,
      [dto.cartId, merchantId],
    );
    return this.snapshotWithClient(client, merchantId, dto.cartId);
  }

  async setAccountDetails(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    dto: SetCartAccountDetailsRequest,
  ): Promise<Cart | null> {
    await this.assertFinanciallyMutable(client, merchantId, cartId);
    const changed = await client.query(
      `UPDATE merchant.pos_cart SET display_label=$6,version=version+1,updated_at=now()
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND id=$3::uuid AND operator_session_id=$4::uuid
      AND version=$5 AND status IN ('draft','prepared') AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')`,
      [
        merchantId,
        dto.locationId,
        cartId,
        dto.operatorSessionId,
        dto.expectedVersion,
        dto.accountName,
      ],
    );
    if (!changed.rowCount) return null;
    const cart = await this.snapshotWithClient(client, merchantId, cartId);
    if (cart?.firedOrderId)
      await syncCartOrderContext(client, merchantId, cartId, cart.firedOrderId);
    return cart;
  }

  async assignAccountTable(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    dto: AssignCartTableRequest,
  ): Promise<Cart | null> {
    // Match the table-open lock order. An assignment cannot create a second account.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${merchantId}:${dto.locationId}:${dto.tableId}`,
    ]);
    const selected = await client.query<{
      tableId: string | null;
      version: number;
      firedOrderId: string | null;
    }>(
      `SELECT table_id::text AS "tableId",version,fired_order_id::text AS "firedOrderId" FROM merchant.pos_cart
      WHERE id=$3::uuid AND merchant_id=$1::uuid AND location_id=$2::uuid AND operator_session_id=$4::uuid
      AND status IN ('draft','prepared') AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered') FOR UPDATE`,
      [merchantId, dto.locationId, cartId, dto.operatorSessionId],
    );
    const row = selected.rows[0];
    if (!row) return null;
    if (row.version !== dto.expectedVersion)
      throw new ConflictException({ code: 'CART_VERSION_CONFLICT' });
    await this.assertAccountPaymentSafe(client, merchantId, cartId, 'table_assignment');
    if (row.tableId && row.tableId !== dto.tableId)
      throw new ConflictException({ code: 'CART_ALREADY_ASSIGNED' });
    const plan = await client.query<{ plan: unknown }>(
      `SELECT published AS plan FROM merchant.floor_plan
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid FOR SHARE`,
      [merchantId, dto.locationId],
    );
    const table = planTables(plan.rows[0]?.plan).get(dto.tableId);
    if (!table) throw new ConflictException({ code: 'TABLE_NOT_IN_PLAN' });
    const target = await client.query(
      `SELECT id FROM merchant.pos_cart WHERE merchant_id=$1::uuid AND location_id=$2::uuid
      AND table_id=$3::uuid AND status IN ('draft','prepared') AND id<>$4::uuid`,
      [merchantId, dto.locationId, dto.tableId, cartId],
    );
    if (target.rowCount) throw new ConflictException({ code: 'CART_TABLE_ACCOUNT_EXISTS' });
    if (row.tableId === dto.tableId) {
      if (dto.partySize != null) {
        await client.query(
          `UPDATE merchant.table_state SET party_size=$4, updated_at=now()
           WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
          [merchantId, dto.locationId, dto.tableId, dto.partySize],
        );
      }
      return this.snapshotWithClient(client, merchantId, cartId);
    }
    await client.query(
      `INSERT INTO merchant.table_state(merchant_id,location_id,table_id,state,seated_at,party_size)
      VALUES($1::uuid,$2::uuid,$3::uuid,'seated',now(),$4)
      ON CONFLICT(merchant_id,location_id,table_id) DO UPDATE SET state='seated',seated_at=now(),party_size=$4,updated_at=now()
      WHERE merchant.table_state.seated_at IS NULL`,
      [merchantId, dto.locationId, dto.tableId, dto.partySize ?? 1],
    );
    const visit = await client.query<{ id: string }>(
      `SELECT visit_id::text AS id FROM merchant.table_state
      WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid FOR UPDATE`,
      [merchantId, dto.locationId, dto.tableId],
    );
    await client.query(
      `UPDATE merchant.pos_cart SET table_id=$3::uuid,table_name=$4,table_visit_id=$5::uuid,
      fulfillment_type='dine_in',version=version+1,updated_at=now() WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, cartId, dto.tableId, table.label, visit.rows[0]?.id],
    );
    if (row.firedOrderId) await syncCartOrderContext(client, merchantId, cartId, row.firedOrderId);
    return this.snapshotWithClient(client, merchantId, cartId);
  }

  async suspendAccount(
    client: PoolClient,
    merchantId: string,
    dto: SuspendCartRequest,
  ): Promise<Cart | null> {
    const current = await client.query<{ empty: boolean }>(
      `SELECT (c.table_id IS NULL AND c.display_label IS NULL AND c.fired_order_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM merchant.pos_cart_line l
          WHERE l.merchant_id=c.merchant_id AND l.cart_id=c.id)) AS empty
       FROM merchant.pos_cart c WHERE c.id=$1::uuid AND c.merchant_id=$2::uuid
       AND c.location_id=$3::uuid FOR UPDATE`,
      [dto.cartId, merchantId, dto.locationId],
    );
    await this.assertAccountPaymentSafe(client, merchantId, dto.cartId, 'account_suspend');
    // AN EMPTY ACCOUNT IS CLOSED, NOT KEPT.
    //
    // A cart with no lines, no table, no name and no fired order holds nothing that a
    // person could recognize or charge, so putting it aside only creates a record
    // nobody asked for and spends the next account number. Three things follow from
    // that: the operator who taps `Nueva cuenta` twice gets one account and not two,
    // the open-accounts list stays a list of real accounts, and the account number on
    // the next customer's ticket is the next number that means something.
    //
    // The till writes the same rule for the operator who leaves with an empty order
    // (`SaleLifecycleController.prepareForOperatorExit`: "Empty order closed when the
    // operator session ended"). The industry writes it too: Loyverse refuses to save a
    // ticket with no items, SpotOn ships a "close an empty check" action to keep the
    // order list clean, and Clover opens an order when the first line item arrives.
    //
    // A name is content: an operator who types one is opening an account on purpose,
    // so the label the request carries wins over this rule.
    const naming =
      dto.accountName !== undefined && dto.accountName !== null && dto.accountName.trim() !== '';
    const discard = current.rows[0]?.empty === true && !naming;
    const changed = await client.query(
      `UPDATE merchant.pos_cart SET
      lifecycle_state=CASE WHEN $8::boolean THEN 'cancelled' ELSE 'suspended' END,
      status=CASE WHEN $8::boolean THEN 'abandoned' ELSE status END,
      cancellation_reason_code=CASE WHEN $8::boolean THEN 'other' ELSE cancellation_reason_code END,
      cancellation_reason=CASE WHEN $8::boolean THEN $9::text ELSE cancellation_reason END,
      cancelled_at=CASE WHEN $8::boolean THEN now() ELSE cancelled_at END,
      suspended_at=CASE WHEN $8::boolean THEN suspended_at ELSE now() END,
      display_label=CASE WHEN $6::boolean THEN $7::text ELSE display_label END,
      version=version+1,updated_at=now() WHERE id=$1::uuid AND merchant_id=$2::uuid
      AND location_id=$3::uuid AND operator_session_id=$4::uuid AND version=$5
      AND status IN ('draft','prepared') AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')`,
      [
        dto.cartId,
        merchantId,
        dto.locationId,
        dto.operatorSessionId,
        dto.expectedVersion,
        dto.accountName !== undefined,
        dto.accountName ?? null,
        discard,
        'Cuenta vacía: se cierra al apartarla.',
      ],
    );
    if (!changed.rowCount) return null;
    const cart = await this.snapshotWithClient(client, merchantId, dto.cartId);
    if (cart?.firedOrderId)
      await syncCartOrderContext(client, merchantId, dto.cartId, cart.firedOrderId);
    return cart;
  }

  async activeCartId(
    merchantId: string,
    locationId: string,
    operatorSessionId: string,
  ): Promise<string | null> {
    const rows = await this.pg.runWithMerchant(
      merchantId,
      null,
      async (client) =>
        (
          await client.query<{ id: string }>(
            `SELECT id::text FROM merchant.pos_cart
             WHERE merchant_id=$1::uuid AND location_id=$2::uuid
               AND operator_session_id=$3::uuid
               AND lifecycle_state IN
                 ('building_cart','ready_for_checkout','recovered')`,
            [merchantId, locationId, operatorSessionId],
          )
        ).rows,
      locationId,
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Price ONE selection against the live catalog: is the product orderable at this
   * location, are the chosen modifiers this product's (and within its groups' min/max),
   * and what does the line cost.
   *
   * The parameter is the three fields this actually reads, not a whole `CartLineInput`.
   * A `CartLineInput` still satisfies it, so the till's callers are unchanged — and the
   * public table-order intake (§8I step 2) can ask the SAME question about a guest's
   * line without inventing an operator session, an expected cart version and an
   * idempotency key to satisfy a shape it does not have. One pricing rule, two
   * producers, and the guest is charged the number the till would have charged.
   */
  async price(
    client: PoolClient,
    merchantId: string,
    locationId: string,
    input: PriceableSelection,
  ): Promise<PricedSelection | null> {
    const product = await client.query<{
      productId: string;
      productName: string;
      saleAction: 'merchandise' | 'gift_card';
      basePrice: string;
      taxRateBasisPoints: number;
      currency: string;
      variantId: string | null;
      variantName: string | null;
      variantAttributes: Record<string, string> | null;
      variantDelta: string | null;
    }>(
      `SELECT p.id::text AS "productId",p.name AS "productName",p.sale_action AS "saleAction",
              p.price::text AS "basePrice",
              p.tax_rate_basis_points AS "taxRateBasisPoints",business.currency,
              v.id::text AS "variantId",v.name AS "variantName",
              v.attributes AS "variantAttributes",v.price_delta::text AS "variantDelta"
       FROM merchant.product p JOIN merchant.merchant business ON business.id=p.merchant_id
       LEFT JOIN merchant.product_variant v ON v.id=$4::uuid AND v.product_id=p.id AND v.active
       LEFT JOIN merchant.product_location_availability a
         ON a.product_id=p.id AND a.location_id=$2::uuid
       WHERE p.merchant_id=$1::uuid AND p.id=$3::uuid AND p.active
         AND ${availabilityStateSql('a')} = 'enabled'
         AND ($4::uuid IS NULL OR v.id IS NOT NULL)`,
      [merchantId, locationId, input.productId, input.variantId],
    );
    if (!product.rows[0]) return null;
    const modifierIds = input.modifierSelections.map((item) => item.modifierId);
    const modifiers = modifierIds.length
      ? await client.query<{
          modifierId: string;
          groupId: string;
          name: string;
          priceDelta: string;
          minSelect: number;
          maxSelect: number | null;
        }>(
          `SELECT m.id::text AS "modifierId",g.id::text AS "groupId",m.name,
                  m.price_delta::text AS "priceDelta",g.min_select AS "minSelect",
                  g.max_select AS "maxSelect"
           FROM merchant.product_modifier m
           JOIN merchant.product_option_group g ON g.id=m.option_group_id
           JOIN merchant.product p ON p.id=g.product_id
           WHERE p.merchant_id=$1::uuid AND p.id=$2::uuid AND m.id=ANY($3::uuid[])`,
          [merchantId, input.productId, modifierIds],
        )
      : { rows: [] };
    if (modifiers.rows.length !== modifierIds.length) return null;
    const counts = new Map<string, number>();
    for (const selection of input.modifierSelections) {
      const row = modifiers.rows.find((item) => item.modifierId === selection.modifierId)!;
      counts.set(row.groupId, (counts.get(row.groupId) ?? 0) + selection.quantity);
    }
    const required = await client.query<{
      id: string;
      minSelect: number;
      maxSelect: number | null;
    }>(
      `SELECT g.id::text,g.min_select AS "minSelect",g.max_select AS "maxSelect"
       FROM merchant.product_option_group g JOIN merchant.product p ON p.id=g.product_id
       WHERE p.merchant_id=$1::uuid AND p.id=$2::uuid`,
      [merchantId, input.productId],
    );
    if (
      required.rows.some((group) => {
        const count = counts.get(group.id) ?? 0;
        return count < group.minSelect || (group.maxSelect != null && count > group.maxSelect);
      })
    ) {
      return null;
    }
    const base = product.rows[0];
    return {
      ...base,
      basePrice: Number(base.basePrice),
      variantDelta: Number(base.variantDelta ?? 0),
      variantAttributes: base.variantAttributes ?? {},
      modifiers: input.modifierSelections.map((selection) => {
        const row = modifiers.rows.find((item) => item.modifierId === selection.modifierId)!;
        return { ...row, priceDelta: Number(row.priceDelta), quantity: selection.quantity };
      }),
    };
  }

  async addOrMerge(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    identityKey: string,
    input: CartLineInput,
    priced: PricedSelection,
  ): Promise<boolean> {
    // An add is allowed on a fired cart: it is the second round (plan §8.2 F6). The
    // merge (`ON CONFLICT`) applies only to the lines still local to the cart, so an
    // identical item added after the fire is a NEW line, not a bump of the line the
    // bar already made.
    if (
      !(await this.bump(client, merchantId, cartId, expectedVersion, input.operatorSessionId, {
        allowFired: true,
      }))
    ) {
      return false;
    }
    const modifierTotal = priced.modifiers.reduce(
      (sum, item) => sum + item.priceDelta * item.quantity,
      0,
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO merchant.pos_cart_line
         (id,merchant_id,cart_id,product_id,variant_id,identity_key,product_name,variant_name,
          variant_attributes,quantity,note,base_price,variant_delta,modifier_total,
          tax_rate_basis_points,course_number)
       VALUES (COALESCE($16::uuid,gen_random_uuid()),
         $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (cart_id,identity_key) WHERE fired_at IS NULL DO UPDATE
         SET quantity=merchant.pos_cart_line.quantity+excluded.quantity,
             course_number=excluded.course_number,updated_at=now()
       RETURNING id::text`,
      [
        merchantId,
        cartId,
        priced.productId,
        priced.variantId,
        identityKey,
        priced.productName,
        priced.variantName,
        priced.variantAttributes,
        input.quantity,
        input.note,
        priced.basePrice,
        priced.variantDelta,
        modifierTotal,
        priced.taxRateBasisPoints,
        input.courseNumber,
        input.clientLineId ?? null,
      ],
    );
    const lineId = rows[0].id;
    await client.query(`DELETE FROM merchant.pos_cart_line_modifier WHERE line_id=$1::uuid`, [
      lineId,
    ]);
    for (const modifier of priced.modifiers) {
      await client.query(
        `INSERT INTO merchant.pos_cart_line_modifier
          (merchant_id,line_id,group_id,modifier_id,name,quantity,price_delta)
         VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7)`,
        [
          merchantId,
          lineId,
          modifier.groupId,
          modifier.modifierId,
          modifier.name,
          modifier.quantity,
          modifier.priceDelta,
        ],
      );
    }
    return true;
  }

  async remove(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    lineId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<boolean> {
    if (
      !(await this.bump(client, merchantId, cartId, expectedVersion, operatorSessionId, {
        allowFired: true,
        pendingLineId: lineId,
      }))
    ) {
      return false;
    }
    const result = await client.query(
      `DELETE FROM merchant.pos_cart_line WHERE merchant_id=$1::uuid AND cart_id=$2::uuid AND id=$3::uuid
         AND fired_at IS NULL`,
      [merchantId, cartId, lineId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async replace(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    lineId: string,
    expectedVersion: number,
    identityKey: string,
    input: CartLineInput,
    priced: PricedSelection,
  ): Promise<boolean> {
    const existing = await client.query<{ identityKey: string }>(
      `SELECT identity_key AS "identityKey" FROM merchant.pos_cart_line
       WHERE merchant_id=$1::uuid AND cart_id=$2::uuid AND id=$3::uuid AND fired_at IS NULL`,
      [merchantId, cartId, lineId],
    );
    if (!existing.rows[0]) return false;
    // A quantity change leaves the product selection intact. Preserve the line ID:
    // rapid subsequent taps from a till still address that ID. Delete+insert made
    // each successful update invalidate the next queued command in production.
    if (existing.rows[0].identityKey === identityKey) {
      if (
        !(await this.bump(client, merchantId, cartId, expectedVersion, input.operatorSessionId, {
          allowFired: true,
          pendingLineId: lineId,
        }))
      ) {
        return false;
      }
      const modifierTotal = priced.modifiers.reduce(
        (sum, item) => sum + item.priceDelta * item.quantity,
        0,
      );
      const updated = await client.query(
        `UPDATE merchant.pos_cart_line SET
           product_name=$4,variant_name=$5,variant_attributes=$6,quantity=$7,note=$8,
           base_price=$9,variant_delta=$10,modifier_total=$11,tax_rate_basis_points=$12,
           course_number=$13,updated_at=now()
         WHERE merchant_id=$1::uuid AND cart_id=$2::uuid AND id=$3::uuid AND fired_at IS NULL`,
        [
          merchantId,
          cartId,
          lineId,
          priced.productName,
          priced.variantName,
          priced.variantAttributes,
          input.quantity,
          input.note,
          priced.basePrice,
          priced.variantDelta,
          modifierTotal,
          priced.taxRateBasisPoints,
          input.courseNumber,
        ],
      );
      if (!updated.rowCount) return false;
      await client.query(`DELETE FROM merchant.pos_cart_line_modifier WHERE line_id=$1::uuid`, [
        lineId,
      ]);
      for (const modifier of priced.modifiers) {
        await client.query(
          `INSERT INTO merchant.pos_cart_line_modifier
            (merchant_id,line_id,group_id,modifier_id,name,quantity,price_delta)
           VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7)`,
          [
            merchantId,
            lineId,
            modifier.groupId,
            modifier.modifierId,
            modifier.name,
            modifier.quantity,
            modifier.priceDelta,
          ],
        );
      }
      return true;
    }
    if (
      !(await this.remove(
        client,
        merchantId,
        cartId,
        lineId,
        expectedVersion,
        input.operatorSessionId,
      ))
    ) {
      return false;
    }
    return this.addOrMerge(
      client,
      merchantId,
      cartId,
      expectedVersion + 1,
      identityKey,
      input,
      priced,
    );
  }

  async prepare(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart SET status='prepared',lifecycle_state='ready_for_checkout',
         version=version+1,updated_at=now()
       WHERE merchant_id=$1::uuid AND id=$2::uuid AND version=$3
         AND operator_session_id=$4::uuid
         AND lifecycle_state IN ('building_cart','recovered')
         AND status='draft'
         AND EXISTS(SELECT 1 FROM merchant.pos_cart_line WHERE cart_id=$2::uuid)`,
      [merchantId, cartId, expectedVersion, operatorSessionId],
    );
    return (rowCount ?? 0) > 0;
  }

  async clear(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<boolean> {
    if (!(await this.bump(client, merchantId, cartId, expectedVersion, operatorSessionId))) {
      return false;
    }
    await client.query(
      `DELETE FROM merchant.pos_cart_line
       WHERE merchant_id=$1::uuid AND cart_id=$2::uuid`,
      [merchantId, cartId],
    );
    return true;
  }

  // Channel attribution (ADR 2026-09-13-pos-channel-attribution). Bind the active cart to the
  // upstream commercial order it settles. The channel is resolved from that order's source and
  // FROZEN onto the cart, so it survives even if the order later changes; the commit copies it
  // onto pos_committed_sale. originOrderId=null detaches the cart back to a walk_in sale.
  async bindOrigin(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
    originOrderId: string | null,
  ): Promise<boolean> {
    let channel: string | null = null;
    if (originOrderId) {
      // Only a real, still-open customer-channel order can be picked up. 'pos' is the till's own
      // order and 'dashboard' is staff entry — neither is an incoming order to fulfil.
      const order = await client.query<{ source: string }>(
        `SELECT source FROM merchant.customer_order
          WHERE id=$1::uuid AND merchant_id=$2::uuid
            AND source NOT IN ('pos','dashboard')
            AND status IN ('placed','preparing','ready')`,
        [originOrderId, merchantId],
      );
      if (!order.rows[0]) return false;
      channel = order.rows[0].source;
    }
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart
          SET origin_order_id=$5::uuid,origin_channel=$6,
              version=version+1,updated_at=now()
        WHERE merchant_id=$1::uuid AND id=$2::uuid AND version=$3
          AND operator_session_id=$4::uuid
          AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
          AND status IN ('draft','prepared')`,
      [merchantId, cartId, expectedVersion, operatorSessionId, originOrderId, channel],
    );
    return (rowCount ?? 0) > 0;
  }

  // The order type (plan §8.2 F3, decision D5). The operator chooses how the order
  // leaves the counter; the cart carries it so the fire and the checkout write the
  // same fact.
  //
  // A GUEST WHO CHANGES THEIR MIND IS THE ORDINARY CASE (owner, 2026-10-12): someone
  // sits down, orders, and then decides to leave with the food. The fired cart used
  // to refuse the change — the order already existed with its type — which left the
  // till unable to record what the guest had just asked for, and the crew doing it by
  // hand. The cart may now change type after the fire, and `syncCartOrderContext`
  // carries the new type and table onto the order the cart already fired, so the
  // record follows the sale. The paper the kitchen holds is not reprinted: it says
  // what it said when it was fired.
  //
  // `takeout` ALSO MEANS NO TABLE. A takeout account has no table, so the id, the
  // label and the visit are cleared in the same statement, and the floor plan gets
  // the table back as `dirty` with no party seated on it — free, and needing to be
  // cleaned, which is the state every other party leaves behind.
  async setFulfillment(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
    fulfillmentType: 'dine_in' | 'takeout',
  ): Promise<boolean> {
    // The table and the fired order are read before the write, because the write is
    // what clears them.
    const target = await client.query<{
      locationId: string;
      tableId: string | null;
      firedOrderId: string | null;
    }>(
      `SELECT location_id::text AS "locationId",table_id::text AS "tableId",
        fired_order_id::text AS "firedOrderId"
      FROM merchant.pos_cart WHERE merchant_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [merchantId, cartId],
    );
    const row = target.rows[0];
    if (!row) return false;
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart
          SET fulfillment_type=$5,
              table_id=CASE WHEN $5='takeout' THEN NULL ELSE table_id END,
              table_name=CASE WHEN $5='takeout' THEN NULL ELSE table_name END,
              table_visit_id=CASE WHEN $5='takeout' THEN NULL ELSE table_visit_id END,
              version=version+1,updated_at=now()
        WHERE merchant_id=$1::uuid AND id=$2::uuid AND version=$3
          AND operator_session_id=$4::uuid
          AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
          AND status IN ('draft','prepared')`,
      [merchantId, cartId, expectedVersion, operatorSessionId, fulfillmentType],
    );
    if ((rowCount ?? 0) === 0) return false;
    if (fulfillmentType === 'takeout' && row.tableId) {
      await client.query(
        `UPDATE merchant.table_state
            SET state='dirty',seated_at=NULL,party_size=NULL,group_id=NULL,updated_at=now()
          WHERE merchant_id=$1::uuid AND location_id=$2::uuid AND table_id=$3::uuid`,
        [merchantId, row.locationId, row.tableId],
      );
    }
    if (row.firedOrderId) {
      await syncCartOrderContext(client, merchantId, cartId, row.firedOrderId);
    }
    return true;
  }

  // The incoming commercial orders a till can pick up: customer-channel orders (not 'pos', not
  // staff 'dashboard' entry) still open. RLS-scoped; location-narrowed, but legacy migrated
  // orders carry location_id=NULL and are always visible so they can still be settled.
  async listIncomingOrders(
    merchantId: string,
    locationId: string,
    userId: string,
  ): Promise<PosIncomingOrder[]> {
    return this.pg.runWithMerchant(
      merchantId,
      userId,
      async (client) => {
        const { rows } = await client.query<{
          orderId: string;
          channel: PosIncomingOrder['channel'];
          status: PosIncomingOrder['status'];
          reference: string | null;
          customerName: string | null;
          itemCount: string;
          totalMinorUnits: string;
          placedAt: Date | null;
        }>(
          `SELECT o.id::text AS "orderId",o.source AS channel,o.status,
                  coalesce(o.external_ref,o.id::text) AS reference,
                  c.name AS "customerName",
                  coalesce(cnt.n,0)::bigint AS "itemCount",
                  coalesce(ot.total,0)::bigint AS "totalMinorUnits",
                  o.placed_at AS "placedAt"
           FROM merchant.customer_order o
           LEFT JOIN merchant.customer c ON c.id=o.customer_id AND c.merchant_id=o.merchant_id
           LEFT JOIN merchant.order_total ot ON ot.order_id=o.id
           LEFT JOIN LATERAL (
             SELECT count(*) AS n FROM merchant.order_item i
             WHERE i.order_id=o.id AND i.voided_at IS NULL
           ) cnt ON true
           WHERE o.merchant_id=$1::uuid
             AND o.source NOT IN ('pos','dashboard')
             AND o.status IN ('placed','preparing','ready')
             AND (o.location_id=$2::uuid OR o.location_id IS NULL)
           ORDER BY coalesce(o.placed_at,o.created_at) DESC
           LIMIT 100`,
          [merchantId, locationId],
        );
        return rows.map((r) => ({
          orderId: r.orderId,
          channel: r.channel,
          status: r.status,
          reference: r.reference,
          customerName: r.customerName,
          itemCount: Number(r.itemCount),
          totalMinorUnits: Number(r.totalMinorUnits),
          placedAt: r.placedAt ? new Date(r.placedAt).toISOString() : null,
        }));
      },
      locationId,
    );
  }

  /**
   * Fire a cart: write its order and project the kitchen ticket WITHOUT taking money.
   *
   * THE TRICK IS THE `external_ref`. It is the same `pos-cart:<cartId>` the checkout
   * uses, and `writeOrder` is idempotent by `(merchant_id, external_ref)`: when the
   * checkout later runs it gets THIS order back — `created: false`, its lines untouched —
   * and hangs the payment, the receipt and the committed sale on it. No second order, no
   * second kitchen ticket, and no branch of its own in the checkout. That is why this is
   * one method rather than a new settlement path.
   *
   * The row is locked `FOR UPDATE` before the version is compared, so the comparison is
   * authoritative: a cart that moved under the operator is refused rather than tied to an
   * order nobody is looking at.
   *
   * The caller owns the transaction. If `writeOrder` throws, the cart mark rolls back with
   * it; and a cart that was already fired answers `already_fired` instead of writing a
   * second order.
   */
  async fire(
    client: PoolClient,
    merchantId: string,
    cart: Cart,
    expectedVersion: number,
    operatorSessionId: string,
  ): Promise<
    | {
        state: 'fired' | 'already_fired';
        orderId: string;
        reference: string | null;
        lineCount: number;
        cartVersion: number;
      }
    | { state: 'rejected' }
  > {
    await this.assertFinanciallyMutable(client, merchantId, cart.id);
    const current = await client.query<{
      firedOrderId: string | null;
      version: number;
      status: string;
      lifecycleState: string;
    }>(
      `SELECT fired_order_id::text AS "firedOrderId",version,status,
              lifecycle_state AS "lifecycleState"
         FROM merchant.pos_cart
        WHERE merchant_id=$1::uuid AND id=$2::uuid AND operator_session_id=$3::uuid
        FOR UPDATE`,
      [merchantId, cart.id, operatorSessionId],
    );
    const row = current.rows[0];
    if (!row) return { state: 'rejected' };

    if (
      row.version !== expectedVersion ||
      !['building_cart', 'ready_for_checkout', 'recovered'].includes(row.lifecycleState) ||
      !['draft', 'prepared'].includes(row.status)
    )
      return { state: 'rejected' };

    if (row.firedOrderId) {
      // THE SECOND ROUND (plan §8.2 F6). The cart already created its order; the
      // lines that never reached it are the ones still local (`fired` false).
      const pending = cart.items.filter((item) => !item.fired);
      if (pending.length === 0) {
        // Nothing new to send, so the answer the first version gave is still true.
        const prior = await client.query<{ reference: string | null; lineCount: string }>(
          `SELECT COALESCE(o.external_ref,o.id::text) AS reference,
                  (SELECT count(*) FROM merchant.order_item i WHERE i.order_id=o.id)::text
                    AS "lineCount"
             FROM merchant.customer_order o
            WHERE o.id=$1::uuid AND o.merchant_id=$2::uuid`,
          [row.firedOrderId, merchantId],
        );
        if (!prior.rows[0]) return { state: 'rejected' };
        return {
          state: 'already_fired',
          orderId: row.firedOrderId,
          reference: prior.rows[0].reference,
          lineCount: Number(prior.rows[0].lineCount),
          cartVersion: row.version,
        };
      }

      if (
        row.version !== expectedVersion ||
        !['building_cart', 'ready_for_checkout', 'recovered'].includes(row.lifecycleState) ||
        !['draft', 'prepared'].includes(row.status)
      ) {
        return { state: 'rejected' };
      }

      // Same order, same ticket — the round is appended to both. `appendOrderItems`
      // writes the `order_upserted` event and grows the kitchen projection, so the
      // new items reach the stations instead of being charged in silence.
      const appended = await appendOrderItems(client, {
        merchantId,
        orderId: row.firedOrderId,
        lines: pending.map((item) => ({
          productId: item.productId,
          name: item.productName,
          variantName: item.variant?.name ?? null,
          quantity: item.quantity,
          courseNumber: item.courseNumber,
          unitPriceCents: item.price.unitPrice.minorUnits,
          notes: item.note,
          modifiers: item.modifiers.map((modifier) => ({
            name: modifier.name,
            priceDeltaCents: 0,
          })),
        })),
      });
      await syncCartOrderContext(client, merchantId, cart.id, row.firedOrderId);
      await this.markFiredLines(
        client,
        merchantId,
        cart.id,
        pending.map((item) => item.id),
        appended.lineIds,
        operatorSessionId,
      );
      const advanced = await client.query<{ version: number }>(
        `UPDATE merchant.pos_cart SET version=version+1,updated_at=now()
          WHERE merchant_id=$1::uuid AND id=$2::uuid
          RETURNING version`,
        [merchantId, cart.id],
      );
      return {
        state: 'fired',
        orderId: row.firedOrderId,
        reference: await this.orderReference(client, merchantId, row.firedOrderId),
        lineCount: pending.length,
        cartVersion: Number(advanced.rows[0]?.version ?? row.version + 1),
      };
    }

    if (
      row.version !== expectedVersion ||
      !['building_cart', 'ready_for_checkout', 'recovered'].includes(row.lifecycleState) ||
      !['draft', 'prepared'].includes(row.status)
    ) {
      return { state: 'rejected' };
    }

    // An empty ticket is a cook walking to a screen to find nothing.
    if (cart.items.length === 0) return { state: 'rejected' };

    const externalRef = `pos-cart:${cart.id}`;
    const written = await writeOrder(client, {
      merchantId,
      locationId: cart.locationId,
      customerId: null,
      source: 'pos',
      // The order type is the cart's (plan §8.2 F3, decision D5). The operator
      // chose how the order leaves the counter, and it is the same fact the
      // checkout would write — so a fired takeaway order is a takeaway order.
      fulfillmentType: cart.fulfillmentType,
      externalRef,
      lines: cart.items.map((item) => ({
        productId: item.productId,
        name: item.productName,
        variantName: item.variant?.name ?? null,
        quantity: item.quantity,
        courseNumber: item.courseNumber,
        // `unitPrice` already folds the variant delta AND the modifiers — the cart
        // computes it as base + variantDelta + modifierTotal — which is exactly what an
        // order line means by "modifiers already folded in".
        unitPriceCents: item.price.unitPrice.minorUnits,
        notes: item.note,
        // Same reason as the checkout: the money is in `unitPriceCents`, so a modifier
        // carries no delta of its own here. It exists for the kitchen ticket, which prints
        // what was asked for, not what it cost.
        modifiers: item.modifiers.map((modifier) => ({
          name: modifier.name,
          priceDeltaCents: 0,
        })),
      })),
    });
    if (!written.orderId) return { state: 'rejected' };

    await syncCartOrderContext(client, merchantId, cart.id, written.orderId);
    // Every line the cart held is on the ticket now, so all of them are sent.
    await this.markFiredLines(
      client,
      merchantId,
      cart.id,
      cart.items.map((item) => item.id),
      written.lineIds,
      operatorSessionId,
    );
    await client.query(
      `UPDATE merchant.pos_cart
          SET fired_order_id=$3::uuid,version=version+1,updated_at=now()
        WHERE merchant_id=$1::uuid AND id=$2::uuid`,
      [merchantId, cart.id, written.orderId],
    );

    return {
      state: 'fired',
      orderId: written.orderId,
      reference: externalRef,
      lineCount: cart.items.length,
      cartVersion: row.version + 1,
    };
  }

  private async markFiredLines(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    cartLineIds: string[],
    orderItemIds: string[],
    operatorSessionId: string,
  ) {
    if (cartLineIds.length !== orderItemIds.length) throw new Error('ORDER_LINE_MAPPING_FAILED');
    await client.query(
      `UPDATE merchant.pos_cart_line l SET fired_at=now(),updated_at=now(),order_item_id=m.order_item_id,
        fired_by_user_id=(SELECT os.user_id FROM runtime.operator_session os WHERE os.id=$5::uuid)
      FROM unnest($3::uuid[],$4::uuid[]) AS m(cart_line_id,order_item_id)
      WHERE l.id=m.cart_line_id AND l.merchant_id=$1::uuid AND l.cart_id=$2::uuid AND l.fired_at IS NULL`,
      [merchantId, cartId, cartLineIds, orderItemIds, operatorSessionId],
    );
  }

  /// The string the kitchen ticket shows for an order — what an operator reads to a
  /// cook. Used by the second round, which answers with the order the cart already
  /// owns rather than one it just wrote.
  private async orderReference(
    client: PoolClient,
    merchantId: string,
    orderId: string,
  ): Promise<string | null> {
    const row = await client.query<{ reference: string | null }>(
      `SELECT COALESCE(external_ref,id::text) AS reference
         FROM merchant.customer_order
        WHERE id=$1::uuid AND merchant_id=$2::uuid`,
      [orderId, merchantId],
    );
    return row.rows[0]?.reference ?? null;
  }

  private async bump(
    client: PoolClient,
    merchantId: string,
    cartId: string,
    expectedVersion: number,
    operatorSessionId: string,
    { allowFired = false, pendingLineId }: { allowFired?: boolean; pendingLineId?: string } = {},
  ) {
    // A cart that fired is frozen for edits to the lines the kitchen already has —
    // changing one would leave the order and the cart disagreeing. It accepts NEW
    // lines (`allowFired`), which are the second round (plan §8.2 F6).
    await this.assertFinanciallyMutable(client, merchantId, cartId);
    const firedGuard = allowFired ? '' : 'AND fired_order_id IS NULL';
    const pendingLineGuard =
      pendingLineId == null
        ? ''
        : `AND EXISTS (
      SELECT 1 FROM merchant.pos_cart_line line WHERE line.merchant_id=$1::uuid
        AND line.cart_id=$2::uuid AND line.id=$5::uuid AND line.fired_at IS NULL)`;
    const { rowCount } = await client.query(
      `UPDATE merchant.pos_cart SET status='draft',lifecycle_state='building_cart',
         version=version+1,updated_at=now()
       WHERE merchant_id=$1::uuid AND id=$2::uuid AND version=$3
         AND operator_session_id=$4::uuid
         ${firedGuard}
         ${pendingLineGuard}
         AND lifecycle_state IN ('building_cart','ready_for_checkout','recovered')
         AND status IN ('draft','prepared')`,
      [
        merchantId,
        cartId,
        expectedVersion,
        operatorSessionId,
        ...(pendingLineId == null ? [] : [pendingLineId]),
      ],
    );
    return (rowCount ?? 0) > 0;
  }

  async snapshot(merchantId: string, locationId: string, cartId: string): Promise<Cart | null> {
    return this.pg.runWithMerchant(
      merchantId,
      null,
      (client) => this.snapshotWithClient(client, merchantId, cartId),
      locationId,
    );
  }

  async snapshotWithClient(
    client: PoolClient,
    merchantId: string,
    cartId: string,
  ): Promise<Cart | null> {
    const cart = await client.query<{
      id: string;
      merchantId: string;
      locationId: string;
      operatorSessionId: string;
      status: 'draft' | 'prepared' | 'committed' | 'abandoned';
      accountOwnerActive: boolean;
      version: number;
      firedOrderId: string | null;
      tableId: string | null;
      tableName: string | null;
      tableVisitId: string | null;
      lifecycleState: NonNullable<Cart['lifecycleState']>;
      fulfillmentType: 'dine_in' | 'takeout';
      businessDate: string;
      updatedAt: string;
      currency: string;
      accountName: string | null;
      accountFolio: string;
      createdAt: string;
      operatorName: string | null;
    }>(
      `SELECT c.id::text,c.merchant_id::text AS "merchantId",c.location_id::text AS "locationId",
              c.operator_session_id::text AS "operatorSessionId",c.status,c.version,
              COALESCE(os.state='active' AND os.expires_at>now() AND d.status='active',false) AS "accountOwnerActive",
              c.display_label AS "accountName",to_char(c.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
              'Cuenta '||lpad(COALESCE(c.daily_account_number,c.account_number)::text,
                greatest(3,length(COALESCE(c.daily_account_number,c.account_number)::text)),'0') AS "accountFolio",
              creator.full_name AS "operatorName",c.table_id::text AS "tableId",c.table_name AS "tableName",
              c.table_visit_id::text AS "tableVisitId",c.lifecycle_state AS "lifecycleState",
              c.fired_order_id::text AS "firedOrderId",c.fulfillment_type AS "fulfillmentType",
              c.business_date::text AS "businessDate",c.updated_at::text AS "updatedAt",b.currency
       FROM merchant.pos_cart c JOIN merchant.merchant b ON b.id=c.merchant_id
       LEFT JOIN runtime.operator_session os ON os.id=c.operator_session_id AND os.merchant_id=c.merchant_id
       LEFT JOIN merchant.device d ON d.id=os.device_id AND d.merchant_id=c.merchant_id
       LEFT JOIN umi."user" creator ON creator.id=c.original_operator_user_id
       WHERE c.merchant_id=$1::uuid AND c.id=$2::uuid`,
      [merchantId, cartId],
    );
    if (!cart.rows[0]) return null;
    const lines = await client.query<{
      id: string;
      productId: string;
      productName: string;
      saleAction: 'merchandise' | 'gift_card';
      quantity: number;
      variantId: string | null;
      variantName: string | null;
      variantAttributes: Record<string, string>;
      note: string | null;
      courseNumber: number;
      firedAt: string | null;
      firedOrderItemId: string | null;
      basePrice: string;
      variantDelta: string;
      modifierTotal: string;
      taxRateBasisPoints: number;
      modifiers: Array<Record<string, unknown>>;
    }>(
      `SELECT l.id::text,l.product_id::text AS "productId",l.product_name AS "productName",
              p.sale_action AS "saleAction",
              l.quantity,l.variant_id::text AS "variantId",l.variant_name AS "variantName",
              l.variant_attributes AS "variantAttributes",l.note,l.base_price::text AS "basePrice",
              l.variant_delta::text AS "variantDelta",l.modifier_total::text AS "modifierTotal",
              l.tax_rate_basis_points AS "taxRateBasisPoints",
              l.course_number AS "courseNumber",
              l.fired_at::text AS "firedAt",l.order_item_id::text AS "firedOrderItemId",
              COALESCE(jsonb_agg(jsonb_build_object('modifierId',m.modifier_id::text,
                'groupId',m.group_id::text,'name',m.name,'quantity',m.quantity,
                'priceDelta',jsonb_build_object('minorUnits',m.price_delta,'currency',$3::text))
                ORDER BY m.name) FILTER(WHERE m.id IS NOT NULL),'[]') modifiers
       FROM merchant.pos_cart_line l JOIN merchant.product p ON p.id=l.product_id
       LEFT JOIN merchant.pos_cart_line_modifier m ON m.line_id=l.id
       WHERE l.merchant_id=$1::uuid AND l.cart_id=$2::uuid
       GROUP BY l.id,p.sale_action ORDER BY l.created_at,l.id`,
      [merchantId, cartId, cart.rows[0].currency],
    );
    const currency = cart.rows[0].currency;
    let subtotal = 0;
    let tax = 0;
    const items = lines.rows.map((line) => {
      const unit = Number(line.basePrice) + Number(line.variantDelta) + Number(line.modifierTotal);
      const lineTotal = unit * line.quantity;
      const lineTax = Math.round(
        (lineTotal * line.taxRateBasisPoints) / (10000 + line.taxRateBasisPoints),
      );
      subtotal += lineTotal;
      tax += lineTax;
      return {
        id: line.id,
        productId: line.productId,
        productName: line.productName,
        saleAction: line.saleAction,
        quantity: line.quantity,
        courseNumber: line.courseNumber,
        // Whether the kitchen already has this line (plan §8.2 F6). A new line on a
        // fired cart arrives unfired until the second fire sends it.
        fired: line.firedAt != null,
        firedOrderItemId: line.firedOrderItemId ?? null,
        variant: line.variantId
          ? {
              variantId: line.variantId,
              name: line.variantName!,
              attributes: line.variantAttributes,
            }
          : null,
        modifiers: line.modifiers,
        note: line.note,
        price: {
          unitPrice: { minorUnits: unit, currency },
          lineSubtotal: { minorUnits: lineTotal, currency },
          tax: { minorUnits: lineTax, currency },
          lineTotal: { minorUnits: lineTotal, currency },
          taxRateBasisPoints: line.taxRateBasisPoints,
        },
      };
    });
    const { businessDate, currency: _currency, ...cartIdentity } = cart.rows[0];
    return {
      ...cartIdentity,
      items: items as Cart['items'],
      totals: {
        subtotal: { minorUnits: subtotal, currency },
        tax: { minorUnits: tax, currency },
        discounts: { total: { minorUnits: 0, currency }, entries: [] },
        grandTotal: { minorUnits: subtotal, currency },
        businessDate,
      },
      checkoutEnabled: false,
      checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
    };
  }
}
