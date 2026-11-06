# Maqueta local del menú digital Umi

Prototipo descartable para revisar el diseño. Bruma, sus productos, horarios y precios son ficticios.

Incluye menú, búsqueda, categorías, opciones, carrito, recogida, mesa 12, horarios y seguimiento simulado.
El estado vive en memoria y se reinicia al recargar. No envía pedidos, mensajes ni pagos.
El plan inicial no incluye verificación de teléfono por SMS. Para recoger se pedirán nombre, teléfono y correo.
La maqueta todavía solo captura nombre y teléfono; el correo está definido en la especificación y falta integrarlo.

## Especificación

Los acuerdos, diferencias con el código existente y etapas propuestas están en [Borrador del menú digital de Umi](docs/2026-11-01-menu-digital-design.md).

## Iniciar

Cuando el servidor esté detenido:

```sh
bash /Users/moon/Documents/umi-menu-preview/preview.sh
```

Abre la URL completa que imprime el servidor. El acceso incluye una clave local.
El servidor se detiene tras 24 horas sin actividad. Usa Ctrl+C para detenerlo desde una terminal.

## Archivos

La maqueta y sus recursos están en `.superpowers/brainstorm/18629-1793487079/content/`.
El servidor de la guía brainstorming permite una vista local sin instalar dependencias ni modificar el monorepo.
Se usan HTML, CSS y JavaScript, con Node v25.9.0 para el servidor.

## Referencias

- Versión actual: `menu-v6.html` + `menu-redesign.css`, en el directorio de contenido indicado arriba. `menu-v5.html` conserva la versión anterior.
- Diseño actual: prototipo local `/Users/moon/Documents/umipos-redesign`, especialmente `src/catalog.css`, `src/interface-system.css` y las capturas `shots/device-iphone-portrait.png` y `shots/device-windows-portrait.png`.
- La adaptación usa IBM Plex Sans, Bricolage Grotesque, superficies cálidas, categorías con colores suaves y controles de 44/48 px. Las fuentes y sus licencias están copiadas localmente.
- Referencia inicial del menú: https://menus.colegastudio.com/demo. La versión anterior utilizaba Inter Tight y Source Sans 3.
- Fotos ilustrativas: Unsplash, archivos locales. Los identificadores son:
  - `photo-1484723091739-30a097e8f929` (French toast)
  - `photo-1541167760496-1628856ab772` (café)
  - `photo-1555507036-ab1f4038808a` (croissants)
  - `photo-1528735602780-2552fd46c7af` (sándwich)
  - `photo-1533134242443-d4fd215305ad` (cheesecake)

Las reglas de siete días de anticipación, 30 minutos de cancelación programada y el horario comercial son ejemplos de interfaz. No configuran ningún merchant real.

## Recorrido por escenas

Abre http://localhost:56450/?chapter=menu&mode=pickup con el servidor de `flow/README.local.md` activo.
El recorrido usa la misma versión del menú, con pausa, repetición y avance por capítulo.
Después de modificar el menú o su tema, ejecuta `node scripts/sync-menu.mjs` desde `flow/` para actualizar esa copia.
Las capturas de esta adaptación están en `flow/shots/redesign/`.
