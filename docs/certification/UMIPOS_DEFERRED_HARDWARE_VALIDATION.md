# Validación diferida de hardware y proveedores de UmiPOS

Actualizado: 2026-08-13

Status: `DEFERRED TO GATE 13 — DOES NOT BLOCK SOFTWARE COMPLETION`.

Este registro contiene validaciones que requieren equipo físico, un sitio real o un proveedor activo.
No contiene una implementación de software pendiente.

## Reglas

- Mantén desactivada cada capacidad que el piloto no requiera.
- Prueba cada capacidad necesaria antes de su uso real.
- Registra dispositivo, versión, entorno, referencia, resultado e issue ID.
- No conviertas evidencia simulada, estática o local en evidencia física.
- Detén el flujo afectado si aparece un P0 o P1.

## Matriz de validación

| Capability            | Software evidence                                                                                     | Gate 13 validation                                                                                        | Current status |
| --------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------- |
| Linux POS             | El archivo RC3, las pruebas Flutter y la compilación Linux pasaron                                    | Prueba pantalla, entrada, suspensión, reinicio, red y almacenamiento local                                | DEFERRED-G13   |
| iPad or iOS POS       | Flutter source and adaptive software behavior passed available checks                                 | Apple signing, install, safe areas, touch, background, restart, and network                               | DEFERRED-G13   |
| KDS hardware          | Swift source, API boundary, simulation, lifecycle, reconnect, and static accessibility passed         | Install on the target iPad; test working distance, touch, background, reconnect, and full lifecycle       | DEFERRED-G13   |
| Receipt printer       | Generic TCP adapter, thermal rendering, command queue, retry policy, and simulator passed             | Test discovery, width, Unicode, paper out, reconnect, original, COPY, and unknown outcome                 | DEFERRED-G13   |
| Cash drawer           | Printer-attached drawer command, authority, recovery, and simulator passed                            | Test register association, authorized pulse, unrelated actions, disconnect, and recovery                  | DEFERRED-G13   |
| Barcode scanner       | Keyboard-wedge routing, sensitive-input protection, rapid input logic, fallback, and simulator passed | Test product resolution, repeat scans, unknown code, focus, disconnect, and reconnect                     | DEFERRED-G13   |
| Customer display      | Scoped command model, privacy projection, recovery, and simulator passed                              | Test pairing, register isolation, totals, idle state, privacy, completion, and reconnect                  | DEFERRED-G13   |
| Real payment provider | Manual terminal assertion is certified; integrated authorization remains disabled                     | Test authorized sandbox first; then test authorization, capture, refund, events, retry, and secret safety | DEFERRED-G13   |
| Object storage        | RC3 funciona con storage desactivado; la configuración falla de forma segura                          | Prueba credenciales, alcance, carga, descarga, fallo, privacidad y durabilidad si se activa               | DEFERRED-G13   |
| Pilot network         | Local failure and reconnect certification passed                                                      | Test DNS, TLS, latency, interruption, reconnect, KDS, devices, and transaction ambiguity at the site      | DEFERRED-G13   |

## Límite de cierre

Gate 10 a Gate 12 están completos. Gate 13 es responsable de la evidencia física y real.

Devuelve un elemento a software solo si Gate 13 encuentra un defecto reproducible.
La ausencia de hardware no es un defecto de software.

## Registro de activación

Usa `docs/certification/UMIPOS_CONTROLLED_PILOT_ACTIVATION.md` como ledger del sitio.
Sustituye cada valor desconocido solo con evidencia real.
