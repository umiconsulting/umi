-- El pago cierra la cuenta. La visita termina cuando sale el cliente.
begin;
alter table merchant.table_state add column if not exists paid_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid='merchant.table_state'::regclass and conname='table_state_paid_visit_present') then
    alter table merchant.table_state add constraint table_state_paid_visit_present
      check (paid_at is null or seated_at is not null);
  end if;
end $$;

create or replace function merchant.table_state_paid_visit_guard()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.seated_at is null then new.paid_at=null; end if;
  return new;
end $$;
revoke all on function merchant.table_state_paid_visit_guard() from public;
grant execute on function merchant.table_state_paid_visit_guard() to api,worker;
drop trigger if exists table_state_paid_visit_guard on merchant.table_state;
create trigger table_state_paid_visit_guard before insert or update on merchant.table_state
  for each row execute function merchant.table_state_paid_visit_guard();
commit;
