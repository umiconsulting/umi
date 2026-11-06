# Revisión del menú con el redesign local

Fecha: 2026-11-02. Maqueta local y publicada en umi-stageshow.pages.dev, sin PR ni conexión al backend.

## Referencia y alcance

El diseño solicitado está en /Users/moon/Documents/umipos-redesign; todavía es un prototipo local. Las referencias visuales son shots/device-windows-portrait.png y shots/device-iphone-portrait.png. Los tokens y componentes visuales proceden de src/catalog.css y src/interface-system.css.

Se adaptaron el menú del cliente, producto, carrito, confirmación y seguimiento: IBM Plex Sans y Bricolage Grotesque, superficies cálidas, azul marino, categorías pastel, controles de 44/48 px y tarjetas de producto completas como botones. Las tarjetas del menú público son más altas que las del POS para acomodar los nombres y mantener su lectura en móvil.

La versión interactiva es menu-v6.html + menu-redesign.css. menu-v5.html se conserva. Stageshow utiliza una copia sincronizada con scripts/sync-menu.mjs; solo cambia las rutas de recursos y carga el adaptador de escenas. Se verificó la igualdad de HTML y CSS entre ambas copias.

Se mantienen las ocho escenas, modalidades, precios y reglas. El pedido #1042 suma $145 + $65 = $210. El correo sigue añadido por el adaptador de escenas; la maqueta interactiva todavía captura nombre y teléfono. Dashboard, POS y KDS reutilizan ahora los componentes del redesign local mediante StaffScreen y la ruta /?embed=menu-staff. Las referencias anteriores quedan documentadas en REHEARSAL.menu-v5.md.

## Verificación

- npm run typecheck: correcto.
- npm run build: correcto.
- node scripts/qa.mjs: 63 comprobaciones correctas, sin errores; pausa, repetición, ocho capítulos, modalidades, cancelación y carteles de escritorio/móvil.
- node scripts/menu-redesign-qa.cjs: correcto; 320, 390, 760, 1024 y 1440 px sin desbordamiento horizontal. Comprueba extras, cantidades, total, carrito, recogida inmediata/programada, aceptación, cancelación pendiente y autorizada, mesa, listo y búsqueda. Sin errores de consola ni respuestas HTTP fallidas.
- Se revisaron las capturas en shots/redesign: escritorio, móvil, producto, carrito, confirmación, programación y seguimiento.

## Revisión independiente

La revisión con las dos capturas del redesign local encontró tarjetas demasiado altas, separadores duplicados antes del total e icono de estado parcialmente oculto al actualizar el seguimiento. Se ajustó la densidad, se dejó un solo separador y se restauró el inicio del diálogo al cambiar su estado. La segunda revisión de desktop.png, mobile-viewport.png, cart.png y tracking.png confirmó que los tres puntos estaban resueltos. Los cuatro productos destacados y sus precios caben completos en la captura móvil de 390 × 844.

## Movimiento y límites

Se grabó el recorrido completo de selección de productos hasta el carrito en escritorio y móvil: shots/redesign/menu-motion-wide.png y menu-motion-mobile.png, dieciséis imágenes por formato. Los objetivos del cursor ahora se miden sobre las tarjetas completas. Solo se desplaza el menú cuando el producto está fuera del área visible.

Los registros de filmación están junto a las imágenes en JSON. El gate de composición imprime rehearsal passed, pero la cobertura temporal queda inconclusa por huecos de muestreo (código 2). Esto no certifica cada fotograma ni los dispositivos físicos. La revisión independiente cubrió capturas estáticas.

No se ejecutó Flutter ni se verificaron integración real con POS/KDS, persistencia, permisos, correo o notificaciones reales. Los pedidos y cambios de estado son simulados.

## Revisión del personal y controles del visor

El proyecto vecino comparte controles BoardUI para elegir aplicación y Explorar / Recorrido. El pedido #1042 usa Workspace, Kitchen y PosReceipt; la configuración vive dentro del Dashboard real del prototipo. Los avisos tienen espacio propio, la sucursal muestra Centro y el ticket conserva Bruma.

Pruebas locales: TypeScript en ambos proyectos, build, pages-qa (13), digital-menu-pages-qa (18), viewer-redesign-qa (33) correctos. Las capturas están en ../umipos-redesign/shots/viewer-redesign. No certifican integración real.

Filmación adicional: shots/redesign/staff-config-motion.png (390 px) y staff-pay-motion.png (1280 px), ocho cuadros por escena con marcas y 0.7 s posterior. Se revisaron visualmente cursor, guardado, pago y entrega. El recorder reporta cobertura temporal inconclusa y seis reglas globales de Phone del redesign: estos escenarios no montan Phone, pero el análisis de CSS alcanza las reglas del bundle incrustado. También registra la aparición inicial del iframe al cargar. No se afirma que el gate haya pasado ni que se haya revisado cada fotograma.

## Unslop: pulido sobre la dirección elegida

Producto: recorrer un pedido de comida, desde el cliente hasta el personal de Umi.
Carácter: claro, cálido, operativo.
Mundo: mostrador, barra, cocina y administración del negocio.
Momentos: productos fotografiados del menú y total/estado del pedido como foco operativo.
Firma: azul Umi, identidad tipográfica existente y estados de la misma cuenta entre pantallas.

Auditoría: alineación distinta del dispositivo entre vistas; selector de sucursal sin valor; avisos sobre títulos; nombre de negocio inconsistente en el recibo. Se corrigieron con los componentes y tokens existentes. Se preservan la paleta, las fuentes y las proporciones del redesign aprobado. El KDS conserva su cola real de una comanda; no se agregan pedidos ficticios de relleno. La configuración conserva su región desplazable y botón Guardar fijo en móvil.

No se añaden decoración, imágenes ni animaciones de carga. Textos de acciones concretas; misma escala de botones y espaciado del visor. Unslop por Damir Sokolovsky (@heydamir), CC BY 4.0; créditos completos en el NOTICE del proyecto vecino.

## Visor integrado del recorrido

Tras la revisión del usuario, los controles del recorrido se movieron a DigitalMenuShow en el proyecto del redesign. Usa Button, Checkbox y Select instalados de BoardUI, estilos de DashboardShow y DeviceFrame. El iframe carga sólo la escena y se ajusta al área útil del dispositivo; la página independiente publicada abre el mismo visor. La prueba de integración pasó 19 comprobaciones locales, incluida la interacción física con Sin animación y el enlace independiente. POS y Dashboard conservaron sus 13 comprobaciones correctas.

La revisión independiente de 1280-config-pickup, 390-config-pickup, controls-dashboard, desktop-tour y mobile-tour no encontró defectos nuevos en controles, captions ni marcos. La tarjeta inicial se verificó aparte: muestra Ana, no {orderIdentity(s)}. Los recorridos en 1280 y 390 completaron sus escenas; el registro inicial intentó ver la tarjeta de escritorio en el formato móvil, donde está oculta por diseño. Se corrigió el formato de esa comprobación y pasó de forma separada.

## Verificación pública del visor unificado

Despliegue: https://55c604ac.umi-stageshow.pages.dev, publicado también en https://umi-stageshow.pages.dev. Las tres pruebas públicas finalizaron correctamente: POS/Dashboard 13, escenas y controles 38, integración del menú 19; 70 comprobaciones, sin errores de página ni recursos faltantes. Evidencia en shots/cloudflare-pages-qa.json, shots/viewer-redesign/qa.json y shots/digital-menu-pages/qa.json. La prueba de cambio de dispositivo espera que termine el cierre del selector BoardUI antes de hacer clic dentro del iframe.
