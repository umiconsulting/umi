# ONCA: descarte de comandas canceladas en Cocina

## Estado

El diagnóstico vincula la ausencia del botón con una sesión de Mesero, sin permiso de descarte.
La evidencia no justifica cambiar permisos ni código.
La última aclaración del propietario identifica la tablet Cocina. El operador del intento fallido falta por confirmar.
El propietario confirmó que Administrador canceló las comandas.
La cancelación comercial y el descarte visual usan operaciones y permisos distintos.
El rol que cancela la cuenta no determina el operador que después consulta el KDS.
No ejecutamos descartes, cambios de sesión ni cambios de configuración en producción.

Los roles KDS tienen el permiso correcto.
La foto del fallo coincide con sesiones de Mesero en Cocina, sin `kitchen.cancel_ack`.
Esto explica que el botón no aparezca. La identidad exacta del operador requiere confirmación del propietario.

## Identidad y alcance

- Worktree: `/private/tmp/umi-onca-kds-cancel-ack-20261102`.
- Rama: `fix/onca-kds-cancel-ack-20261102`.
- Base: `origin/main`, `dea2dfc7`.
- Host de soporte: `juan-PC`, machine-id `97d302e7018b42eb80e9a56e78dab7b6`.
- Huella SSH aprobada: `SHA256:JNZVk8Jse74VgShkRlHZhdWUmZ+M+Ha6iSaXlB07KaE`.
- La API de producción declara `75680bb252fbe3079b98338a5ca737cca19f04e7`.
- La fuente del APK 335 es `da664d424dcde754a6f24c6cc84cfb2c056aad1f`.

Las consultas usaron el contenedor `umi-api-umi-api-1` en el VPS autorizado.
Cada consulta de datos abrió `BEGIN READ ONLY` y terminó con `ROLLBACK`.
El proceso usó las variables internas del contenedor. Ninguna salida contiene credenciales.

## Evidencia de permisos

Consulta del 2 de noviembre de 2026, `19:24:35 UTC` (`12:24:35`, Mazatlán):

| Fuente                                            | Resultado                                         |
| ------------------------------------------------- | ------------------------------------------------- |
| `merchant.role`, clave `onca-kds`                 | Activo, revisión 1                                |
| `merchant.role_permission`                        | Siete permisos KDS, incluido `kitchen.cancel_ack` |
| Empleados del rol                                 | Barista, Cocinero 1 y Cocinero 2                  |
| Sesión activa de Barista                          | Equipo `Samsung A9 Barra`; inició `17:58:52 UTC`  |
| `runtime.operator_session.permissions` de Barista | Contiene los mismos siete permisos                |
| `umi.resolve_staff_permissions` de Barista        | Coincide con la sesión activa                     |

El conjunto exacto es:

```text
kitchen.cancel_ack
kitchen.complete
kitchen.prepare
kitchen.read
kitchen.ready
kitchen.recall
kitchen.station.read
```

El rol carece de `offline.replay`, permisos de cobro y permisos administrativos.
Esta ausencia no prueba el incidente. No agregamos `offline.replay`.
Tampoco aplicamos una migración nueva ni editamos la migración histórica 039.

## Comandos y registros

El registro `merchant.kitchen_command` contiene dos descartes correctos del administrador a las `18:53:57 UTC`:

| Comanda                                | Comando                                | Correlación del comando                | Resultado              |
| -------------------------------------- | -------------------------------------- | -------------------------------------- | ---------------------- |
| `e28745e3-4e13-4e2b-aa4e-1a4485973081` | `8ce4ae90-223e-4e5f-8ad3-138bd4fefe30` | `ceb6b733-da4c-4dd2-a6b5-d89c0da5efb5` | `succeeded`, versión 4 |
| `a1a3e8b0-a3b1-4ecd-aaaa-0273b239f396` | `d07cfabe-b343-4f9e-99cd-0faf4c336de1` | `863434a0-c9ce-4d82-9dcf-7157fd30b75c` | `succeeded`, versión 3 |

La consulta de cuatro días no encontró otro `cancel_ack` ni un comando KDS fallido.
Tampoco encontró `pos.kds.command` en `merchant.offline_replay_command` durante ese periodo.
Los registros de seis horas muestran HTTP 201 para los POST de `/kitchen/command` de hoy.
No encontramos un rechazo de descarte de un operador KDS en esos registros.
La ausencia de registros no demuestra que el botón funcionó en la tablet.

La historia de Cocina contiene estas sesiones:

