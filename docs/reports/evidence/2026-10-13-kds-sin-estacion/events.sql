begin read only;
select now() as captured_at;
select e.sequence,e.occurred_at,ko.public_reference,e.kind,e.aggregate_version,e.status,e.safe_payload,e.correlation_id
from merchant.kitchen_event e
join merchant.kitchen_order ko on ko.id=e.kitchen_order_id
where e.kitchen_order_id in ('50e2ef12-ba2f-4d0c-97be-41a28829257b','bfd5e02f-ee14-47b3-be3e-31b143ac1795')
  and e.occurred_at >= '2026-10-13T22:18:22Z'
order by e.sequence;
select a.occurred_at,u.full_name,a.event_type,a.entity_type,a.entity_id,a.outcome,a.public_data
from merchant.audit_event a
left join umi."user" u on u.id=a.actor_user_id
where a.entity_id in ('50e2ef12-ba2f-4d0c-97be-41a28829257b','bfd5e02f-ee14-47b3-be3e-31b143ac1795')
  and a.occurred_at >= '2026-10-13T22:18:22Z'
order by a.occurred_at;
select c.created_at,c.command_type,c.status,c.expected_version,c.device_id,c.correlation_id
from merchant.kitchen_command c
where c.kitchen_order_id='50e2ef12-ba2f-4d0c-97be-41a28829257b'
  and c.created_at >= '2026-10-13T22:18:22Z'
order by c.created_at;
select s.id,u.full_name,s.state,s.started_at,s.device_id,
  'kitchen.station.manage'=any(s.permissions) as can_manage_routes,
  'kitchen.ready'=any(s.permissions) as can_mark_ready,
  'kitchen.complete'=any(s.permissions) as can_complete,
  'kitchen.cancel_ack'=any(s.permissions) as can_ack_cancel
from runtime.operator_session s
join umi."user" u on u.id=s.user_id
where s.location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6' and s.state='active'
order by u.full_name;
commit;
