# ONCA: tipo de pedido en las comandas de Barra y Cocina

Fecha: 29 de octubre de 2026.

Estado: cambio preparado para revisión por PR. Instalación y comprobación en las
tablets pendientes. El propietario confirmó que Juan-PC está desconectada.

## Solicitud y diseño aprobado

El propietario pidió identificar el tipo de pedido en las comandas de Barra y
Cocina. Aprobó estas etiquetas junto a la referencia de la cuenta:

| Tipo                       | Texto                | Color   | Icono |
| -------------------------- | -------------------- | ------- | ----- |
| `dine_in`                  | Para comer aquí      | Azul    | Mesa  |
| `takeout`                  | Para llevar          | Violeta | Bolsa |
| `delivery`                 | A domicilio          | Neutro  | Ruta  |
| Dato ausente o desconocido | Tipo sin especificar | Neutro  | Ayuda |

El texto identifica el tipo sin depender del color. Los indicadores de preparación,
demora y prioridad conservan su función. Las etiquetas tienen traducciones ES/EN.

## Causa comprobada en el código

La proyección `kds.station_order` ya contiene `fulfillment_type`. El SELECT del
tablero no lo leía. El contrato `KitchenOrderProjection` tampoco lo exponía, y
las comandas construidas desde el carrito local omitían ese dato.

El pedido comercial usa `pickup` para algunos pedidos que el POS denomina
`takeout`. El API convierte ambos valores en `takeout` para el KDS. Conserva
`dine_in` y `delivery`. Un valor desconocido produce `null`.

## Cambio

- Contrato 2.46.0 con `fulfillmentType` opcional y anulable. Los snapshots antiguos siguen siendo válidos.
- Lecturas del API para dispositivos KDS, modo KDS del POS y comandas sin estación.
- Etiqueta compartida en las tarjetas y en la pantalla de comandas sin estación.
- Propagación del dato en las comandas locales y en las lecturas por LAN.
- Artefactos del contrato y traducciones regenerados con las herramientas del repositorio.

La base es `fix/onca-20261026`, commit
`069a07fd2670c0225f98b42d6ba5551fd9accfb5`. Incluye la corrección de sincronización
entregada con la build 334. Esta tarea se desarrolla en
`feat/onca-kds-fulfillment-20261029` y no cambia el despliegue actual.

El cambio reutiliza columnas existentes. No requiere una migración de datos.

## Hallazgos de la revisión

La primera implementación local copiaba el tipo solo al crear una comanda. Después
de iniciar preparación, un cambio posterior de tipo quedaba oculto por el overlay
local. Una prueba reprodujo ese fallo.

La combinación final trata el tipo de pedido de forma separada:

1. Un snapshot oficial conserva su tipo aunque un overlay aporte preparación más reciente.
2. Una comanda que todavía no tiene base oficial obtiene el tipo del carrito local.
3. Un comando explícito pendiente del journal puede sustituir ese tipo.
4. Se aplican solo los comandos del mismo comercio, ubicación y carrito, en orden de `deviceSequence`.
5. `pos.cart.table.set` posterior a `pos.cart.fulfillment.set` vuelve a declarar `dine_in`.
6. Los comandos aceptados o terminados no sustituyen el dato oficial.

Se reutiliza el journal cifrado existente. La lectura resuelve sus alias de
carrito. Si el journal no puede leerse, conserva el snapshot oficial.

Otra prueba detectó que una fila adicional en la tarjeta sin estación impedía
abrir la confirmación desde la posición anterior del botón. El título y la
etiqueta ahora comparten un `Wrap`. La prueba de confirmación vuelve a pasar.

La revisión independiente del código terminó sin bloqueadores después de estas
correcciones. La revisión no sustituye la comprobación en las tablets.

## Validación automatizada

La reproducción inicial produjo cuatro fallos del contrato, catorce del API y
nueve de Flutter. Los mensajes identificaron el campo ausente y las etiquetas
que no aparecían. La revisión añadió cuatro reproducciones de los casos LAN.

| Comprobación                                         | Resultado     |
| ---------------------------------------------------- | ------------- |
| Todos los tests del contrato                         | 99 aprobados  |
| Tests unitarios del módulo KDS del API               | 135 aprobados |
| Tests Flutter de cocina y `kitchen_status_test.dart` | 142 aprobados |
| Typecheck del contrato y del API                     | Sin errores   |
| ESLint de los archivos modificados del API           | Sin errores   |
| Consistencia de artefactos del contrato              | Correcta      |

