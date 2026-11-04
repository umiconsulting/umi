# Rediseño 2: correcciones nativas

Base: `67bacd42`. Fuente: Rediseño 2, release `b1adc1e9`.

UNSLOP se aplica a la dirección aprobada. Autor de la habilidad: Damir Sokolovsky (@heydamir), CC BY 4.0.

La auditoría contiene 24 filas de superficies. La solicitud las denomina 23. Este informe conserva todas las filas.

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
| 17 | Modifier keys and lower form | Implementado. Opciones64/72. Cantidad y tiempo comparten fila cuando el espacio permite; nota usa ancho completo. Captura final: root. |
| 18 | Account rows and due hierarchy | Implementado. Cantidad plana, importe limitado proporcionalmente, total/pagado secundarios y saldo dominante. Cobrar evita duplicar importe. Captura final: root. |
| 19 | Account/checkout shell and catalog return | Implementado. Navegación visible en cuenta, cobro completo, parcial y resultado. Destinos bloqueados durante pago. El resultado final vuelve al catálogo. Captura final: root. |
| 20 | Incoming queue and review desk | Implementado. Cabecera dentro de cola304, total en cada resumen, cliente dominante y región inferior de total/acción. Conserva aviso manual honesto. Captura final: root. |
| 21 | KDS headings/tickets | Implementado. Nombre y conteo en columnas. Tarjeta8, borde neutro y acento superior solo para trabajo en preparación. Captura final: root. |
| 22 | Cash movement grid and status band | Implementado. Movimientos phone en dos columnas, último control completo cuando corresponde, borde y relleno12. Banda estado/ecuación1:2 usa una sola identidad. Captura final: root. |
| 23 | Hardware panels | Implementado. Sin cabecera anidada. Panel20/8, identidad, estado textual real, conexión/uso y acciones existentes. Captura final: root. |
| 24 | Receipt region and actions | Implementado. Recibo corto con altura documental y centro vertical en ancho. Phone comparte desplazamiento. Acción principal48 y comprobante real. Captura final: root. |

## Límites

Root controla APK, emuladores, capturas y comparación visual. Las pruebas de widgets verifican comportamiento y geometría acotada. No establecen aceptación visual nativa.

Herramienta: Flutter oficial 3.47.5, `/Users/moon/.local/opt/flutter-3.47.5/bin/flutter`. Fuente: SDK autorizado por root.

## Checkpoints y verificación

- P2: `0a90e721`, 27 pruebas.
- A: `51eaab72`, 52 pruebas y analizador acotado sin incidencias.
- B: implementación de24filas; 295 pruebas enfocadas aprobadas. Log: `/private/tmp/umi-design2-b-focused.log`.
- Regresión de importe largo200%: RED `/private/tmp/umi-design2-large-amount-red.log` (overflow157px); GREEN `/private/tmp/umi-design2-large-amount-green.log`.
- Teclado y shell phone402×874: `/private/tmp/umi-design2-phone-checkout.log`.
- Primera suite completa:1270 aprobadas,5omitidas,1fallo de anuncio duplicado en caja. Se movió la identidad existente a la banda1:2. La aserción accesible permanece.
- Verificación de caja después de esa corrección:46 aprobadas. Log `/private/tmp/umi-design2-cash-final.log`.
- Suite completa final y analizador: en curso al cerrar B.

La revisión de P2 de root aprobó el cambio. Root confirmó refresco real de la misma cuenta, con pago parcial desde otro teléfono.

El retorno al catálogo tiene una regresión de ruta nativa. Conserva el bloqueo durante pago y las guardas de cuenta. El atajo de pedidos conserva su identidad y permanece inactivo durante el pago.
