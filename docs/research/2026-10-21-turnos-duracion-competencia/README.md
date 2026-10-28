# Duración de turnos de caja: práctica competitiva

- Fecha: 2026-10-21
- Pregunta: ¿Qué regla impide que un turno de caja cruce el día operativo en Square, Toast, Lightspeed, Shopify POS y Fudo?
- Informa esta decisión: construir un autocierre de turno en Umi al cortar el día operativo.
- Competidores: cinco directos, incluido Fudo para el mercado hispano.
- Ventana de evidencia: 2026-10-21. Las fechas visibles de cada página se registran en `assets/INDEX.md`.
- Etiquetas: **HD** = hecho documentado; **TB** = compensación respaldada por fuentes; **IN** = inferencia; **NV** = sin verificar.

## Resultado

**IN:** el mercado no usa un límite universal de 24 horas para un cajón de efectivo.
El patrón fuerte es otro: el turno pertenece a un día operativo. Toast lo cierra en
el corte cuando usa reinicio automático. Square permite que el cajón viva hasta 30
días, pero lo termina si tiene siete días sin actividad. Shopify advierte que un turno
demasiado largo daña el efectivo esperado. Lightspeed y Fudo dependen del cierre
manual.

Umi debe cerrar el turno al cortar el día operativo. No debe esperar 40 horas ni usar
un temporizador fijo de 24 horas como regla principal.

## Estado de Umi

- **HD:** el corte operativo del piloto es `04:00`. La migración fija
  `business_day_start='04:00'` para ONCA en
  [`025_pilot_business_calendar.sql`](../../../docs/migration/build-v3/migrations/025_pilot_business_calendar.sql).
