# UmiPOS: clientes, lealtad y valor almacenado

Actualizado: 2026-08-08

Estado: `COMPLETE`.

## 1. Autoridad

La API de UMI controla los clientes, los puntos y el valor almacenado. PostgreSQL conserva los hechos inmutables. Flutter muestra datos y solicita comandos.

Cada cliente pertenece a un merchant. Una venta puede permanecer anónima. La location limita cada operación y cada consulta.

## 2. Cliente, contacto y consentimiento

El servidor normaliza el correo y el teléfono. La búsqueda es acotada y usa el merchant. El resultado normal oculta el contacto.

El historial de consentimiento es inmutable. La entrega de recibos, la lealtad y el marketing usan decisiones separadas. La creación mínima no concede marketing.

La detección de duplicados crea candidatos. No combina perfiles. El merge requiere permiso, aprobación y una huella exacta.

El merge bloquea puntos, wallet o gift cards sin conciliación. Conserva el historial de los perfiles.

## 3. Política histórica y earn

La vista previa usa una sola función de cálculo en el servidor. La función usa importes enteros y redondeo canónico.

La entrada incluye estos datos:

- líneas y categorías;
- productos excluidos;
- descuentos;
- impuestos;
- propina;
- tenders;
- rewards;
- fecha comercial;
- versión y huella de la política.

La vista previa guarda la base bruta, la base excluida, la base final y los puntos. También guarda el estado pendiente o disponible.

La huella vincula el cliente, el carrito, los totales, los tenders, la location y la política. El commit rechaza una vista previa vencida o diferente.

El checkout guarda una copia histórica inmutable de la política. El refund usa los hechos y la asignación histórica. Nunca usa una política actual para cambiar una venta anterior.

## 4. Rewards

El servidor valida la cuenta, los puntos, la vigencia, la location y el alcance de producto. También valida categorías, variantes, modifiers, gasto mínimo y tenders.

Las reglas de combinación son explícitas. Un descuento o una propina incompatible bloquea la autorización. Otro reward requiere una confirmación de reemplazo. El servidor libera la autorización anterior una vez, renueva la vista y autoriza el nuevo reward. La UI no elimina un beneficio de forma silenciosa.

Los límites por venta, cliente y fecha comercial usan hechos y autorizaciones. El bloqueo de cuenta evita dos usos simultáneos.

La autorización reserva puntos. No canjea puntos. El checkout convierte la autorización en un hecho de canje.

## 5. Expiración y liberación

Un procesador común descubre autorizaciones vencidas. Procesa lotes de hasta 500 filas.

El procesador usa `FOR UPDATE SKIP LOCKED`. La transición crea un solo hecho de liberación. Un segundo proceso devuelve cero efectos.

La expiración cubre rewards, wallet y gift cards. Una autorización comprometida no puede expirar. Una autorización vencida no puede completar checkout.

El orden de lock es estable:

1. merchant;
2. customer;
3. cuenta de puntos;
4. wallet;
5. gift card;
6. autorización;
7. venta o refund;
8. proyección.

## 6. Ajuste manual de puntos

El Centro de clientes contiene una operación protegida. El operador selecciona dirección, puntos y motivo.

El servidor genera una vista previa. Una disminución no puede crear saldo negativo. El umbral del piloto requiere una aprobación vinculada.

El commit agrega un hecho `manual_points_adjustment`. Nunca reemplaza el saldo. La misma identidad de comando devuelve el resultado original.

## 7. Wallet

La wallet pertenece a un cliente, un merchant y una moneda. El ledger usa unidades monetarias menores enteras.

La autorización separa el saldo disponible del saldo autorizado. La liberación restaura el valor una vez.

El checkout usa una asignación canónica. La asignación vincula la cuenta, la autorización, el importe, el orden y la política.

La API calcula la huella de valor. La vista previa y el commit usan la misma serialización canónica. Los cambios invalidan la confirmación.

El commit crea el débito y el tender en la transacción de la venta. También admite tenders mixtos.

La wallet no permite saldo negativo, retiro, transferencia ni crédito. La emisión general permanece desactivada.

## 8. Gift card

La gift card pertenece a un merchant y a una moneda. El código usa entropía criptográfica. La base guarda un hash para la búsqueda.

La emisión promocional requiere permiso y aprobación. La emisión de desarrollo falla en producción. El comando crea una sola tarjeta.

