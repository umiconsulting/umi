# Rehearsal: flujo del menú digital Umi

Fecha: 2026-11-01. Demostración local para revisar decisiones de producto.

## Referencia y composición

Gold: `device-pair`, copiado antes de adaptar. Conserva una ventana principal con un teléfono sobre el margen derecho, el kit de dispositivos y la reproducción de Stageshow. `phone-touch` se conserva como referencia adicional. La versión compacta muestra la pantalla relevante del capítulo en un teléfono, sin reducir toda la composición de escritorio.

Se adaptaron colores y tipografías de la maqueta Umi, fotografías existentes, pantallas de configuración, menú, UmiPOS, preparación y seguimiento. El mismo pedido ficticio #1042 aparece a lo largo del recorrido: French toast $145 y latte $70, total $215 MXN.

## Escenas

Ocho capítulos: configuración, productos, envío, recepción en POS, preparación, aviso, cobro/entrega y cancelación. Cada capítulo se reproduce una vez, conserva el resultado y permite pausa, repetición y avance manual. Hay tres modalidades: recoger, mesa y programado. Cancelación incluye pendiente, aceptado y preparación.

Los horarios, productos y reglas representados son ejemplos de diseño. No son valores predeterminados para todos los merchants ni evidencia de una integración implementada.

## Verificación

- `npm run typecheck`: correcto después de los últimos cambios.
- `npm run build`: correcto después de los últimos cambios.
- `node scripts/qa.mjs`: 39 comprobaciones correctas, sin errores del navegador. Incluye pausa, repetición, las tres modalidades, resultado tras terminar ambas estaciones, 24 carteles de escritorio y ocho capturas compactas.
- Capturas en `shots/`: escritorio a 1440 px de viewport y móvil a 390 px; el escenario de escritorio mide 1000 × 700 y el compacto 372 × 660 antes de ajustarse al contenedor.
- Se inspeccionaron las capturas de configuración, productos, envío, aceptación, cocina, aviso, pago y cancelación, además del contenedor completo y `gold-wide.png`.
- El enlace de la maqueta anterior respondió HTTP 200. La nueva demo se abrió en el navegador en configuración/recoger.

## Filmación

`rehearsal-send-mobile.png/json`: envío programado a 390 px. El gate imprimió `rehearsal passed`; el proceso terminó con código 2 por cuatro huecos de muestreo superiores a 27 ms. No equivale a cobertura completa del movimiento.

`rehearsal-kitchen-wide.png/json`: reserva, liberación, barra lista y cocina lista en escritorio. El gate imprimió `rehearsal passed`; el proceso terminó con código 2 por nueve huecos de muestreo (máximo 33.3 ms). Las diez imágenes de estados se inspeccionaron. Se corrigieron el solapamiento entre reserva y estaciones, etiquetas cambiantes innecesarias dentro de estaciones ocultas y el ancho impar junto al icono de Listo. El aviso de medio píxel desapareció en la última ejecución.

Persisten avisos de medición de ancho y sustitución de nodos en `Swap`, y una revisión manual del reloj del teléfono de 17:09 a 17:10. El kit conserva una copia de salida para la transición; las capturas de estados muestran el cambio, pero no certifican todos los intervalos de movimiento. No se suprimieron estos avisos. La captura adicional `kitchen-release-detail.png` examina el momento de liberación con intervalos solicitados de 80 ms a velocidad 0.5×. Se inspeccionaron sus doce imágenes: la reserva se desvanece antes de entrar las estaciones y los textos salen y entran. El reloj cambia al producirse la liberación. Esa ejecución también terminó con código 2, con dos huecos de muestreo y los avisos de `Swap` conservados.

## Revisión independiente

El revisor visual inspeccionó diez imágenes y no encontró acciones esenciales recortadas. Señaló dos problemas:

1. El capítulo activo quedaba fuera del carril móvil. Se añadió desplazamiento horizontal al cambiar de capítulo o tamaño. La nueva captura `host-mobile.png` muestra 05 Preparar seleccionado y visible.
2. El botón de French toast heredaba el color del texto descriptivo. Se limitó el selector al texto de descripción. La nueva captura `desktop-menu.png` muestra ambos controles con iconos blancos legibles.

## Límites

No hay conexión a UmiPOS, KDS, base de datos, Cloudflare, correo ni pagos. No se enviaron pedidos o avisos. Las comprobaciones cubren la simulación, no la lógica del sistema real. No se verificaron todos los capítulos en movimiento a intervalos de 40–80 ms, todos los glifos a 4× ni dispositivos físicos. No hay un bucle automático: el reinicio ocurre al pulsar Repetir. La cobertura temporal sigue siendo parcial por los huecos indicados.

Trabajo local, sin commit, PR ni despliegue para esta demostración.
