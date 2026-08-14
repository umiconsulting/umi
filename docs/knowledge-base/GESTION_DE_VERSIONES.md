# Gestión de versiones

[Índice](README.md) | [Despliegue](DESPLIEGUE_RESPALDO_Y_RECUPERACION.md) | [Alcance](ALCANCE_V1.md)

## Flujo

La rama `architectureUMIposIntegration` usa PR #72 contra `build-v3`. Los gates validan producto, versión y documentación.

`pnpm check:pr` valida contratos, formato, datos canónicos y reglas del repositorio. GitHub CI valida el commit publicado.

## Identidad

Un candidato de versión, o release candidate, relaciona nombre, commit de origen, artefactos, sumas de verificación, esquema y evidencia.

RC1 falló un despliegue limpio de base de datos. Por eso quedó `SUPERSEDED — DO NOT DEPLOY`.

RC2 corrigió ese bloqueo y regeneró los artefactos. Es la única versión actual para pilot controlado.

## Cómo superseder un RC

1. Registra el defecto y su severidad.
2. Cambia solo el alcance necesario.
3. Asigna una identidad nueva.
4. Regenera artefactos y checksums.
5. Repite la migración, la compilación, la prueba de humo y la certificación afectada.
6. Actualiza manifiesto y procedimientos.
7. Marca el RC anterior como superseded.

No cambies código ejecutable y conserves la identidad anterior.

## Rollback

Un rollback cambia la aplicación a una versión compatible. No borra hechos válidos ni revierte migraciones a ciegas.

Revisa el proceso de tareas, los eventos pendientes, los dispositivos y KDS antes de la reversión de la aplicación.

## Fuentes

- Manifiesto: `docs/pilot/UMIPOS_PILOT_RC_MANIFEST.md`
- Certificación: `docs/certification/UMIPOS_PILOT_CERTIFICATION.md`
- Proceso: `docs/deployment/UMIPOS_RELEASE_PROCESS.md`
- Despliegue: `docs/deployment/UMIPOS_PILOT_RC_DEPLOYMENT.md`