| Inicio UTC    | Operador de Cocina | `kitchen.cancel_ack` |
| ------------- | ------------------ | -------------------- |
| 2/nov, 16:08  | Mesero 1           | No                   |
| 2/nov, 18:16  | Mesero 1           | No                   |
| 2/nov, 18:37  | Mesero 2           | No                   |
| 2/nov, 18:53  | Admin ONCA         | Sí                   |
| 27/oct, 00:58 | Cocinero 1         | Sí                   |

Estos datos identifican las sesiones. No prueban qué PIN intentó usar una persona.

## Foto del fallo

El propietario proporcionó una foto con hora `11:37`, del lunes 2 de noviembre.
La foto muestra el filtro `Cocina de pizzas` y estas comandas:

| Comanda visible    | ID de la base                          | Entrada UTC | Edad compatible con la foto |
| ------------------ | -------------------------------------- | ----------- | --------------------------- |
| Cuenta 001 · Cofea | `e28745e3-4e13-4e2b-aa4e-1a4485973081` | `16:10:48`  | 2 h 26 min                  |
| Cuenta 014         | `a1a3e8b0-a3b1-4ecd-aaaa-0273b239f396` | `18:36:09`  | 1 min                       |

Ambas muestran `Cancelado` y un producto anulado. Ninguna muestra Descartar.
La consulta de la base confirma la estación y los productos de ambas comandas.
La Cuenta 014 contiene Margarita. La Cuenta 001 contiene Tocino con queso de cabra.
Son los mismos tickets que descartó el administrador a las `11:53`, hora local.

La hora de la foto corresponde a `18:37 UTC`.
Mesero 1 terminó su sesión de Cocina a las `18:37:29 UTC`.
Mesero 2 inició su sesión a las `18:37:33 UTC`.
Ambos tienen el rol `waiter`, sin `kitchen.cancel_ack`.
El minuto de la foto no permite distinguir cuál de esas dos sesiones estaba activa.

La diferencia entre el estado de estación y el estado global no explica esta foto:

- Ambos carritos comerciales tienen `status='abandoned'` y `lifecycle_state='cancelled'`.
- `boardSnapshot` proyecta esa cancelación comercial como `order.status='cancelled'`.
- La UI añade `Pedido completo: ...` cuando el estado global difiere del estado de estación.
- La foto no muestra esa leyenda entre la cabecera y `Tiempo 1`.

La explicación respaldada es la falta de autoridad de descarte del operador Mesero.
Cambiar ese permiso para todo el rol ampliaría su autoridad y no corregiría una sesión equivocada.
Usar una sesión de Cocinero ya dispone de la autoridad KDS prevista, sin administrador.
No cambiamos el operador de producción para comprobarlo.

## Revisión del código instalado

No hay diferencias entre el APK 335 y `origin/main` en estos archivos:

- `apps/umi-pos/lib/features/kitchen/kitchen_board_surface.dart`.
- `apps/umi-pos/lib/features/kitchen/kitchen_board_controller.dart`.
- `apps/umi-pos/lib/features/kitchen/kitchen_status_repository.dart`.
- `apps/umi-pos/lib/core/security/operator_permissions.dart`.

`_TicketActions` muestra Descartar cuando el estado es `cancelled` y el operador tiene `kitchen.cancel_ack`.
El controlador envía `cancel_ack` con los identificadores de los productos visibles de la estación.
La API exige ese mismo permiso y conserva los límites de comercio, local y estación.
La API de producción y `origin/main` tampoco difieren en `kds-pos.controller.ts`, `kds.service.ts` ni `kds.repository.ts`.

`EntryController` conserva un snapshot del operador para el arranque sin conexión.
La consulta del servidor no permite leer ese snapshot local de la tablet.
Una diferencia local es una hipótesis pendiente, no una causa confirmada.

## Verificación local

Herramientas: Vitest `2.1.9`, PostgreSQL `17.11`, Flutter `3.47.5`, Dart `3.13.4`.
Usamos las pruebas del repositorio y el playbook `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`.
Las dependencias JavaScript compartidas se usaron mediante enlaces locales temporales.
No cambiamos las dependencias del checkout principal.

Prueba de servicio:

```sh
cd apps/umi-api
node_modules/.bin/vitest run src/modules/kds/kds.service.spec.ts
```

Resultado: 74 pruebas correctas.

Pruebas de interfaz:

```sh
cd apps/umi-pos
/private/tmp/onca-flutter-sdk-3.47.5/bin/flutter test --no-pub \
  test/features/kitchen/kitchen_board_test.dart \
  --plain-name 'cancelled tickets only offer discard and never item preparation'
/private/tmp/onca-flutter-sdk-3.47.5/bin/flutter test --no-pub \
  test/features/kitchen/kitchen_board_test.dart \
  --plain-name 'discard requires kitchen.cancel_ack'
```

