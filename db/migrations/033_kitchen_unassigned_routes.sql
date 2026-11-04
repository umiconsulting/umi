-- El comando administrativo resuelve rutas sin estación bajo RLS del rol API.
-- GRANT se puede ejecutar otra vez y conserva los permisos existentes.
grant update (station_id,status,route_reason,target_seconds,version,updated_at)
  on merchant.kitchen_order_item to api;
-- FOR SHARE exige UPDATE de una columna. El comando sólo bloquea la ruta;
-- no cambia su versión ni concede edición de destino, prioridad o estado.
grant update (version) on merchant.kitchen_route to api;
