# Runbook de soporte de UmiPOS

## Severidad

| Nivel | Definición                                                           | Respuesta                                 |
| ----- | -------------------------------------------------------------------- | ----------------------------------------- |
| P0    | El negocio no puede vender con seguridad o existe riesgo financiero. | Detén la acción y escala de inmediato.    |
| P1    | Una función principal falla, pero existe una alternativa segura.     | Estabiliza y escala durante la operación. |
| P2    | Existe una degradación no crítica.                                   | Registra y programa la corrección.        |
| P3    | El problema es visual o informativo.                                 | Registra para planificación.              |

## Triage

1. Recibe el reporte y asigna una severidad.
2. Recopila la referencia pública y el `correlation ID`.
3. Revisa el estado, el Dashboard y el bundle de soporte.
4. Identifica el dominio responsable.
5. Ejecuta una acción de diagnóstico segura.
6. Usa el Centro de recuperación solo cuando la acción esté permitida.
7. Escala si no existe un resultado terminal.

Usa el comando de bundle de `docs/deployment/UMIPOS_PILOT_DEPLOYMENT.md`. Comparte `command ID`, venta, recibo, dispositivo, hardware o referencia KDS.

No recopiles contraseñas, PIN, tokens, cookies, secretos de gift cards, credenciales de base de datos ni claves.

## Responsabilidad

| Rol             | Acción                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Operador        | Detén la acción incierta. Conserva la referencia. Usa solo la recuperación que indique el producto.  |
| Owner o Manager | Verifica el usuario, la ubicación, el dispositivo, el turno y la aprobación.                         |
| Soporte técnico | Revisa health, diagnostics, audit, Recovery Center, workers, logs redactados y correlación.          |
| Todos           | Escala un resultado financiero incierto, un duplicado, una pérdida de datos o un cruce de autoridad. |

## Incidentes

Cada fila indica síntomas, comprobación, acción, prohibición y escalamiento.

| Incidente                     | Síntomas                     | Comprobación segura                        | Acción segura                                        | No hagas esto                                   | Escalamiento             |
| ----------------------------- | ---------------------------- | ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------- | ------------------------ |
| API no disponible             | POS y Dashboard sin servicio | `/health/live` y `/health/ready`           | conserva ventas elegibles offline; avisa soporte     | no reinicies cobros ambiguos                    | P0 si no se puede vender |
| Base de datos no disponible   | readiness `Unready`          | estado del contenedor y logs redactados    | detén mutaciones y aplica el runbook de restore      | no desactives RLS                               | P0 técnico               |
| Redis no disponible           | sesiones o tareas degradadas | health y `redis-cli ping` mediante runtime | reinicia Redis y confirma readiness                  | no uses Redis como verdad financiera            | P1/P0 según impacto      |
| Impresora offline             | no sale papel                | diagnóstico de hardware                    | corrige energía, papel y conexión; consulta comando  | no repitas la venta                             | P1                       |
| `UnknownOutcome` de impresión | falta confirmación           | referencia del comando                     | consulta el comando y usa COPY si corresponde        | no reenvíes a ciegas                            | P1                       |
| Escáner no disponible         | no lee código                | prueba del escáner                         | usa búsqueda manual y registra el incidente          | no inventes un código                           | P2                       |
| Cajón no disponible           | no abre                      | diagnóstico y hecho de efectivo            | usa el procedimiento físico autorizado               | no omitas el registro financiero                | P1                       |
| POS revocado                  | bootstrap denegado           | referencia del dispositivo                 | confirma la revocación y reinscribe si se autoriza   | no reutilices una credencial                    | P1                       |
| Operador bloqueado            | login denegado               | estado del usuario                         | Owner/Admin restaura el acceso                       | no compartas PIN                                | P1                       |
| KDS desconectado              | heartbeat ausente            | estado de estación                         | conserva el orden físico y reconecta                 | no cambies estados desde Dashboard              | P1                       |
| Conflicto de replay           | operación offline rechazada  | Centro de recuperación                     | consulta el original y resuelve la diferencia        | no borres el journal                            | P1                       |
| Respuesta perdida de refund   | resultado ambiguo            | `command ID` y venta                       | recupera el comando original                         | no repitas el refund                            | P0/P1                    |
| Conflicto de inventario       | versión obsoleta             | balance y conteo                           | recarga y concilia con un comando nuevo              | no sobrescribas el balance                      | P1                       |
| Ambigüedad de gift card       | saldo incierto               | referencia pública y comando               | consulta el resultado original                       | no expongas el código                           | P0/P1                    |
| Cola de recuperación          | casos antiguos               | Centro de recuperación                     | procesa acciones permitidas por antigüedad           | no cierre casos sin evidencia                   | P1                       |
| Despliegue fallido            | servicio sin ready           | manifest, logs y estado                    | ejecuta rollback de aplicación compatible            | no marques la versión activa                    | P0 técnico               |
| Migración fallida             | script con salida no cero    | log y versión de esquema                   | detén el release y restaura si el incidente lo exige | no edites el historial                          | P0 técnico               |
| Respaldo fallido              | falta dump o checksum        | salida y destino                           | corrige destino y repite                             | no borres el último respaldo válido             | P1 técnico               |
| Restore requerido             | datos no disponibles         | decisión de incidente                      | detén servicios y sigue el runbook de restore        | no restaures sobre desarrollo o una base activa | P0 técnico               |

## Respaldo y restore

Rol: `TECHNICAL ADMIN / SUPPORT`.

Para un respaldo, ejecuta `pnpm umipos:pilot:backup`. Confirma el dump, el metadata y el SHA-256. Copia el conjunto a un destino persistente autorizado. Escala una salida distinta de cero.

Para un restore, detén los servicios de aplicación. Provisiona una base aislada. Ejecuta el procedimiento de [respaldo y restore](../deployment/UMIPOS_BACKUP_RESTORE.md). Verifica el esquema, RLS, el smoke y los hechos clave antes de activar.

## Release y upgrade

1. Recibe el release manifest.
2. Ejecuta el precheck.
3. Crea un respaldo.
4. Verifica los checksums, el commit y los contratos.
5. Despliega y aplica las migraciones.
6. Ejecuta el smoke.
7. Activa el release o ejecuta el rollback compatible.

Registra las versiones de API, Dashboard, POS, KDS, contrato y esquema. No reemplaces un binario sin manifest y checksum.
