\set ON_ERROR_STOP on
-- CANCELAR UN PLATILLO QUE LA COCINA YA EMPEZÓ, CON AUTORIZACIÓN.
--
-- `019_cancel_sent_cart_line.sql` puso la frontera en «la cocina ya es dueña de esto»:
-- en cuanto el renglón pasaba a `preparing`, la caja no podía cancelarlo y el único
-- camino era que alguien lo arreglara a mano en la base. La competencia que un café usa
-- de verdad contesta distinto: el cancelado SIGUE siendo posible y lo autoriza un
-- gerente (Toast, Square, SpotOn, TouchBistro, Clover — ver la investigación de política
-- de edición). El platillo ya está hecho en los dos casos: negar el cancelado no lo
-- deshace, solo deja mal la cuenta y vuelve invisible la merma.
--
-- Así que la regla se vuelve dos reglas, y la diferencia entre ellas es `p_forced`:
--
--   * sin forzar (el camino de 019, intacto): el renglón se cancela mientras su
--     renglón de cocina esté en `queued` o `exception`. El operador no necesita
--     autorización porque todavía no hay nada hecho.
--   * forzado (nuevo): se cancela mientras esté en `queued`, `preparing`, `ready` o
--     `exception` —los estados en los que puede existir comida— y solo con una
--     autorización viva de `sale.void.create` consumida por el MISMO comando
--     (`runtime.elevation_grant.consumed_by_command_id`, el mismo mecanismo que usan
--     las excepciones de venta). Un TICKET `completed` sigue negándose: ese ticket ya
--     es el registro del día.
--
-- POR QUÉ `sale.void.create` Y NO UNA PERMISIÓN NUEVA. Es la permisión que ya significa
-- «una persona con autoridad anuló algo», ya está clasificada como `approvalRequired` en
-- `config/umipos-permission-inventory.json` y ya la tienen admin, gerente, owner y
-- supervisor. Inventar una clave nueva obligaría a regenerar el RBAC del piloto, a
-- reinscribir el personal y a explicar por qué dos permisos describen el mismo acto.
--
-- LO QUE EL CANCELADO FORZADO DEJA IGUAL Y LO QUE AÑADE. Deja igual todo el rastro del
-- cancelado normal: la línea comercial se anula con su motivo (`order_item.voided_at` /
-- `void_reason`), el renglón de cocina se cancela, el KDS lo pinta tachado y la cuenta
-- se deja de cobrar. Añade UN hecho que el cancelado normal no puede llevar: el renglón
-- ya se estaba haciendo, así que anularlo es MERMA y no una simple corrección. Ese hecho
-- viaja en el payload del evento de cocina como `afterPreparationStarted`, que es de
-- donde lo va a leer un reporte de merma. Este archivo no añade ninguna columna a
-- propósito: «¿esto se alcanzó a hacer?» se deriva de la versión ANTERIOR del renglón, y
-- el evento ya guarda de qué estado se movió.
--
-- POR QUÉ HAY QUE BORRAR LA FIRMA DE 8 ARGUMENTOS. No puede quedarse viva junto a la
-- nueva: con un noveno argumento con valor por omisión, una llamada de 8 argumentos
-- empata con las dos y Postgres contesta «function is not unique» en vez de tomar el
-- valor por omisión. La llamada de 8 argumentos sigue funcionando contra la firma nueva.

drop function if exists merchant.cancel_sent_cart_line(
  uuid,uuid,uuid,uuid,uuid,integer,text,text);

create or replace function merchant.cancel_sent_cart_line(
  p_merchant uuid, p_location uuid, p_cart uuid, p_line uuid,
  p_operator uuid, p_version integer, p_reason text, p_correlation text,
  p_forced boolean default false
) returns text language plpgsql security definer
set search_path=pg_catalog as $$
declare
  v_order uuid;
  v_item uuid;
  v_ticket uuid;
  v_ticket_status text;
  v_ticket_version bigint;
  v_item_status text;
  v_next text;
  v_made boolean;
