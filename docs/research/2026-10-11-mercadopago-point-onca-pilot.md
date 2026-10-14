# Piloto ONCa: Mercado Pago Point

Fecha: 2026-10-11. Investigación de lectura; no se consultaron secretos, cuentas privadas ni se realizaron cobros.

## Alcance acordado y preparación local

El usuario confirmó que solo tiene su cuenta de desarrollador. La prueba actual usa sandbox. La autorización de ONCa queda para producción.

**Hecho local.** El plan anterior identifica la terminal como Point Smart 2, Newland N950. El 17 de septiembre recibió un importe de 5.00 MXN en pantalla y terminó mediante simulación. Esto es evidencia histórica; la cuenta y el modo actuales siguen pendientes. Fuente: `docs/plans/2026-09-17-mercadopago-point-integration-plan.md`, fase 0.

**Hecho local.** El `.env` de la API y las variables externas de sus dos procesos activos carecen de configuración Point. Se comprobó su presencia sin mostrar valores. El iMin D3 responde por ADB; Point no aparece como dispositivo USB.

**Preparación.** `scripts/mp-point-sandbox.mjs` reutiliza el transporte existente con Node 24.21.0. Su extensión cubre los eventos de simulación que ese transporte no expone. Antes de crear una order, consulta `/users/me` y exige `test_user` y `MLM`. Usa exclusivamente `NEWLAND_N950__SBX0000001`. `.env.mp-point-sandbox` está excluido de Git y contiene una variable vacía, separada del servidor.

```sh
node --env-file=.env.mp-point-sandbox scripts/mp-point-sandbox.mjs check
node --env-file=.env.mp-point-sandbox scripts/mp-point-sandbox.mjs run processed
```

Estados disponibles: `processed`, `failed`, `canceled`, `expired`, `action_required`, `refunded`. El comando prepara `processed` antes de `refunded` y cancela después de `action_required`.

**Verificación local.** Pasaron los controles de credencial ausente, cuenta productiva, país incorrecto y consulta sin escrituras. Los seis escenarios pasaron con respuestas simuladas. La ayuda funciona; con el archivo vacío, `check` falla antes de acceder a la red. **Pendiente:** ejecutar con credencial real de prueba y comprobar por separado POS, webhook, worker, conciliación y pantalla física.

## Instrumento y costo de adopción

**Hecho documentado.** Instrumento recomendado: **Mercado Pago Point, Orders API v1**, vía HTTPS y OAuth. México documenta **Point Smart 1 y Smart 2**. El POS crea una order, Mercado Pago la carga en la terminal y notifica el resultado. [Resumen](https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview).

