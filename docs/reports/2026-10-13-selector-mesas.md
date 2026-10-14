# Selector de mesas con mapa y creación durante el servicio

Fecha: 2026-10-13. Ampliación del ciclo Cuentas/Cocina. Entregado en **0.1.0+94**, instalado en las tres terminales.

## Decisión

El selector de destino muestra el plano publicado. Tocar una mesa muestra información; confirmar elige el destino.
El panel muestra estado físico, lugares, tiempo y folio de la cuenta abierta.
Al asignar una cuenta existente, otra cuenta abierta bloquea el destino. No se mezclan cuentas como efecto de elegir mesa.

«Crear mesa nueva» permanece disponible para los operadores con `cart.write`, aunque ya existan mesas.
Crea una mesa física persistente en el área elegida, con nombre y capacidad.
La posición inicial usa un espacio libre compartido por plano publicado y borrador. El dashboard permite ajustar esa posición.
La operación conserva geometría, identidades y ocupación de las otras mesas. No publica cambios pendientes del borrador.
Una cuenta sin mesa sigue siendo una cuenta; no ocupa un lugar ficticio en la sala.

Pagar cierra la cuenta y conserva la ocupación física. El selector distingue una mesa ocupada sin cuenta abierta.
«Continuar con estos clientes» conserva la visita. «Los clientes se fueron» confirma la salida y deja la mesa por limpiar.
«Marcar limpia» la deja disponible. Estas dos acciones requieren `sale.lifecycle` y reutilizan el controlador existente.
El trigger `table_state_visit_guard`, de la migración 018 existente, impide liberar mesas con cuentas abiertas.
La protección también alcanza todos los miembros de un grupo unido.

El selector actualiza la sala cada cinco segundos mientras Android está activo y la vuelve a leer antes de confirmar.
Un fallo de lectura impide confirmar un estado sin actualizar. Las validaciones del servidor resuelven cambios concurrentes.
La confirmación espera a que termine la lectura; dos toques no producen dos aperturas.
La mesa recién creada se identifica por el área y nombre confirmados, aunque otra terminal haya añadido mesas simultáneamente.

## Accesibilidad

Se conserva una lista textual sólo en pantalla angosta con texto ampliado al 175% o más.
La medición previa del mapa, a 375×812 y texto al 200%, redujo una etiqueta nominal de 23.4 px a 3.22 px.
El ajuste del mapa impedía respetar esa ampliación. El respaldo evita depender de esas etiquetas reducidas.
El nuevo selector tiene prueba a 360×800 y texto al 200%, con objetivos táctiles de al menos 44×44 px.
Los cuatro renders de widgets usan coordenadas válidas dentro del plano; no son capturas de Android.

## Herramientas y fuentes

La [investigación](../research/2026-10-13-seleccion-mesa-temporal/README.md) contiene documentación primaria y cinco capturas públicas.
Toast Tables y Lightspeed Reservations distinguen pago y disponibilidad física. Esa evidencia no se extrapola a todos sus módulos.