La entrega usa un token protegido. El código se cifra con AES-GCM y tiene una duración limitada. La recuperación del comando devuelve el token, no el código.

La lectura del código usa una ruta separada. Esta ruta no guarda el código en `business_command`. Flutter muestra el código en un diálogo local y no lo conserva en el estado normal.

La emisión financiada crea una tarjeta inactiva. La asignación vincula la tarjeta, la línea, el valor, la política y la huella.

El checkout activa la tarjeta después del pago completo. La venta, el pago, la emisión y la activación usan una transacción.

La línea debe usar un producto con `sale_action='gift_card'`. La API rechaza una línea comercial normal.

El pago usa una consulta protegida y una autorización temporal. El recibo conserva solo la referencia oculta.

## 9. Consulta de gift card

La consulta usa límites distribuidos en PostgreSQL. Los límites incluyen merchant, location, device, operator y un bucket protegido del código.

El límite global de device y operator evita un bypass con códigos o sesiones nuevas. La limpieza elimina filas vencidas en lotes acotados.

Una consulta inválida devuelve un estado genérico. No revela si el código existe. Una consulta autorizada devuelve solo referencia oculta, estado, moneda y saldo.

## 10. Historial compuesto

El historial combina estos hechos:

- ventas y recibos;
- referencias provisionales conciliadas;
- refunds, voids y recibos compensatorios;
- earn, canje, liberación, reversión y ajustes;
- autorizaciones de rewards;
- wallet;
- emisión, activación, uso y refund de gift cards;
- merge;
- consentimiento cuando existe permiso.

La API ordena por fecha, tipo e identidad de evento. El cursor es opaco y usa HMAC. La versión actual del cursor es `2`.

El cursor vincula merchant, cliente, permisos y filtros. Un cursor de otro ámbito falla. La API limita cada página a 50 eventos.

Cada hecho usa una visibilidad explícita. Una location nula no concede acceso.

La clasificación usa una lista permitida. Un tipo global desconocido requiere el permiso administrativo.

Los permisos globales y administrativos son separados. Un cambio de permiso invalida un cursor incompatible.

## 11. Checkout, refund y recuperación

El checkout confirma venta, tenders, caja, inventario, recibo, puntos y valor en una transacción. Un error revierte todos los efectos.

La venta financiada activa una gift card en esa transacción. Un fallo o un pago parcial conserva la tarjeta inactiva.

El refund agrega hechos de compensación. No elimina el earn, el canje ni el débito original. Una reversión acumulada no supera el valor original.

La recuperación consulta el comando original antes de un reintento. La expiración y la liberación usan identidades deterministas.

## 12. Offline

Offline puede conservar una referencia limitada del cliente en una venta cash aprobada. El replay vuelve a validar el cliente.

Offline bloquea rewards, ajustes, wallet, emisión y gift cards. No existe una autoridad local de puntos o valor.

## 13. Permisos y aprobaciones

La API exige merchant, location, device, versión de credencial, sesión de operador y entitlement `pos`.

Los ajustes usan `loyalty.adjust`. La emisión usa `gift_card.issue`. Las acciones con valor alto usan permisos de aprobación separados.

Cada aprobación vincula la location, la cuenta, el importe, el comando y la huella. La autoaprobación está bloqueada.

Un reward protegido usa `loyalty.reward.approve`. La aprobación vincula la vista del reward y la huella completa de tenders.

Un cambio comercial invalida la aprobación. La aprobación dura 300 segundos y permite un uso.

## 14. Concurrencia y seguridad

Las cuentas usan locks por fila. Los ledgers usan una secuencia única y hechos append-only.

Las restricciones bloquean doble gasto, doble liberación, saldo negativo y una segunda emisión.

Una venta acepta una sola autorización activa por cuenta. Así, dos allocations no pueden recuperar el mismo débito.

`pnpm umi-pos:customer-value-concurrency-check` ejecuta 26 carreras con dos sesiones PostgreSQL. La matriz produce 52 resultados terminales.

La API no registra contactos, PIN, códigos de gift card ni secretos de recuperación. Flutter usa el SDK generado y no usa Supabase directo.

## 15. Límites y decisiones del Owner

Este Gate no incluye campañas, banca, transferencia, suscripciones ni redes externas de gift cards.

El Owner debe definir la tasa de earn, los límites de rewards y los límites de emisión. El área legal debe revisar retención, anonimización, texto de consentimiento y expiración.

Gate 3F está completo. Gate 3G queda autorizado y no ha empezado.