Las pruebas cubren ambos tipos en Barra y Cocina, actualización de la etiqueta,
snapshots antiguos, ES/EN, pantalla de 360 píxeles y texto al 200 %. También
comprueban colores distintos y contraste mínimo 4.5:1 en los temas claro, oscuro
y medianoche.

Los casos LAN comprueban el cambio después de iniciar preparación, la intención
pendiente sobre una comanda cacheada, una selección posterior de mesa y la
prioridad del dato oficial frente a un carrito antiguo.

Comandos principales:

```sh
node --test packages/contract/test/*.test.mjs
pnpm --filter @umi/api exec vitest run src/modules/kds --exclude '**/*.integration.*'
pnpm --filter @umi/api typecheck
pnpm --filter @umi/contract typecheck
flutter test --reporter expanded test/features/kitchen test/kitchen_status_test.dart
flutter analyze --no-pub
node packages/contract/scripts/generate.mjs --check
```

## Herramientas y procedencia

El análisis final de Flutter terminó sin observaciones. La revisión de formato y
`git diff --check` también terminaron sin errores.

Se usaron Git 2.50.1, pnpm 10.29.3, Vitest 2.1.9, Flutter 3.47.5 y Dart 3.13.4.
La versión de pnpm procede del `packageManager` del repositorio. El SDK de
Flutter procede de la [etiqueta oficial 3.47.5](https://github.com/flutter/flutter/tree/3.47.5),
revisión `6a19cca56475dbfba1478ee68d7bd0c2ef891da1`.

Los catálogos JSON de descarga consultados respondieron 404. El SDK se obtuvo
desde la etiqueta oficial y descargó sus componentes de Flutter. Las pruebas
usan las herramientas existentes; no se creó un ejecutor propio.

La Mac usa Node 25.9.0. pnpm informa que el dashboard exige Node 22; esta tarea
prueba el contrato y el API. CI usa Node 22 para la validación del repositorio.

## Corrección del CI del PR 230

El job `lint` falló en el paso de Gitleaks. ESLint y el formato pasaron.
Los nueve hallazgos corresponden a seis valores públicos: dos identificadores de
evidencia, un commit y tres huellas de la llave pública de Umi Support.

La corrección adopta únicamente las excepciones exactas de `.gitleaks.toml` que
ya contiene `main`, desde el commit `9578f079`. Cada expresión tiene anclas de
inicio y fin. El workflow conserva el escaneo completo con `--all`.

La comprobación local usa Gitleaks 8.30.1, obtenido del
[release oficial](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1)
y verificado con su checksum. El escaneo de 677 commits de `origin` produjo
nueve hallazgos antes del cambio y cero después. Doce comprobaciones adicionales
aceptaron los seis valores exactos y detectaron los seis valores con un sufijo.

```sh
gitleaks git --no-banner --redact --exit-code 1 --log-opts=--remotes=origin
```

## Entrega y comprobaciones pendientes

El usuario pidió entregar mediante PR con la cuenta `umiconsulting-dev`.
El alcance de esta entrega es el PR; el despliegue permanece pendiente.

La copia de esta bitácora en Juan-PC y la prueba real en Barra y Cocina quedan
pendientes de recuperar el acceso. No se ejecutó el doctor de flota en esta
tarea ni se verificó la versión instalada actual.

Después de aprobar el PR y obtener CI verde:

1. Prepara el API con contrato 2.46.0 y una nueva build de UmiPOS desde el cambio aprobado.
2. Instala la misma build en las cuatro tablets conforme al procedimiento de soporte.
3. Confirma versión, firma, arranque y el resultado del doctor de flota.
4. Comprueba una comanda real de cada tipo en Barra y Cocina sin duplicar preparación.
5. Comprueba un cambio de tipo, la recuperación de conexión y los filtros de estación.
6. Registra la evidencia y actualiza el estado de esta entrada en Juan-PC.

El rollback de esta presentación consiste en restaurar el código anterior del
API y el APK canónico anterior. El campo del contrato es opcional; no hay datos
que revertir ni una migración que deshacer.
