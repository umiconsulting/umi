# Folio de cuenta visible junto a la mesa

Fecha: 2026-10-13. Pedido: identificar siempre la cuenta por su número, aunque tenga mesa.

## Cambio

La Comanda usa **Cuenta XXX** como título. La mesa conserva su fila y su acción para cambiar la asignación.

La lista usa **Cuenta XXX · Mesa X** cuando existe mesa. Una cuenta sin mesa conserva **Cuenta XXX** como título.

El nombre opcional permanece como información secundaria. La búsqueda sigue encontrando folio, mesa, nombre y operador.

La causa era `accountDisplayTitle`: daba prioridad a `tableName` y `accountName`, y dejaba el folio como respaldo.

Ahora se usa `accountFolio`, emitido por la API. El POS no calcula números ni usa el número de mesa como identificador de cuenta.

Un contrato antiguo sin folio muestra «Cuenta» o «Account». No se inventa un número a partir del UUID.

Este cambio solo modifica la UI del POS. No cambia API, contrato, esquema, numeración ni datos comerciales. No requiere migración.

Se preservó `account_details_surface.dart`, que estaba sin seguimiento. Se guardó una copia previa antes de editar su helper.

## Herramientas y decisión previa

Se reutilizaron **Flutter / Flutter Test 3.47.5**, **Dart 3.13.4**, **ADB 37.0.0** y **Prettier 3.9.4**.

El [apéndice de investigación](../research/2026-10-13-jornada-correcciones-herramientas.md) documenta la prioridad anterior y el origen canónico del folio.

[Flutter Test](https://docs.flutter.dev/cookbook/testing/widget/finders) recomienda localizar y comprobar los widgets. El [playbook local](../development/LOCAL_VERIFICATION_PLAYBOOK.md) exige capturas del cliente nativo.

[ADB](https://developer.android.com/tools/adb) permite instalar y controlar las terminales existentes. No se agregó una dependencia.

**Decisión:** modificar el helper y su presentación existente. Una biblioteca nueva no aporta valor a esta composición de textos.

## Pruebas

- `flutter analyze`: sin hallazgos. [Log](evidence/2026-10-13-cuenta-folio-mesa/umi-folio92-analyze.log).
- Cuatro archivos dirigidos: **52 pruebas aprobadas**. [Log](evidence/2026-10-13-cuenta-folio-mesa/umi-folio92-focused.log).
- Suite completa POS: **901 pruebas aprobadas**. [Log](evidence/2026-10-13-cuenta-folio-mesa/umi-folio92-suite.log).

Se actualizaron estas premisas:

| Archivo                        | Cambio en la expectativa                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `cart_layout_test.dart`        | El folio es visible como título. La mesa aparece una vez en su control. El nombre largo conserva acciones accesibles al 200%. |
| `open_accounts_test.dart`      | Asignar mesa conserva el folio como título. La lista presenta folio y mesa juntos.                                            |
| `open_accounts_list_test.dart` | La búsqueda conserva selección y filtros con el nuevo título. El nombre opcional pasa a la segunda línea.                     |
| `accounts_workspace_test.dart` | Lista usa el folio; las cuentas con mesa incluyen ambos datos. La selección continúa usando la misma cuenta.                  |

No se añadió una prueba aislada que duplique el helper. Las pruebas existentes comprueban la presentación y la interacción.

```sh
cd apps/umi-pos
/home/juan/.local/opt/flutter/bin/flutter analyze
/home/juan/.local/opt/flutter/bin/flutter test test/cart_layout_test.dart test/open_accounts_test.dart test/open_accounts_list_test.dart test/accounts_workspace_test.dart
/home/juan/.local/opt/flutter/bin/flutter test
```

## Evidencia antes

La iMin mostraba «Mesa 6» como título en la lista y la Comanda. La base confirma que su cuenta es la **152**.

[Lista anterior](evidence/2026-10-13-cuenta-folio-mesa/01-lista-antes.png), [Comanda anterior](evidence/2026-10-13-cuenta-folio-mesa/02-comanda-antes.png), [fila de la base](evidence/2026-10-13-cuenta-folio-mesa/mesa6-db.txt).

```sh
docker exec umi-bv3-pg psql -U postgres -d umi_local -c "SELECT account_number,table_name,status,lifecycle_state,version FROM merchant.pos_cart WHERE merchant_id='e6b14af1-b814-4efe-a6b0-67f5f02f4d53' AND table_name='Mesa 6' ORDER BY account_number DESC LIMIT 3;"
```

## Instalación y verificación nativa

Se compiló **0.1.0+92** y se instaló con `adb install -r` en iMin, A9 y A11.
El [registro de instalación](evidence/2026-10-13-cuenta-folio-mesa/installed-builds.json) contiene las versiones y el hash del APK.
La [compilación](evidence/2026-10-13-cuenta-folio-mesa/build92.log) terminó correctamente.

En la iMin, Admin ONCA reanudó la cuenta 152. Su título muestra «Cuenta 152» y la mesa aparece debajo.
Después se abrió Cuentas → Lista. La misma cuenta muestra «Cuenta 152 · Mesa 6».
No se añadieron productos ni se enviaron pedidos ni cobros durante esta comprobación.

[Comanda después](evidence/2026-10-13-cuenta-folio-mesa/03-comanda-despues-build92.png), [Lista después](evidence/2026-10-13-cuenta-folio-mesa/04-lista-despues-build92.png).

La instalación se comprobó en las tres terminales. Esta comparación visual del folio se realizó en iMin; no se repitió en ambas tablets.

## Relación con las otras correcciones

Se conserva la [corrección del aviso de cuenta ocupada](2026-10-13-aviso-cuenta-liberada.md). Su desaparición automática se probó entre iMin y A11 en el build 91.

La revisión de [comandas anteriores](2026-10-13-comandas-anteriores-diagnostico.md) tiene seguimiento en la [corrección KDS del build 93](2026-10-13-kds-completar-descartar.md).
