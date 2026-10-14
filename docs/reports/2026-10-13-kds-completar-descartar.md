# KDS: completar productos y descartar cancelaciones

Fecha: 2026-10-13. Terminal KDS: A9. Caja: iMin. POS móvil: A11.

**Seguimiento, build 94:** [Sin estación](2026-10-13-kds-sin-estacion.md) resuelve el límite histórico descrito en este reporte.
Admin aplicó las rutas actuales de Aeropress y Amanecer de 004 hacia Barra. Barista 2 los completó en A9; la venta cobrada quedó intacta.
A9 también descartó los dos productos cancelados de 013. [Las filas finales](evidence/2026-10-13-kds-sin-estacion/db-after94.txt) acreditan ambos resultados.
Las tres terminales tienen el mismo APK 94. Este documento conserva las mediciones originales del build 93.

## Problema medido

La cuenta **004 · Mesa 1** conserva una venta cobrada y tres productos de cocina.
Aeropress y Amanecer tienen `missing_route`, sin estación. Capuccino pertenece a Cocina.

La API deriva `exception` para la comanda completa cuando un producto carece de ruta.
La validación permitía empezar Capuccino, pero rechazaba marcarlo listo con `KITCHEN_INVALID_TRANSITION`.
El rechazo ocurre con versión correcta. No depende del PIN, del día anterior ni de la venta cobrada.

[Captura anterior](evidence/2026-10-13-kds-completar-descartar/01-a9-bloqueo-antes.png), [comandos rechazados](evidence/2026-10-13-kds-completar-descartar/commands-before.txt), [base antes](evidence/2026-10-13-kds-completar-descartar/db-before.txt).

## Decisión de experiencia

Cada estación termina sus productos válidos aunque otro producto tenga una excepción de ruta.
La API conserva esa excepción y verifica estación, estado del producto, curso liberado, versión e idempotencia.
Las comandas completadas o canceladas no aceptan acciones de preparación.

El encabezado distingue el estado de la estación del estado global. Ya no muestra «En cola» para una excepción global.
Una excepción no se presenta como producto anulado. El trabajo válido conserva su aviso de tiempo vencido.

Las canceladas muestran **Cancelado** y sólo **Descartar**, sujeto a `kitchen.cancel_ack`.
Los productos quedan visibles como cancelados; no permiten marcar listo, empezar, recuperar ni liberar cursos.
Una cancelación recién visible no produce sonido de pedido nuevo.

Descartar usa el comando existente `cancel_ack`. Registra versión, evento, auditoría e idempotencia.
El descarte afecta sólo los productos de la estación visible y utiliza `station_completed_at`.
La otra estación conserva su aviso hasta reconocerlo. No elimina filas comerciales ni modifica ventas cobradas.

La proyección reconoce dos fuentes: `customer_order.status='canceled'` y cuenta POS abandonada/cancelada sin venta comprometida.
Esto incluye las cancelaciones antiguas cuyo pedido de origen conserva otro estado.
El tablero y los totales de preparación consultan la misma condición.

No se cambia la política **Manual** de ONCA. «Anteriores» conserva trabajo pendiente hasta su resolución explícita.
Cerrar una cuenta no demuestra que cocina preparó sus productos.
Se conserva el watch existente y su actualización periódica de respaldo de ocho segundos.
No se añade transporte de eventos ni dependencia.

## Investigación previa y herramientas

Se aplicaron las guías locales de investigación y verificación antes de implementar.
La [investigación de competencia](../research/2026-10-13-kds-cierre-cuentas-comandas/README.md) contiene fuentes primarias y seis capturas públicas.

Toast documenta pago antes de terminar la preparación. Square, Toast, Lightspeed y Fresh KDS permiten completar productos individualmente.
Lightspeed documenta limpieza al final del turno para el archivo de tickets ya completados.
No se verificó una regla universal de borrado automático de pendientes.
«Cancelado + Descartar» es la decisión solicitada para Umi; no se atribuye ese botón exacto a todos los proveedores.

