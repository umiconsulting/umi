# Inicio modular y recorrido de ventas

Fecha: 2026-11-07. Base: `origin/staging`, commit `7da1845c`.
Destino: PR hacia `staging`. Este cambio no autoriza un despliegue a producción.

## Resultado solicitado

El administrador necesita un resumen útil y enlaces al detalle.
El inicio debe permitir elegir indicadores y cambiar su prioridad.
La selección inicial usa siete días operativos, según la decisión del usuario.
Cada cliente conserva sus datos, permisos, moneda, sucursal y definiciones.

## Evidencia del problema

La revisión consultó ONCA en el dashboard real de staging mediante Chromium y la API real.
El análisis de 2026-10-08 a 2026-11-06 devolvió 300 tickets y 4,211,100 unidades menores de MXN.
El inicio mostraba `$0` de recargas del monedero bajo «Ingresos del mes».
El código vinculaba `analytics.topupsThisMonth` con `revenueThisMonth`.
También vinculaba recargas del mes con actividad «hoy», y recompensas del mes con una etiqueta de siete días.

El cargador anterior ocultaba fallos mediante listas vacías y conteos de cero.
El centro de acción declaraba ausencia de pendientes y un escaneo cada 60 segundos sin ese proceso.
El análisis ignoraba la sucursal seleccionada al crear sus filtros iniciales.
Las consultas sin una identidad completa podían conservar datos durante un cambio de contexto.

La fecha de ONCA usa `business_day_start`, además de `America/Mazatlan`.
A las 00:14 del 7 de noviembre, la API devolvía `today = 2026-11-06`.
Esta diferencia corresponde al día operativo; el reloj del navegador no define el periodo financiero.

## Contrato de presentación

- El inicio y el desglose consumen `SalesAnalysis`.
- Los importes conservan unidades menores hasta la presentación.
- La venta neta excluye propinas y resta descuentos y devoluciones según el criterio elegido.
- El inicio usa `sale_result` y compras por ticket.
- Un ticket devuelto permanece en el denominador de tickets de venta.
- Un promedio sin tickets conserva `null` y se muestra como ausencia de cálculo.
- Un fallo de API muestra error y reintento. Un estado de carga muestra ausencia de resultado.
- Las comparaciones usan periodos anteriores con el mismo número de fechas incluidas.
- La interfaz expone ambas fechas y advierte que el periodo actual puede estar incompleto.
- Las horas corresponden al pedido. Los días corresponden a la fecha operativa del recibo.
- Una hora sin movimientos no demuestra que el negocio estuvo abierto o que faltó demanda.
- Las categorías corresponden al catálogo actual, según la cobertura de la API.

`Cobros originales`, la tabla dinámica y los recibos conservan su función de conciliación.
Sus importes originales tienen una definición distinta del análisis neto.
La etiqueta y la explicación distinguen estos conceptos.

## Interacción

Los widgets disponibles muestran venta neta, tickets, ticket promedio, piezas por ticket, venta diaria, horas, pares y distribución de piezas.
El administrador puede ocultar, activar y ordenar cada widget mediante controles accesibles.
La configuración usa una clave versionada por usuario y negocio en `localStorage`.
La configuración permanece en este navegador. Este cambio no sincroniza preferencias entre dispositivos.
El periodo del inicio se conserva en la URL para permitir recarga y regreso desde el detalle.

Los enlaces conservan fechas, sucursal, criterio de devolución y unidad de compra.
Los widgets de tiempo también seleccionan la dimensión y el indicador del gráfico.
El detalle separa resumen, compras conjuntas, horas, distribución de piezas y sucursales.
Las tablas completas permanecen disponibles cuando un gráfico o un resumen reduce la densidad.

La cocina y el monedero conservan su contexto operativo.
El monedero se identifica como MXN y negocio completo.
La cocina muestra ausencia de pedidos solo después de una consulta válida.

## Recuperación de sesión en staging

La revisión encontró cookies genéricas de `.umiconsulting.co` junto con cookies exclusivas del dashboard de staging.
El navegador enviaba primero la cookie compartida. El parser del backend conserva el primer nombre repetido.
La interfaz permanecía en acceso aunque `GET /api/auth/me` devolvía una sesión válida.
La investigación completa y sus límites constan en [las referencias](../research/2026-11-07-dashboard-business-review.md).

