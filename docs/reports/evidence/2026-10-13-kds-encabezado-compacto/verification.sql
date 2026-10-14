begin read only;
select now() as captured_at;
select u.full_name,s.state,
       'kitchen.read'=any(s.permissions) as kitchen_read,
       'inventory.read'=any(s.permissions) as inventory_read
from runtime.operator_session s join umi."user" u on u.id=s.user_id
where s.location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6'
  and s.state='active' and u.full_name in ('Admin ONCA','Barista 2','Mesero 2')
order by u.full_name;
select ko.public_reference,ko.version,ko.status as kitchen_status,
       s.name as station,i.product_name,i.status as item_status
from merchant.kitchen_order ko
join merchant.kitchen_order_item i on i.kitchen_order_id=ko.id
left join merchant.station s on s.id=i.station_id
where ko.location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6'
  and i.station_completed_at is null
  and ko.status <> 'completed'
order by ko.public_reference,i.display_order;
commit;
