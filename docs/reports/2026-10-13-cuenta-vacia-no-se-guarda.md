# Una cuenta vacía no se guarda

Fecha: 2026-10-13. Autor: agente Codex, a pedido del dueño.

**Qué dijo el dueño.** "Ahora el hacer nueva cuenta y vaciar carrito siento que duplican
funciones, además no estoy seguro de dejar que nueva cuenta pueda borrar una cuenta en blanco,
solo se acumulan si spaméan el botón". Después pidió comparar con la competencia, incluidos los
POS mexicanos. La comparación está en
`docs/research/2026-10-13-cuenta-vacia-competencia/README.md`.

## 1. Qué estaba pasando

**Medido, no supuesto.** En `merchant.pos_cart` de la base local había cuentas vacías por todos
lados:

- Ocho registros abiertos entre 04:00:16 y 04:00:41, todos con cero líneas: un registro por
  toque del botón.
- La cuenta viva del till (número 077) también estaba vacía, y cada toque de "Nueva cuenta"
  dejaba la anterior como `suspended` y abría otra.

**Por qué importaba.** `merchant.pos_cart.account_number` es una columna `generated always as
identity`. Cada registro nuevo gasta el siguiente número, así que una cuenta vacía por toque es
un número gastado que el siguiente cliente ve en su ticket. Es la causa del "¿por qué inicio con
cuenta 147?" que el dueño reportó antes.

**Qué hacía el till.** `CatalogSurface._newSale` guardaba la cuenta en pantalla y abría la
siguiente, sin mirar si la cuenta tenía algo.

**Qué hacía la API.** `PosCartRepository.suspendAccount` escribía `lifecycle_state='suspended'`
sin preguntar si la cuenta tenía contenido. Esa ruta la usan cuatro puertas: `Nueva cuenta`,
abrir una mesa, retomar otra cuenta y salir del turno.

