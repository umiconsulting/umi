/** Cobrar conserva el trabajo pendiente. Sólo una cancelación comercial lo detiene. */
export function commercialCancellationSql(order: string): string {
  return `(EXISTS (
    SELECT 1 FROM merchant.customer_order co
    WHERE co.id=${order}.source_order_id AND co.merchant_id=${order}.merchant_id
      AND co.status='canceled'
  ) OR (EXISTS (
    SELECT 1 FROM merchant.pos_cart c
    WHERE c.merchant_id=${order}.merchant_id AND c.fired_order_id=${order}.source_order_id
      AND c.status='abandoned' AND c.lifecycle_state='cancelled'
  ) AND NOT EXISTS (
    SELECT 1 FROM merchant.pos_committed_sale sale
    WHERE sale.merchant_id=${order}.merchant_id AND sale.order_id=${order}.source_order_id
  )))`;
}
