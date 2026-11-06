# Bitácora de Umi Menu

## 2026-11-06 — Limpieza del módulo

Rama: `hc_umi_menu_cleanup`. Base local: `e68ed51e`, merge del PR #260 a staging.

- Separación en `src/`, `public/`, `scripts/` y `tests/`, coherente con la organización de la landing.
- `public/` contiene recursos versionados; `dist/` es la única salida generada y servida.
- El build limpia su salida para evitar recursos obsoletos.
- Retirada de copias de otros prototipos, escenas, skills, capturas, backlog exportado e informes duplicados.
- Reglas de negocio, decisiones pendientes, límites, créditos y guía de diagnóstico consolidados en README.md.
- Retirada del manifiesto manual de hashes y de las tipografías antiguas que el tema ya sustituía.
- Conservados fotografías activas, licencias OFL, QR, generador y pruebas de reglas.
- El historial Git conserva el detalle original; no se reescribe ni se borra el respaldo externo de Downloads.

Esta limpieza no integra backend ni modifica los flujos comerciales simulados.

### Validación local

- Reducción de 1.170 archivos versionados (23,82 MiB) a 31 archivos fuente (1,57 MiB). Se excluye `dist/`.
- SHA-256: los cinco scripts del navegador y `mvp.css` coinciden con los anteriores al traslado.
- Node v22.23.4 y pnpm 10.29.3: `check`, `test` y `build` aprobados. Diez pruebas aprobadas.
- Python Playwright 1.62.0 y Chromium instalado: prueba HTTP a 430 × 932 y 1440 × 1000.
- Verificados: fotografía ampliada, carrito tras recarga, pedido de mesa, solicitud de cuenta, recogida y aceptación.
- Sin errores JavaScript ni respuestas HTTP fallidas durante esos recorridos.
- Se quitaron cinco declaraciones de fuentes antiguas; el tema activo conserva IBM Plex y Bricolage.
- Formato de archivos modificados y `git diff --check` comprobados.
- No se probó staging, API, POS, KDS, correo ni un dispositivo físico.

Herramientas: scripts existentes del paquete, Node test runner y Playwright disponible en el equipo.
El build sigue siendo una copia estática para preservar los scripts clásicos y evitar dependencias innecesarias.

## 2026-11-05 — Revisión del MVP e incorporación a Umi

- Módulo `apps/umi-menu`, paquete `@umi/menu`, con comandos de desarrollo, build y pruebas.
- Catálogo por secciones, opciones, carrito persistente y seguimiento local.
- Mesa por enlace/QR, recogida inmediata y programada, aceptación y simulación de estaciones y cobro.
- Solicitud de cuenta por mesa. El botón requiere una orden activa sin cobrar; el carrito no lo habilita.
- Hamburguesa con Personal, Recoger, Mesa e Información.
- Promociones con autoavance y foto individual ampliable; sin botón de pausa por solicitud del usuario.
- Corrección del doble marco de foco del buscador.
- Limpieza de frases decorativas, categorías repetidas y altura del carrusel.
- Conservados azul Umi, IBM Plex Sans, Bricolage Grotesque y las fotografías aprobadas.

Commits de referencia: `a387069c` (incorporación), `8f40784c` (cuenta activa), `728d90ce` (formato).
La incorporación inicial incluyó demasiado material histórico. Esta limpieza reduce ese alcance.
Se verificaron diez pruebas de reglas y recorridos de navegador. No acreditaron integración con POS, KDS o correo.

## Antecedentes del diseño

- El menú v6 quedó aprobado el 3 de noviembre de 2026.
- El paquete del 4 de noviembre separó decisiones, flujos, arquitectura y backlog propuesto.
- GitHub Issues fue elegido para seguimiento. P00 y el PR solo documental se descartaron.
- Los datos de Bruma y los plazos del prototipo siempre fueron ejemplos.
