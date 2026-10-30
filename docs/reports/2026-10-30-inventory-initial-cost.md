# Costo inicial de inventario — 2026-10-30

El formulario de artículos permite guardar un costo inicial por unidad. El campo muestra la moneda del negocio y admite cero explícito.

El panel y el reporte distinguen `Costo inicial`, `Calculado con compras` y `Sin costo`. Las compras recibidas tienen prioridad. El panel conserva visible el costo inicial guardado cuando las compras fijan el costo activo.

`Agregar costo` abre el editor del artículo. Las recetas permiten un costo inicial o una compra registrada. Los cambios ajenos conservan el costo; borrar el campo lo elimina.

## Verificación

- Dinero exacto: 18 casos nuevos fallaron antes de la implementación; después pasaron las 29 pruebas del modelo.
- Dashboard: 445 pruebas correctas en 36 archivos.
- Chromium real: regresión e2e completa correcta, con clics y lecturas persistidas de la API aislada.
- Creación a 100.00/kg, edición a 120.00/kg, cancelación, campo vacío, cero y valores inválidos verificados.
- Un cambio ajeno conserva el costo. Un reintento tras una respuesta perdida conserva el borrador y la identidad del comando.
- Receta de 1.25 kg: 125.00 con costo inicial de 100.00; 150.00 tras cambiarlo a 120.00.
- Compras recibidas: 1 kg a 140.00 y 3 kg a 100.00. Costo activo: 110.00/kg. Receta: 137.50.
- El costo inicial conserva las existencias. Las dos recepciones reales registran 4 kg.
- Un fallo al consultar la fuente muestra el error y conserva la distinción con un artículo sin costo.
- Lingui: extracción y compilación estricta correctas. Build correcto. Lint: cero errores y 68 avisos previos.
- Backend, según la verificación del controlador: 346 pruebas correctas y dos exclusiones previas. Migración aplicada de nuevo correctamente.

Se inspeccionaron las capturas de escritorio y móvil. El campo conserva su unidad y moneda. Guardar y Cancelar son accesibles con desplazamiento. El diálogo no presenta desbordamiento horizontal.

## Evidencia

- [Formulario de escritorio](evidence/2026-10-30-inventory-initial-cost/initial-cost-create-desktop.png).
- [Costo activo y costo inicial guardado](evidence/2026-10-30-inventory-initial-cost/initial-cost-source-desktop.png).
- [Campo en móvil](evidence/2026-10-30-inventory-initial-cost/initial-cost-field-390.png).
- [Guardar y Cancelar en móvil](evidence/2026-10-30-inventory-initial-cost/initial-cost-controls-390.png).
- [Reporte de fuentes](evidence/2026-10-30-inventory-initial-cost/initial-cost-report-desktop.png).

Herramientas: Node 22.23.3, pnpm 10.29.3, Vitest 2.1.9, Playwright 1.62.1, Vite 5.4.21 y Lingui 6.6.0. Se usaron las herramientas existentes del repositorio y el procedimiento de `docs/development/LOCAL_VERIFICATION_PLAYBOOK.md`.

El build conserva el aviso previo de paquetes mayores de 500 kB. Las pruebas de sesión emiten sus mensajes esperados de fallos simulados. La publicación y la aprobación del PR quedan pendientes del controlador.
