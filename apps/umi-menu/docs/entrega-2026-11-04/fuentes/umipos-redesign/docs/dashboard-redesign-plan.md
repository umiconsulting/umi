# Plan del dashboard en Stageshow

## Dirección

- Producto: administración de cafeterías para responsables del negocio.
- Carácter: preciso, sobrio, cercano a la operación.
- Mundo: libro de ventas, carta y sala de una cafetería.
- Momentos: evolución de ventas y estado del salón; colores con significado operativo.
- Firma: folios, estaciones y categorías con el mismo lenguaje del POS.

Conserva azul marino, IBM Plex Sans y Bricolage Grotesque. Las funciones actuales definen el alcance.
La navegación agrupa Operación, Negocio y Administración. Cada módulo conserva sus subpantallas.
El resumen inicia el recorrido. Los formularios abren dentro del espacio de trabajo y mantienen el contexto.
El propietario ve su negocio. La vista de plataforma muestra Cafés y Productos y facturación.

## Entregables

1. Corregir las nueve pantallas POS en tablet vertical, incluidos conteo, modificadores y estados secundarios.
2. Registrar módulos, acciones y límites del dashboard actual y de origin/staging.
3. Añadir selector POS/Dashboard al visor, con los seis dispositivos y ambas orientaciones de tablet.
4. Crear navegación, tablas y formularios con componentes BoardUI instalados.
5. Diseñar resumen, pedidos, reportes, caja, cocina, clientes, atención y lealtad.
6. Diseñar productos, inventario, recetas, preparación, compras, plano y dispositivos.
7. Diseñar equipo, horarios, ajustes, diagnóstico, perfil y acceso; separar plataforma.
8. Verificar rutas y acciones con Playwright, capturas claras/oscuras y revisión visual independiente.
9. Documentar diferencias pendientes, alcance simulado y secuencia de PR hacia staging.

## Archivos

- `src/dashboard/data.ts`: módulos, subpantallas y datos ilustrativos.
- `src/dashboard/Dashboard.tsx`: navegación y composición del dashboard.
- `src/dashboard/Detail.tsx`: formularios y flujos locales de revisión/confirmación.
- `src/dashboard/dashboard.css`: disposición adaptable y tokens semánticos.
- `scripts/dashboard-qa.mjs`: navegación y flujos verificables en navegador.

## Herramientas y límites

React 18.3, Vite 6.4.5 y Stageshow 0.1.0 ya están instalados. BoardUI 2026.11.1 aporta
tabla, navegación, botones, campos y pestañas como código fuente. Playwright usa el Chromium local.
No requiere migrar el producto. La tabla de BoardUI evita rehacer interacción de teclado.
La composición del resumen usa HTML/SVG accesible: los componentes de gráficos BoardUI requieren Pro.
Esta maqueta usa datos ilustrativos y estado local. Los contratos y servicios reales permanecen en sus aplicaciones.
Las pruebas de la maqueta verifican la interfaz. Las pruebas nativas y de API pertenecen al plan de integración.
