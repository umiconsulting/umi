# Certificación de la Base de Conocimiento del Owner

Actualizado: 2026-08-13

## Decisión

Gate 11: `OWNER KNOWLEDGE BASE COMPLETE WITH P2`.

Gate 12: `YES WITH P2`.

Commit inicial: `b999280194b9447d01e9548aace23b4b613e30bc`.

Release vigente: `UMI POS Pilot RC2`, versión `6.0.0-pilot.rc2`.

Gate 11 no cambió código ejecutable ni artefactos. RC2 conserva su identidad y sus checksums.

## Estructura

La raíz canónica es `docs/knowledge-base/`. `README.md` organiza aprendizaje y operación.

La base incluye 25 documentos canónicos. El manifiesto identifica propósito, audiencia, estado y evidencia relacionada.

## Cobertura

| Área                                                   | Estado   |
| ------------------------------------------------------ | -------- |
| Producto y negocio                                     | COMPLETA |
| Arquitectura y autoridad                               | COMPLETA |
| Multi-tenancy, identidad, seguridad y permisos         | COMPLETA |
| Comercios, ubicaciones, usuarios, dispositivos y cajas | COMPLETA |
| Flutter POS, Dashboard y KDS                           | COMPLETA |
| Catálogo e inventario                                  | COMPLETA |
| Ventas, pagos, recibos y reembolsos                    | COMPLETA |
| Turnos, clientes, lealtad, Wallet y Gift Card          | COMPLETA |
| Proceso asíncrono, eventos pendientes y observabilidad | COMPLETA |
| Despliegue, respaldo, rollback y restauración          | COMPLETA |
| Solución de problemas e incidentes                     | COMPLETA |
| Desarrollo, codebase map, datos y API                  | COMPLETA |
| Gestión de versiones y RC2                             | COMPLETA |
| Alcance, ventas, FAQ e historias                       | COMPLETA |
| Gate 13 y límites físicos                              | COMPLETA |

## Diagramas

La base contiene diagramas Mermaid para topología, venta, onboarding, dispositivos y KDS.

También incluye reembolso, turno, eventos pendientes, despliegue, incidentes y relaciones de datos.

## Troubleshooting y soporte

La guía maestra usa síntoma, comprobaciones, causa, acción y escalamiento. Incluye 29 escenarios representativos.

El runbook diferencia P0, P1 y P2. Prohíbe reintentos ciegos y ediciones manuales de hechos.

La guía del Owner cubre venta, login, usuario, dispositivo, inventario, KDS y despliegue.

## Exactitud

La documentación usa los roles actuales. UMI API y PostgreSQL permanecen como autoridad.

RC1 aparece como `SUPERSEDED — DO NOT DEPLOY`. RC2 permanece vigente.

Pagos integrados, object storage y costos avanzados no aparecen como funciones certificadas.

La base no afirma evidencia física de iOS, KDS, printer, drawer, scanner ni customer display.

`NEXO LEGACY RUNTIME DEPENDENCY: NONE`.

## P2

- `_ReadyShell` conserva un placeholder que la ruta productiva no usa.
- Los comentarios de `StubToolsService` conservan lenguaje de una fase anterior.

Gate 11 no modificó estos archivos ejecutables. Los elementos permanecen sin impacto operativo.

## Defectos de documentación

P0 encontrados: `0`. P0 abiertos: `0`.

P1 encontrados: `5`. P1 cerrados: `5`. P1 abiertos: `0`.

La revisión cerró profundidad de autenticación, roles, Dashboard, worker y terminología en español.

P2 nuevos abiertos: `0`. P2 heredados: `2`.

## Validación

La publicación final registra formato, enlaces, rutas, referencias de versión, secretos, NEXO y PR gates.

## Resultado

El Owner puede comprender el producto, operar sus superficies y diagnosticar incidentes sin conocimiento informal obligatorio.

La Base explica límites y fuentes de verdad. Gate 13 conserva toda evidencia física y externa pendiente.

`OWNER KNOWLEDGE BASE COMPLETE WITH P2`

`Gate 12 — Final Software Certification & Release Closure: YES WITH P2`
