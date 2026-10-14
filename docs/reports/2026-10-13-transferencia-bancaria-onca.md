# Transferencia bancaria de ONCA y firma del ticket

Fecha: 2026-10-13. Entorno: `umi_local` y tres terminales Android de desarrollo.

## Resultado

- ONCA puede activar la transferencia por sucursal en **Caja y turnos → Reglas del cobro**. El administrador guarda titular, banco, CLABE o número de cuenta. El formulario conserva los datos al desactivar el método.
- El cobro muestra **Transferencia bancaria** como método propio. Al tocarlo, abre un modal con el logo registrado de ONCA, el importe, el banco, el titular, la CLABE y el concepto de la cuenta. En un pago mixto muestra sólo el importe de la parte bancaria.
- Abrir el modal o elegir el método no registra un pago. El operador debe declarar que verificó el abono en el banco o el CEP antes del cobro. La API rechaza una transferencia sin esa confirmación.
- El recibo en pantalla y el ticket térmico llaman al método **Transferencia bancaria**. El pie añade `Powered by Umi: umiconsulting.co` dos renglones después de «Gracias por su visita».
- La configuración de ONCA en la base local usa **datos DEMO que no admiten transferencias reales**: `ONCA DEMO - NO TRANSFERIR`, `BANCO DE PRUEBA - NO TRANSFERIR` y CLABE `000000000000000000`. No se añadieron datos ficticios a staging, producción ni al código como valor predeterminado.

## Decisiones

El contrato subió a `2.35.0`. La transferencia tiene su propio `PaymentMethod` y `TenderType` (`bank_transfer`). La política y los datos del beneficiario viven por sucursal en `merchant.pos_checkout_policy`. El modal usa `merchant.merchant.logo_url`, ya existente. La API conserva la decisión de pago; el POS sólo presenta los datos y registra la confirmación del operador.

Se admiten CLABE y número de cuenta. Se omitió el número completo de tarjeta: almacenarlo ampliaría el alcance de PCI DSS, según [PCI SSC, FAQ 1335](https://www.pcisecuritystandards.org/faqs/1335/). La opción «CLABE» cumple la alternativa solicitada y [Banco de México](https://www.banxico.org.mx/servicios/mi-spei_-transferencias-ban.html) la documenta para SPEI. No hay integración bancaria para constatar automáticamente el abono. [Adyen](https://docs.adyen.com/payment-methods/bank-transfer/api-only) documenta que una transferencia queda pendiente hasta recibir fondos. Las devoluciones de ventas pagadas por transferencia requieren conciliación manual; la API bloquea una devolución que sólo cambiaría el registro sin devolver dinero.

## Herramientas y fuentes

| Herramienta           | Versión                | Uso y fuente de selección                                                                                                                                                                                      |
| --------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flutter y Dart        | 3.47.5 y 3.13.4        | Componentes `showPosDialog` y `PosAlertDialog` existentes; [guía oficial de Flutter](https://docs.flutter.dev/testing/overview) para pruebas y análisis. No se añadió una dependencia visual.                  |
| React y Lingui        | 18.3.1 y 6.6.0         | Formulario controlado y traducciones; [documentación de React](https://react.dev/reference/react-dom/components/input) y [macros de Lingui](https://lingui.dev/ref/macro).                                     |
| Playwright y Chromium | 1.62.1 y 153.0.8010.52 | Clics reales en el dashboard mediante CDP; [documentación de Playwright](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) y `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`. |
| PostgreSQL            | 17.10                  | Migración reejecutable con `ADD COLUMN IF NOT EXISTS`; [documentación oficial](https://www.postgresql.org/docs/current/sql-altertable.html).                                                                   |
| Vitest y tsup         | 2.1.9 y 8.5.1          | Pruebas y build de los paquetes, según los scripts existentes y la [guía de Vitest](https://vitest.dev/guide/features).                                                                                        |

La [investigación](../research/2026-10-13-transferencia-bancaria-pos.md) registra los hechos de Banxico, Adyen y PCI SSC, y separa hechos de inferencias para ONCA.

## Migración y verificaciones

Se aplicó dos veces, con resultado `COMMIT`, la migración [035_bank_transfer_checkout.sql](../migration/build-v3/migrations/035_bank_transfer_checkout.sql):

```sh
docker exec -i umi-bv3-pg psql -U postgres -d umi_local -v ON_ERROR_STOP=1 < docs/migration/build-v3/migrations/035_bank_transfer_checkout.sql
```

La fila de `merchant.pos_checkout_policy` de ONCA, sucursal `54be4d9e-fa0a-4a42-b95f-402acfccade6`, confirma `bank_transfer_enabled=true`, el titular y banco DEMO, la CLABE DEMO y que el comercio tiene logo. El log `/tmp/umi-api-4001.log` registra `PATCH /api/merchants/.../operations/checkout-policy` con estado 200 a las `01:51:54Z`, seguido de `GET` con estado 200. Registra también `GET /api/v1/pos/merchants/.../checkout/policy` con estado 200 a las `01:55:51Z`.

Las capturas muestran el [formulario guardado](evidence/2026-10-13-transferencia-bancaria/dashboard-transferencia-configurada.png), el [modal con el logo real](evidence/2026-10-13-transferencia-bancaria/imin-103-modal.png), el [panel bancario seleccionado](evidence/2026-10-13-transferencia-bancaria/imin-103-seleccionada.png), la [confirmación manual](evidence/2026-10-13-transferencia-bancaria/imin-103-confirmacion.png) y la [Cuenta 182 todavía abierta](evidence/2026-10-13-transferencia-bancaria/imin-103-cuenta-abierta.png) después de cerrar el diálogo sin confirmar el abono. El dashboard se verificó con clics reales: guardar respondió 200 y, tras recargar, el método seguía activo con la CLABE DEMO.

- POS: `flutter analyze --no-pub` sin hallazgos; **945 pruebas** de la suite completa pasaron. Se añadieron pruebas para modal sin cobro, confirmación, método desactivado, importe mixto, tamaño del ícono y etiquetas de recibo. `money_format_test.dart` pasó de 14 a 17 campos decimales permitidos: los tres nuevos valores alimentan el comando bancario, mientras los importes visibles usan `formatMinorUnits`.
- Dashboard: **369 pruebas** y build de desarrollo pasaron. ESLint de los archivos cambiados pasó. El lint global mantiene un fallo previo en `src/shell.jsx:45`, archivo que no se tocó.
- API: **56 pruebas** pertinentes y build pasaron. El contrato pasó **86 pruebas** y `generate:check`. El análisis de tipos global mantiene dos fallos previos en `pos-hardware.repository.spec.ts:70,95`.
- Android: APK de perfil final `0.1.0+103`, contrato `2.35.0`, instalado en iMin, A9 y A11. `dumpsys package` confirmó `versionCode=103` en los tres.

La primera instalación (`+101`) permitió ver el concepto «Cuenta Cuenta 182». La segunda (`+102`) mostró que el panel derecho conservaba un texto de terminal y estiraba el ícono bancario. Se corrigieron ambos defectos y se construyó `+103` para dejar el resultado final en los tres equipos.

## Límites

No se realizó una transferencia real ni se marcó pagada la Cuenta 182: los datos de prueba no pertenecen a un banco. La pantalla física del modal y la selección se verificaron en la iMin; A9 y A11 sólo se verificaron por instalación y versión. Las etiquetas y el pie del ticket se verificaron con pruebas de render y del generador térmico; la impresión física aún no se comprobó. Staging y producción no recibieron migración, configuración ni APK.
