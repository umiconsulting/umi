# Bitácora de Umi Menu

## 2026-11-24 — Aviso de pago único

- Retirada del aviso de pago en la tarjeta de mesa para evitar su repetición junto al carrito.

## 2026-11-24 — Moneda explícita

- Precios con símbolo y código de moneda, por ejemplo $50.00 MXN.
- Formato compartido para catálogo, opciones, carrito y recibo; conserva la moneda de la API.

## 2026-11-24 — Búsqueda persistente

- Buscador y categorías permanecen juntos al desplazar el catálogo.
- Controles compactos en móvil; el título principal permanece fuera del bloque fijo.

## 2026-11-24 — Revisión y navegación

- Aviso de pago con el personal en el carrito, confirmación y recibo.
- Resumen antes del envío con cantidades, variantes, extras, indicaciones y precios estimados.
- Categorías visibles al desplazar el catálogo y disponibilidad destacada en tarjetas.
- Aviso previo cuando faltan presentaciones disponibles.

## 2026-11-24 — Botón de agregado

- Texto y precio centrados en el botón, incluso cuando falta el precio por una selección pendiente.

## 2026-11-24 — Título principal

- Título principal actualizado a «MENU DIGITAL».

## 2026-11-24 — Vaciar carrito

- Botón para vaciar el carrito en escritorio y en el diálogo móvil.
- Encabezado sin separador y botón con espacio superior para evitar la unión visual de los bordes.
- Opción Deshacer con validación de los productos antes de restaurarlos.
- Acción bloqueada durante el envío o la comprobación pendiente.

## 2026-11-24 — Imagen del reverso

- Imagen nítida en el reverso, con los recursos existentes por categoría.
- Etiqueta «Imagen ilustrativa» cuando el producto no tiene fotografía propia.
- La tarjeta conserva sus dimensiones y el frente conserva el desenfoque.

## 2026-11-24 — Fondo de peces

- Patrón SVG estático con peces de trazo azul tenue sobre el fondo del menú.
- Ilustración decorativa propia; conserva el logotipo y las superficies sólidas de lectura.
- Sin dependencias, animaciones ni imágenes grandes.

## 2026-11-24 — Filtros del catálogo

- Categorías publicadas de la API con prioridad; clasificación visual por tipo cuando faltan todas.
- Filtros con cantidades, búsqueda dentro de la categoría y navegación de teclado.
- Verificación con 64 productos reales, sin pedidos y sin desbordamiento móvil.

## 2026-11-24 — Jerarquía y lectura del menú

- Retirada de los textos auxiliares del reverso; se conserva únicamente la acción +.
- El hover conserva el borde suave de la tarjeta; el foco de teclado mantiene su indicador.

- Reverso azul suave con miniatura e icono, nombre y precio destacados, resumen y única acción +.
- Alto y ancho iguales al frente. El contenido largo se resume y permanece completo en el modal.
- Lectura del detalle completo también para productos no disponibles; la acción de agregado sigue restringida.
- Encabezado «Menú», texto secundario con más contraste y nombres más legibles.
- Carrito con quitar y deshacer, sin modificar un envío pendiente. Avisos accesibles dentro de los diálogos.
- Investigación en la nota existente, con Material, Carbon, Soft Restaurant y WCAG. Capturas sólo en Desktop.
- Verificación en Chromium real de escritorio y móvil, descripción extensa, geometría del giro y recuperación del total.
- Sin nuevas dependencias, pedidos, pruebas ni capturas en el repositorio.

## 2026-11-24 — Selección de variantes

- Carrito con columna de imagen de 54 píxeles, separación de 14 píxeles y contenido flexible para evitar solapes.

- El botón + abre siempre el modal antes de agregar. Se retiran los botones redundantes de personalización y elección de opciones.
- Precio estimado y separación de líneas por variante, con el nombre elegido en el carrito.
- Validación y precio del servidor; snapshot de la variante para preparación y recepción en POS.
- Lectura por lote de variantes con la misma disponibilidad del catálogo; sin consultas por cada producto.
- Campo opcional sin valor predeterminado para conservar reintentos anteriores.
- La API desplegada anterior todavía no ofrece estas opciones. La prueba del selector usó respuestas controladas; no creó pedidos.

## 2026-11-24 — Prueba con el catálogo de staging

- Tarjetas con giro para leer descripción, precio, opciones y alérgenos. Botón + para agregar o elegir opciones; retorno al pulsar el reverso o Escape.
- Movimiento reducido respetado y cara oculta sin controles interactivos. Una sola equis para borrar la búsqueda.
- Fondos ilustrativos tenues y difuminados para comida, bebida y postre cuando falta la foto real; icono visible por tipo. Se reutilizan recursos existentes.
- Texto de categorías centrado. Nombre del negocio sólo en el encabezado principal; retirada de etiquetas pequeñas repetidas.

- Puente local opcional hacia las rutas públicas de la API, sin credenciales del dashboard.
- Conservación de las respuestas reales y de los errores; sin catálogo de respaldo ni pedidos simulados.
- Validación de ONCA, mesa T3: 64 productos, ocho con opciones, escritorio y móvil sin errores JavaScript.
- No se envían pedidos, no se modifica la ocupación de mesas y no se despliega el PR.
- La consulta sin QR continúa pendiente de la nueva ruta en la API desplegada.

## 2026-11-18 — Claridad y controles del menú

- Búsqueda sin resultados con texto específico y botón para borrarla.
- Fotografías con dimensiones declaradas; primeras tarjetas sin carga diferida y restantes con carga diferida nativa.
- Respaldo visual si una fotografía falla, sin bloquear la selección del producto.
- Controles de cantidad, búsqueda, categorías y cierre con objetivo táctil de 44 × 44 píxeles.
- Foco visible y ajuste de nombres largos. Conteo de resultados anunciado a tecnologías de asistencia.
- Las opciones múltiples respetan su máximo desde la selección y permiten deshacerla.

