# Certificación final de software de UMI POS

Actualizado: 2026-08-13

## Decisión

`UMI POS SOFTWARE COMPLETE WITH P2`

`Software Closure: APPROVED WITH P2`

El hardware y el entorno real quedan diferidos a Gate 13. No existe un P0 o P1 abierto.

## Procedencia y release

| Campo                     | Valor                                      |
| ------------------------- | ------------------------------------------ |
| Commit inicial de Gate 12 | `afb8b9c96d99f21ae3aeaf7b3c1bb75c6741a884` |
| Release vigente           | `UMI POS Pilot RC3`                        |
| Versión                   | `6.0.0-pilot.rc3`                          |
| Artifact source           | `5b852c5e8152ca3dc6f9070ae2d49a277406dc72` |
| Rama                      | `architectureUMIposIntegration`            |
| PR                        | `#72`, base `build-v3`, sin merge          |
| Contrato                  | `2.12.0`                                   |
| Esquema                   | `build-v3-48`                              |

RC1 y RC2 están reemplazados. No se deben desplegar.

Gate 12 encontró un P1 en RC2. El healthcheck del worker no podía resolver `ioredis` dentro de la imagen con pnpm.
El worker procesaba trabajo, pero Docker lo marcaba como no saludable. RC3 declara la dependencia directa y añade una prueba de regresión.

## Alcance v1 congelado

### Incluido

- API de UMI y PostgreSQL como autoridad.
- Redis, worker, outbox, auditoría, observabilidad y recuperación.
- Dashboard administrativo con 19 módulos operativos.
- Flutter POS para Linux.
- Software KDS y su proyección de cocina.
- Organizaciones, ubicaciones, usuarios, roles, dispositivos, cajas y turnos.
- Catálogo, precios, opciones, modificadores y códigos de barras.
- Inventario v1 basado en hechos y proyecciones de cantidad.
- Ventas, efectivo, registro manual de terminal, recibos y reembolsos.
- Clientes, lealtad, wallet y gift cards.

### Fuera de v1

- Android, Windows y macOS.
- Costeo avanzado.
- Procesamiento integrado de proveedores de pago.
- Object storage como dependencia activa.

### Diferido a Gate 13

- iOS/iPad, KDS físico, impresora, cajón, scanner y customer display.
- Red y sitio reales.
- Proveedor integrado y object storage, si se activan.

## Inventario final

| Área                                | Estado                        | Evidencia principal                          |
| ----------------------------------- | ----------------------------- | -------------------------------------------- |
| API, PostgreSQL y Redis             | COMPLETE                      | Build, 857 pruebas y clean deployment        |
| Worker y outbox                     | COMPLETE                      | Worker RC3 saludable y prueba de healthcheck |
| Dashboard                           | COMPLETE WITH NON-BLOCKING P2 | 12 pruebas, lint y build                     |
| Flutter POS Linux                   | COMPLETE                      | Analyze, 178 pruebas y release build         |
| KDS                                 | COMPLETE                      | 14 pruebas PostgreSQL y ciclo certificado    |
| Identidad, RBAC, RLS y dispositivos | COMPLETE                      | Suites API y matriz de autorización          |
| Comercio e inventario               | COMPLETE                      | Reconciliación con drift cero                |
| Customer value                      | COMPLETE                      | Wallet, gift card y reconciliación           |
| Deployment y recuperación           | COMPLETE                      | RC3 desplegado, smoke y reinicio             |
| Hardware y proveedores              | DEFERRED TO GATE 13           | Registro diferido                            |

## Resultados técnicos