- **HD:** el till ya detecta un turno anterior al inicio del día operativo y muestra
  un aviso visible en
  [`cash_surface.dart`](../../../apps/umi-pos/lib/features/cash/cash_surface.dart#L193).
- **HD:** el modelo ya admite la razón de cierre `carried_over` en
  [`023_cash_shift_close_reason.sql`](../../../docs/migration/build-v3/migrations/023_cash_shift_close_reason.sql#L20).
- **HD:** el ADR aceptado exige autocierre, esperado congelado, conteo pendiente y
  bloqueo del cierre diario mientras haya un turno anterior sin cerrar. El ADR dice
  que el aviso está implementado y que el autocierre y el candado faltan:
  [`2026-10-12-cierre-de-turno-de-caja-adr.md`](../../architecture/2026-10-12-cierre-de-turno-de-caja-adr.md#L3).
- **HD:** el código actual no consume `carried_over` fuera de la migración. Solo
  existe el aviso del till. Por eso un turno puede seguir abierto durante 47 horas.
- **HD:** la iMin capturada muestra un turno abierto durante `47 h 22 min`:
  [`umi-imin-shift.png`](assets/umi-imin-shift.png).

## Matriz competitiva

| Etapa                    | Square                                                                 | Toast                                                                                                   | Lightspeed K-Series                                           | Shopify POS                                                                                 | Fudo                                                        |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Objeto de caja           | Sesión independiente del día de ventas. **HD**                         | Cajón independiente del cierre del día. **HD**                                                          | Periodo de venta y cajones separados. **HD**                  | Sesión de caja por terminal. **HD**                                                         | Arqueo de caja para un turno. **HD**                        |
| Inicio                   | Manual desde la app POS. **HD**                                        | Manual o reinicio automático. **HD**                                                                    | Un encargado abre el periodo de venta. **HD**                 | Manual o automático tras la última venta. **HD**                                            | Manual al iniciar la jornada. **HD**                        |
| Fin normal               | Manual desde POS o panel. **HD**                                       | Manual o al corte con reinicio automático. **HD**                                                       | El encargado cierra el periodo y los cajones. **HD**          | Manual o remoto. **HD**                                                                     | Manual al cambiar el turno o terminar el día. **HD**        |
| Regla ante sesión vieja  | Cierra tras más de 30 días abiertos y al menos 7 sin actividad. **HD** | El modo automático cierra al final del día operativo. El modo manual no cierra durante la noche. **HD** | No se encontró límite de duración en la documentación. **NV** | El comercio debe cerrar a intervalos regulares. No se encontró un límite automático. **NV** | No se encontró límite de duración ni autocierre. **NV**     |
| Pantalla de recuperación | Fin remoto desde el panel. **HD**                                      | Reabrir un cajón cerrado para ajustar entradas. **HD**                                                  | El cierre exige resolver pedidos y cerrar cada cajón. **HD**  | Cerrar la sesión desde el panel y conservar el historial. **HD**                            | Cerrar el arqueo desde la pantalla de arqueos. **HD**       |
| Señal de anomalía        | Estado terminado, no una continuación silenciosa. **IN**               | El cierre por reloj aparece como cierre del día. **HD**                                                 | El periodo cerrado impide vender hasta abrir otro. **HD**     | La pantalla advierte que un turno largo vuelve imprecisos los informes. **HD**              | El arqueo abierto muestra hora de apertura y estado. **HD** |

Las capturas de estas afirmaciones están en `assets/`.

## Qué hace cada competidor

### Square

**HD:** Square separa “terminar” de “cerrar”. Terminar registra el fin del turno.
Cerrar registra el efectivo contado. La página también documenta una recolección de
seguridad: una sesión abierta durante más de 30 días con siete días sin actividad
termina automáticamente. El comercio puede terminar una sesión desde el panel o desde
la app POS.

Fuente: [Start and end a cash drawer session](https://squareup.com/help/us/en/article/8344-start-and-end-a-cash-drawer-session).

**IN:** 40 horas no activa esta regla de Square. Es un mal estado operativo, pero no
prueba una caída del sistema.

### Toast

**HD:** Toast ofrece dos modos para el saldo inicial. El modo automático reinicia el
cajón con el saldo configurado y lo cierra a las 04:00. El modo manual pide el saldo
al abrir y no cierra el cajón durante la noche. El cierre de día y el cierre de cajón
son funciones distintas.

Fuente: [Use Cash Drawers](https://support.toasttab.com/en/article/Use-Cash-Drawers-New-Experience).

**IN:** Toast demuestra la regla correcta para Umi: usar el corte del día operativo,
no una duración arbitraria. También demuestra que el comercio debe elegir entre cierre
automático y manejo manual.

### Lightspeed Restaurant K-Series

**HD:** un encargado abre el periodo de venta. Sin periodo abierto no se procesan
pedidos. Para cerrarlo se deben cerrar los pedidos, hacer salir al personal y contar y
cerrar el cajón de cada terminal.

Fuentes:

- [Opening and closing a sales period](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360051071413-Opening-and-closing-a-sales-period)
- [Managing cash drawer operations](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050436394-Managing-cash-drawer-operations)

**NV:** no se encontró un límite automático de duración.

### Shopify POS

**HD:** una sesión debe cerrarse con regularidad. Si permanece abierta demasiado
tiempo, los informes de efectivo esperado y diferencias pueden quedar imprecisos. La
sesión sigue abierta hasta un cierre manual. El panel permite cerrarla de forma remota.
Una sesión cerrada no se reabre ni se edita.

Fuentes:

- [Manage register sessions in Shopify POS](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-pos)
- [Manage register sessions from Shopify admin](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/cash-register-management/register-sessions-in-shopify-admin)

**IN:** Shopify nombra el daño del turno largo, pero delega la prevención al proceso
del comercio. Umi necesita una regla del sistema.

### Fudo

**HD:** Fudo recomienda abrir un arqueo al iniciar la jornada. Recomienda cerrarlo al
cambiar de turno, cambiar de encargado o terminar la jornada. Una caja no puede tener
dos arqueos abiertos. Varias cajas pueden tener arqueos abiertos a la vez.

Fuentes:

- [3. Arqueos de caja](https://soporte.fu.do/es/articles/11730865-3-arqueos-de-caja)
- [¿Cómo inicio un nuevo turno de trabajo?](https://soporte.fu.do/es/articles/11730855-como-inicio-un-nuevo-turno-de-trabajo)
- [¿Cómo abrir más de un arqueo de caja?](https://soporte.fu.do/es/articles/12044091-como-abrir-mas-de-un-arqueo-de-caja)

**NV:** no se encontró un autocierre ni una duración máxima.

## Dónde discrepan las fuentes

- **HD:** Square acepta una sesión de 30 días con inactividad. Shopify pide cierres
  regulares y Fudo recomienda un cierre diario. Los tres describen un turno válido de
  forma diferente.
- **HD:** Toast puede cerrar mediante un reloj. Lightspeed y Fudo describen cierres
  manuales.
- **TB:** un temporizador fijo de 24 horas es simple. Un corte operativo es más fiel
  al negocio y evita partir una noche que cruza medianoche.

**IN:** la conclusión no es copiar la duración de un proveedor. Es copiar el límite
de responsabilidad por día operativo y conservar un cierre manual de recuperación.

## Qué no cambió desde las investigaciones previas

Se revisaron estas investigaciones:

- [`2026-09-06-cash-shift-management-owner-ux.md`](../2026-09-06-cash-shift-management-owner-ux.md)
- [`2026-09-07-shift-close-vs-reporting-day-research.md`](../2026-09-07-shift-close-vs-reporting-day-research.md)
- [`2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md`](../2026-09-29-cash-center-vendor-docs-forums-and-screenshots.md)
- [`2026-10-12-cierre-de-turno-de-caja-adr.md`](../../architecture/2026-10-12-cierre-de-turno-de-caja-adr.md)

**HD:** no cambia la separación entre turno de caja y día de ventas. No cambia el
conteo ciego. No cambia la necesidad de preservar el libro de movimientos. No cambia
la decisión de cerrar al corte de las 04:00.

La investigación agrega tres hechos actuales:

1. Square documenta un límite de 30 días y siete días inactivos, no un límite de 40
   horas. **HD**
2. Toast documenta cierre automático al final del día y cierre manual que no ocurre
   durante la noche. **HD**
3. Shopify documenta el riesgo de informes imprecisos, pero no muestra un autocierre.
   **HD**

**HD:** los documentos no nombran un investigador individual. Git atribuye los
documentos del 6 y 7 de septiembre a Juan Lopez. Git atribuye el documento del 29 de
septiembre y el ADR a la cuenta `umi-juanlopez`.

## Recomendación

**Construir el autocierre aceptado en el ADR.**

1. Cerrar el turno cuando pasa `business_day_start`, no al llegar a 24 horas.
2. Ejecutar el cierre en el servidor al pasar el corte o en la primera escritura
   posterior. Hacerlo idempotente.
3. Marcar el cierre con `closed_reason='carried_over'`.
4. Congelar el efectivo esperado y dejar el conteo pendiente. No inventar efectivo
   contado.
5. Liberar el registro para un turno nuevo.
6. Impedir ventas nuevas contra el turno cerrado. Pedir abrir un turno nuevo.
7. Bloquear el cierre del día actual mientras exista un turno anterior sin resolver.
8. Mantener el cierre manual y la recuperación por encargado. Registrar actor y
   motivo.

La regla principal es el corte del día operativo. Un límite de 24 horas es solo una
alternativa secundaria.

## Alternativa y motivo de rechazo

La alternativa es cerrar todo turno a las 24 horas desde su apertura.

Se rechaza como regla principal por tres motivos:

- Una tienda de 24 horas puede tener un día operativo válido de 24 horas.
- Un cierre fijo no coincide con el corte de ventas ni con el corte del día.
- Un cierre a las 24 horas todavía permite mezclar dos días operativos.

Un límite absoluto de seguridad puede existir como respaldo de configuración. No debe
reemplazar el corte del día.

## Escenarios de aceptación

1. Un turno abierto a las 23:00 se cierra al pasar las 04:00.
2. Un turno abierto a las 03:59 se cierra al pasar las 04:00.
3. Un turno cerrado por el reloj conserva su libro y su efectivo esperado.
4. El conteo posterior no cambia las ventas del turno cerrado.
5. Una terminal offline recibe el mismo cierre al sincronizar. El cierre se ejecuta
   una sola vez.
6. Una venta después del corte pide abrir un turno nuevo.
7. El cierre del día actual falla mientras exista un turno anterior sin resolver.
8. Un encargado puede cerrar el turno atrasado y dejar la razón en el historial.

## Límites de la evidencia

- No se ejecutó una cuenta real de los cinco productos. Las capturas son de sus
  centros de ayuda renderizados.
- No se obtuvieron cuentas de operadores sobre turnos de 40 horas. **NV**
- Las páginas no publican un máximo para Lightspeed y Fudo. Esto no prueba que el
  producto no tenga un máximo interno. **NV**
- No se verificaron versiones de aplicación de cada proveedor. La evidencia es la
  documentación vigente visible el 2026-10-21.

## Herramientas

- `rg` 15.2.0 para leer el historial y el código local.
- `curl` 8.22.0 para las fuentes primarias y sus estados HTTP.
- Chromium 153.0.8010.52 con Playwright, `headless:false` y `DISPLAY=:0`, para las
  capturas renderizadas.
- Node.js 24.21.0 para ejecutar `capture.mjs`.
- ADB para capturar la pantalla real de la iMin.

La selección de rutas sigue
[`2026-09-16-research-channels-playbook.md`](../2026-09-16-research-channels-playbook.md).

## Rutas fallidas

| Host                  | Ruta                                | Resultado                                    | Alternativa                          |
| --------------------- | ----------------------------------- | -------------------------------------------- | ------------------------------------ |
| Servicio de búsqueda  | `search_service.web_run`            | No disponible para el modelo.                | Búsqueda directa y centros de ayuda. |
| `html.duckduckgo.com` | `/html/?q=POS cash drawer shift...` | 202, desafío de robot.                       | No se usó para evidencia.            |
| `www.google.com`      | `/search?q=restaurant POS...`       | 200, HTML de desafío sin resultados.         | No se usó para evidencia.            |
| `www.bing.com`        | `/search?q=POS cash drawer...`      | 200, la consulta no produjo una página útil. | Centros de ayuda directos.           |
| `help.shopify.com`    | Página de sesiones POS con `curl`   | 403.                                         | `r.jina.ai` 200 y Chromium 200.      |
| `soporte.fu.do`       | Página raíz con `curl`              | 200, aplicación JavaScript sin texto útil.   | `r.jina.ai` 200 y Chromium 200.      |
| `www.docs.ncr.com`    | Página de fechas de negocio         | El contenido extraído dice 404.              | Wayback CDX 200 con cero capturas.   |

## Archivos

- [`assets/INDEX.md`](assets/INDEX.md): origen, fecha, clase de dispositivo y hash de
  cada captura.
- [`capture.mjs`](capture.mjs): reproduce las capturas de los centros de ayuda.
