begin read only;

select ko.id as kitchen_order_id,
       ko.public_reference,
       ko.business_date,
       ko.status as order_status,
       ko.version,
       c.name as category,
       p.name as product,
       i.status as item_status,
       s.name as station
  from merchant.kitchen_order ko
  join merchant.kitchen_order_item i on i.kitchen_order_id = ko.id
  join merchant.product p on p.id = i.product_id
  join merchant.product_category c on c.id = p.category_id
  left join merchant.station s on s.id = i.station_id
 where ko.id = 'bebec681-abed-47ca-8c6d-f4214aad5f90';

select r.id as route_id,
       c.name as category,
       s.name as station,
       r.route_priority,
       r.target_seconds,
       r.active
  from merchant.kitchen_route r
  join merchant.product_category c on c.id = r.category_id
  join merchant.station s on s.id = r.station_id
 where r.id = '6e271683-4af9-44d8-9e30-1bcdf367b7c8';

commit;
