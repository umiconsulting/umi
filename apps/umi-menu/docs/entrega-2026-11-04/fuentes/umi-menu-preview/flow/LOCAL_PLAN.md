# Flujo local sobre el diseño existente

Corrección solicitada por el usuario: conservar las interfaces actuales al mostrar el recorrido.

- Menú: copia de menu-v6.html, adaptada al redesign local de `/Users/moon/Documents/umipos-redesign`. Comparte el tema menu-redesign.css con la maqueta interactiva y conserva fotografías, categorías, productos, opciones, carrito y diálogos.
- Dashboard: estilos y tokens copiados del repositorio, con su barra lateral y encabezado.
- POS y KDS: representación HTML basada en sus capturas actuales; no es una ejecución de Flutter.
- Las funciones nuevas se muestran como propuestas dentro de esas estructuras.
- Stageshow controla escenas, cursor, pausa y repetición.
- Cada pantalla ocupa el área disponible; se retiró la composición de ventana y teléfono.
- El pedido ficticio #1042 usa los precios originales: French toast $145, latte $65, total $210.
- El adaptador añade el correo acordado a la copia usada en la demo. La versión anterior menu-v5.html sigue intacta.
- Todo queda local, sin PR ni despliegue.
