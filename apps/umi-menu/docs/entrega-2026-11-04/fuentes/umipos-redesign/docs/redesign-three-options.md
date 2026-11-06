# Tres composiciones del POS

Dirección aprobada en task 3F; no requiere una nueva aprobación.

Producto: caja de café con recepción, preparación y cobro según rol.
Carácter: directo, seguro, práctico.
Mundo: mostrador, salón y comanda física.
Momentos: identidad y categoría del producto; estado físico de las mesas.
Firma: umi en minúsculas, navy UMI, IBM Plex Sans y jerarquía cuenta/servicio/saldo.

## Auditoría y decisión

1. Se conserva la galería existente, sus categorías entre catálogo y cuenta y su composición exacta.
2. El ensayo anterior seguía siendo una galería de fotografías lavadas con el mismo rail central. Se sustituye por teclas de trabajo con categorías horizontales, nombres dominantes y precios, sin fotos ni huecos de imagen. El ritmo usa tamaños realmente distintos sin cambiar el orden DOM ni los datos.
3. El UMI original tiene menú navy, umi persistente, La carta con búsqueda, pestañas de categorías y comanda derecha. Se conserva esa relación, con botones horizontales compactos cuyo nombre completo a 18 px identifica el producto, categoría explícita, borde de categoría y precio alineado. Dos columnas útiles en escritorio, una en teléfono y tablet vertical.

Se reutilizan Workspace, Scene, controles BoardUI instalados, ScrollFade, modelos y callbacks. Los cambios se limitan a composición scoped y al selector; dashboard, menú digital y propuesta 1 quedan fuera.

