# Revisión del flujo sobre el diseño actual

Fecha: 2026-11-01. Demo local, sin PR, despliegue o conexión al backend.

## Referencias

La primera versión partió de device-pair. El usuario rechazó su diferencia con el producto actual. Se retiró esa composición. Las referencias de diseño son ahora:

- umi-menu-preview/.superpowers/brainstorm/18629-1793487079/content/menu-v5.html.
- umi/apps/umi-dashboard/src/shell.jsx, src/styles.css y packages/tokens/dist/dashboard.css.
- Captura POS: umi/docs/reports/evidence/2026-10-27-onca-incident-010/post334-caja-current.png.
- Captura KDS: umi/docs/reports/evidence/2026-10-18-account-first-interaction/09-kds-item-ready.png.
- Captura Dashboard: umi/docs/reports/evidence/2026-10-13-jornada-correcciones/dashboard-reglas-cobro-inicial.png.

El menú contiene una copia del HTML aprobado. Una comparación de texto confirma igualdad al revertir las rutas de recursos y quitar la carga del adaptador. El original permanece intacto.

El Dashboard usa una copia acotada de sus estilos y tokens. POS y KDS son representaciones HTML de las referencias. Las nuevas acciones son propuestas; no son capturas de funciones ya implementadas.

## Escenas

Configuración, productos, envío, recepción, preparación, aviso, cobro/entrega y cancelación. Tres modalidades: recoger, mesa y programado. Cada capítulo se reproduce una vez y permite pausa, repetición y avance manual.

El menú conserva categorías, fotografías, opciones, carrito y diálogos. El adaptador agrega el correo acordado solo a la copia de la demo. Los precios vuelven a los del menú aprobado: $145 y $65, total $210.

El KDS usa sus tarjetas, casillas de productos y navegación. Antes de liberar un pedido programado muestra el estado vacío. La reserva se explica en el recorrido.

## Comprobaciones

- npm run typecheck: correcto tras los cambios finales.
- npm run build: correcto tras los cambios finales.
- node scripts/qa.mjs: 63 comprobaciones correctas, sin errores. Incluye pausa, repetición, ocho capítulos, tres modalidades, cancelación directa y con autorización, 24 carteles de escritorio y ocho vistas compactas.
- node scripts/qa.mjs --review: tres comprobaciones específicas después de las correcciones finales, sin errores. Verifica que desaparezca Rechazar al aceptar, que la acción final del KDS quede sobre la navegación móvil y que la selección móvil llegue al carrito original.
- La revisión midió el botón lateral: fondo transparente y texto rgba(240, 244, 255, 0.62), como en el Dashboard.
- Se revisaron visualmente el menú inicial, configuración, aceptación, KDS, seguimiento y sus vistas móviles. Las capturas están en shots/.

Herramientas: Stageshow 0.1.0, Vite 6.4.5, Node 25.9.0 y Chromium local mediante Playwright Core.

## Revisión independiente

El revisor confirmó que la composición ya conserva la identidad visible del Dashboard, POS y KDS. Detectó:

1. Rechazar seguía visible después de aceptar: se retiró del estado aceptado.
2. Para llevar tenía cubiertos: ahora usa una bolsa.
3. La segunda acción del KDS móvil quedaba bajo la navegación: el recorrido desplaza el contenido y reserva espacio inferior.

El revisor recibió una captura antigua del defecto de botones blancos en el Dashboard. Se corrigió el conflicto con el reset CSS de Stageshow y se verificó con captura y estilos calculados nuevos.

## Filmación y límites

product-kitchen-wide.png/json recoge diez estados de la liberación y preparación. El gate de ilustración no pasó: señaló alineación entre el logo centrado y los enlaces laterales, y márgenes de tarjetas dentro del tablero. Esas estructuras siguen las referencias del producto y la corrección explícita del usuario. No se cambió el diseño para satisfacer las reglas de composición publicitaria.

La misma grabación dejó cobertura temporal inconclusa por huecos de muestreo. También registró cambios directos de texto y aparición de tarjetas al actualizar el KDS. No se afirma que el movimiento esté validado en todos los fotogramas.

product-menu-mobile.png/json recoge el menú aprobado dentro de su iframe. La primera captura detectó el objetivo del primer producto fuera de vista. Se añadió un desplazamiento previo y se comprobó el recorrido en Chromium. El gate no inspecciona todo el DOM interno del iframe; las capturas y las comprobaciones con Playwright cubren ese contenido.

La filmación móvil final contiene dieciséis imágenes, todas inspeccionadas. Imprime rehearsal passed y ya no reporta objetivos ausentes. Termina con código 2 por catorce huecos de muestreo, con máximo de 50.5 ms. Se inspeccionaron también las diez imágenes finales del KDS. No se presenta el gate del KDS como aprobado.

No se verificaron dispositivos físicos, Flutter nativo, permisos, persistencia, correo real ni integración con POS/KDS. No se enviaron pedidos, mensajes o pagos. La animación usa estados simulados.
