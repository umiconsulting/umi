# Rediseño 2: correcciones nativas

Base: `67bacd42`. Fuente final del producto: `417129ce`. Fuente: Rediseño 2, release `b1adc1e9`.

UNSLOP se aplica a la dirección aprobada. Autor de la habilidad: Damir Sokolovsky (@heydamir), CC BY 4.0.

La auditoría inicial contiene 24 filas. El seguimiento añade la fila 25 para el selector de servicio. Este informe conserva todas las filas.

## P2 separado

Commit: `0a90e721`. Generación explícita por lectura del salón. Cart y ledger conservan lecturas sin lease. Cada respuesta valida su generación.

RED: `/private/tmp/umi-design2-preview-red.log`. El mismo account conserva una lectura en vez de dos.
GREEN: `/private/tmp/umi-design2-preview-green.log`. 27 pruebas aprobadas.

## Estado de las correcciones

| Fila | Superficie | Estado |
| --- | --- | --- |
| 1 | Full/partial phone method bank | Implementado. Métodos reales en claves de texto de 48 px. Ancho compartido y filas adicionales según espacio y texto. Captura final: root. |
| 2 | Phone account/amount checkout hierarchy | Implementado. Identidad y saldo comparten la cabecera. Detalle y división preceden métodos y formulario. Ajustes condicionales conservan sus controles. Captura final: root. |
| 3 | Checkout keypad and control density | Implementado. Teclado phone de 188 px: claves44 y espacios4. Presentación compacta explícita. Prueba402×874 conserva teclado completo y acción. Captura final: root. |
| 4 | Count workspace | Implementado. El propietario del conteo usa una pantalla de caja con identidad real. Conserva política, cancelación, reconteo y envío. Captura final: root. |
| 5 | Grouped denomination keys and fixed total | Implementado. Grupos MXN de billetes y monedas, dos claves por fila, subtotal cero explícito. Total separado del desplazamiento. Otras monedas conservan todas las denominaciones. Captura final: root. |
| 6 | Settings section bank | Implementado. Banco2×2 en teléfono y claves iguales en tableta. Conserva selección y permisos. Captura final: root. |
| 7 | Wide sale toolbar | Implementado. Tres bandas en paisaje: título/búsqueda, categorías, nuevo pedido/herramientas. Captura final: root. |
| 8 | Operational type hierarchy | Implementado. Títulos operativos18/600; cuerpo14, secundario13, etiquetas12. Nombres de productos18/600. Captura final: root. |
| 9 | Tablet map controls and lower dock | Implementado. Paisaje desde900: controles232 junto al plano completo y región inferior con regla. Conserva geometría publicada. Captura final: root. |
| 10 | Inline phone table detail | Implementado. El teléfono con escala normal añade detalle debajo del mapa. Texto ampliado conserva la alternativa accesible y sus acciones. Captura final: root. |
| 11 | Completion change emphasis | Implementado. El efectivo destaca cambio real. Otros métodos destacan importe cobrado. Total y recibido quedan subordinados. Captura final: root. |
| 12 | Shell rail/header geometry | Implementado. Rail72 colapsado y cabecera56. Expansión184 y preferencias existentes permanecen. Captura final: root. |
| 13 | Standard dark palette and navy navigation | Implementado. Dark usa101725/151E2E/7999DF. Navy223979 permanece en navegación. Midnight conserva su modo propio. Captura final: root. |
| 14 | PIN console geometry | Implementado. Consola centrada, título20/500, marco phone16, regla y claves56. ConservaPIN4–8. Captura final: root. |
| 15 | Portrait categories and tools | Implementado. Categorías phone/retrato48, espacios4 y relleno8. Banda de herramientas44 sin título Productos. Captura final: root. |
| 16 | Narrow product grid and wide footer | Implementado. Dos columnas desde280 de catálogo a escala normal. Pie ancho usa cantidad cargada y monedas reales. Captura final: root. |
| 17 | Modifier keys and lower form | Implementado. Opciones64/72. Cantidad y tiempo comparten fila en teléfono normal. Las etiquetas y los controles quedan alineados. La ayuda y la nota conservan ancho completo. Captura final: root. |
| 18 | Account rows and due hierarchy | Implementado. Cantidad plana, importe limitado proporcionalmente, total/pagado secundarios y saldo dominante. Cobrar evita duplicar importe. Captura final: root. |
| 19 | Account/checkout shell and catalog return | Implementado. Navegación visible en cuenta, cobro completo, parcial y resultado. Destinos bloqueados durante pago. El resultado final vuelve al catálogo. Captura final: root. |
| 20 | Incoming queue and review desk | Implementado. Cabecera dentro de cola304, total en cada resumen, cliente dominante y región inferior de total/acción. Conserva aviso manual honesto. Captura final: root. |
| 21 | KDS headings/tickets | Implementado. Nombre y conteo en columnas. Tarjeta8, borde neutro y acento superior solo para trabajo en preparación. Captura final: root. |
| 22 | Cash movement grid and status band | Implementado. Movimientos phone en dos columnas, último control completo cuando corresponde, borde y relleno12. Banda estado/ecuación1:2 usa una sola identidad. Captura final: root. |
| 23 | Hardware panels | Implementado. Sin cabecera anidada. Panel20/8, identidad, estado textual real, conexión/uso y acciones existentes. Captura final: root. |
| 24 | Receipt region and actions | Implementado. Recibo corto con altura documental y centro vertical en ancho. Phone comparte desplazamiento. Acción principal48 y comprobante real. Captura final: root. |
| 25 | Inline service choice | Implementado. Servicio del nuevo pedido dentro del catálogo. Comer aquí usa el propietario de selección de mesa. Para llevar usa el propietario de apertura actual. Volver, Escape, navegación y cierre conservan la cuenta. Los otros llamadores conservan su presentación. |