begin
  if p_merchant is distinct from umi.current_merchant()
     or p_location is distinct from umi.current_location()
     or p_reason is null
     or p_reason not in ('customer_changed','operator_mistake','duplicate','other')
     or not exists (
       select 1 from runtime.operator_session os
       join merchant.device d on d.id=os.device_id and d.status='active'
       where os.id=p_operator and os.merchant_id=p_merchant and os.location_id=p_location
         and os.device_id=umi.current_device()
         and os.user_id=nullif(current_setting('app.user_id',true),'')::uuid
         and os.state='active' and os.expires_at>now()
         and ('*'=any(os.permissions)
           or ('cart.write'=any(os.permissions) and 'order.fire'=any(os.permissions)))
         and exists (select 1 from jsonb_array_elements(os.entitlements) e
           where e->>'featureKey'='pos' and coalesce((e->>'enabled')::boolean,false))
     ) then return 'rejected'; end if;

  select c.fired_order_id into v_order from merchant.pos_cart c
    where c.id=p_cart and c.merchant_id=p_merchant and c.location_id=p_location
      and c.operator_session_id=p_operator and c.version=p_version
      and c.status in ('draft','prepared')
      and c.lifecycle_state in ('building_cart','ready_for_checkout','recovered')
    for update;
  if v_order is null then return 'rejected'; end if;

  -- Order locks serialize cancellation with settlement and new rounds.
  perform 1 from merchant.customer_order o
    where o.id=v_order and o.merchant_id=p_merchant and o.location_id=p_location
      and o.status not in ('completed','canceled') for update;
  if not found or exists (
    select 1 from merchant.pos_committed_sale s
      where s.merchant_id=p_merchant and s.order_id=v_order
  ) or exists (
    select 1 from merchant.pos_payment_attempt a
      where a.merchant_id=p_merchant and a.cart_id=p_cart
        and a.status in ('pending','succeeded','unknown','timeout')
  ) or exists (
    select 1 from merchant.payment p where p.order_id=v_order and p.status='captured'
  ) then return 'rejected'; end if;

  select l.order_item_id into v_item from merchant.pos_cart_line l
    join merchant.order_item i on i.id=l.order_item_id and i.order_id=v_order
    where l.id=p_line and l.cart_id=p_cart and l.merchant_id=p_merchant
      and l.fired_at is not null and i.voided_at is null for update of l,i;
  if v_item is null then return 'rejected'; end if;

  select ko.id,ko.status,ko.version into v_ticket,v_ticket_status,v_ticket_version
    from merchant.kitchen_order ko where ko.source_order_id=v_order
      and ko.merchant_id=p_merchant and ko.location_id=p_location for update;
  if v_ticket is not null then
    select k.status into v_item_status from merchant.kitchen_order_item k
      where k.kitchen_order_id=v_ticket and k.merchant_id=p_merchant
        and k.source_order_item_id=v_item for update;
    -- El renglón salió de la cola: cancelarlo tira algo a la basura.
    v_made := v_item_status in ('preparing','ready');
    if v_ticket_status='completed'
       or (v_item_status is not null and v_item_status not in ('queued','exception')
           and not (p_forced and v_item_status in ('preparing','ready')))
    then return 'preparation_started'; end if;
  end if;

  -- The existing immutable-line trigger emits the order_upserted event.
  update merchant.order_item set voided_at=clock_timestamp(),void_reason=p_reason
    where id=v_item and order_id=v_order and voided_at is null;

  if v_item_status is not null then
    update merchant.kitchen_order_item
      set status='cancelled',version=version+1,cancelled_at=clock_timestamp(),updated_at=clock_timestamp()
      where merchant_id=p_merchant and kitchen_order_id=v_ticket and source_order_item_id=v_item;
    select case
      when bool_and(status='cancelled') then 'cancelled'
      when bool_or(status='exception') then 'exception'
      when bool_and(status='ready') filter (where status<>'cancelled') then 'ready'
      when bool_or(status='ready') then 'partially_ready'
      when bool_or(status='preparing') then 'in_preparation'
      else 'queued' end into v_next
      from merchant.kitchen_order_item where merchant_id=p_merchant and kitchen_order_id=v_ticket;
    update merchant.kitchen_order set status=v_next,version=v_ticket_version+1,
      updated_at=clock_timestamp(),
      cancelled_at=case when v_next='cancelled' then clock_timestamp() else cancelled_at end,
      cancellation_code=case when v_next='cancelled' then 'cart_line_cancelled' else cancellation_code end
      where merchant_id=p_merchant and id=v_ticket;
    insert into merchant.kitchen_event
      (event_id,merchant_id,location_id,kitchen_order_id,kind,aggregate_version,status,safe_payload,correlation_id)
      values (gen_random_uuid(),p_merchant,p_location,v_ticket,
        case when v_next='cancelled' then 'order_cancelled' else 'order_updated' end,
        v_ticket_version+1,v_next,
        jsonb_build_object('sourceOrderItemId',v_item,'reasonCode',p_reason,
                           'afterPreparationStarted',coalesce(v_made,false)),
        p_correlation);
    perform pg_notify('umi_kitchen_board',jsonb_build_object(
      'merchant_id',p_merchant,'location_id',p_location,'kitchen_order_id',v_ticket)::text);
  end if;
  return 'cancelled';
end $$;

alter function merchant.cancel_sent_cart_line(uuid,uuid,uuid,uuid,uuid,integer,text,text,boolean) owner to worker;
revoke all on function merchant.cancel_sent_cart_line(uuid,uuid,uuid,uuid,uuid,integer,text,text,boolean) from public;
grant execute on function merchant.cancel_sent_cart_line(uuid,uuid,uuid,uuid,uuid,integer,text,text,boolean) to api;

comment on function merchant.cancel_sent_cart_line(uuid,uuid,uuid,uuid,uuid,integer,text,text,boolean) is
  'Anula un renglón ya enviado. Sin p_forced: solo si cocina no lo tocó (queued/exception). Con p_forced: también si ya lo empezó o lo terminó (preparing/ready), y el llamador debe haber consumido una autorización sale.void.create en el mismo comando — el evento de cocina marca afterPreparationStarted para que la merma sea contable. Un ticket completed nunca se anula.';
