\set ON_ERROR_STOP on
-- La estación termina sus ítems sin terminar el trabajo de otras estaciones.
alter table merchant.kitchen_order_item
  add column if not exists station_completed_at timestamptz;
grant update(station_completed_at) on merchant.kitchen_order_item to api;
comment on column merchant.kitchen_order_item.station_completed_at is
  'Confirmación de entrega de la estación. El estado global termina cuando todas las estaciones confirman sus ítems.';
