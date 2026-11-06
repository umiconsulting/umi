# Dirección vigente del prototipo

UMI POS para operación de Caja, Barra y Cocina. El estudio conserva IBM Plex Sans, Bricolage Grotesque y azul marino. Usa Stageshow para representar las pantallas y el recorrido; BoardUI aporta controles accesibles; Unslop guía la composición y la limpieza visual.

El diseño toma las superficies suaves y la legibilidad de Zavo, Vita y Elinext. Las imágenes de Polotab sustentan la columna de categorías y la edición de opciones dentro del catálogo. El usuario eligió reflejar la distribución: productos, categorías, cuenta. La navegación y el control de despliegue forman una barra independiente, con UMI siempre visible.

Los productos son botones separados, con color por categoría, etiqueta escrita y fotografía de fondo. El texto conserva una zona de menor intensidad fotográfica. Todo no usa grupos ni encabezados intermedios. La cuenta conserva cantidades y modificadores. El plano mantiene coordenadas fijas y estados de mesa distinguibles; verde significa disponible.

La entrada tiene usuario, PIN y resumen operativo. Las claves son públicas y exclusivas del prototipo. Caja, Barra y Cocina tienen vistas distintas. El KDS no ofrece entrega al cliente, importes ni cobro.

Los tres recorridos mantienen origen, servicio, folio y artículos hasta el pago. El estado de pago no sustituye el estado de preparación. La animación representa la transferencia de trabajo entre estaciones.

Configuración y Caja se contrastaron con el código actual de Flutter. El inventario con fuentes está en ../docs/current-pos-options.md. La propuesta reúne hardware e impresión bajo Configuración y conserva la secuencia real de cierre: conteo, diferencia, conciliación y confirmación. La maqueta incluye interacciones locales; no conecta dispositivos ni servicios.

El pase de Unslop retira bordes nativos y sombras de los botones de BoardUI, elimina mensajes decorativos y conserva un solo lenguaje de acciones. No añade tarjetas de métricas comerciales al acceso. El resumen muestra turno, disponibilidad del salón y pendientes del menú digital.

La verificación cubre escritorio y móvil, tema claro y oscuro, teclado PIN, separación de roles, catálogo, mesas, cobro, movimientos y cierre. La revisión de todos los cuadros de animación sigue fuera de la certificación disponible; ver REHEARSAL.md.


La vista móvil tiene categorías de 48 px, navegación de texto legible, cuenta con regreso superior y acciones fijas al pie. Caja se organiza en Movimientos, Turno y Cierre. El conteo replica denominaciones y cantidades del POS nativo, incluida la moneda de $0.50; la política determina si el esperado se oculta y si se capturan denominaciones o total.

El visor ofrece Windows, Mac, iPhone 17 Pro, Pixel 8, iPad Air 11″ y Samsung Galaxy Tab A11. Las tablets giran con controles Vertical/Horizontal. Los marcos Phone y Window aportan zonas del sistema; sus variantes se amplían en el kit para tablet y Windows. La tablet vertical usa catálogo con filtros arriba y cuenta lateral; la horizontal conserva categorías en el centro. Los formatos son referencias de composición y no una integración nativa por plataforma.


## Dashboard: dirección corregida

## Recorrido del dashboard

Stageshow reproduce una visita completa, una vez, desde el acceso y la verificación hasta las 47 vistas disponibles (las dos de plataforma solo en ese perfil). Se conserva la composición ya aprobada. El recorrido usa el dashboard real del prototipo, cursor medido por `data-target` y cambios de estado escritos en el guion; no ejecuta clics DOM ni operaciones del negocio. Los capítulos siguen el menú: operación, clientes, negocio, configuración y perfil. Los detalles de pedidos, caja, productos, clientes, inventario y dispositivos dan contexto a las listas. El plano muestra edición y propiedades sin publicar cambios.

Los controles de reproducir, pausa, anterior, siguiente, capítulo y explorar están fuera del dispositivo. Explorar conserva la pantalla visible. Cambiar formato o perfil detiene la animación en el mismo capítulo. Movimiento reducido permite avanzar paso por paso. Se verificarán cobertura de vistas, blancos del cursor, pausa, reinicio, cancelación, separación de perfiles y formatos de teléfono/tablet, además de acceso y exploración existentes.

La propuesta inicial del dashboard fue rechazada por alejarse de su identidad. La versión vigente parte de shell.jsx, overview.jsx, tokens y capturas del producto original: barra azul marino, umidash, Inter Tight/Source Sans 3, encabezado con negocio y sucursal. Conserva el orden de ingresos del mes, lealtad, estaciones, centro de acción y actividad del día. No conserva el gráfico añadido en la propuesta anterior. El pescado original cubre todo el acceso.

Los componentes de formulario comparten alturas, radios y estados con POS; las fuentes propias de cada aplicación se conservan. Las 47 vistas están representadas, con alcance funcional detallado en ../docs/prototype-parity.md. El editor de plano recupera las herramientas del original y mantiene la geometría operativa del POS. La integración real requiere portar la presentación sobre el código actual, según ../docs/staging-integration-audit.md.
