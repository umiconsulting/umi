# Guía de diagnóstico del Owner

[Índice](README.md) | [Observabilidad](TRABAJADORES_Y_OBSERVABILIDAD.md) | [Incidentes](INCIDENTES_SOPORTE_Y_DIAGNOSTICO.md)

## Una venta tiene un problema

1. Identifica comercio y ubicación.
2. Obtén transaction ID y command ID.
3. Identifica usuario, dispositivo y caja.
4. Consulta el hecho autoritativo de la venta.
5. Revisa pagos, recibo y reembolsos.
6. Revisa auditoría y correlation ID.
7. Revisa el proceso de tareas solo para efectos asíncronos.
8. Ejecuta conciliación financiera e inventario.
9. Selecciona recuperación o escalamiento.

No uses el estado visual como única evidencia.

## Problema de login

1. Confirma ambiente y versión.
2. Revisa `/health/live` y `/health/ready`.
3. Confirma estado del usuario y membresía.
4. Revisa cookie, expiración y reloj.
5. Diferencia `401` de `403`.

## Problema de usuario o rol

1. Obtén usuario, comercio y ubicación.
2. Revisa membresía, rol y permisos efectivos.
3. Revisa revocación reciente.
4. Confirma protección del último Owner.
5. Busca el evento en auditoría.

## Problema de dispositivo

1. Confirma ambiente, versión e identidad.
2. Revisa confianza, revocación y credencial.
3. Revisa ubicación y caja.
4. Reinscribe solo con autorización.

## Problema de inventario

1. Identifica item y ubicación.
2. Consulta ledger y proyección.
3. Relaciona venta, reembolso, ajuste, conteo y traslado.
4. Ejecuta la reconciliación.
5. Escala una diferencia de negocio.

## Problema de KDS

1. Confirma estación, ubicación y versión.
2. Revisa heartbeat y conexión.
3. Identifica order ID y estado terminal.
4. Solicita una instantánea y concilia.
5. Verifica duplicados antes de actuar.

## Problema de despliegue

1. Compara la identidad de versión con el manifiesto.
2. Revisa schema head y migraciones.
3. Revisa la disponibilidad de API y del proceso de tareas.
4. Revisa configuración sin imprimir secretos.
5. Ejecuta la prueba de humo.
6. Usa rollback compatible si es necesario.

## Regla de decisión

Si no puedes demostrar qué ocurrió, no autorices una mutación correctiva. Escala con evidencia.
