# Verificación local de importaciones

Fecha: 2026-10-31. Base de la tarea: `a368484a`.

La verificación usa PostgreSQL `umi_inventory_import` en el puerto 55435.
La API usa el puerto 4082. El dashboard usa el puerto 4083.
Chromium usa CDP 9226 y un contexto separado por prueba.
Los servicios anteriores permanecen activos.

## Resultados observados

| Caso                    | Resultado                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Plantillas              | Descargas reales CSV y XLSX para artículos y recetas. Se leen los encabezados del archivo.                       |
| Artículo XLSX           | Una fila crea un solo artículo. El costo es 1250 centavos por kilogramo.                                         |
| Cantidades del artículo | Escala 3, mínimo 1250, PAR 2500 y vida útil de 7 días.                                                           |
| Existencia              | La importación conserva el número de movimientos. El fixture agrega existencia después.                          |
| Reimportación           | El artículo y la receta muestran «Sin cambios». No aparece otra versión de receta.                               |
| Recetas CSV             | Se guardan una receta de producto y una de variante. El grupo inválido queda fuera.                              |
| Conversión              | 125 con escala 3 en kilogramo usa la conversión registrada 1000/1 a gramo.                                       |
| Historial               | XLSX cambia la receta a versión 2. La versión 1 conserva sus componentes y queda inactiva.                       |
| Concurrencia            | Otra actualización crea la versión 3. La vista previa anterior recibe HTTP409.                                   |
| Atomicidad              | El grupo inválido no crea receta ni mapeo. Una petición directa inválida también se rechaza.                     |
| Resultados              | CSV y XLSX conservan cinco filas de origen, con estados y errores en español.                                    |
| Referencias             | Las tres colecciones reciben páginas reales con cursor y HTTP200. El checkpoint registra 48 lecturas con cursor. |
| Paginación de pantalla  | Vista previa y resultado tienen dos páginas. La segunda página muestra las últimas filas.                        |
| Móvil                   | A 390 px, el diálogo cabe en la página. La tabla tiene desplazamiento horizontal propio.                         |
| Teclado                 | Tab y Shift+Tab conservan el foco en el diálogo. Escape restaura el foco al botón de apertura.                   |
| Cambio de negocio       | El dueño cierra el diálogo y cambia de negocio con clics reales antes de recibir la respuesta retenida.          |
| Filas sin enviar        | Solo llega el primer comando. La segunda fila queda pendiente y no existe en PostgreSQL.                         |
| Ubicación               | El comando conserva la sucursal original. La respuesta no agrega filas a la lista del segundo negocio.           |
| Permisos                | El usuario tiene `inventory.read` sin `merchant.manage`. Ambas acciones de importar están ausentes.              |
| API restringida         | HTTP403 y cero artículos creados.                                                                                |
| Venta real              | PIN de dispositivo, sesión de operador, carrito, preparación y checkout con terminal manual.                     |
| Consumo exacto          | Dos unidades consumen 750 gramos de harina y 250 milésimas de kilogramo del artículo importado.                  |
| Recibo                  | Destino `display`. No se solicita entrega de notificaciones.                                                     |

La creación del artículo usa XLSX. La creación de recetas usa CSV.
La actualización y la reimportación de recetas usan XLSX.
Las pruebas de Task3 conservan el caso de respuesta perdida, la identidad del comando y la recuperación del informe.

## Capturas

- [Resultado mixto de recetas](recipe-mixed-result.png).
- [Rechazo de la vista previa obsoleta](recipe-stale-conflict.png).
- [Vista previa móvil](pagination-mobile-preview.png).
- [Resultado móvil](pagination-mobile-result.png).
- [Segundo negocio después de la respuesta](second-merchant-after-response.png).
- [Usuario con permiso de consulta](restricted-user.png).

Las capturas se inspeccionaron. Los controles caben en el diálogo.
Los botones del resultado móvil conservan sus filas y su alineación.

## Ejecución reproducible

Se requieren los servicios locales aislados y un fixture privado con modo 600.
El fixture conserva los identificadores iniciales de Task3.
Su campo `task4` agrega el segundo negocio, el usuario restringido y las credenciales del dispositivo local.
También se requieren más de 100 artículos, recetas y destinos de receta.
El script privado de preparación creó 105 registros por colección.
Los archivos privados permanecen fuera de Git.

