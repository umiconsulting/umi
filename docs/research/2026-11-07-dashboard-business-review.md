# Inicio y análisis de ventas: referencias para UMI

Fecha: 2026-11-07. Alcance: documentación oficial de Square y Shopify, contrato UMI y herramientas existentes.

## Decisión

**Inferencia UMI.** El inicio debe responder cuánto vendió el negocio, cuántos tickets registró y cómo cambió el resultado.
Cada indicador debe abrir su detalle con el mismo comercio, sucursal y período.
El detalle debe responder las cinco preguntas del cliente con gráficos y filas verificables.

**Inferencia UMI.** Conserva las fórmulas del contrato UMI. Copia patrones de navegación; verifica cada definición financiera antes de adoptar un nombre.

## Herramientas

| Herramienta      | Evidencia y versión                                                                           | Licencia     | Uso y coste de adopción                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- |
| Playwright       | **Hecho local.** `@playwright/test` 1.62.1 en `pnpm-lock.yaml` y en la instalación existente. | Apache-2.0   | **Inferencia.** Conserva la herramienta para clics, capturas y red. No requiere otra dependencia.         |
| TanStack Query   | **Hecho local.** `@tanstack/react-query` 5.102.8 en el lockfile y la instalación existente.   | MIT          | **Inferencia.** Reutiliza el proveedor existente para consultas que necesiten caché y estados explícitos. |
| Chromium por CDP | **Hecho medido.** Chrome 153.0.8010.52, protocolo 1.3, en `127.0.0.1:9222`.                   | No se evaluó | **Hecho local.** Es el navegador del procedimiento del repositorio.                                       |