El Worker usa `umi_staging_*` cuando `API_ORIGIN` apunta al backend de staging.
Traduce esos nombres para la API y elimina el atributo `Domain` de las cookies de autenticación emitidas.
El transporte de producción conserva sus nombres y su comportamiento.
El cliente recupera la sesión desde `/api/auth/me` y conserva los fallos temporales.
La nueva separación requiere un acceso inicial en staging. No migra cookies genéricas ambiguas.

## Aceptación

1. El inicio muestra las cifras del análisis para los mismos filtros.
2. Cada widget abre su desglose con las fechas y la sucursal originales.
3. La configuración permanece tras recargar y no mezcla usuarios ni negocios.
4. La carga y los errores nunca muestran una cifra de otro contexto.
5. Un periodo vacío muestra cero en sumas y ausencia de cálculo en promedios.
6. Los errores permiten reintentar con los mismos filtros.
7. Los gráficos conservan valores negativos, denominadores y unidades.
8. La interfaz funciona en escritorio y a 390 píxeles.
9. La sesión de staging se separa de las cookies compartidas de producción.
10. El PR pasa los gates locales, la revisión de código y los checks de CI.

## Verificación

El dashboard pasó 650 pruebas en 46 archivos.
Los gates `pnpm check:pr` y `turbo run build lint test --filter=...[origin/staging]` pasaron.
El dashboard no define un comando `typecheck`; su gate usa ESLint y la compilación de Vite.
La comprobación de advertencias aceptó las 68 advertencias existentes, sin categorías nuevas.
La compilación conserva el aviso existente sobre el tamaño del paquete principal.

Chromium verificó ONCA con la API real, en escritorio y a 390 píxeles.
El inicio mostró $3,435.00 MXN, 27 tickets y 2.48 piezas por ticket, del 31 de octubre al 6 de noviembre.
El recorrido comprobó selección, orden y persistencia de widgets, enlaces al detalle y regreso con el periodo original.
También comprobó el indicador del gráfico después de aplicar filtros.
Un periodo anterior a la primera venta mostró ausencia de tickets.
La interrupción deliberada de la red mostró error, ocultó cifras y permitió reintentar.
La espera deliberada de respuestas mostró carga sin cifras anteriores.
Las tres revisiones de axe no registraron infracciones: inicio de escritorio, detalle de tiempo y compras conjuntas en móvil.
El navegador no registró errores de JavaScript ni desbordamiento horizontal.
La recuperación mediante cookies restauró el inicio después de borrar la sesión local.

La revisión independiente de Standards detectó una pérdida de opciones de sucursal.
La revisión de Spec detectó el mismo problema y un reinicio del indicador al aplicar filtros.
Las tres observaciones quedaron corregidas y ambas revisiones confirmaron cero hallazgos abiertos.
ONCA dispone de una sucursal en esta sesión; la comprobación de múltiples sucursales usa el contrato y las pruebas de contexto.
La [vista previa del PR #264](https://pr-264.umi-dashboard.pages.dev/?home=1) pasó la verificación en Cloudflare Pages.
El inicio mostró la misma venta neta de ONCA y el widget de promedio abrió su indicador correcto.
`GET /api/auth/me` respondió 200 y el refresco respondió 201.
El navegador recibió las cuatro cookies `umi_staging_*` con el dominio exclusivo de la vista previa.
Las cookies de sesión conservaron `HttpOnly` y `Secure`; la cookie CSRF conservó su acceso desde el cliente.
La recarga recuperó la sesión después de borrar la copia local.
La vista previa no registró errores de JavaScript.
El [PR #264](https://github.com/umiconsulting/umi/pull/264) tiene `staging` como destino y queda disponible para revisión.
Los checks de CI son visibles en el PR; este informe registra las verificaciones locales y de navegador.

Herramientas: Node 22.23.2, pnpm 10.29.3, Playwright 1.62.1, Chromium por CDP y axe-core.
Las capturas y respuestas de API quedan en `/tmp/umi-business-evidence/`.
Las sesiones y las cookies permanecen fuera del control de versiones.

El script `tools/ux-sweep/dashboard-business.mjs` repite los clics contra una instancia local con proxy a la API autorizada.
La variable `UX_STORAGE_STATE` recibe una sesión local autorizada fuera del repositorio.
Los fallos de red del recorrido son deliberados. Las respuestas financieras válidas vienen de la API real.