```sh
export PATH=/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/node/bin:/Users/moon/.npm/_npx/c29883048cd047b6/node_modules/.bin:$PATH
export UMI_IMPORT_FIXTURE=/private/tmp/umi-inventory-import-ui-fixture.json
export UMI_IMPORT_DATABASE_URL=postgresql://moon@127.0.0.1:55435/umi_inventory_import
export UMI_IMPORT_BASE=http://127.0.0.1:4083
export UX_CDP=http://127.0.0.1:9226
cd apps/umi-dashboard
env -u NO_COLOR pnpm exec playwright test --config playwright.inventory-import.config.js --grep 'real API and database'
```

El test rechaza una base remota o un nombre de base distinto.
La configuración reutiliza el stack existente y no inicia otro servidor.
Cada ejecución usa códigos y productos nuevos para evitar colisiones con ejecuciones anteriores.
El test crea datos solo en la base local indicada.

La ejecución observada usa los mismos módulos mediante el runner privado autorizado.
Se conservaron checkpoints separados para evitar repetir las ventas y las importaciones que ya pasaron.
El test combinado de Playwright quedó disponible; no se reclama una ejecución completa adicional de ese comando.

## Límites y correcciones del harness

El rechazo concurrente produce `CONFLICT` con el motivo `INVENTORY_RECIPE_RETIRED`.
El informe conserva el código `CONFLICT`, pero muestra un mensaje genérico.
La captura permite revisar esta limitación de texto.
Una petición posterior confirmó la respuesta exacta:

```json
{"status":409,"error":{"code":"CONFLICT","retryable":false,"details":{"reason":"INVENTORY_RECIPE_RETIRED"}}}
```

El backend conserva la versión concurrente y no crea una cuarta versión.

Las primeras repeticiones usaron recargas completas y alcanzaron el límite real HTTP429.
La prueba ahora usa navegación SPA y conserva la ruta al abrir otro diálogo.
El límite permanece activo.
Los tests existentes del runner verifican reintentos de HTTP429 con la identidad original.
El contexto temporal de aquella ejecución se cerró; ese informe específico no se reanudó.

Una expectativa inicial confundió 0.250 con su representación canónica: 25 con escala 2.
La verificación ahora comprueba esa representación exacta.
Un selector inicial trató «Negocio» como un select nativo.
El harness ahora usa clics en el botón y en la opción del listbox.
El cierre del handler tiene límites y conserva la excepción original.

Una captura superó 20 segundos mientras esperaba las fuentes.
Las capturas ahora tienen un límite de 60 segundos.
Un runner completó las aserciones, pero conservó su conexión CDP y terminó con Ctrl-C.
El checkpoint posterior terminó con código 0 después del cierre correcto del cliente.

En Playwright 1.62.1, el cierre del cliente obtenido por `connectOverCDP` desconecta su transporte.
Se verificó que CDP 9226 todavía responde después del cierre.
No se cerró Chromium compartido.

## Herramientas

Se usan Playwright 1.62.1, Chromium 153.0.8010.12, ExcelJS y `pg` ya instalados en el workspace.
Node 22.23.3 y pnpm 10.29.3 ejecutan los comandos.
La fuente de los formatos y las rutas es el contrato existente del repositorio.
El harness usa la API real para el checkout y SQL para las aserciones exactas.
No se agregó una dependencia. Los cambios de producto se limitan al formato autorizado.

## Checks finales

- Dashboard: 42 archivos y 589 tests aprobados.
- Lint: cero errores y 68 warnings existentes.
- Build: Lingui estricto y Vite aprobados. Permanece el aviso de chunks grandes.
- Playwright `--list`: dos tests detectados en la configuración local.
- `PR_BASE_REF=origin/staging pnpm check:pr`: aprobado, incluido Prettier.
- Gitleaks 8.30.1 con `--redact`: cero hallazgos en el rango de la feature y el diff preparado.
- `git diff --check`: aprobado.

El formato mecánico de siete archivos anteriores tiene el commit separado `5869b1c5`.
No se repitieron tests ni build después de esa corrección de formato.
