begin read only;
select now() as captured_at;
select ko.public_reference,ko.id,ko.status as kitchen_status,ko.version,c.lifecycle_state as commercial_status,
  i.product_name,s.name as station,i.status,i.route_reason,i.target_seconds,i.station_completed_at
from merchant.kitchen_order ko
join merchant.kitchen_order_item i on i.kitchen_order_id=ko.id
left join merchant.station s on s.id=i.station_id
left join merchant.pos_cart c on c.fired_order_id=ko.source_order_id
where ko.location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6'
  and (ko.public_reference like '%004%' or ko.public_reference like '%013%')
order by ko.public_reference,i.display_order;
commit;
