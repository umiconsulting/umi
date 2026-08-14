# Despliegue de UMI POS Pilot RC

Actualizado: 2026-08-13

Este procedimiento despliega `UMI POS Pilot RC3` desde `5b852c5e8152ca3dc6f9070ae2d49a277406dc72`.
RC1 y RC2 están reemplazados. No los despliegues.

## Despliegue

1. Selecciona el commit certificado.
2. Verifica el manifiesto y los checksums.
3. Copia `deploy/pilot/pilot.env.example` al entorno protegido.
4. Sustituye cada placeholder desde el almacén de secretos.
5. Define los orígenes HTTPS y los proxies de confianza.
6. Configura TLS de PostgreSQL cuando cruce una red privada confiable.
7. Mantén object storage desactivado hasta certificar su proveedor.
8. Mantén los proveedores de pago desactivados hasta su certificación.
9. Ejecuta `pnpm umipos:pilot:precheck`.
10. Crea un respaldo actual de PostgreSQL.
11. Ejecuta las migraciones ordenadas hasta `build-v3-48`.
12. Verifica readiness de PostgreSQL y Redis.
13. Despliega la imagen de API.
14. Despliega el worker desde la imagen de API.
15. Despliega Dashboard y Caddy.
16. Instala Linux POS en un dispositivo inscrito.
17. Instala KDS mediante el proceso compatible de Apple.
18. Ejecuta `pnpm umipos:pilot:smoke`.
19. Ejecuta `pnpm pilot:readiness`.
20. Verifica versión, commit, contrato y esquema en Diagnostics.

Detén el despliegue si falla una migración, readiness, identidad o smoke.

## Smoke posterior

1. Verifica liveness y readiness de API.
2. Abre Dashboard mediante HTTPS.
3. Autentica al Owner.
4. Verifica merchant y location.
5. Verifica el alcance del Manager.
6. Verifica device, register y shift.
7. Carga un catálogo representativo.
8. Verifica la visibilidad del inventario.
9. Conecta la estación KDS asignada.
10. Confirma una venta segura en efectivo.
11. Verifica un hecho de venta, tender y recibo.
12. Verifica la venta en Dashboard.
13. Confirma que no existe un duplicado.
14. Revisa Diagnostics, Audit y Recovery Center.

## Rollback y recuperación

Usa rollback de aplicación para un defecto de aplicación.
Selecciona el último artefacto certificado compatible con el esquema actual.
Pausa el worker antes de un rollback incompatible.

No reviertas una migración que ya contiene hechos de negocio.
No edites hechos de ventas, recibos, reembolsos, inventario o auditoría.
Pausa o drena outbox antes de cambiar el worker.
Conserva cada job pendiente y su identidad.

Usa un respaldo verificado solo para pérdida o corrupción de PostgreSQL.
Detén todos los writers antes de una restauración.
Restaura primero en una base aislada.
Ejecuta reconciliación y smoke antes de reanudar tráfico.

## Protección de datos

- PostgreSQL es la autoridad de los hechos de negocio.
- Crea un respaldo verificado antes de cada despliegue.
- Guarda respaldos fuera del host de aplicación.
- Redis, tarjetas KDS, caché POS y estado de UI no son respaldos.
- El operador de plataforma ejecuta la restauración.

## Lista go/no-go

- [ ] El commit desplegado es `5b852c5e8152ca3dc6f9070ae2d49a277406dc72`.
- [ ] El entorno corresponde al entorno aprobado.
- [ ] Las migraciones terminan en `build-v3-48`.
- [ ] La configuración requerida está presente.
- [ ] El almacén contiene todos los secretos.
- [ ] Object storage está desactivado o certificado.
- [ ] El modo de pago es correcto.
- [ ] Merchant, locations, Owner y Manager están listos.
- [ ] Devices, registers y KDS están asignados.
- [ ] El catálogo está activo.
- [ ] El inventario tiene drift cero.
- [ ] API, worker, PostgreSQL, Redis y Dashboard están saludables.
- [ ] El smoke posterior pasó.
- [ ] El respaldo tiene un checksum válido.
- [ ] Soporte conoce la ruta de escalamiento.
- [ ] Se revisaron los elementos de Gate 13.
