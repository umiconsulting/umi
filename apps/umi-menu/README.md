# Umi Menu

Módulo del menú digital de Umi: `apps/umi-menu`, paquete `@umi/menu`.

## Estado

Se trasladó el MVP local con el diseño aprobado y sus cambios recientes.
Las operaciones se simulan en el navegador. La integración con `umi-api`, POS, KDS y correo está pendiente.
El backend de Umi conserva la autoridad comercial. Este módulo no añade otro backend.

## Ejecutar desde la raíz de Umi

```sh
pnpm --filter @umi/menu dev
```

Abre http://127.0.0.1:56456/index.html.
Para mesa: http://127.0.0.1:56456/index.html?mesa=12.

```sh
pnpm --filter @umi/menu check
pnpm --filter @umi/menu test
pnpm --filter @umi/menu build
```

Node 22 y Python 3 son suficientes. No se añadieron dependencias.
El empaquetador copia una lista explícita de recursos a `public/` y `dist/`.
Conserva los scripts clásicos del prototipo, que comparten funciones globales.
El servidor expone solo `public/`; la documentación no forma parte del sitio.

## Documentación

- [Entrega y decisiones](docs/entrega-2026-11-04/README.md).
- [Backlog](docs/entrega-2026-11-04/backlog/README.md): 33 historias y 13 decisiones.
- [Flujos](docs/entrega-2026-11-04/docs/02-flujos-y-reglas.md).
- [Arquitectura](docs/entrega-2026-11-04/docs/04-arquitectura-e-integracion.md).
- [Guía original del MVP](docs/MVP-LOCAL-ORIGINAL.md): límites y recorrido funcional.
- [Validación anterior](VALIDACION.md): evidencia histórica del MVP, con sus restricciones originales.

La carpeta `docs/entrega-2026-11-04` conserva documentación, fuentes de referencia, capturas y skills históricas.
Estas skills no quedan instaladas. La compilación `preview/` antigua no se duplicó: se usa el MVP actual.
Los comandos y rutas históricos deben interpretarse desde el paquete original.
La copia en Downloads permanece como respaldo. El código editable desde ahora vive en este módulo.

## Acuerdos recientes

- El usuario eligió esta ubicación dentro del monorepo.
- Menú hamburguesa: Personal, Recoger, Mesa e Información.
- Carrusel automático de promociones y foto individual ampliable.
- QR por mesa y solicitud de cuenta en la simulación.
- Conservar estilo, tipografías, fotografías y categorías.
- GitHub Issues para este proyecto. PRs funcionales a staging; validación antes de main.

## Continuidad

La skill `product-feature-review`, solicitada por el AGENTS raíz, no se encontró en este equipo.
Este traslado conserva el prototipo; no implementa contratos ni comportamiento comercial nuevo.
Localiza la skill antes de ampliar la integración funcional según las reglas del repositorio.
