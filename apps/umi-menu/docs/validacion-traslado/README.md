# Validación del traslado

Fecha: 2026-11-05. Base: `54447d4ace0d6674da25d3f518ae9a777626f62f` de origin/staging.
Rama local: `feat/umi-menu-prototype`. Cambios aún sin commit.

- Node v22.23.4 y pnpm 10.29.3: `pnpm --filter @umi/menu check`, `test` y `build` aprobados. Nueve pruebas aprobadas.
- `pnpm --filter @umi/menu list --depth -1`: paquete reconocido por el workspace.
- `git diff --check`: aprobado.
- `pnpm dev`: servidor activo en 127.0.0.1:56456. El puerto original 56455 estaba ocupado; se conservó su proceso.
- Python Playwright con Chromium headless instalado: recorrido a 430 × 932 y captura a 1440 × 1000.
- Clics reales: producto, agregar, carrito, confirmar mesa 12, estado «En preparación», pedir cuenta, abrir hamburguesa y panel del personal.
- Resultado: solicitud «Mesa 12 · Cuenta solicitada» visible. Cero errores JavaScript durante el recorrido.
- Capturas: `umi-menu-mobile.png` y `umi-menu-desktop.png`.

Las restricciones antiguas de VALIDACION.md corresponden a la revisión anterior del paquete. En este traslado sí se ejecutó un navegador.
No se probó integración con API, POS, KDS, correo o staging. No se abrió un PR ni se promovió a main.

Herramientas elegidas: pnpm del monorepo, Node para copia estática, Python http.server y Playwright disponibles en el equipo.
El pequeño empaquetador mantiene el HTML y los scripts clásicos existentes. No añade un framework ni dependencias para un traslado.