Validación: Chromium real en escritorio y móvil, con catálogo sintético y fallos de imagen controlados.
Se conserva una sola prueba automatizada. No se agregan dependencias ni archivos de evidencia al PR.
Fuentes: guía de carga diferida de web.dev y criterios de tamaño de objetivo de WCAG, citados en la investigación.
No se presenta esta comprobación como una medición de Core Web Vitals ni una auditoría completa de accesibilidad.

## 2026-11-17 — Conexión con la API

Rama: `hc_digital_menu_connect`. Base: `b509fcc487bf17fe01cb80787533c98955a664ce` de staging.

- Sustitución del catálogo fijo y los pedidos simulados por contratos y llamadas públicas.
- Consulta por restaurante y sucursal con el catálogo existente de la API.
- QR como autoridad de mesa; precios finales calculados por la API.
- Recuperación de envíos inciertos con cuerpo y clave de idempotencia persistentes.
- Separación del carrito por contexto y coordinación entre pestañas.
- Conservación del tema aprobado y fotos del catálogo. Retirada de acciones operativas simuladas.
- Una sola prueba nueva para el reintento, por instrucción del usuario. Retirada de pruebas de la simulación eliminada.
- Investigación de UI, rendimiento y alcance en `docs/research/2026-11-17-digital-menu-recommendations.md`.

Validación: recorrido Chromium en escritorio y móvil con respuestas controladas; sin errores JavaScript.
Se comprobó pérdida de respuesta, recarga, reintento idéntico, total confirmado y consulta sin QR.
No se creó ningún pedido remoto. El despliegue y un pedido persistido de piloto quedan pendientes.

## 2026-11-06 — Limpieza del módulo

Rama: `hc_umi_menu_cleanup`. Base local: `e68ed51e`, merge del PR #260 a staging.

- Separación en `src/`, `public/`, `scripts/` y `tests/`, coherente con la organización de la landing.
- `public/` contiene recursos versionados; `dist/` es la única salida generada y servida.
- El build limpia su salida para evitar recursos obsoletos.
- Retirada de copias de otros prototipos, escenas, skills, capturas, backlog exportado e informes duplicados.
- Reglas de negocio, decisiones pendientes, límites, créditos y guía de diagnóstico consolidados en README.md.
- Retirada del manifiesto manual de hashes y de las tipografías antiguas que el tema ya sustituía.
- Conservados fotografías activas, licencias OFL, QR, generador y pruebas de reglas.
- El historial Git conserva el detalle original; no se reescribe ni se borra el respaldo externo de Downloads.

Esta limpieza no integra backend ni modifica los flujos comerciales simulados.

### Validación local

- Reducción de 1.170 archivos versionados (23,82 MiB) a 31 archivos fuente (1,57 MiB). Se excluye `dist/`.
- SHA-256: los cinco scripts del navegador y `mvp.css` coinciden con los anteriores al traslado.
- Node v22.23.4 y pnpm 10.29.3: `check`, `test` y `build` aprobados. Diez pruebas aprobadas.
- Python Playwright 1.62.0 y Chromium instalado: prueba HTTP a 430 × 932 y 1440 × 1000.
- Verificados: fotografía ampliada, carrito tras recarga, pedido de mesa, solicitud de cuenta, recogida y aceptación.
- Sin errores JavaScript ni respuestas HTTP fallidas durante esos recorridos.
- Se quitaron cinco declaraciones de fuentes antiguas; el tema activo conserva IBM Plex y Bricolage.
- Formato de archivos modificados y `git diff --check` comprobados.
- No se probó staging, API, POS, KDS, correo ni un dispositivo físico.

Herramientas: scripts existentes del paquete, Node test runner y Playwright disponible en el equipo.
El build sigue siendo una copia estática para preservar los scripts clásicos y evitar dependencias innecesarias.

## 2026-11-05 — Revisión del MVP e incorporación a Umi

- Módulo `apps/umi-menu`, paquete `@umi/menu`, con comandos de desarrollo, build y pruebas.
- Catálogo por secciones, opciones, carrito persistente y seguimiento local.
- Mesa por enlace/QR, recogida inmediata y programada, aceptación y simulación de estaciones y cobro.
- Solicitud de cuenta por mesa. El botón requiere una orden activa sin cobrar; el carrito no lo habilita.
- Hamburguesa con Personal, Recoger, Mesa e Información.
- Promociones con autoavance y foto individual ampliable; sin botón de pausa por solicitud del usuario.
- Corrección del doble marco de foco del buscador.
- Limpieza de frases decorativas, categorías repetidas y altura del carrusel.
- Conservados azul Umi, IBM Plex Sans, Bricolage Grotesque y las fotografías aprobadas.

Commits de referencia: `a387069c` (incorporación), `8f40784c` (cuenta activa), `728d90ce` (formato).
La incorporación inicial incluyó demasiado material histórico. Esta limpieza reduce ese alcance.
Se verificaron diez pruebas de reglas y recorridos de navegador. No acreditaron integración con POS, KDS o correo.

## Antecedentes del diseño

- El menú v6 quedó aprobado el 3 de noviembre de 2026.
- El paquete del 4 de noviembre separó decisiones, flujos, arquitectura y backlog propuesto.
- GitHub Issues fue elegido para seguimiento. P00 y el PR solo documental se descartaron.
- Los datos de Bruma y los plazos del prototipo siempre fueron ejemplos.