**Hecho documentado.** Playwright puede observar y modificar solicitudes HTTP, incluidas las consultas `fetch`.
Sus aserciones de interfaz repiten la comprobación hasta que se cumple la condición o vence el plazo.
Fuentes: [red](https://playwright.dev/docs/network), [aserciones](https://playwright.dev/docs/test-assertions),
[licencia](https://github.com/microsoft/playwright/blob/main/LICENSE).

**Hecho documentado.** TanStack Query distingue consulta pendiente, error y éxito. `isFetching` también incluye las actualizaciones en segundo plano.
Cada variable que cambia la consulta pertenece a su clave de caché.
Fuentes: [estados](https://tanstack.com/query/latest/docs/framework/react/guides/queries),
[claves](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys),
[licencia](https://github.com/TanStack/query/blob/main/LICENSE).

**Inferencia UMI.** Incluye identidad, permisos efectivos, comercio, sucursal y parámetros del informe en la clave cuando determinen la respuesta.
Un cambio de contexto debe retirar el resultado anterior hasta que exista un resultado del nuevo contexto.
Conserva el error de la API; un error requiere una acción de recuperación y no justifica mostrar cero.

**Límite.** Las fuentes oficiales y las versiones existentes confirman disponibilidad. Esta revisión no verificó la política futura de mantenimiento de ambos proyectos.
No se necesita una herramienta creada desde cero. Si CDP falla, el procedimiento local indica cómo iniciar Chromium.

## Patrones documentados por etapa

| Etapa       | Square                                                                               | Shopify                                                                                                          | Aplicación propuesta en UMI                                                                                |
| ----------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Entrada     | **Hecho documentado.** Resumen de ventas con métricas seleccionables y definiciones. | **Hecho documentado.** Resumen con indicadores numéricos y gráficos. El título del indicador abre su informe.    | **Inferencia.** Una fila breve de indicadores con acceso al detalle.                                       |
| Contexto    | **Hecho documentado.** Filtros por período, sucursal y horario.                      | **Hecho documentado.** Filtros superiores para período y comparación.                                            | **Inferencia.** Contexto visible, compartido entre inicio y ventas.                                        |
| Comparación | **Hecho documentado.** Tendencias con dos períodos y gráfico de líneas o barras.     | **Hecho documentado.** POS compara hoy con el mismo día de la semana anterior.                                   | **Inferencia.** Expón ambos períodos. Decide expresamente si el día actual se compara hasta la misma hora. |
| Profundidad | **Hecho documentado.** Informes de ventas y pagos separados.                         | **Hecho documentado.** POS muestra ventas netas, ticket medio y piezas por orden; los indicadores abren detalle. | **Inferencia.** Separa comportamiento de compra y conciliación de pagos.                                   |

Fuentes: [Square: resumen y tendencias](https://squareup.com/help/us/en/article/5381-in-app-summaries-and-reports),
[Shopify: resumen](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/overview-dashboard/using-the-overview-dashboard),
[Shopify: POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/analytics-on-pos).

## Definiciones que deben conservarse

**Hecho local.** UMI calcula el ticket promedio con venta neta de productos dividida entre tickets de venta.
Sin tickets, devuelve `null`. Las devoluciones ajustan importes y piezas, pero mantienen el ticket original en el conteo.
El informe ofrece dos criterios: resultado de la venta original y movimientos del período.
Fuentes: [cálculo](../../apps/umi-api/src/modules/dashboard-operations/sales-analysis.ts),
[contrato](../../packages/contract/src/sales-analysis.ts),
[presentación actual](../../apps/umi-dashboard/src/screens/sales-purchase-analysis.jsx).

**Hecho local.** La API devuelve moneda, zona horaria, fechas, sucursal, instante de captura y cobertura.
También devuelve primera venta y fecha actual para el contexto consultado.
Fuente: [servicio](../../apps/umi-api/src/modules/dashboard-operations/sales-analysis.service.ts).

**Hecho documentado.** Shopify define su ticket medio como ventas brutas menos descuentos, dividido entre órdenes; excluye ajustes posteriores.
Fuente: [campos analíticos](https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports/report-types/analytics-fields).

**Hecho documentado.** Square US distingue ventas netas, ventas totales y pagos cobrados.
Su documentación actual incluye cuentas abiertas por defecto y advierte diferencias entre informes por cálculo y momento de registro.
Fuente: [métricas actuales de Square US](https://squareup.com/help/us/en/article/5381-in-app-summaries-and-reports).

**Inferencia UMI.** Estas diferencias impiden tratar «venta», «cobro» y «ticket promedio» como términos intercambiables entre productos.
No cambies el denominador de UMI para que el número coincida con otra plataforma.
Muestra «Sin tickets» para promedios sin denominador. Muestra cero solo cuando una consulta válida confirme ese resultado.

## Criterios de implementación y verificación

**Inferencia UMI.** La opción preferida reutiliza el contrato de análisis para el resumen y el detalle.
La alternativa conserva informes distintos, con fórmulas visibles y pruebas de conciliación explícitas.
La primera opción reduce definiciones duplicadas; la segunda conserva límites existentes cuando los contratos responden preguntas diferentes.

**Inferencia UMI.** Verifica estos recorridos con clics reales:

1. Inicio con ventas reales → indicador → detalle con los mismos filtros e importes.
2. Cambio de comercio o sucursal → resultado del nuevo contexto, sin cifras del contexto anterior.
3. Período vacío → mensaje de ausencia, conteo cero confirmado y promedio sin denominador.
4. API lenta → carga visible, sin ceros provisionales.
5. API con error → error visible → reintento → recuperación.
6. Permiso insuficiente → estado de acceso restringido, sin cifras ni contexto ajenos.
7. Cambio de fecha cerca de medianoche → día de la sucursal y zona horaria explícitos.
8. Pantalla estrecha → controles completos, gráficos legibles y detalle accesible.

**Inferencia UMI.** Usa respuestas reales para comprobar cifras. Usa interceptación de red identificada para provocar carga y errores.
La interceptación prueba recuperación de interfaz; no demuestra que el servidor real produjo ese estado.

## Evidencia, rutas y límites

**Hecho medido.** Playwright abrió las tres páginas oficiales siguientes en un contexto CDP separado, con vista de 1440 × 1000.
Las capturas muestran documentación pública; no prueban una sesión autenticada en los productos competidores.

| Página                       | Estado   | Captura local                                                         |
| ---------------------------- | -------- | --------------------------------------------------------------------- |
| Square: resumen y tendencias | HTTP 200 | `/tmp/umi-dashboard-business-research/square-sales-summary.png`       |
| Shopify: resumen             | HTTP 200 | `/tmp/umi-dashboard-business-research/shopify-analytics-overview.png` |
| Shopify: POS                 | HTTP 200 | `/tmp/umi-dashboard-business-research/shopify-pos-analytics.png`      |

**Hecho medido.** El índice de capturas y los textos públicos están en `/tmp/umi-dashboard-business-research/`.
Los archivos temporales no forman parte del repositorio.

| Ruta fallida                                                                      | Resultado                             | Recuperación                                                                   |
| --------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Square `/help/us/en/article/5040-summaries-and-reports-from-the-online-dashboard` | El lector web informó acceso fallido. | Se consultó el artículo oficial 5381.                                          |
| Square `/help/us/en/article/5072-view-and-download-your-sales-summaries`          | El lector web informó acceso fallido. | `curl` devolvió HTTP 200 y permitió obtener la ruta canónica de configuración. |
| Importación directa de `node_modules/playwright/index.mjs`                        | Módulo no disponible en la raíz.      | Se usó la exportación existente de `@playwright/test`.                         |

**Hecho documentado.** La ruta canónica de configuración de Square permite definir zona horaria, inicio y fin del horario del informe.
Fuente: [configuración](https://squareup.com/help/us/en/article/5072-summaries-and-reports-from-the-online-dashboard).

**Hecho local.** La revisión previa de diseño ya exige claridad, control sobre acciones monetarias y verificación sobre el dispositivo real.
Fuente: [revisión de 2026-09-15](2026-09-15-ux-patterns-and-design-north-star.md).
**Inferencia.** Estos criterios permanecen vigentes. Este trabajo añade jerarquía comercial, contexto compartido y estados de datos explícitos.

**Límite.** Esta nota aporta referencias y criterios. El informe de implementación debe registrar por separado los resultados reales de UMI.
El acceso autenticado a los dashboards competidores permanece **UNVERIFIED**.

## Investigación adicional: sesión perdida tras recargar staging

**Síntoma comunicado.** El usuario inicia sesión, obtiene datos y vuelve al acceso después de recargar.
La investigación conserva las pestañas existentes y sus cookies. No ejecuta login, refresh ni logout.

### Evidencia de solo lectura

**Hecho medido.** Dos pestañas existentes estaban en `https://staging-dashboard.umiconsulting.co/login`.
Ambas carecían de `umi-dashboard-local-session` en `localStorage`.
Una conservaba dos solicitudes `/api/auth/local/refresh`, ambas con HTTP 401.
Estos datos proceden de `performance.getEntriesByType('resource')`, sin recarga ni navegación.

**Hecho medido.** Existían cookies `umi_refresh` y `umi_csrf` para dos ámbitos distintos:

- `.umiconsulting.co`, con `SameSite=Lax`;
- `staging-dashboard.umiconsulting.co`, con `SameSite=None`.

**Hecho medido.** La cookie `umi_access` vigente era exclusiva del host `staging-dashboard.umiconsulting.co`.
Una consulta `GET /api/auth/me?umi_auth_read_probe=1` devolvió HTTP 200 y una sesión.
La interfaz permaneció en `/login`. La consulta no ejecutó la rotación de tokens.
Los valores de cookies, credenciales y datos de sesión se omitieron de los registros.

**Hecho medido.** CDP observó el orden del header `Cookie` para ese GET:
`umi_refresh` del dominio padre precedía a `umi_refresh` exclusivo del host.
La correspondencia comparó valores en memoria y publicó solo nombres y ámbitos.

**Hecho medido.** El JavaScript desplegado `assets/index-D_7y5_fh.js` contiene `authMode: "cookie"`, `apiBase: ""` y `environment: "staging"`.
Por tanto, ese artefacto consulta `/api` bajo el origen del dashboard.
La hipótesis de una base directa incorrecta queda descartada para ese artefacto.

### Cadena causal y límites

**Hecho local.** El Worker conserva los headers y pasa `/api` al `API_ORIGIN` configurado.
La cookie exclusiva del dashboard es válida para ese recorrido: el navegador la envía al dashboard y el Worker la reenvía.
No necesita pertenecer a `api-staging.umiconsulting.co`.
Fuentes: [Worker](../../apps/umi-dashboard/public/_worker.js),
[despliegue](../../.github/workflows/deploy-dashboard.yml),
[configuración documentada](../../apps/umi-dashboard/docs/deployment.md).

**Hecho medido.** `@fastify/cookie` 11.0.2 usa `cookie` 1.1.1 en la instalación existente.
Su parser conserva el primer valor de un nombre repetido.
La prueba sintética `parse('umi_refresh=old-domain-cookie; umi_refresh=new-host-cookie')` devolvió el primer valor.
No se usaron tokens reales en esta prueba.

**Hecho documentado.** Las cookies pueden compartir nombre con dominios o rutas distintos.
El header de solicitud no comunica esos atributos; el servidor no debe depender de su orden para resolver nombres duplicados.
Fuente: [RFC 6265, secciones 4.2.2 y 5.4](https://httpwg.org/specs/rfc6265.html).

**Hecho local.** La API recibe una sola cookie `umi_refresh` ya interpretada por Fastify.
Un token inválido, vencido o sustituido produce rechazo. La reutilización puede revocar su familia.
Fuentes: [controlador](../../apps/umi-api/src/modules/auth/auth.controller.ts),
[servicio](../../apps/umi-api/src/modules/auth/auth.service.ts),
[repositorio](../../apps/umi-api/src/modules/auth/auth.repository.ts).

**Inferencia causal prioritaria.** La cookie antigua del dominio padre puede ocultar la cookie nueva durante el refresh.
El rechazo 401 activa `handleSessionExpired`, que elimina la sesión local y envía al usuario a `/login`.
El access token nuevo puede permanecer válido: el GET observado demuestra esa situación.

**Hecho local.** `AuthProvider` restaura únicamente `localStorage`; no consulta `/api/auth/me` al iniciar.
`RequireAuth` deriva a `/login` cuando falta esa sesión local.
Esto impide recuperar automáticamente una cookie válida después de perder la copia local.
Fuentes: [autenticación cliente](../../apps/umi-dashboard/src/lib/auth.jsx),
[protección de rutas](../../apps/umi-dashboard/src/app.jsx).

**Límite.** El header original de los dos refresh fallidos y el motivo interno del rechazo permanecen **UNVERIFIED**.
La evidencia demuestra la colisión y la recuperación ausente. No demuestra el historial del token antiguo.

### Corrección propuesta

**Inferencia UMI.** Aísla los nombres de cookies por entorno; incluye access, refresh, CSRF y preferencia de persistencia.
Una migración por configuración de la API mantiene la autoridad de autenticación en su propietario.
Si se adapta el proxy, documenta la traducción de nombres y prueba entrada, respuesta y logout.
Evita elegir primero o último por posición: el header no identifica el ámbito.

**Inferencia UMI.** Restaura la sesión con `/api/auth/me` cuando existe una cookie válida y falta la copia local.
Conserva la separación entre error temporal y rechazo definitivo.
No borres cookies compartidas `.umiconsulting.co` durante una corrección exclusiva de staging; pueden pertenecer a producción.

**Inferencia UMI.** Añade una comprobación con cookies antiguas del dominio padre y cookies nuevas del host de staging.
El usuario debe conservar la sesión tras recargar y durante una rotación legítima.
Comprueba también dos pestañas, pérdida de `localStorage`, logout y aislamiento entre staging y producción.

## Verificación técnica de la adaptación del Worker

**Hecho documentado.** Cloudflare conserva `Headers.getAll('Set-Cookie')` para obtener cada cookie por separado.
`Headers.append('Set-Cookie', value)` añade otro header, sin unir los valores con comas.
`Expires` puede contener una coma, por lo que separar un header combinado por comas destruye cookies válidas.
Fuente: [Headers de Workers](https://developers.cloudflare.com/workers/runtime-apis/headers/).

**Hecho documentado.** `Headers.getSetCookie()` también está disponible en Workers.
El flag `http_headers_getsetcookie` lo habilita por defecto desde la fecha de compatibilidad `2023-03-01`.
Fuente: [flags de compatibilidad](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#headers-supports-getsetcookie).

**Inferencia UMI.** Prefiere `getSetCookie()` cuando exista y usa `getAll('Set-Cookie')` como alternativa del runtime Cloudflare.
Retira el header original antes de añadir cada cookie transformada con `append`.
Conserva sin cambios las cookies ajenas a la lista explícita de autenticación.
Prueba ambos métodos: Node y Workers no ofrecen exactamente la misma API.

**Inferencia UMI.** La adaptación propuesta puede aislar staging sin cambiar el contrato de autenticación del backend:

1. Activa la adaptación únicamente cuando el backend configurado sea el API de staging.
2. Traduce las cuatro cookies `umi_staging_{access,refresh,csrf,remember}` a sus nombres `umi_` al enviar la solicitud.
3. Omite los cuatro nombres genéricos antiguos del header enviado al API de staging.
4. Conserva las cookies ajenas a esos ocho nombres exactos.
5. Renombra las cuatro cookies de respuesta y retira su atributo `Domain`.
6. Conserva `Path`, `Secure`, `HttpOnly`, `SameSite`, `Expires` y `Max-Age`, incluido el borrado de logout.
7. Lee `umi_staging_csrf` en el cliente cuando el entorno sea staging y la API use el mismo origen.

**Inferencia UMI.** La condición por backend cubre el dominio estable y las vistas previas.
La rama de producción debe conservar solicitudes y respuestas originales.
La primera autenticación bajo el nuevo esquema requiere un login; no conviertas silenciosamente cookies genéricas ambiguas.
La API conserva la verificación de JWT, la rotación, los permisos y la validación CSRF.

### WebSocket

**Hecho documentado.** Una respuesta de upgrade exitoso en Cloudflare expone `response.webSocket`.
El constructor `Response` acepta `webSocket` junto con estado y headers.
Fuente: [Response de Workers](https://developers.cloudflare.com/workers/runtime-apis/response/).

**Inferencia UMI.** Devuelve la respuesta original cuando no haya cookies que modificar; esto conserva el upgrade del proxy.
Si reconstruyes una respuesta 101, conserva explícitamente `webSocket`, estado y headers, con cuerpo `null`.
No reconstruyas un upgrade como una respuesta HTTP ordinaria.

**Hecho local.** El gateway lee `umi_access` del header `Cookie` del handshake.
Fuente: [gateway](../../apps/umi-api/src/modules/realtime/dashboard-realtime.gateway.ts).
**Inferencia UMI.** Traduce la cookie de solicitud también en `/socket.io`; la adaptación exclusiva de `/api` perdería autenticación en tiempo real.
La comprobación del Worker debe verificar el upgrade y la continuidad de eventos en el navegador.

### Fuente de la sesión inicial

**Hecho local.** `GET /api/auth/me` es idempotente y devuelve `SessionResponse`, cuyo campo `session` usa `SessionEnvelope`.
El sobre contiene usuario, comercios, proveedor, rol de plataforma y `accessExpiresIn`.
Fuentes: [ruta](../../packages/contract/src/route-table.ts), [sobre](../../packages/contract/src/schemas.ts).

**Hecho local.** El controlador calcula `accessExpiresIn` con el vencimiento restante del access JWT; no reemite esa cookie.
Fuente: [controlador](../../apps/umi-api/src/modules/auth/auth.controller.ts).
**Inferencia UMI.** Es la fuente correcta para recuperar la sesión y calcular una nueva expiración absoluta del cliente.
No reutilices una expiración absoluta antigua de `localStorage` ni supongas el TTL completo después de `/me`.

**Hecho local.** `_apiFetch` excluye `/api/auth/` de la recuperación automática ante HTTP 401.
Fuente: [lector de datos](../../apps/umi-dashboard/src/data.jsx).
**Inferencia UMI.** El bootstrap debe resolver expresamente el access vencido con refresh cuando corresponda.
Mantén los errores temporales separados del rechazo definitivo y permite reintentar.
