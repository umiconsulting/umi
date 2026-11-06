# Validación de la entrega

Fecha: 4 de noviembre de 2026. Alcance: integridad, portabilidad y funcionamiento básico del **prototipo** incluido.

## Entorno

- macOS ARM64.
- Node `v25.9.0`.
- npm `11.12.1`.
- Python `3.14.4`.
- Vite `6.4.5`, desde los lockfiles entregados.
- Playwright Core y Chromium headless shell local, revisión de carpeta `1234`.

## Reconstrucción desde otra carpeta

Se copiaron las fuentes entregadas a `/private/tmp/umi-menu-handoff-build-20261104`. Se conservaron los nombres de los dos proyectos vecinos. Los originales no se modificaron.

| Directorio | Comando | Resultado |
| --- | --- | --- |
| `umi-menu-preview/flow` | `npm ci --offline --no-audit --no-fund` | Código 0; 75 paquetes instalados desde la caché. |
| `umipos-redesign` | `npm ci --offline --no-audit --no-fund` | Código 0; 342 paquetes instalados desde la caché. |
| `umi-menu-preview/flow` | `npm run typecheck` | Código 0. |
| `umipos-redesign` | `npm run build:menu` | Código 0; menú v6 y recorrido generados. |
| `umipos-redesign` | `npm run typecheck` | Código 0. |
| `umipos-redesign` | `npm run build` | Código 0. |

La instalación emitió avisos de dependencias obsoletas. El build emitió un aviso sobre paquetes compilados mayores de 500 kB. No se actualizaron dependencias durante la entrega.

Se compararon los **110 archivos** del build reconstruido con `preview/`: mismos nombres y SHA-256; ninguna diferencia. Informe: [comparacion-build.json](comparacion-build.json).

Esto prueba que las fuentes y recursos incluidos reconstruyen la compilación entregada en este entorno. No certifica una descarga nueva del registro sin caché, otros sistemas operativos ni versiones distintas.

## Comprobación en navegador

Se sirvió `preview/` mediante Python en `127.0.0.1:56454`. Se ejecutó `scripts/comprobar-preview.mjs` con las dependencias de la copia de prueba y Chromium local.

Resultado: **13 comprobaciones correctas**, sin errores de página ni recursos locales con respuesta HTTP de error.

- Menú integrado dentro del visor.
- Fotografías y ausencia de desbordamiento a 1440 y 390 px.
- Carrito simulado de dos productos, total $210.
- Confirmación y estado pendiente en ambos formatos.
- Carga de escenas de Dashboard y KDS.

El formulario sigue sin correo, como registra `emailFieldPresent: false`. Es una brecha conocida del prototipo, no un cambio omitido del paquete.

Informe y capturas: [comprobacion-entrega](comprobacion-entrega/). Se revisaron también la captura móvil del menú y la escena de configuración.

## Skills y documentación

Se probó `scripts/instalar-skills.py` con Stageshow, BoardUI y Unslop en una carpeta temporal nueva. Copió las tres carpetas. No instaló skills en la cuenta del autor.

El empaquetado comprueba los enlaces locales de README.md, AGENTS.md, docs/ y este informe. Conserva los documentos históricos originales, cuyos enlaces pueden requerir el monorepo completo.

Se comprueban hashes de las copias contra `inventario-origen.json`, exclusiones de archivos sensibles por nombre y ausencia de marcadores de claves privadas. Esta revisión no es una auditoría de seguridad del producto.

El paquete final incluye `SHA256SUMS`, verificable mediante `scripts/verificar-paquete.py`.

## Fuera de esta validación

- Integración con API, PostgreSQL, POS Flutter, dispositivos KDS o SMTP reales.
- Contratos, migraciones, permisos o inventario del producto.
- Entrega o lectura de correos.
- Cobros reales, concurrencia de pedidos o programación durable.
- Estado actual del VPS o del repositorio remoto.
- Certificación completa de todas las animaciones y formatos del prototipo.

No se abrió un PR, no se publicó el sitio y no se promovió código a staging o main.