Resultado: ambas pruebas correctas.
La primera usa permisos KDS sin administrador. El botón envía `cancel_ack` y no permite preparar productos cancelados.
La segunda oculta el botón cuando falta `kitchen.cancel_ack`.

Pruebas de PostgreSQL:

```sh
cd apps/umi-api
DATABASE_URL_WORKER=postgresql://moon@127.0.0.1:55435/umi_onca_kds_cancel_ack_20261102 \
  node_modules/.bin/vitest run --config vitest.onca-local.config.ts \
  src/modules/kds/kitchen-station-actions.integration.ts \
  src/modules/kds/kitchen-unassigned.integration.ts
```

Resultado: 17 pruebas correctas y dos omitidas por la suite existente.
La base es una copia local aislada de `umi_inventory_phase2_verify`.
Las pruebas cubren el descarte por estación, los duplicados, los estados activos y los límites de autorización.
La configuración local sólo dirige `@umi/contract` a `../../packages/contract/src/index.ts`.
Esto evita usar el `dist` desactualizado del checkout principal.
La configuración temporal permanece en el worktree, fuera del commit.

El primer intento usó ese `dist` desactualizado y produjo nueve errores de contrato `fulfillmentType`.
Con el contrato fuente del worktree, esos errores desaparecen sin cambiar código de producción.
La prueba histórica de la migración 039 también falla en esta copia por `cashier.order.fire`, agregado por otra migración.
Ese fallo previo no corresponde al permiso KDS. No lo modificamos.

No existe una reproducción roja del síntoma reportado.
Estas pruebas comprueban el comportamiento existente; no prueban que el incidente real esté corregido.

### Exploración del contrato heredado

Una prueba exploratoria exigió rechazar `cancel_ack` de un ticket activo directamente en el repositorio.
El repositorio también atiende el contrato heredado `action='partial_cancel_items'`, que permite esa cancelación parcial.
El resultado rojo de esa prueba no demuestra un defecto ni una vulnerabilidad.
Ese contrato difiere del retiro de una proyección que ya tiene una cancelación comercial autoritativa.
Un rechazo general cambiaría la compatibilidad del contrato.
Retiramos la prueba exploratoria del worktree y conservamos su parche fuera del repositorio:
`/private/tmp/onca-kds-active-ack-exploration-20261102.patch`.
No cambiamos el contrato ni ejecutamos la exploración en producción.

## Observación de Cocina

ADB funciona en `100.125.137.36:41251`.
A las `12:32`, hora de Mazatlán, Cocina mostró KeepADB en primer plano.
Trajimos al frente la tarea existente de UmiPOS. Android confirmó que no inició otra actividad.
UmiPOS mostró `Ingresa tu PIN de operador`, con campos vacíos.
No introdujimos PIN ni pulsamos controles de comandas.
La captura está en `/private/tmp/onca-kds-cocina-20261102.png`, fuera del repositorio.
El logcat filtrado no devolvió eventos KDS ni errores de permisos.

La pantalla de PIN impide identificar visualmente el operador y el ticket que fallaron.
El propietario aclaró después que retiraron las canceladas con Admin y que ya no hay canceladas visibles.
La consulta del registro confirma esos dos descartes correctos.
La verificación del flujo real queda pendiente hasta que exista otro caso seguro con un perfil KDS.

## Límite adicional de Barra

KeepADB publicó `100.90.102.41:32891` el 31 de octubre a las `15:55:09 UTC`.
El registro todavía marca ese endpoint como activo.
Un intento de `adb connect` al endpoint publicado respondió `Connection refused`.
No exploramos otros puertos.
Caja, Cocina y Mesero aparecen conectados por ADB; Barra no aparece.
La flota no está sana.

## Próximos pasos

1. Verifica que Cocina use el perfil KDS previsto, como Cocinero 1 o Cocinero 2.
2. Cuando exista una comanda cancelada segura, confirma que aparece Descartar con ese perfil.
3. Conserva la identidad del operador, la comanda y la hora antes de cualquier acción.
4. Repite el descarte sólo con autorización para ese caso y comprueba el alcance por estación.
5. Si el botón falta con un perfil KDS, contrasta el estado local con la sesión del servidor.
6. Si hay un error, conserva su código y correlación antes de proponer código o permisos.

No se necesita un PR de código ni un despliegue con la evidencia actual.
Una corrección futura de código requiere una prueba roja concreta y revisión de PR antes de merge o producción.

La recuperación de ADB en Barra es independiente de este paso.
Para Barra, pide que abran KeepADB y la depuración inalámbrica hasta recibir un endpoint vigente.

No hay despliegue ni rollback de código que ejecutar en esta fase.
No modifiques permisos, sesiones, ventas ni comandas para cerrar el incidente por suposición.