## Límites

Root controla APK, emuladores, capturas y comparación visual. Las pruebas de widgets verifican comportamiento y geometría acotada. No establecen aceptación visual nativa.

Herramienta: Flutter oficial 3.47.5, `/Users/moon/.local/opt/flutter-3.47.5/bin/flutter`. Fuente: SDK autorizado por root.

## Checkpoints y verificación

- P2: `0a90e721`, 27 pruebas.
- A: `51eaab72`, 52 pruebas y analizador acotado sin incidencias.
- B: `aee849ae`, implementación de las 24 filas; 295 pruebas enfocadas aprobadas. Log: `/private/tmp/umi-design2-b-focused.log`.
- Regresión de importe largo200 %: RED `/private/tmp/umi-design2-large-amount-red.log` (overflow157px); GREEN `/private/tmp/umi-design2-large-amount-green.log`.
- Teclado y shell phone402×874: `/private/tmp/umi-design2-phone-checkout.log`.
- Primera suite completa:1270 aprobadas,5omitidas,1fallo de anuncio duplicado en caja. Se movió la identidad existente a la banda1:2. La aserción accesible permanece.
- Verificación de caja después de esa corrección:46 aprobadas. Log `/private/tmp/umi-design2-cash-final.log`.
- B final: 1,271 pruebas aprobadas, 5 omisiones existentes, cero fallos. Log: `/private/tmp/umi-design2-corrections-full-final.log`.
- B analizador completo: cero errores y advertencias; 3 infos existentes. Log: `/private/tmp/umi-design2-corrections-analyze.log`.

La revisión de P2 de root aprobó el cambio. Root confirmó refresco real de la misma cuenta, con pago parcial desde otro teléfono.

El retorno al catálogo tiene una regresión de ruta nativa. Conserva el bloqueo durante pago y las guardas de cuenta. El atajo de pedidos conserva su identidad y permanece inactivo durante el pago.

## Checkpoint C: revisión y pruebas nativas de root

C conserva la dirección aprobada. Corrige los estados que detectaron la revisión de B y las capturas reales.

- La fila 17 usa etiquetas sobre los controles en dos columnas desde 312 px de contenido normal. El cálculo de altura conserva traducciones y escala. RED: `/private/tmp/umi-design2-phone-lower-form-red.log`. GREEN inicial: `/private/tmp/umi-design2-phone-lower-form-green.log`, 55 pruebas.
- Hardware conserva Actualizar fuera de la rama de éxito. La regresión reproduce un fallo del registro y verifica su recuperación. RED: `/private/tmp/umi-design2-hardware-retry-red.log`. GREEN: `/private/tmp/umi-design2-hardware-retry-green.log`.
- Pedidos usa un único ancho de contenido de 720 px. La cabecera permanece durante carga, vacío, fallo y detalle. La regresión cubre 684/868 px de contenido dentro de un viewport de 900 px. RED: `/private/tmp/umi-design2-header-recovery-red.log`.
- KDS usa el estado real `in_preparation` para el acento activo. La prueba de preparación exige el acento. RED: `/private/tmp/umi-design2-active-accent-red.log`.
- El catálogo pasa su navegación permitida al abrir la cuenta. La regresión recorre catálogo, cuenta, división y cobro completo. Los destinos permanecen visibles y sus callbacks quedan bloqueados. RED: `/private/tmp/umi-design2-catalog-navigation-red.log`.
- El plano conserva su geometría durante la primera lectura. Una presentación neutral indica estado pendiente. Las acciones esperan la primera respuesta válida. Un fallo inicial conserva el estado desconocido. Un sondeo fallido conserva el último plano de estado válido. RED: `/private/tmp/umi-design2-floor-initial-red.log`.
- Caja separa los movimientos de la apertura sin venta. Resguardo ocupa ancho completo en teléfono. El conteo conserva umi, identifica la caja por `registerId` y registro real, y presenta total y cancelación en filas compactas. Cada denominación presenta valor, entrada y subtotal, en ese orden.
- La fila 25 conserva el carro completo antes de la elección. Las pruebas cubren ambos servicios, mesa, Volver, Escape, navegación, cierre y la entrada directa de productos.

