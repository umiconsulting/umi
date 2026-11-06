# Rediseño 2 · Mostrador UMI

## Auditoría

- Carta: título y búsqueda en dos franjas altas antes del primer producto.
- Categorías: rectángulos grandes que compiten con las teclas de producto.
- Catálogo: doce teclas iguales, sin ritmo; fotos extendidas con contraste desigual.
- Cuenta: metadatos y cantidades repetidas consumen el espacio de los renglones.
- Navegación: superficie con el mismo peso que el contenido, sin un lomo reconocible.
- Pago, caja, opciones y configuración: agrupaciones con tratamientos dispares.
- Texto: etiquetas auxiliares menores de 12 px y excesiva jerarquía Bricolage fuera del wordmark.
- Móvil: requiere espacio propio para cuenta y acciones, no reducción del escritorio.

## Dirección de cinco líneas

Producto: POS de café para recibir pedidos, coordinar preparación y cobrar según el rol.
Carácter: directo, seguro, práctico.
Mundo: el mostrador del café, el salón físico y el ticket de trabajo.
Momentos: teclas con fotos del café y color por categoría; plano físico con estados útiles.
Firma: umi en minúsculas sobre un lomo navy y la misma jerarquía de folio, servicio y saldo.

## Plan y nueve pasadas UNSLOP, en orden

1. Espaciado: retícula de 4 px, encabezado de 56 px, insets de 16 px, blancos destinados a productos y renglones.
2. Color: aliases UMI y tokens BoardUI existentes, navegación navy; fondos neutrales y categorías conocidas.
3. Iconos: conservar navegación operativa, sin iconos decorativos de categoría ni signos más en productos.
4. Copy: conservar callbacks y nombres operativos; quitar duplicación visual del subtítulo de carta y del importe del botón de cobro.
5. Tipo: IBM Plex Sans, utilidades compuestas BoardUI; Bricolage reservado a umi y jerarquía existente, texto auxiliar mínimo de 12 px.
6. Layout: cabecera/búsqueda compartidas, productos de alturas deliberadas, categoría central breve y ticket continuo. Banda de categorías en tablet vertical y teléfono.
7. Detalles: separadores y grupos, controles táctiles de 44 px, precios alineados, una cifra principal por cobrar.
8. Visuales: fotos existentes con máscara continua; geometría del plano intacta. Referencias locales Zavo estudiadas por proporción, sin copiar marca, assets o textos.
9. Movimiento: reutilizar Stageshow y sus targets; cambio de diseño sin remount ni reinicio; respetar reduced motion.

## Implementación y alcance

La selección vive en App, fuera de Scene/Stage; `design=2` selecciona la variante. El cambio no llama setScene, setTake, setAuto ni cambia la key de Stage. `data-design=2` se limita al Workspace POS. Dashboard y menú mantienen sus componentes y estilos.

No se cambian datasets, modelos operativos, roles, geometría física ni integraciones. Las fotos, importes y escenarios son los existentes del prototipo.

UNSLOP por Damir Sokolovsky ([@heydamir](https://x.com/heydamir)), CC BY 4.0. Aplicado con dirección e implementación autorizadas en el brief.

## Resultado y límites de la verificación

Se realizaron dos iteraciones compuestas. La segunda corrigió el alto real del Input, el contraste del rail, la densidad del pago móvil y el peso de Faltan. Una corrección tipográfica final llevó los auxiliares heredados a 12 px sin cambiar la composición.

- Variante: 7 comprobaciones de URL/selector/pedido/pago parcial sin reinicio.
- Matriz: Windows, Mac, iPhone, Android, iPad y Galaxy en ambas orientaciones de tablet, claro/oscuro; 93 comprobaciones de búsqueda, fotos, último renglón y pago. ScrollFade probado en ambos teléfonos/temas, incluido reset arriba.
- Suites existentes: tres flujos (29), roles/preparación (45), paridad operativa (49), caja/hardware simulado (54), layout de pago (2).
- Typecheck y build completados. Permanece la advertencia de chunks grandes del build existente.
- Opción1: misma composición antes/después; 429 píxeles de ~1.048M difieren con delta máximo7/255 por antialias. No se afirma identidad binaria del PNG.
- Recorrido filmado: 28 frames por dispositivo durante54.8s en Windows claro e iPhone oscuro. Ambos alcanzan el recibo. Sheets revisadas y reportes conservados en shots/option2/.
- El análisis automático de motion es **inconcluso**, exit2, por gaps de muestreo y candidatos de sus heurísticas. No se afirma `rehearsal passed`. Persisten advertencias de geometría heredada del kit, cambios completos de pantalla y marco de402px escalado dentro del host390px. Son límites documentados para revisión, no resultados silenciados.
- El pago y la cuenta móviles tienen desplazamiento real para detalle/teclado y acciones principales fijas. El resumen de pago ocupa aproximadamente140px en lugar de248px. No se simuló teclado de sistema operativo ni hardware real.
