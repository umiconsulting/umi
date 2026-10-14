# Cuenta liberada: actualización automática del aviso

Fecha: 2026-10-13. Entorno local ONCA. Build **0.1.0+91** instalado en iMin, A9 y A11.

> **Seguimiento al build 93:** esta medición del aviso permanece válida y forma parte del APK posterior instalado en las tres terminales. El [reporte KDS 93](2026-10-13-kds-completar-descartar.md) resolvió la cancelación comercial visible y el descarte de comandas con estación. El pendiente de cocina al final de este documento describe el estado del build 91; su parte todavía abierta son las excepciones sin estación. Consulta la [matriz actual del ciclo](2026-10-13-pendientes-del-ciclo.md).

## Resultado

El aviso de cuenta ocupada desaparece cuando el servidor confirma que el otro operador la liberó. El cajero puede permanecer en Cuentas.

La prueba real cerró la sesión de Mesero 2 en la A11. La iMin retiró el aviso sin recibir toques ni cambiar de pantalla.

La consulta se repite cada cinco segundos mientras existe ese conflicto. La latencia también depende de la respuesta de la API.

## Causa y cambio

El error observado era `CART_ACCOUNT_BUSY`, al intentar recuperar una cuenta. No era el rechazo de inicio de sesión `OPERATOR_SESSION_BUSY`.

El servidor liberaba la cuenta al guardar y cerrar sesión. El POS conservaba el texto del rechazo anterior hasta otra acción local.

- `Cart` incorpora `accountOwnerActive`, booleano opcional. La API lo calcula con la sesión activa, su vencimiento y el dispositivo activo.
- El cálculo usa la misma condición que protege la recuperación de cuentas. La lectura conserva el propietario y la versión.
- `CartController.readAccount` usa el GET existente de una cuenta. No recupera ni guarda el carrito.
- `OpenAccountsList` consulta solo la cuenta del conflicto visible. Actualiza su fila y su versión, conserva la búsqueda y evita solicitudes simultáneas.
- El temporizador se detiene al resolver el conflicto, desmontar la lista o pausar la aplicación. Descarta respuestas de otro conflicto.
- Un error de red conserva el aviso. Un propietario inactivo, una cuenta guardada o un cambio de propietario retira el aviso anterior.
- Una cuenta que ya no existe o está cerrada sale de la lista.

No se sondea `listAccounts`: esa consulta ejecuta el barrido de cuentas anteriores. Se reutiliza la lectura individual sin ese efecto.

No hubo migración ni dependencia nueva. Se regeneraron los modelos del contrato con `pnpm --filter @umi/contract build`.

## Herramientas y decisión previa

La [investigación previa](../research/2026-10-13-jornada-correcciones-herramientas.md) documenta fuentes, licencias, versiones y alternativas.

