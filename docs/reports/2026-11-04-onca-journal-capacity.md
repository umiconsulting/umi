# ONCA: el historial confirmado agotaba la capacidad del journal

## Evidencia y reproducción

El Centro de recuperación de la D3 mostró un historial hasta el comando 250, con cero pendientes y cero conflictos del servidor.
La lista conservaba comandos ya enviados y recibos oficiales.
El código de la build 336 aplicaba el límite de 250 a todas las entradas no archivadas.
Ese conteo incluía entradas `accepted`, `duplicate` y `resolved`.
El historial no se archivaba automáticamente y la rutina de compactación no tenía un llamador de producción.

La reproducción usa el journal cifrado y la cola reales con 250 comandos ya confirmados.
La siguiente escritura falla con `queue_capacity_exceeded`, aunque no exista trabajo pendiente.
La conservación necesaria antes de cambiar de cuenta devuelve falso.
El checkout convierte ese fallo en `OFFLINE_SYNC_PENDING` antes de enviar un cobro a la API.
El resultado coincide con el aviso y el estado observados en la D3.
El código técnico del aviso histórico no se conservó; la atribución se basa en esa coincidencia y en la reproducción controlada.

## Corrección

El límite de 250 cuenta sólo comandos activos: pendientes, en replay, desconocidos o con conflicto.
Los comandos confirmados y resueltos conservan su historial sin consumir ese límite.
El límite sigue rechazando un comando adicional cuando existen 250 comandos activos.

Cada escritura nueva aplica la retención existente al historial vencido.
La misma función se usa en la compactación explícita.
Conserva todos los comandos activos, incluso los que están en replay.
También conserva efectivo aceptado que todavía no tiene la referencia oficial requerida.
La limpieza no reinicia las secuencias, los cursores ni los mapeos.
Las referencias oficiales se conservan aunque venza una copia histórica local.
Los hechos comerciales de la API no se modifican.

## Pruebas y seguridad

- Antes del cambio fallaron la escritura número 251 y la conservación del siguiente pedido.
- Después del cambio se conserva el historial reciente y se añade la secuencia 251.
- Con 250 comandos activos se conserva el rechazo por capacidad.
- La limpieza conserva efectivo sin referencia, comandos pendientes, desconocidos, en replay y con conflicto.
- Los mapeos permanecen disponibles después de limpiar historial vencido.
- Las 1,239 pruebas Flutter aprobaron con código de salida cero.
- El análisis Dart de los cuatro archivos terminó sin incidencias.
- El formato Dart y `git diff --check` aprobaron.
- La revisión independiente no encontró hallazgos bloqueantes.

Se usaron Flutter 3.47.5 y Dart 3.13.4 en Juan-PC como `juan`.
La evidencia se conserva en `/home/juan/.local/state/onca-support-20261104/checkout-state/`.
Los archivos principales son `journal-capacity-red.log`, `journal-capacity-green.log`,
`journal-retention-replaying-red.log`, `journal-retention-replaying-green.log`,
`journal-capacity-full-flutter-suite.log` y `journal-capacity-analyze.log`.

## Defecto independiente de efectivo

El [PR #253](https://github.com/umiconsulting/umi/pull/253) corrige el rechazo `policy_invalid` durante la validación del replay.
Ese cambio tiene su propia rama, pruebas y revisión.
La prueba combinada reproduce estas tres etapas:

| Código bajo prueba       | Resultado del efectivo con 250 confirmados                    |
| ------------------------ | ------------------------------------------------------------- |
| Build 336                | `OFFLINE_SYNC_PENDING` antes del pago                         |
| Sólo capacidad corregida | `policy_invalid` mientras el replay valida la sesión          |
| Ambos cambios            | Efectivo completado una vez, con la escritura previa en orden |

Se confirmó dos veces el mismo cobro de prueba y el journal conservó una sola entrada de efectivo.
La prueba usa respuestas de red controladas; no ejecuta pagos ni escrituras en producción.
Su evidencia final está en `cash-history-250-combined-final-green.log`.
El probe temporal se archivó fuera del repositorio.

## Entrega y límites

No se requiere una migración de base de datos ni un cambio del formato del journal.
Ambos PR necesitan aprobación antes de generar e instalar una nueva build.
La corrección aún no se verificó en una tablet con un APK nuevo.
La recuperación anterior de la cuenta real no valida este código nuevo.
El rollback requiere revertir el cambio y reconstruir el APK; puede restaurar el límite incorrecto.
La reversión no requiere borrar el journal ni los datos comerciales.