- API: typecheck, 857 pruebas y build pasaron.
- Dashboard: 12 pruebas, lint sin errores y build de producción pasaron.
- Flutter POS: analyze, 178 pruebas y build Linux pasaron.
- KDS: 14 pruebas de integración con PostgreSQL pasaron.
- Migraciones: la cadena limpia terminó en `build-v3-48` sin drift.
- Salud RC3: API y worker están `healthy`.
- Readiness RC3: PostgreSQL, Redis, contrato y esquema son compatibles.
- Reconciliación financiera: gross `9000`, refund `4499`, net `4501`, drift `0`.
- Reconciliación de inventario: 16 proyecciones, drift `0`.
- Customer value: wallet drift `0`, gift-card drift `0` y secretos expuestos `0`.
- Secret scan: Gitleaks no encontró hallazgos.
- NEXO: `NEXO LEGACY RUNTIME DEPENDENCY: NONE`.

## Seguridad y autoridad

El backend aplica autenticación, RBAC, ubicación, dispositivo y RLS. El frontend no es una barrera de seguridad.
Las pruebas cubren Owner, Manager, Cashier, Viewer y contexto KDS. No existe cruce de tenant o ubicación.
Los reembolsos requieren autoridad. KDS no tiene autoridad financiera. Los hechos financieros y de auditoría son inmutables.

## Fallos, reinicio y recuperación

RC3 conserva la verdad de negocio tras reiniciar API y worker. El worker vuelve a estado saludable.
Los reintentos usan identidades estables. Las operaciones inciertas requieren consulta antes de un nuevo intento.
El sistema conserva correlation IDs, auditoría, Recovery Center y registros de trabajos fallidos.

## Configuración y despliegue

`apps/umi-api/src/shared/config/config.schema.ts` valida la configuración. `deploy/pilot/pilot.env.example` documenta el contrato.
Los valores de producción fallan de forma cerrada. Los secretos no pertenecen a Git ni a bundles públicos.
El procedimiento canónico despliega RC3 y ejecuta migraciones, readiness, smoke, respaldo y verificación de identidad.

## Knowledge Base y documentación

La [Base de Conocimiento](../knowledge-base/README.md) es la entrada canónica para Owner, soporte y desarrollo.
Sus 25 documentos están en español. Los enlaces internos y las rutas de origen se validaron.
La documentación histórica conserva su release original. La documentación activa señala RC3 como release vigente.

## Ledger de defectos

| ID        | Severidad | Hallazgo                                                        | Estado         |
| --------- | --------- | --------------------------------------------------------------- | -------------- |
| G12-P1-01 | P1        | El healthcheck del worker de RC2 no resolvía `ioredis`          | CERRADO EN RC3 |
| G10-P2-01 | P2        | `_ReadyShell` contiene un placeholder de catálogo no alcanzable | ACEPTADO       |
| G10-P2-02 | P2        | Comentarios históricos de fase mencionan `StubToolsService`     | ACEPTADO       |

## Warnings aceptados

| Fuente             | Motivo                              | Impacto                                                  | Disposición                               |
| ------------------ | ----------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| Dashboard lint     | 49 warnings conocidos; cero errores | No cambian ejecución ni autoridad                        | Revisar solo con cambio del módulo        |
| KDS suite normal   | 14 pruebas requieren PostgreSQL     | No oculta un defecto; las 14 pasaron con PostgreSQL real | Mantener condición de entorno             |
| `_ReadyShell`      | Ruta no productiva                  | Sin efecto en usuarios                                   | Retener hasta un cambio ejecutable futuro |
| `StubToolsService` | Comentario histórico                | Sin binding ni uso de runtime                            | Retener como deuda menor                  |

Los elementos de Gate 13 no son warnings de software.

## Estado de NEXO

No existe una dependencia de runtime, build, migración o despliegue con NEXO.
El checkout local antiguo es `TECHNICALLY DISPOSABLE`. Conserva antes su remoto, historial y evidencia de archivo.
No elimines el checkout como parte de Gate 12.

## Cierre y PR

PR #72 queda `READY TO MERGE — NOT MERGED`. Gate 12 no tiene autorización explícita para fusionarlo.
El siguiente paso es una aprobación manual conforme a la gobernanza del repositorio.
Gate 13 no inicia. Espera hardware y un entorno real.

## Declaración final

`UMI POS SOFTWARE COMPLETE — HARDWARE CERTIFICATION DEFERRED TO GATE 13`
