# UmiPOS: clientes, lealtad y valor almacenado

Actualizado: 2026-08-05

Estado: `INCOMPLETE`.

La base segura existe. El Gate todavía requiere política completa, expiración, operaciones
administrativas, límites de consulta y la matriz completa de concurrencia.

## 1. Autoridad

La API de UMI controla los clientes, los puntos y el valor almacenado. PostgreSQL conserva los hechos inmutables. Flutter muestra datos y solicita comandos.

Cada cliente pertenece a un merchant. Una venta puede permanecer anónima. La location limita el acceso operativo cuando la política lo requiere.

## 2. Cliente y contactos

El cliente tiene una referencia pública, un estado, un idioma y una versión. El correo y el teléfono son opcionales. El servidor normaliza los contactos.

La búsqueda usa el merchant, la location y un límite. El resultado normal oculta el contacto. El permiso `customer.contact.read` permite una vista más amplia.

La detección de duplicados crea candidatos. No combina perfiles. La combinación requiere permiso, aprobación y una huella del comando.

Si los perfiles contienen puntos o wallet, la API devuelve `ValueReconciliationRequired`. La API no suma saldos de forma silenciosa. Las gift cards no se combinan.

## 3. Privacidad y consentimiento

El historial de consentimiento es inmutable. Cada tipo tiene una decisión separada.

- La entrega de recibo no concede marketing.
- La inscripción de lealtad no concede marketing.
- La venta anónima permanece disponible.
- La creación mínima no preselecciona marketing.
- La API no registra el correo, el teléfono ni el código completo de una gift card.

La combinación restrictiva de consentimientos todavía está pendiente. Este Gate no certifica una ley de privacidad.

## 4. Venta y cliente

El operador puede buscar, crear, adjuntar o quitar un cliente. El cliente debe pertenecer al merchant y estar activo.

Un cambio de cliente invalida la vista de lealtad y las autorizaciones de valor. El commit inmutable bloquea cambios posteriores. La recuperación conserva la referencia del cliente.

El historial actual muestra una lista acotada de ventas. Las proyecciones de recibos, refunds, puntos y valor quedan pendientes. El cursor real también queda pendiente.

## 5. Puntos y recompensas

Una cuenta de lealtad pertenece a un cliente y a un programa. El ledger de puntos es append-only. La proyección distingue puntos pendientes, disponibles, autorizados, canjeados y revertidos.

La política base define earn, escala, redondeo y momento. Falta vincular la vista previa y la versión histórica al checkout.

Una autorización de reward reserva puntos por cinco minutos. Falta la liberación automática al vencer y la validación completa de elegibilidad.

El canje y el beneficio financiero se comprometen juntos. El refund agrega una reversión proporcional. La reversión acumulada no supera el canje original.

El ledger acepta ajustes tipados. La ruta operativa para ajustes todavía está pendiente.

## 6. Wallet

La wallet pertenece a un cliente, un merchant y una moneda. El ledger usa unidades monetarias menores enteras. La proyección se reconstruye desde el ledger.

La autorización reduce el valor disponible y aumenta el valor autorizado. El commit convierte la autorización en un débito. La liberación restaura el valor una vez.

La wallet no permite saldo negativo, retiro de efectivo, transferencia ni crédito. La emisión permanece desactivada fuera de seeds y compensaciones autorizadas.

## 7. Gift card

La gift card pertenece a un merchant y a una moneda. El código usa un hash para búsqueda. La UI muestra un código protegido.

Una tarjeta inactiva no puede pagar. La activación consume una aprobación vinculada. La emisión y la suspensión operativas están pendientes.

La gift card puede cubrir todo o parte de la venta. La moneda y el merchant deben coincidir. Este Gate no integra una red externa de gift cards.

## 8. Checkout y refund

Una transacción compromete estos hechos cuando aplican:

1. Venta.
2. Tender.
3. Efecto de caja.
4. Inventario.
5. Recibo.
6. Puntos earn.
7. Reward canjeado.
8. Débito de wallet o gift card.
9. Estado de las autorizaciones.
10. Auditoría y resultado idempotente.

Un fallo revierte toda la transacción. Un reintento con el mismo comando devuelve el resultado original.

El refund usa los hechos históricos. Agrega reversiones proporcionales de puntos, wallet y gift card. No sustituye el tender original. No crea store credit sin una política explícita.

## 9. Offline y recuperación

Offline puede conservar una referencia limitada del cliente en una venta cash aprobada. El replay vuelve a validar el cliente y la política.

Offline bloquea creación, consentimiento, rewards, wallet y gift cards. No existe un ledger local oficial. La recuperación consulta el comando original antes de repetirlo.

## 10. Permisos y aprobaciones

Los permisos canónicos usan los prefijos `customer`, `loyalty`, `wallet`, `gift_card` y `stored_value`. La API también exige merchant, location, device, credencial, sesión y entitlement `pos`.

Las acciones sensibles usan una aprobación de un solo uso. La aprobación vincula el cliente, la cuenta, el valor, la location y la huella. La autoaprobación está bloqueada por defecto.

## 11. Seguridad y límites

- La búsqueda de clientes es acotada. El límite de tasa para gift cards está pendiente.
- La API bloquea acceso entre merchants.
- Los puntos y el dinero usan enteros.
- Los ledgers bloquean update y delete.
- Los códigos de gift card no aparecen en logs.
- Flutter no usa Supabase directo.
- Flutter usa el SDK generado.

El personal debe confirmar la identidad del cliente. La posesión del código de una gift card conserva riesgo de portador. Este Gate no incluye marketing, banca, suscripciones ni segmentación CRM.
