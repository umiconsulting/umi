# Preparación del piloto real de ONCA — 14 de octubre de 2026

Estado: **despliegue pendiente de verificación técnica**. La API y la base de producción siguen en la versión anterior. Las tres terminales conservan el APK de desarrollo 129. Este informe registra las comprobaciones y los pasos que faltan.

> **Actualización del 14 de octubre, 20:30 UTC.** El ensayo que faltaba ya se hizo y está en verde: respaldo nuevo **con permisos**, restauración sobre una copia aislada de producción con **filas y privilegios idénticos**, migraciones `001`–`040` aplicadas **dos veces**, `99_verify.sql` en OK, `security_gate.sql` **PASSED** y el folio diario probado contra datos reales. Detalle en [el informe del ensayo fiel](./2026-10-14-onca-migracion-ensayo-fiel.md). Producción sigue intacta: lo que resta es el paso 3 en adelante de la secuencia de publicación.

## Decisión de entorno

ONCA debe operar contra la API de producción y su base de Supabase. Staging contiene ventas y cuentas de ensayo. No se debe usar esa base para ventas reales. El ensayo de migraciones se hace en una copia aislada antes del cambio de producción. Esta separación sigue las guías de [Supabase](https://supabase.com/docs/guides/deployment/managing-environments) y [Firebase](https://firebase.google.com/docs/projects/dev-workflows/overview-environments).

## Estado comprobado

| Componente            | Evidencia                                                                                                                    | Consecuencia                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| VPS de producción     | SSH como `juan`; API viva en `https://api.umiconsulting.co`; contrato `2.23.0`                                               | Hay acceso de lectura y operación al VPS.                                                        |
| Base de producción    | PostgreSQL 17.6; `runtime.schema_migration=build-v3-79`; ONCA ausente; faltan objetos de 004–038                             | El código local de contrato `2.38.1` requiere migración y API nueva.                             |
| Respaldo administrado | `supabase backups list --project-ref xbudknbimkgjjgohnjgp --output-format json` devolvió `backups=[]` y `pitr_enabled=false` | Supabase no muestra un respaldo físico ni PITR para este proyecto.                               |
| Respaldo lógico       | `pg_dump` 17.10 terminó con código 0; `pg_restore --file=/dev/null` leyó el archivo completo                                 | Existe una copia actual protegida. Falta probar la restauración en la base aislada.              |
| Conexiones del VPS    | `DATABASE_URL_APP` usa `api_login`; `DATABASE_URL_WORKER` usa `worker_login`                                                 | Ninguna cuenta puede crear objetos. El trabajador sólo puede leer 192 de 194 tablas principales. |
| Staging               | Base separada con ONCA y datos de ensayo; esquema posterior a 004 incompleto                                                 | Sirve para un ensayo aislado. No sirve para cobrar.                                              |
| Android instalado     | Build 129 de desarrollo en iMin, A9 y A11; URL local y firma de depuración                                                   | Requiere un APK de producción, firma estable y nueva inscripción.                                |
| Código local          | Árbol compartido con más de 600 archivos modificados; API local `2.38.1`                                                     | Hay que fijar una revisión verificable antes de publicar.                                        |

La lista de Supabase sólo comprueba respaldos físicos visibles por su API. No demuestra que no exista otro respaldo externo. El último archivo de respaldo visto en el VPS es del 6 de octubre y no es una copia actual.

El archivo lógico nuevo está en `~/.local/share/umi/backups/umi-prod-20261014T195330Z-full.dump` y en `/home/juan/umi-backups/umi-prod-20261014T195330Z-full.dump` del VPS. Ambos tienen permiso `0600`, tamaño de 22 859 654 bytes y SHA-256 `7154768a823cc4ec22cccfe14d3091652cc9de8d5ffe0a5275946e64f38c1a83`. Un archivo separado, `umi-prod-20261014T195330Z-globals.sql`, conserva los roles globales. También tiene permiso `0600` en ambos equipos y SHA-256 `c2989d2525a24da10c4cd52751987d52ffb0bee41577b15f02f5d608b687fe09`. Puede contener hashes de contraseña y debe permanecer protegido.

La contraseña de conexión se leyó desde un archivo privado fuera del repositorio. La conexión usó TLS con `sslmode=require`; no verificó la identidad del servidor porque faltaba el certificado CA de Supabase. El volcado de PostgreSQL no incluye los objetos binarios de Supabase Storage. El [método y sus límites](../research/2026-10-14-supabase-pilot-backup/README.md) están documentados por separado.

## Trabajo hecho

- Se crearon los proyectos Firebase `umiconsulting-pos-staging` y `umiconsulting-pos-prod`. Cada proyecto tiene una app Android `co.umiconsulting.umi_pos.estacion`.
- Los archivos `google-services.json` de staging y producción están en las variantes Android. Gradle comprueba el proyecto esperado para cada variante.
- Android separa `development`, `staging` y `production`. El tipo `release` exige una llave externa; ya no usa la firma de depuración.
- La migración [039](../migration/build-v3/migrations/039_onca_production_readiness.sql) prepara la zona `America/Mazatlan`, el corte `04:00` y roles de ONCA. Se aplicó dos veces en `umi_local` sin duplicados. No crea personas, PIN ni pagos.
- Se clonó `umi_staging` en `umi_pilot_migration_rehearsal_20261014`. Las migraciones 005–039 pasaron en la copia. La 038 exigió `psql --single-transaction`. El ejecutor de CI ya usa esa opción para 038 en sus dos pasadas.
- El formulario de Equipo del Dashboard ahora acepta correo. Si se asigna un PIN, exige ese correo. El acceso por PIN necesita un correo en la API.
- Se decidió usar siete cuentas de puesto: Admin, Cajero, Mesero 1, Mesero 2, Barista, Cocinero 1 y Cocinero 2. No se crearon en producción.

La contraseña propuesta por el dueño coincide con la contraseña compartida de las pruebas locales. Se usará una invitación o un restablecimiento para fijar una contraseña privada de producción. Los PIN de puesto se asignarán en el alta real y no se registran en este archivo.

## Verificación

- POS: `flutter analyze` sin hallazgos y 996 pruebas aprobadas.
- Android: Gradle generó recursos Firebase correctos para los tres entornos. Rechazó el cruce de entornos y un release sin llave.
- Dashboard: ESLint y Prettier sin hallazgos; compilación Vite en modo development; 369 pruebas aprobadas.
- Dashboard real: un clic abrió «Añadir una persona». El formulario mostró el correo; el botón quedó inactivo con PIN sin correo y activo al escribir un correo válido. Se canceló sin crear una persona. [Captura](./evidence/2026-10-14-pilot-readiness/dashboard-staff-email.png).
- La prueba de la migración 039 ejecutó dos aplicaciones en una transacción con `ROLLBACK`. La aplicación local persistente se repitió sin error.
- La copia de staging conservó un comercio, 51 productos y cero cuentas POS. Pasó `99_verify.sql`. El origen no cambió.
- El respaldo actual de producción se leyó completo con `pg_restore --file=/dev/null`; la huella SHA-256 coincidió en la computadora y el VPS.

## Secuencia para publicar

1. Restaura el respaldo lógico actual en una copia aislada y verifica los datos. El rol del VPS no bastaba para crear el archivo.
2. Aplica 004–039 en la copia poblada. Verifica permisos, cuentas existentes y rutas de cocina.
3. Fija una revisión Git verificable. Ejecuta las suites de API, contrato, Dashboard y POS sobre esa revisión.
4. Aplica las migraciones de producción y publica API y trabajador con el mismo contrato. Comprueba `/health/ready`, `/health/release` y logs.
5. Crea ONCA con el catálogo sin ventas de prueba. Configura cobro, impuestos, recibos, caja, plano, estaciones y credenciales Firebase del trabajador. No habilites transferencia con datos bancarios inventados.
6. Crea las siete cuentas de puesto con identidades separadas. Inscribe la iMin, la A9 y la A11. Prueba cada PIN y permiso.
7. Compila un solo APK `release` de producción con HTTPS y firma estable. Reinstala las terminales después de revisar las colas locales. Prueba impresora, cajón, pago, ticket, KDS y aviso al mesero con una venta controlada.

## Herramientas y fundamento

| Herramienta                   | Versión             | Motivo y fuente                                                                                                         |
| ----------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Supabase CLI                  | 2.121.0             | Lista proyectos y respaldos; [documentación de Supabase](https://supabase.com/docs/guides/platform/backups).            |
| `pg_dump` / `pg_restore`      | 17.10 en contenedor | Copia lógica para PostgreSQL 17.6; [manual de PostgreSQL](https://www.postgresql.org/docs/17/app-pgdump.html).          |
| Firebase CLI                  | 15.33.0             | Crea los proyectos y registra las apps; [guía de Firebase CLI](https://firebase.google.com/docs/cli).                   |
| Google Services Gradle plugin | 4.5.0               | Lee un JSON por variante; [guía de Firebase](https://firebase.google.com/docs/android/google-services-plugin-and-file). |
| Flutter / Dart                | 3.47.5 / 3.13.4     | Analiza, prueba y compila Android; [guía de firma Flutter](https://docs.flutter.dev/deployment/android).                |
| Playwright                    | 1.62.1              | Conecta con Chromium por CDP para clics reales; [API de Playwright](https://playwright.dev/docs/api/class-browsertype). |

## Sin verificar

- ~~No se ha restaurado aún el respaldo de los esquemas de Umi.~~ **Resuelto el 14 de octubre**: restaurado con permisos en `umi_prod_rehearsal_acl_20261014`, con filas y privilegios idénticos a producción.
- No se probó una restauración completa de los servicios administrados de Supabase, los roles globales ni los archivos de Storage.
- ~~No se probó el llenado de folios diarios sobre cuentas abiertas.~~ **Resuelto el 14 de octubre**: probado en la copia de producción, incluida una cuenta abierta que cruza el cambio de día.
- ~~No se aplicaron 004–039...~~ **Ensayo resuelto**: `001`–`040` aplicadas dos veces sobre la copia de producción, con `99_verify.sql` en OK y la puerta de seguridad PASSED. **En producción siguen sin aplicarse.**
- No se crearon los siete accesos ni se probó su inicio de sesión en producción.
- No se configuró la credencial FCM del trabajador de producción ni se probó una notificación real.
- No se compiló ni instaló un APK de producción. No se hizo una venta real.
