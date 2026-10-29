# Conciliación de producción, GitHub y cambios locales

Fecha: 28 de octubre de 2026.
Destino: un solo PR hacia `main`. El alcance excluye la compilación de iOS.

## Fuentes conciliadas

| Fuente                     | Revisión o estado                                                               | Comprobación                                                              |
| -------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| GitHub `main`              | `02b25532`                                                                      | Base del worktree de integración; conserva las correcciones del dashboard |
| Rama local del piloto      | `597f8ba6`                                                                      | Integrada con su historia y sus correcciones de POS, caja y KDS           |
| Rama remota de soporte     | `069a07fd`                                                                      | Incluye el PR 228 y las correcciones posteriores al piloto                |
| API y worker de producción | `445bedacae9f0aeb1406f7b09b1b27e46b5b5fc8`                                      | SSH, etiquetas de imagen, `/health/release` y cambios del contenedor      |
| POS 334                    | `08a2ea004195d3c423d3ce74aa71e3430314f1e5`                                      | Registro de compilación, PR 228 y SHA-256 del APK instalado en Caja       |
| Cambios locales sin commit | Landing, leads, prototipo de POS, soporte Android, herramientas y documentación | Copia desde los dos worktrees activos; los originales se conservan        |

La imagen del API es `ghcr.io/umiconsulting/umi-api:onca-445bedac`.
El API conserva el contrato `2.45.0` y el esquema esperado `build-v3-79`.
La inspección de los contenedores no encontró cambios en el código desplegado.
El worker sólo añadió su archivo temporal de disponibilidad.
Los checkouts del VPS no tienen cambios pendientes en archivos de código ya registrados.

## Hotfix SQL recuperado del VPS

El checkout `/home/juan/umi` conservaba una migración sin registrar en Git:

`supabase/migrations/20261023232130_allow_drawer_diagnostic_without_register.sql`.

La consulta de producción, dentro de una transacción de sólo lectura, confirmó ambos controles del hotfix:
`hardware_diagnostic` y `manager_test`.
El MD5 de la definición actual de `merchant.create_hardware_command(jsonb)` es
`640cd64c81b10feb7cba624a7f4a36d9`.
La migración recuperada conserva los bytes del archivo del VPS y admite una segunda ejecución.
Esta tarea conserva el hotfix; no vuelve a ejecutarlo en producción.

## Identidad del POS

El APK canónico es `UmiPOS-1.0.0-production-release-build334-final.apk`.
Su SHA-256 es `c8b3b81335c742b6a6a696e8d32c5c92b93376b7ab47d8d66c908d57f9329e09`.
La consulta ADB actual de Caja confirmó la build 334, sin depuración, y el mismo SHA-256.
La evidencia del 27 de octubre confirma la instalación del mismo APK en las cuatro terminales.
Esa evidencia está en [el incidente 010](2026-10-27-onca-production-bug-010.md).

La consulta actual sólo encontró ADB en Caja.
Barra estaba en línea por Tailscale, sin conexión ADB; Cocina y Mesero estaban fuera de línea.
No se reinstaló, reinició ni modificó una terminal para esta conciliación.

## Historia y archivos locales

El historial de Codex y los registros de compilación identifican el PR 228 como origen de la build 334.
La base de sesiones de Hermes disponible no contiene una sesión de Umi que amplíe esa evidencia.
El worktree `/tmp/umi-fast-actions` conserva un ensayo del 22 de octubre sobre una base anterior.
La integración conserva la implementación posterior del flujo local y los hotfixes comprobados; no reaplica ese ensayo anterior.

Los archivos temporales `.tmp-*`, las descargas masivas y los árboles de accesibilidad quedan locales.
El PR conserva los documentos y la evidencia citada que acompañan los cambios.
Los respaldos históricos del VPS no sustituyen al código de la imagen desplegada.

## Revisión y límites de publicación

La revisión de estándares no encontró bloqueadores nuevos en Umi Support ni en la migración recuperada.
El endpoint central de contacto conserva la compatibilidad con clientes anteriores: acepta el consentimiento omitido y rechaza `false`.
El formulario nuevo envía `privacyAccepted: true`; la ruta nueva de Next exige ese valor.

El aviso de privacidad de la landing conserva datos pendientes de aprobación en su README y DESIGN.
Este PR conserva el trabajo solicitado. La publicación pública del formulario requiere completar esa aprobación antes del merge.

## Validación local

- Compilación, lint y pruebas de los paquetes afectados: ocho tareas aprobadas.
- API: 2,100 pruebas aprobadas; 29 pruebas omitidas por la configuración existente.
- Landing: 34 pruebas aprobadas.
- Contrato: 93 pruebas aprobadas.
- POS: 1,170 pruebas aprobadas; análisis completo sin incidencias.
- Umi Support: 48 pruebas JVM aprobadas, lint Android aprobado y APK de depuración compilado.

El comando conjunto de Turborepo usa `--concurrency=1`.
Las pruebas del contrato vuelven a crear `dist`; la ejecución simultánea retiraba tipos durante el análisis de sus consumidores.
La ejecución secuencial conserva todos los controles y elimina esa interferencia entre tareas.
La compilación de iOS queda excluida por instrucción del propietario.

## Herramientas y fuentes

Se usaron Git 2.56.0, GitHub CLI 2.102.0, Node.js 22.23.2, pnpm 10.29.3, Flutter 3.47.5 y Gitleaks 8.30.1.
Umi Support usa Java 17, Android SDK 36 y Gradle Wrapper 9.1.0.
Se usaron las herramientas existentes, sin crear otro flujo de publicación.
Las fuentes del procedimiento son [PR Gates](../../.agents/skills/pr-gates/SKILL.md),
[Git worktree](https://git-scm.com/docs/git-worktree) y [GitHub CLI](https://cli.github.com/manual/gh_pr_create).
