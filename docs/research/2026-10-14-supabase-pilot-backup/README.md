# Respaldo de Supabase para el piloto ONCA

Fecha: 2026-10-14. Alcance: elegir una herramienta y un método. Esta investigación no ejecutó un respaldo ni cambió producción.

## Decisión y herramienta

**Inferencia para Umi:** usa `pg_dump` y `pg_restore` de **PostgreSQL 17**. Guarda un archivo completo en formato personalizado (`-Fc`). Restaura sólo `umi`, `merchant`, `runtime` y `kds` en una base PostgreSQL 17 aislada para ensayar las migraciones. Conserva el archivo completo como respaldo; la copia parcial sólo sirve para el ensayo de la aplicación.

**Hecho documentado:** `pg_dump` crea un respaldo consistente mientras la base sigue en uso. El formato personalizado permite inspeccionar y seleccionar objetos con `pg_restore`. El archivo no incluye roles ni otros objetos globales del clúster. Fuentes: [PostgreSQL 17: `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html), [PostgreSQL 17: `pg_dumpall`](https://www.postgresql.org/docs/17/app-pg-dumpall.html).

**Hecho documentado:** Supabase recomienda conexión directa para `pg_dump`. La conexión de sesión por el pooler, en puerto 5432, es la alternativa para una red sólo IPv4. La [guía de copia de Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) usa ese pooler por defecto. El puerto 6543 corresponde al modo transacción y no es el elegido para este trabajo. Fuentes: [conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres), [copia y restauración](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

| Herramienta              | Versión observada en esta estación              | Licencia y mantenimiento                                                                                                                                                                     | Costo de adopción y límite                                                                                                                                                                                                                                                                   |
| ------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pg_dump` / `pg_restore` | 18.6 en el host; 17.10 en el contenedor elegido | [Licencia PostgreSQL](https://www.postgresql.org/about/licence/), sin cuota de licencia. La [rama 17 tiene soporte hasta noviembre de 2029](https://www.postgresql.org/support/versioning/). | Requiere cliente 17, espacio protegido para el archivo y ensayo de restauración. `pg_dump` guarda una base, pero no los roles globales.                                                                                                                                                      |
| Supabase CLI `db dump`   | 2.121.0                                         | [MIT, repositorio oficial activo](https://github.com/supabase/cli).                                                                                                                          | Requiere Docker para esta orden. El [comando excluye esquemas administrados](https://supabase.com/docs/reference/cli/global-flags), incluidos `auth` y `storage`; además, el uso por defecto omite datos y roles. No sirve como **único** archivo para afirmar que se respaldó toda la base. |

**Decisión sustentada por fuente:** usa un cliente `pg_dump` 17.x aunque la estación tenga 18.6. PostgreSQL permite extraer desde servidores anteriores, pero **no garantiza** que un archivo generado por una versión mayor se restaure en una menor. El servidor y el destino del ensayo son PostgreSQL 17. Fuente: [compatibilidad de `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html). Comprueba la versión real del binario antes de ejecutar el respaldo. No se fijó una versión menor de 17: usa una versión 17 mantenida que esté disponible y registra la versión exacta.

## Método propuesto

1. Crea un archivo de contraseña fuera del repositorio. Limita su permiso a `0600` y usa `PGPASSFILE`. No pases la contraseña ni una URL con contraseña como argumento. PostgreSQL documenta el formato del archivo y exige permisos privados en Unix: [archivo de contraseña](https://www.postgresql.org/docs/17/libpq-pgpass.html). Su documentación desaconseja `PGPASSWORD` porque algunos sistemas exponen el entorno del proceso: [variables de libpq](https://www.postgresql.org/docs/17/libpq-envars.html).
2. Usa la dirección exacta del panel **Connect**. No deduzcas el host del nombre de la región. Usa la conexión directa si hay IPv6. En una red sólo IPv4, usa la conexión de sesión en 5432 y el nombre de usuario completo que entrega el panel. Fuente: [conexiones de Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
3. Usa `sslmode=verify-full` con el certificado CA de la base. Supabase documenta cómo descargarlo. `require` cifra el transporte, pero no verifica el nombre del servidor. Fuente: [SSL de Supabase](https://supabase.com/docs/guides/platform/ssl-enforcement).
4. Ejecuta `pg_dump` 17.x sin filtro de esquemas ni de datos. Guarda el archivo con permisos privados, fuera del repositorio y de los directorios servidos por el VPS. Revisa el código de salida y **todos** los avisos. El archivo contiene datos reales y puede contener secretos.
5. Ejecuta `pg_restore --list` para comprobar que el archivo se puede leer. Esto comprueba el índice del archivo, no la restauración. Calcula una huella SHA-256 para detectar cambios posteriores.
6. Crea una base nueva y aislada en PostgreSQL 17. Inspecciona el índice y prepara las extensiones o funciones externas que necesiten los esquemas de Umi. Restaura `umi`, `merchant`, `runtime` y `kds` con `--no-owner --no-acl --single-transaction`. Si falla una dependencia, registra el error y prepara el requisito en el destino; no omitas la tabla ni el error.
7. Comprueba que la restauración terminó sin errores. Compara tablas, restricciones, políticas RLS, secuencias y conteos relevantes con producción. Usa el `99_verify.sql` del proyecto y la puerta de seguridad en la copia. Una comparación de conteos en momentos distintos puede variar si producción recibe escrituras.
8. Ejecuta las migraciones previstas **dos veces** en esa copia y comprueba el resultado. Mantén sin cambios la base de staging que ya opera. Elimina la copia de ensayo sólo después de registrar el resultado y conforme a la política de retención del piloto.

Patrón de comandos, con valores de entorno preparados fuera del repositorio. No se ejecutó en esta investigación:

```sh
pg_dump --version                         # Debe indicar 17.x.
PGPASSFILE="$SOURCE_PASSFILE" PGSSLMODE=verify-full PGSSLROOTCERT="$SOURCE_CA" \
  pg_dump -h "$SOURCE_HOST" -p 5432 -U "$SOURCE_USER" -d postgres \
  -Fc -f "$PRIVATE_BACKUP_DIR/prod-before-onca.dump"

pg_restore --list "$PRIVATE_BACKUP_DIR/prod-before-onca.dump" > "$PRIVATE_BACKUP_DIR/prod-before-onca.toc"
sha256sum "$PRIVATE_BACKUP_DIR/prod-before-onca.dump" > "$PRIVATE_BACKUP_DIR/prod-before-onca.sha256"

# Crear antes una base vacía desde template0 y preparar sus dependencias.
pg_restore -d "$ISOLATED_PG17_DATABASE" -n umi -n merchant -n runtime -n kds \
  --no-owner --no-acl --single-transaction --verbose \
  "$PRIVATE_BACKUP_DIR/prod-before-onca.dump"
```

**Hecho documentado:** `--single-transaction` hace que el restore termine completo o revierta sus cambios; implica detenerse ante un error. Los filtros `-n` seleccionan esquemas, pero una restauración parcial puede necesitar objetos externos. Fuentes: [opciones de `pg_restore`](https://www.postgresql.org/docs/17/app-pgrestore.html), [límite de los filtros de `pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html).

## Qué prueba el ensayo

**Inferencia para Umi:** la copia de esquemas de la aplicación permite medir el salto de esquema y datos **reales** de producción antes de modificarla. La base actual de staging no sustituye ese ensayo si su esquema o sus filas difieren.

**Límite documentado:** el respaldo lógico de la base no incluye los objetos binarios de Supabase Storage; incluye sólo sus metadatos. `pg_dump` tampoco guarda roles globales. Una copia parcial en PostgreSQL local no demuestra que toda la plataforma Supabase se pueda recuperar. Fuentes: [respaldos de Supabase](https://supabase.com/docs/guides/platform/backups), [`pg_dumpall`](https://www.postgresql.org/docs/17/app-pg-dumpall.html).

**NO VERIFICADO:** conexión con el rol `postgres`, lectura de todos los esquemas, tamaño del archivo, dependencias concretas, restauración completa de Supabase y resultado de las migraciones. La ejecución debe registrar esos resultados antes del cambio de producción. Si `pg_dump` falla o informa un objeto ilegible, el archivo no constituye un respaldo completo.

## Fuentes y nivel de investigación

Se usó el nivel 1: documentación oficial de [PostgreSQL](https://www.postgresql.org/docs/17/) y [Supabase](https://supabase.com/docs). Para licencia y mantenimiento de Supabase CLI se usó el [repositorio oficial](https://github.com/supabase/cli), nivel 3. No hizo falta una fuente secundaria. La selección de PostgreSQL 17, el archivo completo y la copia parcial para ensayo son inferencias de Umi a partir de esas fuentes.