| Herramienta           | Versión         | Uso y fuente                                                                                                            |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Flutter / Dart        | 3.47.5 / 3.13.4 | `FloorPlanMap`, widgets, analizador y pruebas existentes; [pruebas Flutter](https://docs.flutter.dev/testing/overview). |
| PostgreSQL            | 17.10           | Bloqueos de fila y transacción existentes; [bloqueos](https://www.postgresql.org/docs/17/explicit-locking.html).        |
| node-postgres         | 8.22.0          | Pruebas reales con un cliente y `ROLLBACK`; [transacciones](https://node-postgres.com/features/transactions).           |
| Vitest                | 2.1.9           | Ejecutor de API existente.                                                                                              |
| ADB                   | 37.0.0          | Capturas y recorrido Android; [herramienta oficial](https://developer.android.com/tools/adb).                           |
| Playwright / Prettier | 1.62.1 / 3.9.4  | Investigación pública y formato de Markdown.                                                                            |

No se añade una biblioteca de mapas ni otro modelo de ocupación. Se reutiliza `FloorPlanMap` y el documento existente.
La búsqueda acotada de espacio libre es propia: sólo añade un elemento validado, sin optimizar ni reorganizar la sala.
Una biblioteca general de distribución añadiría dependencia y podría mover mesas existentes.

## Contrato y base

`POST /floor-plan/tables` acepta área, nombre, capacidad, versión publicada e idempotencia.
El servidor valida sesión, dispositivo, sucursal y `cart.write`; registra auditoría y conserva el resultado del reintento.
La lectura de estados añade `openAccountId`, `openAccountFolio` y `openAccountTableId` opcionales.
Los miembros de un grupo muestran la cuenta que impide liberarlos.

No requiere esquema nuevo ni migración. Usa `merchant.floor_plan` y la protección existente de cuentas abiertas.

## Evidencia y pruebas

[Selector anterior en A11](evidence/2026-10-13-selector-mesas/01-a11-selector-antes.png).
[Estados anteriores de la base](evidence/2026-10-13-selector-mesas/db-before.txt).

Backend: nueve pruebas PostgreSQL aprobadas con fixtures aislados y `ROLLBACK` en `umi_local`.
Comprueban preservación de mesas ocupadas y borrador, idempotencia, versión, duplicados, límites, permisos y liberación de grupos.
Contrato final conjunto: 86 pruebas aprobadas. Integridad y permisos: 38 aprobadas. ESLint y build API correctos.
No se certifica RLS con estos fixtures: usan el rol worker. Tampoco simulan dos conexiones concurrentes.

POS: **35 pruebas dirigidas aprobadas**, incluidos cuatro renders de widgets y el respaldo accesible.
Cubren selección, cuentas ajenas, creación, permisos, salida, limpieza, lectura periódica, confirmación pendiente y creación concurrente.
El selector anterior esperaba tarjetas; ahora las pruebas esperan el mapa y su panel, salvo texto ampliado en pantalla angosta.
`flutter analyze` terminó sin hallazgos. La suite completa conjunta aprobó **933 pruebas**.

Registros: [selector POS](evidence/2026-10-13-selector-mesas/pos-focused.log),
[integraciones API](evidence/2026-10-13-selector-mesas/api-integration.log),
[suite completa](evidence/2026-10-13-kds-sin-estacion/pos-suite.log),
[análisis](evidence/2026-10-13-kds-sin-estacion/pos-analyze.log).

## Recorrido Android y filas reales

Se operaron iMin como Admin y A11 como Mesero 2, con toques derivados de capturas.

| Acción                             | Resultado y evidencia                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Asignar la cuenta 150 a Mesa 1     | Otra cuenta bloquea el destino: [Cuenta 141 protegida](evidence/2026-10-13-selector-mesas/imin-mesa1-protegida.png).                              |
| Seleccionar Mesa 5                 | [Ocupada sin cuenta abierta](evidence/2026-10-13-selector-mesas/imin-mesa5-ocupada.png); permite confirmar la salida.                             |
| Confirmar «Los clientes se fueron» | [Por limpiar](evidence/2026-10-13-selector-mesas/imin-mesa5-por-limpiar.png).                                                                     |
| Marcar limpia desde iMin           | [Disponible](evidence/2026-10-13-selector-mesas/imin-mesa5-limpia.png).                                                                           |
| Abrir selector desde A11           | [Mapa y panel](evidence/2026-10-13-selector-mesas/a11-mapa.png); [Cuenta 141 identificada](evidence/2026-10-13-selector-mesas/a11-cuenta141.png). |
| Crear una mesa desde A11           | [Mesa 16 persistente y seleccionada](evidence/2026-10-13-selector-mesas/a11-mesa16-creada.png), cuatro lugares.                                   |
| Consultar Mesa 5 como Mesero       | [Sin acciones de gestión](evidence/2026-10-13-selector-mesas/a11-sin-gestion.png), conforme al permiso.                                           |
| Cambiar Mesa 5 desde otra terminal | [A11 se actualiza sin pulsar Actualizar](evidence/2026-10-13-selector-mesas/a11-limpia-sin-actualizar.png).                                       |

Las [filas anteriores](evidence/2026-10-13-selector-mesas/db-before94.txt) y
[posteriores](evidence/2026-10-13-selector-mesas/db-after94.txt) registran 89 cuentas guardadas y 11 abiertas en ambos cortes.
Cancelar el selector dejó A11 en $0 sin guardar una cuenta nueva.
El plano pasó de 15 a 16 mesas, y de versión 12 a 13. Las cuentas 141, 150 y 152 conservaron sus mesas.
La Mesa 16 queda disponible para esta simulación; la creación no abrió una cuenta comercial.

La Mesa 5 venía de una simulación de división, sin cuenta abierta en esa visita.
El recorrido comprueba ocupación y liberación; no acredita un cobro nuevo de esa visita.
La separación entre pago y ocupación está documentada en la lógica y las pruebas existentes.

El [log de API](evidence/2026-10-13-selector-mesas/api-requests.jsonl) contiene los tres POST reales, todos con 201:
`table-state/clear`, `floor-plan/tables` y `table-state/open`, además de las lecturas de sala.
La [consulta reproducible](evidence/2026-10-13-selector-mesas/verification.sql) usa una transacción de sólo lectura.

## Build y límites

Se compiló un APK conjunto para el selector y Sin estación, después de los controles.
El [registro de instalación](evidence/2026-10-13-kds-sin-estacion/installed-builds.json) verifica versión 94 y SHA256 idéntico en iMin, A9 y A11.
El [reporte conjunto del KDS](2026-10-13-kds-sin-estacion.md) contiene el comando de build y los límites del entorno.

No se probó creación simultánea desde dos dispositivos reales ni el plano lleno hasta su límite geométrico.
Esos casos tienen pruebas de servidor o widget; no se presentan como recorridos nativos.
No se midió el texto al 200% en Android durante este recorrido. La medición y los widgets justifican conservar el respaldo accesible.
