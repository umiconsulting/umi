# Flujo del menú digital

Abre http://localhost:56450/?chapter=menu&mode=pickup.

El menú usa el redesign local de Umi, encontrado en `/Users/moon/Documents/umipos-redesign`. Dashboard, POS y KDS mantienen las referencias del recorrido anterior; esta adaptación visual cubre el menú del cliente, sus formularios, carrito y seguimiento.

1. Elige recoger, mesa o programado.
2. Selecciona uno de los ocho capítulos.
3. Usa Pausar, Repetir o Siguiente.
4. En Cancelar, cambia el estado del pedido.
5. Usa Sin animación para ver el resultado.

El menú usa una copia de menu-v6.html y el tema menu-redesign.css. El Dashboard usa una copia local de sus estilos.
El POS y el KDS son representaciones HTML basadas en capturas de la app.
Las acciones nuevas son propuestas. No se ejecuta Flutter ni se conecta al backend.

## Iniciar

Desde este directorio:

    node node_modules/vite/bin/vite.js playground --config playground/vite.config.ts --host 127.0.0.1 --port 56450 --strictPort

## Archivos

- examples/umi-flow/index.tsx: escenas y adaptador de reproducción.
- examples/umi-flow/surfaces.tsx: configuración y pantallas del personal.
- examples/umi-flow/product-flow.css: estilos de las escenas.
- examples/umi-flow/dashboard-source.css: copia acotada de estilos y tokens del Dashboard.
- playground/public/reference/menu.html: copia de menu-v6.html; solo cambian rutas de recursos y la carga del adaptador.
- playground/public/assets/menu-redesign.css: tema derivado del redesign local; incluye sus fuentes y colores por categoría.
- playground/public/reference/menu-driver.js: estados simulados y objetivos del cursor sobre las tarjetas del menú.
- playground/viewer.tsx: navegación y controles.
- scripts/qa.mjs: comprobaciones en Chromium.
- scripts/menu-redesign-qa.cjs: comprobación interactiva de la maqueta y capturas a 320–1440 px; usa la instalación local de Playwright del monorepo.
- scripts/sync-menu.mjs: actualiza la copia del menú, el tema y las fuentes desde la maqueta interactiva.
- shots/: capturas y resultados.
- examples/umi-flow/REHEARSAL.md: referencias, revisión y límites.

La versión anterior, menu-v5.html, se conserva. El correo sigue siendo parte del adaptador de escenas; aún no se captura en la maqueta interactiva. No se envían pedidos, mensajes o pagos.
No se creó un PR para esta demostración.

El visor de `../umipos-redesign` integra esta demo en la sección Menú digital de https://umi-stageshow.pages.dev/?app=menu. Su tarea `build:menu` construye el recorrido con base `/menu-digital/recorrido/`. El HTML de referencia y las fuentes usan rutas relativas para funcionar tanto en local como bajo ese prefijo; `playground/public/menu.html` es la copia interactiva independiente, sin el adaptador de escenas.
