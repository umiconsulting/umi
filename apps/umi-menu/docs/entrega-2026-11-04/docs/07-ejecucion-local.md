# Ejecución local y acceso

Ejecuta los comandos desde la carpeta raíz extraída de esta entrega, salvo que se indique otro directorio. No hace falta acceso al VPS para revisar el prototipo.

## Ver el diseño sin instalar dependencias JavaScript

Requisito: Python 3.9 o posterior. La copia compilada está en `preview/`.

```sh
python3 -m http.server 56454 --bind 127.0.0.1 --directory preview
```

Abre:

- Menú dentro del visor: `http://127.0.0.1:56454/?app=menu`.
- Recorrido: `http://127.0.0.1:56454/?app=menu&menuView=tour`.
- Menú del cliente: `http://127.0.0.1:56454/menu-digital/menu.html`.

Detén el servidor con Ctrl+C. Usa HTTP local; abrir `index.html` directamente como archivo no resuelve bien los recursos y los iframes.

La copia compilada sirve para revisar. Sus estados son ficticios y no se conectan con negocios reales.

## Trabajar con las fuentes

Requisitos: Node compatible con `>=20.19`, npm y acceso al registro de paquetes para una instalación sin caché. La validación de esta entrega usa Node 25.9.0.

Conserva los nombres y la relación de carpetas:

```text
fuentes/umipos-redesign
fuentes/umi-menu-preview/flow
fuentes/umi-menu-preview/.superpowers/brainstorm/18629-1793487079/content
```

Instala ambos proyectos:

```sh
cd fuentes/umi-menu-preview/flow
npm ci
cd ../../umipos-redesign
npm ci
```

Desde `fuentes/umipos-redesign`, prepara el menú y comprueba el proyecto:

```sh
npm run build:menu
npm run typecheck
npm run build
npm run dev
```

Abre `http://127.0.0.1:56452/?app=menu`. El recorrido integrado también usa ese servidor después de `build:menu`.

Después de cambiar `menu-v6.html`, `menu-redesign.css` o el recorrido, vuelve a ejecutar `npm run build:menu`. El build copia recursos y metadatos; editar solo archivos generados pierde los cambios en la próxima copia.

Para revisar la compilación nueva, desde `fuentes/umipos-redesign`:

```sh
node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 56453 --strictPort
```

Abre `http://127.0.0.1:56453/?app=menu`. Esto revisa `dist/` generado en esa carpeta. No actualiza el sitio público ni `preview/` del paquete.

## Comprobar el recorrido por separado

Desde `fuentes/umi-menu-preview/flow`:

```sh
npm run typecheck
node scripts/sync-menu.mjs
node node_modules/vite/bin/vite.js playground --config playground/vite.config.ts --host 127.0.0.1 --port 56450 --strictPort
```

Para escenas del personal, mantén también el visor principal en el puerto 56452. La revisión normal puede usar directamente el recorrido integrado y evitar dos servidores de desarrollo.

## Pruebas de navegador

Los scripts históricos están incluidos en ambos proyectos. Muchos fijan una ruta de Chromium de la computadora original. Esa ruta debe adaptarse al equipo receptor.

Además, algunos selectores históricos usan textos del visor anteriores. El 3 de noviembre aparecieron esperas vencidas al buscar `data-mark="fin"` en vista fija. Revisa los selectores antes de interpretar un fallo como regresión del producto.

La entrega añade una comprobación acotada y portable en `scripts/comprobar-preview.mjs`. Con las dependencias instaladas y el servidor del puerto 56454 activo, desde la raíz:

```sh
node scripts/comprobar-preview.mjs --browser /ruta/al/ejecutable/chromium
```

Sustituye esa ruta por tu Chromium instalado. El script usa Playwright Core del proyecto, verifica catálogo y pedido simulado, y guarda capturas. `--out` permite elegir otra carpeta de evidencia. No acredita la API ni el POS real.

Para pruebas del producto real, usa el playbook vigente del monorepo. No reemplaces una comprobación del POS Flutter con el recorrido React.

## Archivos que requieren cuidado al mover el proyecto

- `preview.sh` pertenece al servidor inicial de brainstorming y contiene una ruta absoluta del autor. No es necesario para el arranque recomendado.
- El contenido bajo `.superpowers/.../content` sí es necesario. Algunos exploradores lo ocultan.
- `public/menu-digital/` del visor se genera mediante `build:menu` y se omite de las fuentes entregadas para evitar dos autoridades.
- `preview/` es una copia independiente de la compilación existente. No se actualiza por cambiar las fuentes.
- No se incluyen `node_modules`, cachés, tokens del servidor local, sesiones de Wrangler o archivos `.env`.

## Preparar el repositorio real

Solicita al responsable acceso a GitHub y a los entornos que necesites. Clona Umi y revisa sus instrucciones actuales:

```sh
git clone https://github.com/umiconsulting/umi.git umi
cd umi
git fetch origin staging
git worktree add -b feat/digital-menu-settings ../umi-menu-settings origin/staging
```

Lee `AGENTS.md`, las instrucciones del módulo y `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md` en el worktree. El `packageManager` observado el 4 de noviembre es `pnpm@10.29.3`; usa la versión declarada por el checkout vigente.

No uses `npm ci` del prototipo como instrucción para todo el monorepo. Umi usa pnpm y el POS usa Flutter.

Los cambios van por PRs atómicos a **staging**. Prueba allí antes de promover a **main**. No abras un PR de desarrollo directamente a main.

## Accesos necesarios según fase

| Acceso | Cuándo hace falta |
| --- | --- |
| Archivos de esta entrega | Revisión visual, contexto y planeación. |
| GitHub `umiconsulting/umi` | Implementación, ramas y PRs. |
| GitHub Issues, repositorio `umiconsulting/umi` | Publicar historias y tareas cuando se solicite; buscar primero si ya existen. |
| Entorno staging, PostgreSQL y dispositivos de prueba | Validar integración real antes de main. |
| VPS de Umi | Contraste de runtime o despliegue autorizado; no necesario para abrir el prototipo. |
| Cloudflare de Umi | Preparación o publicación de sitios autorizados. |
| Proveedor de correo y destinatarios de prueba | Validar configuración y entrega de avisos. |

Las credenciales se entregan por el mecanismo del equipo, no dentro del ZIP.

## Cloudflare y Wrangler

El proyecto de demostración existente se llama `umi-stageshow`. Su configuración está en `fuentes/umipos-redesign/wrangler.jsonc`.

Si se autoriza una actualización de ese prototipo, desde su directorio:

```sh
npx wrangler login
npx wrangler whoami
npm run deploy:pages
```

`deploy:pages` compila y publica de inmediato en el proyecto público. No es un comando de vista previa ni el flujo de PRs del producto real. El nombre `main` de la rama de Pages en ese script no sustituye la validación del monorepo en staging.

Para esta entrega no se ejecutó ese comando. La futura publicación comercial debe usar la configuración revisada de P19.
