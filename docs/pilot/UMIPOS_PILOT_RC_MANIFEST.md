# Manifiesto de UMI POS Pilot RC

Actualizado: 2026-08-13

## Identidad

| Campo                    | Valor                                                              |
| ------------------------ | ------------------------------------------------------------------ |
| Release                  | `UMI POS Pilot RC3`                                                |
| Versión                  | `6.0.0-pilot.rc3`                                                  |
| Source commit            | `5b852c5e8152ca3dc6f9070ae2d49a277406dc72`                         |
| Rama                     | `architectureUMIposIntegration`                                    |
| PR                       | `#72`                                                              |
| Base                     | `build-v3`                                                         |
| Contrato                 | `2.12.0`                                                           |
| Esquema de configuración | `1`                                                                |
| Migraciones              | `build-v3-00` a `build-v3-48`                                      |
| Digest de migración      | `b00445e57382ec33e9780e51cc9af5c3f2561bf9c686e2a64356647eccb2c555` |

El source commit es la autoridad de los artefactos.

RC1 y RC2 están reemplazados. No los despliegues.

## Artefactos

| Componente    | Artefacto                             | Identidad                                                                  | Estado                    |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------- | ------------------------- |
| API           | `umipos-api:6.0.0-pilot.rc3`          | `sha256:6945291a794578c0fbfa1f3d9fb6b4e96cfb3739df34154364a877ee0fad4292`  | Construido                |
| Worker        | Imagen de API con comando worker      | Mismo digest de API                                                        | Construido y saludable    |
| Dashboard     | `umipos-dashboard:6.0.0-pilot.rc3`    | `sha256:2a3e7574dec89883a20aa263e0855f45c66519c8e9428a2ecdd193234d754c21`  | Construido                |
| Linux POS     | `umipos-linux-6.0.0-pilot.rc3.tar.gz` | SHA-256 `3db93292801e22821751c8253ed42e2fcd8d4b98cfa0aebbd52e2fa1679209e9` | Construido                |
| KDS           | Árbol de origen                       | `git-tree:9f0e88f1c839a453472294ce305a515476ac0d90`                        | Verificado por software   |
| Base de datos | Migraciones build-v3                  | Digest anterior                                                            | Migración limpia aprobada |

El manifiesto de máquina está en `artifacts/releases/6.0.0-pilot.rc3/release-manifest.json`.
La política del repositorio mantiene los artefactos fuera de Git.

## Infraestructura

RC3 requiere PostgreSQL, Redis, API, worker, Dashboard, Caddy y OpenTelemetry.
Usa TLS en el ingreso público. Inyecta todos los secretos fuera de Git.

Object storage está desactivado. Ninguna operación v1 lo requiere.
El procesamiento integrado de pagos está desactivado.
El registro manual de una terminal externa es una afirmación del operador.

## Contrato de configuración

Usa `deploy/pilot/pilot.env.example` como plantilla.
Usa `apps/umi-api/src/shared/config/config.schema.ts` como autoridad de runtime.

- Runtime: entorno, PostgreSQL, Redis, orígenes y release.
- Secretos: contraseñas, claves de sesión, customer value y tokens operativos.
- Pilot: bootstrap, versiones mínimas, cookies seguras y proxies de confianza.
- Opcional: object storage, telemetría y adaptadores externos.
- Pruebas: identidades smoke, confirmación desechable y fixture de cierre.

Los valores de producción fallan de forma cerrada.
No uses placeholders, credenciales de prueba o localhost en un entorno real.

## Observaciones

- Gate 13 validará iOS, KDS físico y periféricos.
- Gate 13 validará el sitio, la red y los proveedores si se activan.
- Dos P2 de código no alcanzable o comentarios históricos permanecen aceptados.
- Gate 12 cerró el P1 del healthcheck del worker de RC2.

## Despliegue y recuperación

Usa [el procedimiento de despliegue](../deployment/UMIPOS_PILOT_RC_DEPLOYMENT.md).
Usa rollback de aplicación con un esquema compatible.
No reviertas hechos de negocio inmutables.
Usa un respaldo verificado solo para pérdida o corrupción de PostgreSQL.

## Evidencia

- [Certificación final de software](../certification/UMIPOS_FINAL_SOFTWARE_CERTIFICATION.md)
- [Certificación del Pilot RC](../certification/UMIPOS_PILOT_RC_CERTIFICATION.md)
- [Certificación del pilot](../certification/UMIPOS_PILOT_CERTIFICATION.md)
- [Gate 13 diferido](../certification/UMIPOS_DEFERRED_HARDWARE_VALIDATION.md)
