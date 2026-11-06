# Stageshow en Cloudflare Pages

Publicado el 2 de noviembre de 2026 mediante Wrangler 4.156.0 en la cuenta UMI.

- Proyecto: `umi-stageshow`.
- Enlace estable: https://umi-stageshow.pages.dev/
- Primera versión: https://f7c1c873.umi-stageshow.pages.dev/
- Dashboard: https://umi-stageshow.pages.dev/?app=dashboard
- Recorrido del dashboard: https://umi-stageshow.pages.dev/?app=dashboard&play
- iPhone: https://umi-stageshow.pages.dev/?app=dashboard&device=iphone
- Ventas: https://umi-stageshow.pages.dev/?app=dashboard&view=sales
- Menú digital: https://umi-stageshow.pages.dev/?app=menu
- Recorrido del menú: https://umi-stageshow.pages.dev/?app=menu&menuView=tour
- Menú sin visor: https://umi-stageshow.pages.dev/menu-digital/menu.html

El proyecto publica únicamente `dist`. No tiene API, autenticación real ni conexión con los datos del negocio. Usa los ejemplos y el almacenamiento del navegador del prototipo. El enlace es público. `robots.txt` y `X-Robots-Tag` solicitan que los buscadores no lo indexen; no restringen el acceso.

## Actualización

```sh
npm ci
npx wrangler whoami
npm run deploy:pages
node scripts/pages-qa.mjs
```

`deploy:pages` prepara el menú digital desde el prototipo vecino `../umi-menu-preview`, comprueba TypeScript, genera el build y publica en la rama `main` del proyecto `umi-stageshow`. Wrangler queda fijado en `package.json` y `package-lock.json`. `wrangler.jsonc` define el proyecto y el directorio de salida.

El menú y el recorrido se incluyen en `dist/menu-digital/`; no se publica el directorio de trabajo, la clave del servidor local ni archivos de configuración de Cloudflare. El HTML, las fuentes, las fotografías y el adaptador de escenas usan rutas dentro del mismo sitio. En desarrollo, el visor apunta explícitamente a `recorrido/index.html` para evitar el fallback de Vite al POS.

Para comprobar la integración local: `node scripts/digital-menu-pages-qa.mjs`. Para comprobar el enlace publicado: `node scripts/digital-menu-pages-qa.mjs https://umi-stageshow.pages.dev`.

La creación inicial usó `wrangler pages project create umi-stageshow --production-branch main --force`. Wrangler 4.156.0 delega la creación a Workers si no se indica ese argumento. El proyecto ya existe: las actualizaciones usan `pages deploy` sin `--force`.

## Verificación de la primera versión

TypeScript y build terminaron con código 0. El enlace estable devuelve HTTP 200 y los encabezados configurados. La prueba de navegador pasó 13 comprobaciones: catálogo, selectores de los tres flujos, resumen y periodo de Ventas, iPhone, login con la imagen cargada, navegación del recorrido, giro de tablet y edición en modo Explorar. No hubo errores de página ni recursos faltantes.

Evidencia: `shots/cloudflare-pages-qa.json` y `shots/cloudflare-pages.png`. Esta prueba confirma la publicación y una muestra de interacciones; no certifica todos los flujos ni integraciones reales.

Los proyectos existentes `umi-dashboard` y `umi-landing` conservan sus despliegues.

## Controles compartidos y escenas del redesign

POS, Dashboard y Menú digital comparten `PreviewChoices`: botones de 44 px, radio de 8 px, la misma selección y el orden Explorar / Recorrido. Los selectores de dispositivo comienzan a la izquierda.

El recorrido incrusta `/?embed=menu-staff` para las escenas de Dashboard, recepción, KDS, cobro y autorización de cancelación. Renderiza los componentes de este proyecto con el pedido ficticio #1042; el origen y la ventana emisora se validan al intercambiar el estado y la geometría del cursor. La vista local independiente del recorrido usa el servidor vecino 56452; lo publicado usa el mismo origen de Pages.

Verificación específica: `node scripts/viewer-redesign-qa.mjs https://umi-stageshow.pages.dev`. Incluye controles, sucursal, avisos sin superposición, total y negocio en el ticket, y escenas de escritorio/móvil. Esta prueba se suma a `pages-qa.mjs` y `digital-menu-pages-qa.mjs`.

El recorrido del menú usa `DigitalMenuShow` dentro del visor principal, con los mismos componentes BoardUI, estilos de transporte y marcos `DeviceFrame` del Dashboard. Conserva modalidades, ocho capítulos, pausa, repetición, velocidad y vista fija. Los enlaces independientes publicados redirigen a `?app=menu&menuView=tour&menuFullscreen=1`, que monta el mismo componente. `build:menu` copia los metadatos del recorrido desde flow-data.ts para conservar una sola fuente.

El iframe contiene únicamente la escena (`embed=umi-flow&framed=1`) y ajusta sus dimensiones al área útil del dispositivo. El control de reproducción queda fuera de la escena. El nombre de cliente de Pedidos entrantes es una expresión JSX, y la prueba del visor comprueba que muestre Ana sin texto de código.

## Verificación pública del visor unificado

Despliegue: https://55c604ac.umi-stageshow.pages.dev, publicado también en https://umi-stageshow.pages.dev. Las tres pruebas públicas finalizaron correctamente: POS/Dashboard 13, escenas y controles 38, integración del menú 19; 70 comprobaciones, sin errores de página ni recursos faltantes. Evidencia en shots/cloudflare-pages-qa.json, shots/viewer-redesign/qa.json y shots/digital-menu-pages/qa.json. La prueba de cambio de dispositivo espera que termine el cierre del selector BoardUI antes de hacer clic dentro del iframe.
