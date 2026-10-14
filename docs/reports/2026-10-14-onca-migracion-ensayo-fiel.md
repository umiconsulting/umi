# Ensayo fiel de la migración de ONCA sobre una copia de producción — 14 de octubre de 2026

Estado: **ensayo completo y en verde; producción sigue intacta**. Este informe cierra el hueco que quedó abierto en [la preparación del piloto](./2026-10-14-onca-release-readiness.md): el respaldo anterior se generó **sin permisos** y el ensayo restauraba sin privilegios, así que no probaba la puerta de seguridad.

## Qué se hizo

### 1. Respaldo nuevo, con permisos y con TLS verificado

El respaldo previo (`umi-prod-20261014T195330Z-full.dump`) se generó sin ACL: `pg_restore --list` muestra **0 entradas de permisos**. Sin ellas la copia no reproduce quién puede leer o escribir cada objeto, que es justamente lo que vigila la puerta de seguridad.

| Artefacto         | Archivo                                             | Tamaño     | SHA-256                                                            |
| ----------------- | --------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Respaldo completo | `umi-prod-20261014T201547Z-full.dump`               | 23 203 317 | `90e89d157a541923cc35fd1d84f4d820682d62df0f187cfcd16510b6c993741b` |
| Roles globales    | `umi-prod-20261014T201849Z-globals-nopasswords.sql` | 8 735      | `88d7809005be3e231a413d99f447fb9fe7116e28c56964b9a167f8d881519a7f` |

