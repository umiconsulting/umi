# Peces dorados del login

The canvas uses a plain navy background. The background grid is removed.

Esta copia procede de [stackedlol/ascii-sharks 0.1.0](https://github.com/stackedlol/ascii-sharks/tree/a0074c16a106f0abc665fe9712ca445f8f98ad8e). Conserva su licencia MIT en `LICENSE`.

TypeScript 5.9.3 transformó los módulos originales a JavaScript ES2022. `math.js` y `species.js` conservan esa transformación. La simulación mantiene los giros, los cardúmenes, la columna del cuerpo y la reacción al cursor.

Desktop uses the full screen. The text and the form appear above the canvas. `world.js` adds soft steering through `open-space.js`. The steering uses the measured bounds of the logo, text, and form. It favors the open space and permits occasional crossings. The source controls forward motion, body waves, and the schools. The goldfish select prey outside the content.

`renderer.js` añade el pez dorado y la paleta ámbar. Conserva el muestreo, las sombras, la textura y la onda del cuerpo. `engine.js` conserva el paso de 1/60 s. Adapta la composición inicial, la población y el tamaño. También permite la pausa por visibilidad y movimiento reducido.

The finer detail pass uses 6 × 9 px cells at 1440 px. The previous cells measured 8 × 12 px. Mobile uses 5 × 7 px cells. The body has a smooth taper. The tail has curved edges and two lobes. The fins use lighter cells, fine glyphs, and a delayed wave. A continuous light variation replaces the abrupt goldfish shimmer.

`goldfish.js` shares the body profile between rendering and collision clearance. `encounters.js` predicts close approaches along the body and fins. The fish pass to their right and slow before contact. A bounded separation step protects the solid bodies during crowded passes. It translates each spine as a whole and preserves its shape. Transparent fins can overlap briefly.

The renderer interpolates the body nodes, phase, turn, and speed between fixed steps. The source simulation still advances at 1/60 s. The render bounds use the goldfish fin reach to limit the work per frame. The original renderer remains the implementation source; this change needs no new renderer dependency.

The renderer caches segment geometry once per fish. It calculates surface coordinates only after it finds the nearest segment. The checks and evidence for the finer detail and encounters are in [the encounter report](../../../../../docs/reports/2026-11-05-dashboard-login-goldfish-encounters.md).

The photo reference pass uses a fuller shoulder, compact paired fins, and curved tail lobes. Goldfish have a curved gill cover and a soft dorsal highlight. The head moves less, while the wave grows toward the tail. `goldfishWaveEnvelope` shares that wave limit with the collision guard. The [photo references](../../../../../docs/reports/2026-11-06-goldfish-photo-references.md) distinguish observed anatomy from artistic choices.

`../login-goldfish.jsx` monta tres peces en escritorio y uno en móvil. A `ResizeObserver` updates the content bounds after layout changes. Mobile retains the scene above the form. The component destroys the motor and the observer on exit. El formulario permanece disponible si Canvas falla. La escena se usa en el acceso del dashboard; la landing conserva su fondo anterior.

Desde la raíz del worktree, inicia la vista local:

```sh
VITE_UMI_ENVIRONMENT=development VITE_AUTH_MODE=cookie VITE_API_BASE= VITE_PUBLIC_URL=http://127.0.0.1:4025 VITE_DEV_PORT=4025 pnpm --filter @umi/dashboard dev
```

Abre `http://127.0.0.1:4025/login`. Con el navegador CDP en el puerto 9222, ejecuta:

```sh
node tools/ux-sweep/dashboard-login-goldfish.mjs
```

With Vite development mode, run the controlled encounters against the source engine:

```sh
node tools/ux-sweep/dashboard-login-goldfish-encounters.mjs
```

The encounter check covers head-on, crossing, following, three-fish convergence, and a 30-second normal scene. It checks solid-body overlap and limits for position and heading changes. The quality tool records screenshots and Chromium callback costs:

```sh
UMI_GOLDFISH_LABEL=finer node tools/ux-sweep/dashboard-login-goldfish-quality.mjs
```

For twelve motion frames at each of three viewport sizes, set `UMI_GOLDFISH_FRAMES=12`.
With Vite development mode, capture eight stroke phases and two banks:

```sh
node tools/ux-sweep/dashboard-login-goldfish-anatomy.mjs
```

The anatomy sheet uses the actual renderer with controlled poses. The encounter tool checks the actual simulation.

La prueba intercepta las peticiones de autenticación. No crea sesiones reales ni envía correos. Guarda capturas y resultados en `docs/reports/evidence/2026-11-05-dashboard-login-goldfish/`.