**Hecho documentado.** La API tiene licencia contractual limitada, revocable y no transferible. Hay mantenimiento activo: el changelog de octubre 2026 agregó cancelación de orders `at_terminal`. [Licencia](https://www.mercadopago.com.mx/developers/es/docs/resources/legal/terms-and-conditions), [changelog](https://www.mercadopago.com.mx/developers/es/changelog).

**Hecho local / inferencia.** Umi ya dispone de transporte HTTP, OAuth, renovación, terminales y webhooks; reutilizarlos cuesta configuración y verificación del despliegue, sin adoptar otro SDK. Fuente: `apps/umi-api/src/modules/mercado-pago/`, `apps/umi-api/src/modules/tender/providers/mercado-pago-point.transport.ts`. **UNVERIFIED:** esos módulos están habilitados y configurados en el entorno de ONCa.

**Hecho documentado / pendiente.** Point publica ausencia de renta mensual y una tasa de 3.5% + IVA para acreditación inmediata; MSI añade tasas. Esto no verifica las condiciones particulares de ONCa ni implica gratuidad universal de la API. [Tasas públicas](https://www.mercadopago.com.mx/herramientas-para-vender/lectores-point?code=POINT_ORG_DEFAULT).

## Ruta productiva posterior

1. **Hecho documentado.** ONCa es integración para terceros: su vendedor autoriza la aplicación mediante OAuth `authorization_code`; el backend intercambia el código en `POST /oauth/token`. Usar su `user_id` y token para sus recursos. Redirect URI debe coincidir exactamente; PKCE es opcional y recomendado. [OAuth](https://www.mercadopago.com.mx/developers/es/docs/security/oauth/creation). **Hecho local:** `GET /api/merchants/:merchantId/mp-point/authorization` y callback `/api/mp-point/oauth/callback` existen; el intercambio fuerza `test_token=false` y no implementa PKCE. No habilitarlo en el panel sin completar esa implementación.

2. **Hecho documentado.** Crear o seleccionar sucursal y caja en la cuenta recaudadora; asociar la terminal usando su app móvil. Una caja admite una terminal PDV. Consultar `GET /terminals/v1/list`, cotejar `id` con serial físico y cambiar, si hace falta, mediante `PATCH /terminals/v1/setup` con `{"terminals":[{"id":"…","operating_mode":"PDV"}]}`. Reiniciar y comprobar PDV. [Configuración](https://www.mercadopago.com.mx/developers/es/docs/mp-point/configure-terminal). **Pendiente:** cuenta vinculada actualmente y sucursal/caja reales.

3. **Hecho documentado.** Configurar HTTPS y tópico **Order (Mercado Pago)**, validar `x-signature`. Para terceros, webhooks productivos en la aplicación principal del integrador. [Notificaciones](https://www.mercadopago.com.mx/developers/es/docs/mp-point/notifications), [producción](https://www.mercadopago.com.mx/developers/es/docs/mp-point/go-to-production). **Hecho local:** receptor `/api/webhooks/mercado-pago-point`; debe comprobarse recepción, cola y worker.

4. **Hecho documentado.** Crear con `POST /v1/orders`, `type=point`, referencia externa única, monto decimal en string, `config.point.terminal_id` y `X-Idempotency-Key`. Consultar `GET /v1/orders/{id}` para confirmar el resultado; creación no significa pago. [Procesamiento](https://www.mercadopago.com.mx/developers/es/docs/mp-point/payment-processing). **Inferencia:** mantener pendiente frente a pérdida de respuesta y conciliar antes de repetir.

## Pruebas hoy y límites

**Hecho documentado.** Las credenciales/cuentas de prueba simulan estados; no cobran con tarjetas reales en hardware. Está disponible terminal virtual `NEWLAND_N950__SBX0000001`; no sirve para medir calidad. Crear una order y simular con `POST /v1/orders/{id}/events`: `processed`, `failed`, `canceled`, `expired`, `action_required` y, después de procesada, `refunded`. Verificar webhook y lectura posterior. [Pruebas](https://www.mercadopago.com.mx/developers/es/docs/mp-point/integration-test).

**Inferencia.** Ejecutar primero la simulación en ambiente aislado; después una venta física controlada, con cuenta productiva ONCa y medio real, verificando abono y conciliación. No usar la autorización productiva actual de Umi como si fuera sandbox. **UNVERIFIED:** camino interno que permita enlazar terminal virtual; el bind actual exige listado del vendedor.

**Hecho documentado / límite local.** Se puede cancelar `at_terminal` con `POST /v1/orders/{id}/cancel` y header `x-allow-cancelable-status: at_terminal`; esperar webhook porque es asíncrono. El transporte actual revisado no expone cancelación. Ante caída de integración, Mercado Pago documenta STANDALONE provisional y reinicio. [Troubleshooting](https://www.mercadopago.com.mx/developers/es/docs/mp-point/resources/troubleshooting).

## Evidencia y rutas

Escalones usados: documentación/referencia oficial (1), changelog/status (2), código local (3). [Status](https://status.mercadopago.com/) mostró sistemas operativos al consultar; no demuestra disponibilidad de la cuenta. Ruta inicial `integration-configuration` falló; navegación oficial resolvió `configure-terminal`. Ayuda `terminos-y-condiciones_715` dio 403; búsqueda y enlace oficial resolvieron términos Developers. El enlace de tasas Developers fue insuficiente; búsqueda oficial resolvió producto Point. **UNVERIFIED:** credenciales, deployment, homologación y readiness de ONCa.
