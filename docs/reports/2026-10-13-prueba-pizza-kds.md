# Prueba del flujo de pizza en KDS y significado de Preparación

Fecha: 2026-10-13. Se probó el APK 0.1.0+96 ya instalado, sin modificar código ni datos de configuración.

## Qué significa «Preparación» hoy

En el KDS del POS, «Preparación» no es una etapa de la comanda. Es una consulta de inventario: lista insumos con niveles objetivo y cantidades de reposición. Como no hay niveles objetivo configurados, Admin ONCA vio el mensaje «No hay niveles objetivo de preparación. Configúralos en Inventario del panel administrativo.» La Margarita de prueba no apareció ahí.

En cambio, Barista 2 puede operar el KDS, pero no tiene permiso de inventario. Al tocar la pestaña visible «Preparación», la llamada `GET /inventory/prep-list` respondió `403 PERMISSION_DENIED`. La pestaña mezcla dos funciones que deben estar separadas y además anuncia una opción que el rol no puede usar.

## Prueba real

En la iMin creé Cuenta 173, agregué una Margarita y la envié a cocina. Antes de crearla, comprobé que la categoría Pizzas ya tenía una regla activa hacia Cocina, prioridad 100; no hizo falta modificar rutas ni base de datos. En la A9, como Barista 2, la tarjeta de Cuenta 173 apareció en Cocina como «En cola». Toqué «Empezar»; cambió a «En preparación». Dejé la cuenta sin pagar y la comanda en ese estado para que el resultado siga visible.

| Captura                                                                                          | Resultado                                  |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| [Cuenta vacía](evidence/2026-10-13-prueba-pizza-kds/cuenta-vacia.png)                            | Cuenta 173 antes de añadir la pizza        |
| [Categoría Pizzas](evidence/2026-10-13-prueba-pizza-kds/categoria-pizzas.png)                    | Producto elegido para la prueba            |
| [Margarita en cuenta](evidence/2026-10-13-prueba-pizza-kds/margarita-en-cuenta.png)              | La línea añadida                           |
| [Enviada a cocina](evidence/2026-10-13-prueba-pizza-kds/margarita-enviada.png)                   | Envío desde la iMin                        |
| [En cola en Cocina](evidence/2026-10-13-prueba-pizza-kds/margarita-en-cola.png)                  | Cuenta 173 llegó a la estación configurada |
| [En preparación](evidence/2026-10-13-prueba-pizza-kds/margarita-en-preparacion.png)              | Barista inició el trabajo                  |
| [Preparación como Barista](evidence/2026-10-13-prueba-pizza-kds/pestana-preparacion-barista.png) | Error visible por permiso de inventario    |
| [Preparación como Admin](evidence/2026-10-13-prueba-pizza-kds/pestana-preparacion-admin.png)     | Lista de insumos sin niveles objetivo      |

La [consulta SQL](evidence/2026-10-13-prueba-pizza-kds/verification.sql) y su [salida](evidence/2026-10-13-prueba-pizza-kds/database.txt) confirman: Cuenta 173, `in_preparation`, artículo `preparing`, categoría Pizzas y estación Cocina. La ruta categoría→estación está activa. El [extracto del log de API](evidence/2026-10-13-prueba-pizza-kds/api-requests.jsonl) registra el comando de cocina con HTTP 201, la carga de Preparación como Barista rechazada y la carga de la lista como Admin con HTTP 200. Se redactaron los identificadores de sesión en las URL.

## Recomendación de experiencia

Mantendría una sola vista «Comandas» para el cocinero. El flujo normal de una estación de cocina debe ser «Empezar» → «Listo»; el estado debe avanzar cuando el cocinero termina, y el POS del mesero recibe ese aviso. No pondría otra pestaña llamada «Preparación» entre ambos estados porque en Umi ya nombra otra función.

La acción actual «Terminar» sólo tiene sentido si representa una responsabilidad real distinta, como Expo verificando y cerrando el ticket. Si Cocina es una sola estación y el mismo operador hace todo, añade una pulsación que no aclara el trabajo. Tampoco llamaría «Entregada» al estado de Cocina: que un platillo esté listo no prueba que se haya llevado a la mesa; si el negocio quiere rastrear entrega física, eso pertenece al flujo de servicio del mesero.

La documentación oficial de Toast describe estaciones de preparación que marcan los artículos como cumplidos y una estación Expo opcional que ve cuándo todos quedaron listos; también documenta que un KDS de preparación puede operar sin Expo. Esto apoya conservar Expo sólo donde haya una persona o proceso de pase, no exigirlo a una cocina de una sola estación ([Toast: KDS overview](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html), [Toast: item fulfillment](https://doc.toasttab.com/doc/platformguide/platformKitchenUnderstandingItemFulfillmentKDS.html)). La comparación más amplia con Toast, Square, Lightspeed, Fresh KDS y sistemas regionales está en la [investigación de KDS](../research/2026-10-13-kds-ruteo-tiempos-sonidos/README.md), con las capturas y límites de verificación allí indicados.

Movería la lista actual a Inventario y la titularía «Insumos» o «Reposición». En KDS ocultaría esa entrada a quien no tenga permiso de inventario. Esto resuelve tanto la confusión funcional como el 403 que observamos en Barista 2.

## Qué quedó sin verificar

- No marqué la Margarita como lista ni comprobé el aviso al POS del mesero; la dejé en preparación para preservar la captura y la orden de prueba.
- No configuré niveles objetivo de inventario; por eso la lista de Admin estaba vacía.
- No hice cambios de código, de ruta ni de base, ni generé un APK nuevo. En esta tarea sólo se verificó el comportamiento del build 96.
- Las capturas de competidores son documentación o pantallas de ejemplo de proveedores, no sesiones comerciales reales. Sus alcances están etiquetados en la investigación enlazada.