| Herramienta            | Versión usada | Motivo y fuente                                                                                                                  |
| ---------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Flutter / Flutter Test | 3.47.5        | Widgets y aplicación Android existente; [documentación](https://docs.flutter.dev/testing/overview).                              |
| Dart                   | 3.13.4        | Analizador y formato del proyecto.                                                                                               |
| Vitest                 | 2.1.9         | Ejecutor existente; [integración de pruebas](https://vitest.dev/guide/).                                                         |
| PostgreSQL             | 17.10         | Transacciones reales con `ROLLBACK`; [documentación](https://www.postgresql.org/docs/17/tutorial-transactions.html).             |
| node-postgres          | 8.22.0        | Cliente existente; [transacciones](https://node-postgres.com/features/transactions).                                             |
| ADB                    | 37.0.0        | Capturas, toques e instalación nativa; [documentación](https://developer.android.com/tools/adb).                                 |
| Playwright             | 1.62.1        | Capturas públicas en Chromium existente; [CDP](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp). |
| Prettier               | 3.9.4         | Formato de Markdown y TypeScript.                                                                                                |

Se corrige el estado existente en su repositorio propietario. Una biblioteca nueva de estados no aporta valor a esta validación.
La corrección reutiliza el contrato, los permisos y el registro de comandos. **No requiere migración**.

## Pruebas

- `flutter analyze`: sin hallazgos.
- Pruebas dirigidas de tablero y alertas: **76 aprobadas**.
- Suite completa POS: **907 aprobadas**.
- Módulo KDS de la API: **117 aprobadas**; las 29 pruebas antiguas Gate4A quedaron omitidas por falta de su fixture específico.
- Nueva integración PostgreSQL: **6 aprobadas**, con fixtures aislados y `ROLLBACK` en cada caso.
- `pnpm build` de la API: aprobado.

La integración comprueba acciones por estación con excepción global, estados terminales, alcance, cursos retenidos y versión incorrecta.
También comprueba cancelación comercial, cuenta POS cancelada, descarte independiente e idempotencia.
Usa el mismo `umi_local`, con el usuario worker configurado en `.env`; no usa otra base ni otra API.

```sh
cd apps/umi-api
node --env-file=.env -e "const r=require('node:child_process').spawnSync('pnpm',['test:integration:kitchen'],{stdio:'inherit',env:process.env});process.exit(r.status??1)"
pnpm exec vitest run src/modules/kds
pnpm build
```

Las pruebas POS añadidas cubren listo/terminar con excepción global, descarte y permisos, distinción de falta de ruta y ausencia de alarma para canceladas.
La prueba de urgencia cambia de premisa: un producto válido puede vencer aunque otro producto produzca una excepción global.

## Instalación y prueba nativa

El mismo APK **0.1.0+93** se instaló con `adb install -r` en iMin, A9 y A11.
[Versiones y SHA-256](evidence/2026-10-13-kds-completar-descartar/installed-builds.json), [compilación](evidence/2026-10-13-kds-completar-descartar/umi-build93.log).
Se mantuvo `http://127.0.0.1:4001` con `adb reverse tcp:4001 tcp:4001` en las tres terminales.
Esta conexión de desarrollo requiere ADB y el host encendidos.

En A9, como **Cocinero 2**, se tocó Capuccino de la cuenta 004. Quedó listo a las **21:49:05.891 UTC**.
Después se pulsó Terminar a las **21:49:27.858 UTC**. La tarjeta salió de Cocina.
La comanda conserva `exception` para los dos productos sin ruta; la venta cobrada permanece intacta.

[Lista de acciones disponible](evidence/2026-10-13-kds-completar-descartar/03-a9-cuenta004-listo.png), [estación después de terminar](evidence/2026-10-13-kds-completar-descartar/04-a9-cuenta004-terminada.png).

En Barra se verificó la cuenta 070, ya cancelada y sin venta. Mostró sólo Descartar.
El descarte terminó a las **21:50:52.180 UTC**, con `cancel_ack`, versión 3 y evento 278.
Las otras cancelaciones permanecieron visibles.

[Cancelada antes](evidence/2026-10-13-kds-completar-descartar/05-a9-cuenta070-cancelada.png), [después](evidence/2026-10-13-kds-completar-descartar/06-a9-cuenta070-descartada.png), [registro de comandos](evidence/2026-10-13-kds-completar-descartar/commands-after.txt), [filas después](evidence/2026-10-13-kds-completar-descartar/db-after.txt), [log HTTP](evidence/2026-10-13-kds-completar-descartar/api-native-after.json).

Los avisos de cancelaciones antiguas aparecen ahora para su reconocimiento. Su aparición no crea pedidos nuevos ni trabajo de preparación.

Logs de verificación: [análisis](evidence/2026-10-13-kds-completar-descartar/umi-kds93-analyze.log), [widgets y alertas](evidence/2026-10-13-kds-completar-descartar/umi-kds93-focused.log), [suite POS](evidence/2026-10-13-kds-completar-descartar/umi-kds93-suite.log), [API KDS](evidence/2026-10-13-kds-completar-descartar/umi-kds93-api-tests.log), [Postgres](evidence/2026-10-13-kds-completar-descartar/umi-kds93-integration.log).

La A11 se lanzó inicialmente con Android bloqueado y falló la preparación. Se desbloqueó y reinició la aplicación sin borrar datos.
La pantalla de acceso apareció después del reinicio. No se atribuye ese fallo de arranque a este cambio del KDS.

## Límites conocidos

Los dos productos sin ruta de la 004 conservan su excepción. No se inventa una estación ni se declaran preparados.
La cuenta 013 tiene todos sus productos sin estación; el tablero actual sólo proyecta estaciones existentes y no la muestra.
Esta corrección no añade una bandeja administrativa para reparar rutas históricas.

No se fuerza el cambio de fecha, el cierre de caja ni la política `auto_void` durante esta comprobación.
No se prueban flujos en una licencia comercial de los competidores; la investigación utiliza documentación pública.

El chequeo global TypeScript permanece en rojo por dos errores previos en `pos-hardware.repository.spec.ts`, líneas 70 y 95.
[Log](evidence/2026-10-13-kds-completar-descartar/umi-kds93-api-typecheck.log). No se modificó ese archivo ni el repositorio/spec de `pos-cash` excluido por el usuario.
