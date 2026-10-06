# Ensayo de roles por comercio

Fecha: 2026-09-01  
Base de origen: `umi_transition_rehearsal_20260901`  
Base desechable: `umi_role_rehearsal_20260901`  
Migración: `docs/migration/build-v3/migrations/002_merchant_roles.sql`

## Resultado

La migración pasó el ensayo local.

- El ensayo conservó los cinco comercios.
- El ensayo conservó las ocho relaciones de personal.
- La migración creó siete plantillas de rol.
- La migración creó 35 roles activos de comercio.
- La migración creó 2,915 asignaciones de permiso.
- Cada persona recibió un `merchant_role_id`.
- Cada persona conservó el conjunto anterior de permisos.
- La segunda ejecución de la migración no produjo un error.

## Límites de seguridad

La prueba de RLS usó dos comercios diferentes.

- El contexto del comercio A leyó siete roles del comercio A.
- El contexto del comercio A no pudo insertar un rol para el comercio B.
- El rol `api` conservó `USAGE` sobre el esquema `merchant`.
- El rol `api` conservó `SELECT` e `INSERT` sobre `merchant.role`.

La función `umi.resolve_staff_permissions` usa primero el rol del comercio.
La función usa el rol global anterior solo como ruta de reversión.

## Validación de la aplicación

CodeGraph 1.5.0 indexó 1,072 archivos.
El índice produjo 20,855 nodos y 53,028 relaciones.

La revisión manual añadió el acceso directo de `pos-cash.repository.ts` al alcance.
Ese acceso ahora usa `umi.resolve_staff_permissions`.

Las siguientes pruebas pasaron:

- 30 pruebas enfocadas de API para roles, personal, entrada POS y caja POS.
- 14 pruebas del Dashboard.
- 60 pruebas del contrato.
- La compilación del contrato.
- La verificación de tipos de la API.
- La compilación de producción del Dashboard.

Firefox abrió `http://127.0.0.1:4000/staff` con Playwright.
La sesión leyó cinco comercios y seleccionó El Gran Ribera.
Las rutas de personal y roles respondieron con `200`.

La prueba de interfaz completó estas acciones:

1. Abrió `Roles y permisos`.
2. Leyó los siete roles activos desde PostgreSQL.
3. Creó un rol temporal.
4. Cambió el nombre del rol.
5. Guardó la revisión 2.
6. Archivó el rol temporal.
7. Confirmó que quedaron siete roles activos.
8. Confirmó que la consola no tuvo errores.
9. Confirmó una sola columna a 390 píxeles de ancho.

Firefox también abrió UmiPOS en `http://127.0.0.1:4002`.
La ruta `/health/release` respondió con `200` para ese origen.
UmiPOS pasó la verificación de versión y mostró el registro del dispositivo.
La consola del POS no tuvo errores.

Una sesión nueva de Firefox encontró una pantalla vacía con el servidor DDC.
Ese servidor cargó 621 módulos y no ejecutó `main.dart`.
El modo `release` eliminó DDC y mostró el registro en menos de ocho segundos.

La prueba usó una credencial temporal para el operador local.
La prueba restauró el hash, el algoritmo y el método MFA originales.

## Observación de base

`99_verify.sql` reporta el esquema `observability` como un esquema inesperado.
La base original reporta el mismo resultado antes de esta migración.
Este resultado pertenece a la base del ensayo.
No lo causó la migración de roles.
