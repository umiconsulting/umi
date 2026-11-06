# Corrección de dirección: identidad del dashboard UMI

Revisión del 2 de noviembre de 2026. El usuario rechazó la primera maqueta por genérica y alejada del dashboard original.

## Base comprobada

Código: `apps/umi-dashboard/src/shell.jsx`, `screens/overview.jsx`, `styles.css`, `packages/tokens/dist/dashboard.css`.
Capturas: `docs/reports/evidence/2026-10-11-onca-console/01-overview.png` y `docs/reports/evidence/2026-10-13-jornada-operacion/01-dashboard-floor.png` del repositorio UMI.

## Auditoría Unslop

- La barra blanca eliminaba el contraste y la identidad de la navegación azul marino original.
- «umi Dashboard» sustituía sin motivo la marca tipográfica «umidash».
- La maqueta repetía categoría, título, descripción y encabezado, gastando altura en móvil.
- El resumen inventaba un tablero de métricas diarias y un gráfico de barras; desplazaba visitas, lealtad, estaciones y actividad del monedero que sí tiene el original.
- Las tablas sin una superficie común y los formularios genéricos perdían la composición de consola del producto.
- La tipografía había cambiado a la del POS, aunque el dashboard usa Inter Tight y Source Sans 3.

## Dirección

Producto: administración de un café, sus ventas, clientes, lealtad y operación.
Carácter: preciso, operativo, reconocible.
Mundo: la consola umidash existente, con sus áreas y vocabulario.
Momentos: el ingreso principal y el estado de las estaciones; color sólo con significado.
Firma: barra azul marino, marca umidash y encabezado con contexto de negocio y sucursal.

## Intervención

Recuperar navegación y orden original, fuentes y colores reales. Mantener el resumen original: ingresos del mes, indicadores de lealtad, estaciones y centro de acción junto a actividad del día. Mejorar tamaño de controles, separación, ancho de contenido y lectura móvil. El pescado continúa como fondo completo del acceso. No añadir gráficos decorativos ni tarjetas nuevas para completar espacios.

Se conservan los 19 módulos de muestra, 47 vistas, campos, controles y las herramientas recuperadas del editor. La presentación no sustituye los contratos ni las funciones de las aplicaciones reales. La matriz de paridad del prototipo distingue operaciones locales de recorridos simulados.

## Acceso

La tarjeta blanca de acceso también fue rechazada por genérica. Se recupera la composición del login original: marca umi con ondas, «Hola de nuevo» y formulario directo sobre la imagen oscura. Los campos llevan etiqueta exterior, una sola superficie y un solo borde; 52 px de alto. El botón recupera la forma redondeada, el azul y los 50 px del producto actual. La primera variante con etiqueta dentro produjo bordes anidados y fue retirada. La verificación comprueba el borde real y el color del texto hijo del botón, no solo el estilo de su contenedor.

La frase original se conserva por instrucción explícita del usuario: «Tu operación, en tiempo real. Supervisa la operación de tu negocio al momento, desde un solo panel.» Se verifica su presencia completa y la ausencia de superposición con el formulario en los cinco formatos de acceso.

## Resumen narrativo de Ventas

Se recuperó «Resumen del periodo» debajo de los indicadores. Su omisión en el prototipo fue una regresión: el dashboard original lo conserva en `screens/ventas-report.jsx` y obtiene el texto mediante `useSalesInsight(range, refresh)` en `data.jsx`. El servicio usa el mismo periodo, negocio y sucursal que los totales y oculta el panel cuando no hay narrativa. Este contenido funcional debe conservarse al integrar el diseño.

Stageshow presenta un texto de ejemplo calculado con los datos del reporte: venta neta, pedidos pagados, ticket promedio, unidades y producto más vendido. No llama al servicio de análisis ni modifica la aplicación real. Hoy, Ayer, 7 días y 30 días actualizan el texto; la agrupación o búsqueda de la tabla no cambia el alcance del resumen. Las sucursales sin datos muestran indicadores en cero, sin heredar el resumen ni los desgloses de Centro.

Verificación del 2 de noviembre de 2026: `node scripts/device-qa.mjs --sales-summary` pasa 29 comprobaciones de periodo, datos y contexto, Windows, iPhone, Android, iPad vertical y Galaxy Tab en ambas orientaciones; también iPhone oscuro. Se inspeccionaron las capturas de escritorio y teléfono. `--dashboard-regression` pasa sus 22 comprobaciones, incluidas coincidencia de totales y exportación del periodo. TypeScript y build pasan; el build mantiene el aviso de tamaño de chunks. Evidencia en `shots/sales-summary-qa.json`, `shots/sales-summary-windows.png` y `shots/sales-summary-iphone.png`.
