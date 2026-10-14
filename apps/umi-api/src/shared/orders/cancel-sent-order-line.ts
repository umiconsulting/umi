import type { PoolClient } from 'pg';

export interface CancelSentOrderLineInput {
  merchantId: string;
  locationId: string;
  cartId: string;
  lineId: string;
  operatorSessionId: string;
  expectedVersion: number;
  reasonCode: 'customer_changed' | 'operator_mistake' | 'duplicate' | 'other';
  correlationId: string;
  /**
   * Cancel a line the kitchen already started (`preparing`/`ready`), not just one still
   * in the queue. The database does not take the caller's word for it: a forced cancel is
   * only reachable when the SAME command consumed a live `sale.void.create` elevation
   * (migration 026), and the line's kitchen event records that the food was already made.
   */
  forced?: boolean;
}

export type CancelSentOrderLineState =
  | 'cancelled'
  | 'preparation_started'
  /**
   * The ticket belongs to a business day that is no longer the merchant's current one.
   * Migration 027 added this answer so the till can tell a closed day apart from a
   * kitchen that already started the dish — two refusals with two different next steps.
   */
  | 'day_closed'
  | 'rejected';

/** Cancel the exact source line inside the caller's command transaction. */
export async function cancelSentOrderLine(
  client: PoolClient,
  input: CancelSentOrderLineInput,
): Promise<CancelSentOrderLineState> {
  const result = await client.query<{ state: CancelSentOrderLineState }>(
    `SELECT merchant.cancel_sent_cart_line(
       $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::integer,$7::text,$8::text,$9::boolean
     ) AS state`,
    [
      input.merchantId,
      input.locationId,
      input.cartId,
      input.lineId,
      input.operatorSessionId,
      input.expectedVersion,
      input.reasonCode,
      input.correlationId,
      input.forced ?? false,
    ],
  );
  return result.rows[0]?.state ?? 'rejected';
}