C enfocado: 262 pruebas aprobadas. Log: `/private/tmp/umi-design2-c-focused.log`.
C analizador completo: cero errores y advertencias; 3 infos existentes. Log: `/private/tmp/umi-design2-c-analyze-full.log`.
La suite completa final incluye C y D: 1,287 pruebas aprobadas, 5 omisiones existentes y cero fallos.

Las omisiones existentes corresponden a cinco casos Linux AppImage. Las tres infos existentes permanecen en `inventory_repository.dart`, `cash_keyboard_test.dart` y `pos_entry_brand_test.dart`. Los mensajes de negativa de caja son diagnósticos esperados anteriores. C conserva sus aserciones y los propietarios accesibles.

## Checkpoint D y cierre

Producto final: `417129ce`. Checkpoint C: `05794250`. D conserva el alcance de las mismas 25 filas.

- Cobro completo y parcial usan banco vertical, área de trabajo y cuenta de 304 px a 800/820 px. Los puntos de corte usan el ancho disponible después de la navegación. Los controles adicionales permanecen. Los importes conservan todos sus dígitos con texto ampliado.
- El conteo mantiene los grupos de billetes y monedas juntos y el área de envío de 256 px en tableta vertical. El teléfono conserva el total fijo compacto. Los valores, entradas y subtotales permanecen disponibles.
- El selector de servicio ocupa su altura de contenido. Los productos permanecen visibles y sus acciones quedan bloqueadas durante la decisión. Las pruebas verifican ambos servicios sin mutaciones antes de la elección.

RED de la composición de cobro vertical: `/private/tmp/umi-design2-portrait-composition-red.log`. El registro inicial del caso de conteo tuvo una etiqueta de política incorrecta en su fixture; se corrigió antes de validar la geometría.
La regresión adicional de texto al 200 % detectó un importe de pago parcial que excedía el espacio. Su lectura usa ahora un ancho flexible y conserva todos los dígitos. Diagnóstico: `/private/tmp/umi-design2-partial-scale-diagnostic.log`.

Verificación final:

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| D enfocado: cobro, parcial, caja, denominaciones y entrada de pedido | 158 aprobadas | `/private/tmp/umi-design2-d-focused.log` |
| Suite completa Flutter | 1,287 aprobadas, 5 omitidas, 0 fallos | `/private/tmp/umi-design2-corrections-full-d-final.log` |
| Analizador completo | 0 errores, 0 advertencias, 3 infos anteriores | `/private/tmp/umi-design2-d-analyze-full.log` |
| Espacios y conflictos del diff | Correcto | `git diff --check` |

Comandos finales:

```sh
/Users/moon/.local/opt/flutter-3.47.5/bin/flutter test --no-pub
/Users/moon/.local/opt/flutter-3.47.5/bin/flutter analyze --no-pub --no-fatal-infos
git diff --check
```

Las 25 filas tienen implementación en el código final. Root conserva la comparación visual final en Android y la aceptación del APK. Este informe separa esa aceptación de las pruebas de widgets y controladores. Los propietarios de API, contrato 2.51, persistencia, leases, pagos, operación sin conexión y hardware permanecen. No se modificaron API, esquema, datos, emuladores ni procesos externos.

## Seguimiento menor M1 de la revisión D

Producto final: `4bc6589a`. La segunda inserción del selector de servicio en paisaje exige ahora `!keyboard`. Las ramas con y sin teclado son excluyentes y conservan una sola inserción. Es el único cambio de producción posterior a D.

La cobertura añadida abre el selector y enfoca la búsqueda en 1340 × 800 con un inset inferior de 200 px. Verifica al menos 440 px de área de trabajo, un selector compacto, el producto visible y ninguna adición ni mutación de la cuenta al pulsarlo durante la decisión.

Esta prueba del flujo real también pasaba antes del ajuste: el `PosPage` exterior consume el inset inferior antes de que el catálogo lea `viewInsets`. Por ello no constituye evidencia RED/GREEN del condicional interno señalado por la revisión. La exclusión se comprueba en el cambio de código; la prueba cubre el comportamiento de la ruta real. No se modificó la gestión del teclado del shell.

| Comprobación final sobre `4bc6589a` | Resultado | Evidencia |
| --- | --- | --- |
| Entrada de pedido | 23 aprobadas | `/private/tmp/umi-design2-m1-order-entry.log` |
| Suite completa Flutter, una ejecución sobre el código final | 1,288 aprobadas, 5 omisiones existentes, 0 fallos | `/private/tmp/umi-design2-corrections-full-m1-final.log` |
| Analizador completo | 0 errores, 0 advertencias, 3 infos anteriores | `/private/tmp/umi-design2-m1-analyze-full.log` |
| Espacios y conflictos del diff | Correcto | `git diff --check` |

La aceptación visual nativa final sigue a cargo de root.
