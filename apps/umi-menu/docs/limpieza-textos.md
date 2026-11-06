# Limpieza de textos del menú

Solicitud del usuario: reducir texto decorativo y conservar el diseño aprobado.

- Se eliminó la etiqueta sobre el título de promociones.
- Se usa «Promociones» como título y el contenido del combo como nombre visible.
- Se quitaron subtítulos repetidos y la invitación genérica a pedir.
- Las categorías se muestran en tarjetas solo en destacados o búsquedas.
- Se compactó el carrusel. Se conservan tipografías, colores y fotografías.
- Se conserva un aviso visible de demo y la información necesaria para pedir.

Validación local, 2026-11-05, rama hc_umi_digital_menu:
`pnpm --filter @umi/menu check`, `test` y `build`: aprobados; nueve pruebas.
Playwright con Chromium instalado, 430 × 932: título Promociones, filtro Desayunos sin etiquetas repetidas y agregar al carrito aprobados. Sin errores JavaScript.
Servidor HTTP activo en http://127.0.0.1:56456/index.html.
Validación funcional del usuario y push pendientes. Sin validación de staging ni integración comercial.

Ajuste posterior: Pedir la cuenta requiere al menos un pedido de esa mesa activo y sin cobrar. Un carrito sin enviar no habilita la acción. Cerrar todos los pedidos cierra las solicitudes pendientes. Diez pruebas aprobadas y recorrido móvil verificado: deshabilitado sin pedido y con carrito; habilitado después de confirmar.