| Herramienta            | Versión            | Fuente que respalda el uso                                                                                                      |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Flutter / Flutter Test | 3.47.5             | [Pruebas oficiales](https://docs.flutter.dev/testing/overview) y playbook local.                                                |
| Dart / Timer           | 3.13.4             | [Timer](https://api.dart.dev/dart-async/Timer-class.html), para rearmar la consulta tras cada respuesta.                        |
| AppLifecycleListener   | SDK Flutter 3.47.5 | [Referencia oficial](https://api.flutter.dev/flutter/widgets/AppLifecycleListener-class.html), para pausar y cancelar lecturas. |
| Vitest                 | 2.1.9              | Configuración existente de la API; [fuente oficial](https://github.com/vitest-dev/vitest/tree/v2.1.9).                          |
| PostgreSQL / psql      | 17.10              | [Documentación oficial](https://www.postgresql.org/docs/17/) y contenedor existente.                                            |
| ADB                    | 37.0.0             | [Android Developers](https://developer.android.com/tools/adb); instalación y captura nativa.                                    |
| Playwright Test        | 1.62.1             | [Documentación oficial](https://playwright.dev/docs/intro); navegador CDP del playbook.                                         |
| Prettier               | 3.9.4              | Formateador del repositorio; markdown revisado con `npx prettier --write`.                                                      |

Node **24.21.0**, pnpm **10.29.3**. Se reutilizan herramientas instaladas; no se actualizó una dependencia.

**Decisión para Umi:** un temporizador del SDK cubre la necesidad. El canal actual del dispositivo no publica liberaciones de cuentas.

El código propio solo conecta la lectura existente con el estado visible. Agregar otro transporte ampliaría el cambio sin aportar evidencia necesaria para este caso.

## Pruebas

| Comprobación                      | Resultado         | Evidencia                                                                      |
| --------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| `flutter analyze`                 | Sin hallazgos     | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-analyze.log)        |
| Pruebas de cuentas dirigidas      | 34 aprobadas      | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-tests.log)          |
| Suite completa POS                | **901 aprobadas** | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-suite.log)          |
| Repositorio y servicio de carrito | 36 aprobadas      | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-api-tests.log)      |
| Integración con Postgres          | 6 aprobadas       | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-integration.log)    |
| Contrato                          | 84 aprobadas      | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-contract-tests.log) |
| Build de API                      | Correcto          | [Log](evidence/2026-10-13-aviso-cuenta-liberada/umi-poll91-api-build.log)      |

`accounts_workspace_test.dart` comprueba que el aviso persiste con propietario activo y desaparece al liberarse. Comprueba también que cesa la consulta.

Cuatro pruebas nuevas en `open_accounts_list_test.dart` cubren pausa, reanudación, eliminación, versión actualizada, búsqueda, lectura lenta, error de red y respuesta tardía.

`table-accounts.integration.ts` comprueba `accountOwnerActive` antes y después de terminar la sesión de la fixture. Conserva propietario y versión en ambas lecturas.

`pos-kitchen.test.mjs` tenía una expectativa anterior de permiso `kitchen.read`. Se alineó con `order.fire`, que el contrato ya usa para consultar el pedido del mesero.

No se cambió el permiso del producto en esta corrección. La suite del contrato quedó verde después de actualizar esa premisa.

```sh
cd apps/umi-pos
/home/juan/.local/opt/flutter/bin/flutter analyze
/home/juan/.local/opt/flutter/bin/flutter test test/accounts_workspace_test.dart test/open_accounts_list_test.dart test/open_accounts_test.dart
/home/juan/.local/opt/flutter/bin/flutter test

cd ../umi-api
pnpm exec vitest run src/modules/pos-cart/pos-cart.repository.spec.ts src/modules/pos-cart/pos-cart.service.spec.ts
node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts src/modules/pos-cart/table-accounts.integration.ts
pnpm build

cd ../..
pnpm --filter @umi/contract test
```

## Evidencia nativa y servidor

Se usó la cuenta **153**, id `c024d314-c6a3-476c-871c-d8e12d2f7f5e`, con un Capuccino de MXN 60.

1. A11 abrió la cuenta como Mesero 2. La iMin intentó abrirla como Admin ONCA.
2. La lista inicial tenía una versión anterior. Se actualizó antes de preparar la prueba del conflicto de propietario.
3. La iMin recibió `CART_ACCOUNT_BUSY` a **21:23:48.814 UTC**. [Aviso visible](evidence/2026-10-13-aviso-cuenta-liberada/01-imin-cuenta-ocupada.png).
4. Las lecturas automáticas devolvieron 200 a **21:23:53.895** y **21:23:58.938**. El aviso permaneció con la sesión activa.
5. Se pulsó Cerrar sesión únicamente en la A11. El logout devolvió 201 a **21:24:03.854**.
6. La lectura automática siguiente devolvió 200 a **21:24:04.033**. La captura posterior confirmó el aviso retirado, sin tocar la iMin.
7. Después se abrió la cuenta desde la iMin: `/resume` devolvió 201 a **21:24:27.634**, sin conflicto de versión.

[iMin sin aviso](evidence/2026-10-13-aviso-cuenta-liberada/02-imin-liberada-sin-tocar.png), [A11 en PIN](evidence/2026-10-13-aviso-cuenta-liberada/03-a11-sesion-cerrada.png), [cuenta abierta](evidence/2026-10-13-aviso-cuenta-liberada/04-imin-cuenta-abierta.png), [marcas de captura](evidence/2026-10-13-aviso-cuenta-liberada/native-timing.txt), [peticiones API](evidence/2026-10-13-aviso-cuenta-liberada/api-native.json).

La base confirmó versión **8**, estado `recovered`, sesión `active` antes de salir. Después confirmó versión **9**, estado `suspended`, sesión `ended`.

[Fila antes](evidence/2026-10-13-aviso-cuenta-liberada/cuenta153-before.txt) y [fila después](evidence/2026-10-13-aviso-cuenta-liberada/cuenta153-after.txt). El guardado produjo el cambio de versión; el sondeo solo leyó.

Se guardó la cuenta después de comprobar la apertura. No se cobró, anuló ni añadió un producto durante este recorrido.

## Instalación

Un único APK **0.1.0+91**, profile Android arm64, se instaló con `adb install -r` en las tres terminales.

[Log del build](evidence/2026-10-13-aviso-cuenta-liberada/build91.log) y [versiones instaladas y SHA-256](evidence/2026-10-13-aviso-cuenta-liberada/installed-builds.json).

```sh
cd apps/umi-pos
/home/juan/.local/opt/flutter/bin/flutter build apk --profile --target-platform android-arm64 --build-name 0.1.0 --build-number 91 -PumiposApplicationId=co.umiconsulting.umi_pos.estacion --dart-define=UMIPOS_ENVIRONMENT=development --dart-define=UMIPOS_API_BASE_URL=http://127.0.0.1:4001 --dart-define=UMIPOS_DEVICE_KEY= --dart-define=UMIPOS_CONTRACT_VERSION=2.34.0 --dart-define=UMIPOS_RELEASE_VERSION=0.1.0 --dart-define=UMIPOS_CONFIG_SCHEMA_VERSION=1 --dart-define=UMIPOS_DEVELOPMENT_DIAGNOSTICS=true --dart-define=UMIPOS_FEATURE_BOOTSTRAP=disabled --dart-define=UMIPOS_HARDWARE_SIMULATOR_ENABLED=false
adb -s 192.168.1.10:5555 install -r build/app/outputs/flutter-apk/app-profile.apk
adb -s 192.168.1.14:35559 install -r build/app/outputs/flutter-apk/app-profile.apk
adb -s 192.168.1.13:38333 install -r build/app/outputs/flutter-apk/app-profile.apk
```

Se conservó el acceso local mediante `adb reverse tcp:4001 tcp:4001` en cada dispositivo. Depende de la conexión ADB con esta estación.

La API se reinició con el código compilado. Un proceso anterior mostró pools cerrados durante el reinicio; se confirmó un único listener nuevo en 4001.

Las lecturas finales de carrito y cocina devolvieron 200. La A9 quedó en Cocina; la A11 volvió al acceso de Mesero 2.

## Comandas anteriores y límites

La revisión independiente está en [Comandas anteriores: diagnóstico del cierre diario](2026-10-13-comandas-anteriores-diagnostico.md).

ONCA conserva Manual, con corte a las 04:00. Las comandas antiguas pertenecen a cuentas finales; el autocierre comercial no resuelve su trabajo pendiente.

**Pendiente de implementación:** reconciliar el KDS de cuentas canceladas y ofrecer una resolución explícita de trabajo anterior, incluidas las excepciones sin estación.

No se cambió esa política ni se retiraron comandas antiguas. No se comprobó su preparación o entrega real.

La prueba nativa del aviso se ejecutó entre iMin y A11. La A9 verificó arranque y tablero; no repitió el papel de cajero.

Pausa, errores de red y respuestas tardías se comprobaron mediante pruebas automatizadas. No se simuló pérdida física de red ni expiración real de doce horas.

No se ejecutó la suite completa de la API. La spec protegida de caja y los errores previos de tipos de hardware quedan fuera de esta corrección.
