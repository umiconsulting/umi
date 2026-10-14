begin read only;
select now() as captured_at;
select version,published_version,
  (select count(*) from jsonb_array_elements(published->'areas') a,
    jsonb_array_elements(a->'elements') e where e->>'kind'='table') as published_tables
from merchant.floor_plan where location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6';
select a->>'name' as area,e->>'id' as table_id,e->>'label' as label,
  e->>'capacity' as capacity,s.state,s.party_size,s.visit_id,c.account_number,c.lifecycle_state
from merchant.floor_plan p cross join lateral jsonb_array_elements(p.published->'areas') a
cross join lateral jsonb_array_elements(a->'elements') e
left join merchant.table_state s on s.merchant_id=p.merchant_id and s.location_id=p.location_id and s.table_id=(e->>'id')::uuid
left join merchant.pos_cart c on c.merchant_id=p.merchant_id and c.location_id=p.location_id
  and c.table_id=s.table_id and c.status in ('draft','prepared')
where p.location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6' and e->>'kind'='table'
order by e->>'label';
select count(*) as saved_accounts,count(*) filter(where status in ('draft','prepared')) as open_accounts
from merchant.pos_cart where location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6';
commit;
