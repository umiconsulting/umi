\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;

SELECT now() AS measured_at_utc;

SELECT id, name, timezone, business_day_start, pos_day_close_policy,
       ((now() AT TIME ZONE timezone) - business_day_start::interval)::date AS current_business_date
  FROM merchant.merchant
 WHERE id = 'e6b14af1-b814-4efe-a6b0-67f5f02f4d53';

SELECT k.id AS kitchen_order_id, k.public_reference, k.status AS kitchen_status,
       k.business_date, o.status AS commercial_status,
       c.account_number, c.lifecycle_state, c.status AS cart_status,
       c.cancellation_reason, c.cancelled_at,
       (SELECT count(*) FROM merchant.pos_committed_sale s
         WHERE s.merchant_id = k.merchant_id AND s.order_id = k.source_order_id) AS paid_sales
  FROM merchant.kitchen_order k
  JOIN merchant.customer_order o ON o.id = k.source_order_id AND o.merchant_id = k.merchant_id
  LEFT JOIN merchant.pos_cart c ON c.merchant_id = k.merchant_id
       AND (c.fired_order_id = k.source_order_id OR c.origin_order_id = k.source_order_id)
 WHERE k.merchant_id = 'e6b14af1-b814-4efe-a6b0-67f5f02f4d53'
   AND k.location_id = '54be4d9e-fa0a-4a42-b95f-402acfccade6'
   AND c.account_number IN (4, 13, 70, 71)
 ORDER BY c.account_number;

SELECT k.public_reference, i.product_name, i.status AS item_status,
       i.station_id, s.name AS station_name, i.route_reason, i.station_completed_at
  FROM merchant.kitchen_order_item i
  JOIN merchant.kitchen_order k ON k.id = i.kitchen_order_id AND k.merchant_id = i.merchant_id
  LEFT JOIN merchant.station s ON s.id = i.station_id AND s.merchant_id = i.merchant_id
 WHERE k.merchant_id = 'e6b14af1-b814-4efe-a6b0-67f5f02f4d53'
   AND k.location_id = '54be4d9e-fa0a-4a42-b95f-402acfccade6'
   AND EXISTS (SELECT 1 FROM merchant.pos_cart c
                WHERE c.merchant_id = k.merchant_id AND c.fired_order_id = k.source_order_id
                  AND c.account_number IN (4, 13, 70, 71))
 ORDER BY k.public_reference, i.display_order;

SELECT c.account_number, c.status, c.lifecycle_state, c.business_date,
       c.table_name, c.display_label
  FROM merchant.pos_cart c
  JOIN merchant.merchant m ON m.id = c.merchant_id
 WHERE c.merchant_id = 'e6b14af1-b814-4efe-a6b0-67f5f02f4d53'
   AND c.location_id = '54be4d9e-fa0a-4a42-b95f-402acfccade6'
   AND c.status IN ('draft', 'prepared')
   AND c.business_date < ((now() AT TIME ZONE m.timezone) - m.business_day_start::interval)::date
 ORDER BY c.account_number;

COMMIT;
