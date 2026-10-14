# Implementación completa del POS UMI

Fecha: 9 de octubre de 2026. Objetivo activo: implementar el nuevo diseño en todo el POS.

La implementación final está integrada en `/home/juan/Projects/umiconsulting/umi`, por instrucción del usuario.
La rama es `feat/pos-fired-order-contract`. La integración permanece en el árbol de trabajo.
El fork `umi-pos-estacion` conserva la historia de diseño y la investigación.
La combinación de tres versiones conserva los cambios locales anteriores del principal.
El diseño usa `#223979` y `#7692CB`. Los cambios TPM tienen su propia evaluación e historia.

## Herramientas

| Pregunta                         | Respuesta                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| ¿Existe una herramienta probada? | Flutter Test, Analyzer y Driver verifican este cliente nativo. Git conserva cambios y procedencia.                        |
| ¿Está instalada?                 | Flutter 3.47.5 y Dart 3.13.4 están en `/home/juan/.local/opt/flutter`.                                                    |
| ¿Se puede operar sin preguntas?  | Sí. Driver usa la extensión de desarrollo. Hyprland permite verificar la ventana y el workspace.                          |
| ¿Qué cuesta adoptarla?           | Ninguna dependencia nueva. Se usan los paquetes y procedimientos actuales.                                                |
| ¿Cuál es la alternativa?         | VM Service permite leer campos en profile. AT-SPI verifica semántica externa. Las pruebas verifican carreras controladas. |

Fuentes primarias: `apps/umi-pos/AGENTS.md`, `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` y el SDK instalado.
VM Service no permite evaluar expresiones en AOT. Se usan lecturas de campos, sin credenciales ni datos de autenticación.
Los controles propios son una condición explícita del usuario. Flutter Widgets constituye la base, sin Material ni Cupertino.

Versiones observadas: Git 2.53.0, VM Service 15.2.0, Vitest 2.1.9 y TypeScript 5.9.3.
Hyprland 0.56.2 comprueba proceso, ventana y workspace. xdotool 4.20260303.1 envía teclas al proceso verificado.
AT-SPI 2.0 comprueba la semántica externa mediante su bus privado.
Las versiones técnicas y las fuentes instaladas no constituyen un benchmark del POS.

El texto de cantidades usa `BigInt` del SDK.
El contrato exige enteros seguros y escalas de cero a seis en `packages/contract/src/recipes.ts`.
Una conversión intermedia a `double` puede perder exactitud; no se añade una biblioteca para este caso acotado.
La [decisión N27](../research/2026-10-08-pos-native-estacion/N27-decision.md) conserva la razón y las pruebas.

## Auditoría de cobertura

Cada fila debe conservar sus tareas, permisos, estados, adaptación y recuperación. Las pruebas aisladas complementan la inspección nativa.
La presencia de `PosPage` demuestra adopción técnica. Por sí sola no demuestra un flujo completo.

| Superficie                            | Implementación integrada                                 | Evidencia                                                                                  | Límite de validación                                                                |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Terminal, comercio y sucursal         | `umi_pos_app.dart`, `entry_surface.dart`                 | Registro nativo N2; pruebas de emparejamiento y entrada                                    | La preparación de fixture no demuestra un alta real de comercio.                    |
| PIN y bloqueo                         | `entry_surface.dart`, `pin_entry.dart`                   | Acceso y cambios de rol nativos; cierre de rutas probado                                   | Voz e IME pendientes.                                                               |
| Carta, detalle y modificadores        | `catalog_surface.dart`                                   | N5–N6; variante y nota Unicode cobradas; N24–N25 texto/foco                                | Operadores y escáner físico pendientes.                                             |
| Comanda y pedidos entrantes           | `catalog_surface.dart`, `incoming_orders_surface.dart`   | N24–N27; total, permisos, pedido poblado y pruebas de adopción                             | Adopción nativa completa pendiente en G39.                                          |
| Mesas y servicio                      | `floor_plan_surface.dart`                                | N8–N10; mesa poblada, traslado y tiempo canónico                                           | No representa toda operación de salón.                                              |
| Cocina y preparación                  | `kitchen_board_surface.dart`                             | N26; ticket poblado, 200%, consulta y rechazo; N27 conexión corregida                      | Operación autorizada y preparación poblada pendientes en G39.                       |
| Cobro y pago incierto                 | `checkout_surface.dart`                                  | N5–N6; cobros nativos; recuperación y métodos probados                                     | Terminal de pago físico pendiente.                                                  |
| Venta, recibo e historial             | `sale_surface.dart`, `receipt_document.dart`             | N17–N21; búsqueda, reintento, recibo y teclado con 500 líneas                              | Impresión y lista extensa de ventas pendientes.                                     |
| Cancelación, devolución y excepciones | `exception_surface.dart`                                 | Suite de excepciones, autorización, inventario y pago                                      | Recorrido nativo completo de excepciones pendiente.                                 |
| Caja, movimientos, conteo y cierre    | `cash_surface.dart`                                      | N5–N18; apertura/cierre, denominaciones y persistencia; N27 total_only                     | La fixture nativa usa su política; total_only se comprueba en prueba de superficie. |
| Clientes y valor                      | `customer_value_surface.dart`                            | N27; Cliente Piloto poblado, teléfono/escritorio; pruebas de valor y permisos              | Recorrido nativo completo de valor pendiente.                                       |
| Inventario y producción               | `inventory_surface.dart`                                 | N27; 16 artículos, 200%, formulario y unidad nativos; conteo/producción decimales probados | La inspección nativa cancela el ajuste; no demuestra una producción real.           |
| Hardware y ajustes                    | `hardware_surface.dart`, `display_settings_surface.dart` | N27; sin dispositivos/cola vacía; tamaños y preferencias nativos                           | Dispositivos e impresión físicos pendientes.                                        |
| Conexión, recuperación y diagnóstico  | `recovery_center.dart`, `umi_pos_app.dart`               | Fallos y reintentos nativos; N27 descarta respuestas de Cocina después de salir            | Otras condiciones de red, operadores y mediciones nuevas pendientes.                |

## Secuencia

1. **Completado:** reproducir y corregir la carrera de conexión de Cocina, con evidencia nativa antes y después.
2. **Completado en los datos disponibles:** recorrer Inventario, Clientes, Hardware, Pedidos y Preparación.
3. **Completado:** corregir cantidades, unidades, alcance de conteo, verbos y destino de configuración. Conservar importes y restricciones.
4. **Completado en los tamaños documentados:** comprobar escritorio, teléfono y texto al 200%.
5. **Completado:** aprobar 667 pruebas del principal, análisis, release Linux y verificaciones API pertinentes.
6. **Completado:** integrar en el principal, revisar el delta y comprobar los 22 archivos ajenos por SHA-256.
7. **Completado:** guardar investigación, decisiones, registros, fuentes y capturas en el principal.

## Criterio de cierre

La capa visual está integrada en todas las superficies del POS. Conserva los comandos y permisos existentes.
El principal conserva el trabajo local del usuario. TPM conserva su ámbito separado.
El [resultado final](../research/2026-10-08-pos-native-estacion/N27-verification.json) identifica compilación, pruebas y procedencia.
Los límites de la tabla conservan las tareas empíricas pendientes; ninguna se declara aprobada por presencia de código.
La puntuación artística actual es **8.7/10**. La integración completa no convierte esa puntuación en 10.0.
