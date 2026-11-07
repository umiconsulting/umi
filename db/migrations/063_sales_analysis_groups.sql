create table if not exists merchant.sales_analysis_group (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchant.merchant(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (merchant_id, id)
);
create unique index if not exists sales_analysis_group_name_uq on merchant.sales_analysis_group (merchant_id, lower(btrim(name)));
create unique index if not exists sales_analysis_product_scope_uq on merchant.product (merchant_id, id);

create table if not exists merchant.sales_analysis_group_product (
  merchant_id uuid not null,
  group_id uuid not null,
  product_id uuid not null,
  primary key (merchant_id, group_id, product_id),
  foreign key (merchant_id, group_id) references merchant.sales_analysis_group(merchant_id, id) on delete cascade,
  foreign key (merchant_id, product_id) references merchant.product(merchant_id, id) on delete cascade
);

do $$ declare table_name text; begin
  foreach table_name in array array['sales_analysis_group', 'sales_analysis_group_product'] loop
    execute format('alter table merchant.%I enable row level security', table_name);
    execute format('alter table merchant.%I force row level security', table_name);
    execute format('drop policy if exists merchant_isolation on merchant.%I', table_name);
    execute format('create policy merchant_isolation on merchant.%I using (merchant_id = (select umi.current_merchant())) with check (merchant_id = (select umi.current_merchant()))', table_name);
    execute format('revoke all on merchant.%I from public', table_name);
    execute format('grant select, insert, update, delete on merchant.%I to api, worker', table_name);
    execute format('grant select on merchant.%I to readonly', table_name);
  end loop;
end $$;
