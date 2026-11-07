create index if not exists sales_analysis_receipt_period_idx
  on merchant.receipt_snapshot (merchant_id, business_date, location_id);

create index if not exists sales_analysis_sale_scope_idx
  on merchant.pos_committed_sale (merchant_id, location_id, committed_at);

create index if not exists sales_analysis_refund_sale_idx
  on merchant.pos_sale_exception (merchant_id, sale_id, committed_at)
  where status = 'committed';