- `pg_dump` / `pg_restore` **17.10** contra el servidor **PostgreSQL 17.6**; formato personalizado; 2 min 09 s.
- Verificación: el índice lista **953 entradas de ACL** (323 en `umi`, `merchant`, `runtime` y `kds`), y una descompresión completa (`pg_restore -f /dev/null`) terminó sin errores.
- Los roles globales se volvieron a dump-ear con `--no-role-passwords`, para no dejar hashes de contraseña en un archivo de trabajo.
- La conexión usó **`sslmode=verify-full`**. El certificado raíz se obtuvo capturando la cadena que presenta el pooler (`Supabase Root 2021 CA`, autofirmado, SHA-256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`) y quedó guardado fuera del repositorio en `~/.config/umi/supabase-prod-ca.crt`. Esto cierra la limitación que el ensayo anterior declaraba como “`require` sin verificar identidad”.
- Los dos archivos se copiaron al VPS (`/home/juan/umi-backups/`) y la huella se verificó **en ambos equipos** con `sha256sum -c`.

### 2. Restauración aislada, ahora con privilegios

Base nueva en el contenedor PostgreSQL de pruebas del VPS: **`umi_prod_rehearsal_acl_20261014`**. No se tocó ni producción ni `umi_staging`.

- Restauración con ACL: `pg_restore -n umi -n merchant -n runtime -n kds --no-owner --single-transaction`. Resultado: **0 errores, 0 avisos**, **316 ACL creadas**.
- Antes de restaurar se crearon los esquemas, las extensiones (`pgcrypto`, `uuid-ossp`, `pg_trgm`, `unaccent`, `btree_gist`, `vector`) y las **18 funciones de `public`** de las que dependen los triggers de la aplicación. `public.tg_touch_updated_at` es la que faltaba y detuvo el primer intento.

Verificación contra producción:

| Comprobación        | Resultado                                                |
| ------------------- | -------------------------------------------------------- |
| Filas por tabla     | **Idénticas**: 194 tablas, 20 441 filas, `diff` vacío.   |
| Permisos por objeto | **Idénticos** salvo 4 entradas equivalentes (ver abajo). |
| Esquemas            | `umi`, `merchant`, `runtime`, `kds` restaurados.         |

Las 4 diferencias de permisos son dos vistas y dos tablas cuyo ACL en producción es exactamente el del dueño (`{postgres=arwdDxtm/postgres}`), con `postgres` como dueño: PostgreSQL guarda ese ACL materializado y `pg_dump` no lo emite porque equivale al valor por defecto, así que al restaurar queda `NULL`. El privilegio efectivo es el mismo.

Limitación del método, comprobada y corregida: **el `pg_restore` filtrado por esquema no aplica los ACL de nivel esquema**. Hubo que ejecutar a mano los cuatro `grant usage` (`kds` a `worker, readonly`; `merchant`, `runtime` y `umi` a `api, worker, readonly`) para que la copia reflejara a producción. Queda anotado porque es una trampa que se repetiría en cualquier copia parcial futura.

### 3. Migraciones aplicadas dos veces, con el ejecutor del CI

Sobre la copia poblada, los 40 archivos de `docs/migration/build-v3/migrations/` (`001`–`040`) en orden, con `psql -v ON_ERROR_STOP=1` y `--single-transaction` sólo para `038`, **idéntico a `.github/workflows/umi-api-ci.yml`**. Dos pasadas completas sin fallos: la segunda prueba la regla de re-ejecución.

Efecto sobre los datos reales: ONCA pasó de no existir a existir con su catálogo (**6 comercios, 187 productos, 5 sucursales**), sin tocar los otros cinco comercios.

### 4. Instrumentos del repositorio

- `99_verify.sql`: `build-v3 verify: OK` (22 tablas base en `umi`, 149 en `merchant`, 28 en `runtime`).
- `security_gate.sql`: **SECURITY GATE PASSED — 47 comprobaciones estructurales en verde, 1 brecha reconocida (MFA), 1 no medible en este destino (logins scrypt)**. La puerta conductual, ejecutada como el rol `api`, también pasó: alcance vacío sin error, sin fugas entre comercios.
  - El único `FAIL` inicial fue un artefacto del ensayo: el esquema `extensions` se había creado a mano sin permisos. Se replicó el ACL de producción (`api`, `worker` y `readonly` con `USAGE`, sin `CREATE`) y la puerta quedó en verde.

### 5. Folio diario (038) sobre datos reales

La prueba [038_folio_diario_rehearsal.sql](./evidence/2026-10-14-prod-migration-rehearsal/038_folio_diario_rehearsal.sql) corre con un fixture sintético que termina en `ROLLBACK`, usando la zona y el corte reales de ONCA:

| Caso                                      | Resultado                                                   |
| ----------------------------------------- | ----------------------------------------------------------- |
| Dos cuentas del mismo día                 | 001, 002                                                    |
| Cuenta antes del corte de las 04:00       | Sigue en el día anterior, 003                               |
| Primera cuenta del día nuevo              | 001                                                         |
| Cuenta abierta que cruza el cambio de día | Conserva folio 002 y su estado; el día nuevo arranca en 001 |
| Contador en 999                           | 1000, sin cortar el folio                                   |

La copia quedó limpia después: 0 cuentas, 0 contadores y ningún registro sintético.

Hallazgo de modelo que salió al escribir el fixture: `pos_cart_active_operator_uidx` permite **una sola cuenta activa por (comercio, sucursal, operador)**. No es un defecto, pero conviene tenerlo presente al probar cobros simultáneos de la misma persona.

## Lo que sigue sin verificar

- Producción no se ha modificado: **no se aplicaron las migraciones ni se publicó la API nueva**.
- La copia no incluye los esquemas administrados por Supabase (`auth`, `storage`, `vault`) ni los roles de su API (`anon`, `authenticated`, `service_role`), que no existen en el clúster de pruebas; los ACL que los mencionan no se ejercieron.
- `pg_dump` no incluye los objetos binarios de Storage ni los roles globales (van en archivo aparte).
- ONCA no existe todavía en producción, no hay cuentas de puesto ni APK de producción instalado, y no se hizo ninguna venta real.
- La contraseña de `postgres` que se compartió por chat **debe rotarse**; el archivo de roles con hashes (`umi-prod-20261014T195330Z-globals.sql`) debe destruirse al hacerlo.

## Secuencia para publicar

1. Fijar una revisión de Git verificable y correr las suites de API, contrato, Dashboard y POS sobre ella. (El árbol sigue compartido con más de 600 archivos modificados.)
2. Aplicar `001`–`040` en Supabase con el mismo ejecutor del CI y comprobar `/health/ready`, `/health/release` y logs de API y trabajador.
3. Crear ONCA en producción desde `002` (sin ventas de prueba), configurar cobro, impuestos, recibos, caja, plano, estaciones y la credencial FCM del trabajador.
4. Crear las siete cuentas de puesto (Admin 1111, Cajero 2222, Mesero 3333/4444, Barista 5555, Cocinero 6666/7777) y probar cada PIN.
5. Compilar un único APK `release` de producción (HTTPS, firma estable, Firebase de producción), reinstalar las tres terminales y hacer una venta controlada: pago, ticket, cajón, KDS y aviso al mesero.

## Herramientas y versiones

| Herramienta                 | Versión           | Motivo                                                                                                    |
| --------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------- |
| `pg_dump` / `pg_restore`    | 17.10             | Cliente 17 para no restaurar con versión mayor a la del servidor 17.6.                                    |
| Docker                      | —                 | Ejecuta el cliente 17 y aísla credenciales por montaje de archivo privado.                                |
| OpenSSL / Python 3.14       | 3.6.5             | Captura de la cadena del pooler para fijar la CA (el pooler no habla TLS sin el protocolo de PostgreSQL). |
| Supabase CLI / Firebase CLI | 2.121.0 / 15.33.0 | Proyectos y respaldos administrados; proyectos Firebase por entorno.                                      |

## Evidencia

Todo en [`docs/reports/evidence/2026-10-14-prod-migration-rehearsal/`](./evidence/2026-10-14-prod-migration-rehearsal/):

- `migrations-pass1.log`, `migrations-pass2-y-puertas.log`: las dos pasadas y los instrumentos.
- `security-gate.log`: salida completa de la puerta.
- `conteos-produccion.txt` y `conteos-ensayo.txt`: conteos por tabla (idénticos).
- `privilegios-produccion.txt`, `privilegios-ensayo.txt` y `privilegios.diff`: comparación de permisos.
- `038_folio_diario_rehearsal.sql`: la prueba del folio diario.