**La regla ya existía en el mismo till, para el camino heredado.**
`SaleLifecycleController.prepareForOperatorExit` cierra la orden vacía ("Empty order closed when
the operator session ended") en vez de guardarla. El camino por cuentas abiertas se había
quedado sin esa regla.

## 2. Qué cambió

### 2.1 API — `apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts`

`suspendAccount` pregunta primero si la cuenta tiene algo: líneas, mesa, nombre u orden
disparada. Si no tiene nada, la **cierra** en vez de guardarla:

```text
lifecycle_state='cancelled', status='abandoned',
cancellation_reason_code='other',
cancellation_reason='Cuenta vacía: se cierra al apartarla.'
```

Reglas que sostienen el cambio:

- Un nombre es contenido: si el operador escribió uno, la cuenta se conserva.
- La condición es la misma que la lista de cuentas abiertas usa (`openAccountIds`), así que el
  till y la API no pueden discrepar sobre qué es una cuenta reconocible.
- Se reusó el patrón del barrido del cierre del día (`status='abandoned'`,
  `lifecycle_state='cancelled'`, motivo y código), que ya pasa el guardia de ciclo de vida
  `merchant.pos_cart_lifecycle_guard`.

### 2.2 POS — `apps/umi-pos/lib/features/catalog/catalog_surface.dart`

- `Nueva cuenta` se apaga cuando la cuenta en pantalla está vacía, y su explicación dice cuál es
  la cuenta que ya está en uso. Un botón que responde a un toque con nada es el defecto que este
  till ya conoce; el control ahora se ve apagado, no vivo.
- La guarda también vive en `_newSale`, para los otros llamadores (espacio Cuentas y el arranque
  de pedido en móvil): con una cuenta vacía el till no escribe nada y sólo limpia la captura.
- El botón "Nueva cuenta sin mesa" del espacio Cuentas se oculta en ese mismo estado.

### 2.3 POS — `apps/umi-pos/lib/features/cart/account_details_surface.dart`

`accountIsBare(Cart)` es la única definición de "cuenta vacía" en el till: sin líneas, sin mesa,
sin nombre y sin orden disparada.

## 3. Pruebas

| Suite                                         | Resultado                                                 |
| --------------------------------------------- | --------------------------------------------------------- |
| `flutter test` (POS)                          | 851 pruebas, todas verdes (eran 849)                      |
| `npx vitest run src/modules/pos-cart`         | 33 pruebas, todas verdes (eran 29)                        |
| `npx vitest run` (API completa)               | 1890 verdes, 29 saltadas, **1 falla ajena a este cambio** |
| `flutter analyze` sobre los archivos tocados  | sin hallazgos                                             |
| `prettier --check` sobre los archivos tocados | conformes                                                 |

Pruebas nuevas:

- POS, widget: "Nueva cuenta stands down on an empty account and writes nothing". Comprueba que
  el control está apagado, que dice por qué, que su tinta es la del estado apagado y que no se
  pide ni un guardado ni una cuenta nueva.
- POS, unidad: "an account is bare only when nothing identifies it" (líneas, mesa, nombre, orden
  disparada).
- API, unidad: cuatro casos sobre `suspendAccount` (cierra la vacía con motivo; conserva la que
  tiene línea; conserva la vacía con nombre; y lee los cuatro hechos).

**Falla ajena.** `src/modules/pos-cash/pos-cash.repository.regression.spec.ts` espera el texto
literal `SET status='open',version=version+1,suspended_at=NULL`, y el archivo que revisa ahora
escribe un `CASE` (trabajo en curso de otra sesión sobre `pos-cash.repository.ts`, que ya estaba
modificado antes de este cambio). No se tocó.

## 4. Verificación en vivo (iMin D3, `192.168.1.10:5555`)

Build `0.1.0+74`, instalado con `adb install -r`, PIN de Admin.

| Paso                           | Resultado medido                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Cuenta 077 vacía               | "Nueva cuenta" se ve apagado: tinta `#59677F`, la del estado apagado                                                        |
| Seis toques seguidos           | Cero registros nuevos, cero llamadas de escritura en el log de la API, el till sigue en Cuenta 077                          |
| Se agrega un Capuccino         | La cuenta 077 conserva una línea y el control vuelve a encenderse (`#131F44`)                                               |
| "Nueva cuenta" con una línea   | La 077 queda `suspended` con su línea y el till abre la 078                                                                 |
| "Vaciar cuenta" en la 078      | La 078 queda `building_cart` con cero líneas: conserva folio                                                                |
| Abrir la Mesa 8 desde el plano | La 078 vacía queda `cancelled`/`abandoned` con motivo "Cuenta vacía: se cierra al apartarla." y se abre la 079 para la mesa |

Evidencia en `docs/reports/evidence/2026-10-13-cuenta-vacia/`:
`00-cuenta-vacia-control-apagado.png` (cuenta 078 vacía, control apagado),
`01-seis-toques-sin-registro.png` (después de seis toques),
`02-con-linea-control-encendido.png` (con un Capuccino dentro),
`03-mesa8-descarta-la-vacia.png` (Mesa 8 abierta),
`04-tinta-apagada.png` y `05-tinta-encendida.png` (la tinta del control, medida:
`#59677F` apagada, `#131F44` encendida).

Evidencia en `merchant.pos_cart` después de la sesión:

```text
 account_number | lifecycle_state |  status   | table_name |  cancellation_reason
----------------+-----------------+-----------+------------+---------------------------------------
             77 | suspended       | draft     |            |
             78 | cancelled       | abandoned |            | Cuenta vacía: se cierra al apartarla.
             79 | building_cart   | draft     | Mesa 8     |
```

Cero cuentas vacías quedaron como registro abierto.

**Datos de prueba dejados en la base** (para que el dueño decida): la 077 es una cuenta
suspendida con un Capuccino, la 078 es un descarte y la 079 es la Mesa 8 abierta y sin
productos. La Mesa 8 se puede cerrar desde el till cuando el dueño quiera.

## 5. Lo que queda pendiente

1. **Un solo botón con dos salidas** (decisión del dueño, ver la sección 9 de la investigación):
   que `Nueva cuenta` pregunte "¿guardar la cuenta o descartar los productos?" cuando hay
   productos sin cobrar, y que `Vaciar cuenta` salga del menú de la comanda.
2. **Suite de integración de `pos-cart` sin ejecutar.** Necesita la base build-v3 con los roles
   de harness. El caso "keeps suspended accounts without a table available to another actor"
   codificaba la regla vieja (suspendía una cuenta de mostrador vacía); se actualizó para darle
   una línea antes de apartarla, y no se ejecutó.
3. **`pos-cash.repository.regression.spec.ts`** sigue en rojo por el trabajo en curso de otra
   sesión.