UNSLOP de Damir Sokolovsky (https://heydamir.design/unslop), CC BY 4.0, guió la auditoría de jerarquía, fotografía y densidad. Se mantienen los frames Stageshow existentes y su tour.


## Identidad del catálogo · ajuste 3G

Se aplica la petición de retirar las fotos de la propuesta 2 y mejorar la identificación de productos de la 3 sin perder el UMI original. La propuesta 2 conserva el ritmo desigual de sus teclas y sus colores de categoría; el espacio de fotografía y el relleno de precio desaparecen. La propuesta 3 conserva navy/umi, La carta/búsqueda, pestañas horizontales y cuenta derecha. Cada botón ofrece nombre completo (BoardUI `text-title-3-medium`, 18 px), categoría escrita, borde con el tono de su pestaña, precio en columna estable y cantidad separada. Las superficies son discretas y permiten leer el nombre sin una imagen de fondo.

Evidencia observada: `public/actual.png` muestra esa organización de UMI, pero sus iniciales repetidas no identifican productos de forma única. La investigación `umi/docs/research/2026-10-12-polotab-menu.md` documenta nombres, precios, franjas de categoría, acción de tarjeta completa y marcas adicionales al color. Las fotografías comerciales no demuestran rapidez ni precisión del operador. La inferencia de diseño aquí es dar prioridad al nombre legible y usar categoría/color como orientación secundaria; no se afirma una mejora medida de rendimiento. `CATALOG_UI_DECISIONS.md` corresponde al catálogo nativo y sigue siendo su contrato; esta excepción visual acotada es del prototipo y está autorizada por el usuario.

Una capacidad derivada por diseño controla las fotografías efectivas del catálogo, las opciones y Ajustes. Las propuestas 2 y 3 no montan imágenes de producto ni controles para activarlas. Se conserva la preferencia de la propuesta 1 al cambiar 1 → 2 → 3 → 1; no se reinicia Workspace ni Scene. Modelos, productos, precios, callbacks, roles, dashboard, menú digital y coreografía permanecen iguales. La identificación es una decisión visual, pendiente de medición con operadores reales.


## Extensión autorizada: inicio con PIN

Tras aclarar el usuario que ambas pantallas debían expresar cada dirección, el acceso 2 pasa a una consola centrada: botones reales de los tres operadores existentes, PIN y teclado agrupados, resumen de turno/mesas/pedidos en banda inferior. El acceso 3 usa una banda navy con umi/ONCA/Centro, área de acceso y resumen a la derecha; en teléfono la identidad forma un encabezado navy y el resumen se apila. Se comparten selección de rol, validación, edición de PIN, teclas y objetivos del tour. La estructura de 1 conserva sus mismos elementos y posiciones.

En venta 3, Frecuentes reutiliza los cuatro IDs favoritos y la misma función de agregar/editar; sus objetivos `frequent-*` no duplican los del tour. La preferencia del menú se guarda por diseño: 3 abre con menú expandido en escritorio, 2 compacto, y cada elección manual se conserva. Cambiar diseño no reinicia cuenta, pagos, PIN, tema ni dispositivo.

Verificación de este ajuste: capturas y resultados en `shots/product-identity/`. Son pruebas del prototipo en navegador con marcos Stageshow, no mediciones operativas ni pruebas de hardware nativo. Se conserva la evidencia visual anterior en `shots/option2-revision/` y `shots/option3/`.

## Direcciones completas · 3H

La revisión del 2 de noviembre detectó que, fuera del PIN y catálogo, las tres propuestas seguían compartiendo la misma jerarquía y distribución. Comanda, modificadores, cobro, entrantes, mesas, preparación, caja, conteo, configuración y recibo solo variaban su acabado. Ese alcance incompleto motivó este pase completo.

La auditoría se hizo sobre los componentes actuales y `public/actual.png`, `umi-zavo-pos-screen.png` e `umi-inspo-zavo.png`. Las referencias de Zavo documentan el catálogo; las demás pantallas son una extrapolación de diseño para UMI, no una reproducción de pantallas de Zavo que no se han visto. Se conserva la dirección aprobada: operativa, legible, práctica; mostrador, plano, comanda y libro de caja como referencias de composición. No hay imágenes de producto en 2/3, métricas inventadas ni nuevas capacidades de negocio.

| Superficie | Propuesta 2 | Propuesta 3 |
| --- | --- | --- |
| Cuenta | Filas separadas y dos zonas de trabajo: preparación/envío y saldo/cobro. | Comanda con columnas cantidad/producto/importe, rondas, notas y secciones regladas. |
| Modificadores | Panel ancho dentro del catálogo, bancos de opciones y campos en columnas. | Inspector derecho que reserva ancho real; catálogo restante de una columna. En teléfono, registro de opciones de ancho completo. |
| Cobro | Teclas de método verticales, formulario central y cuenta a la derecha. | Registro superior de cuenta y pagos, pestañas de método, formulario y pie continuo con cambio/confirmación. |
| Entrantes | Cola compacta y mesa amplia de revisión con aceptación asociada al total. | Registro de llegada con comanda expandida debajo. |
| Mesas | Plano completo y dock horizontal de mesa seleccionada debajo. | Plano y documento lateral con hechos, cuenta y operaciones de mesa. |
| Barra/cocina | Carriles Recepción, En preparación y Lista, derivados de las rondas reales. | Registro de comandas horizontales, identidad/productos/estado y acción. |
| Caja | Banda de turno, teclas diferenciadas de entrada/salida/resguardo y áreas de operación. | Ecuación y libro como documento principal, operaciones compactas debajo; también continuo en teléfono. |
| Conteo | Bloques de denominación con cantidad/subtotal y área de envío separada. | Registro de valor/cantidad/subtotal con filas regladas y pie fijo. |
| Configuración | Banco horizontal de categorías y paneles de dispositivos. | Índice y registro de dispositivo/estado, conexión/asignación y operaciones, con formularios alineados. |
| Recibo | Resultado e importe dominantes, detalles compactos y acciones al pie. | Documento de recibo junto al registro del pago; apilado en teléfono. |

Las agrupaciones JSX se reutilizan dentro de sus dueños de estado. No se introdujeron claves por diseño, cambios de modelos, reset de cuentas, precios, reglas de terminal ni políticas de caja. La propuesta 1 mantiene su rama original. El trabajo de CSS está acotado a 2/3 en `src/full-directions.css`; las envolturas de compatibilidad de 1 usan `display: contents` o la rama original.

Se conservan BoardUI instalado, sus tokens, campos y botones; ScrollFade existente y el añadido a las opciones de producto; marcos Stageshow y objetivos de los recorridos. La cantidad de denominación y los campos de las alternativas tienen marco de 48 px con área editable de 44 px. Los pies de cobro y conteo se verificaron en las alturas reales de tablets verticales y horizontales.

Evidencia: `shots/full-directions/`. La matriz cubre 2/3, claro/oscuro, Windows, iPhone, Android, iPad y Galaxy en ambas orientaciones (336 estados medidos; capturas representativas, no una imagen redundante de cada estado). `state-geometry-probe.json` registra 66 comprobaciones de conservación de estado y geometría. Los resultados de suites se separan en `qa-2` y `qa-3`. La validación del original 1 y la publicación las realiza la revisión independiente.
