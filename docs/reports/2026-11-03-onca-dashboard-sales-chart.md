# ONCA: barras planas en la gráfica de ventas

Fecha: 3 de noviembre de 2026.

## Síntoma y evidencia

El propietario reportó que Venta por día y Venta por hora siempre muestran barras planas.
Las dos capturas conservan etiquetas distintas, pero todas las barras se reducen a una línea.

Se reprodujo el problema en Chromium con el dashboard real y respuestas de prueba controladas.
Los importes de prueba son diferentes. No proceden de ventas de ONCA y no validan su contabilidad.
La prueba roja midió una altura de dos píxeles para la barra máxima en anchos de 1440 y 768 píxeles.

## Causa y corrección

`SeriesChart` usa un contenedor flex de altura fija y alinea sus columnas al fondo.
Las columnas no tenían una altura definida. El porcentaje de la barra no disponía de la altura de su columna.
El navegador reducía las barras al mínimo de dos píxeles.

La corrección define `height: '100%'` en cada columna.
El área de la barra ocupa el espacio que queda sobre su etiqueta.
Los porcentajes que ya calculaba el gráfico ahora producen alturas proporcionales.

El cambio de producción ocupa una línea en `apps/umi-dashboard/src/screens/ventas-report.jsx`.
Las consultas, los filtros, los importes y la contabilidad no cambian.

## Validación real de interfaz

Playwright abre Reportes con datos controlados y pulsa 7 días.
Comprueba la vista por hora, la vista por día y sus proporciones en dos anchos.

| Vista | Importes de prueba en centavos | Alturas después de corregir, en píxeles |
| ----- | ------------------------------ | --------------------------------------- |
| Hora  | 0, 10000, 40000                | 2.59375, 32.578125, 130.328125          |
| Día   | 10000, 40000, 20000            | 32.578125, 130.328125, 65.15625         |

Ambos anchos produjeron esas medidas.
El periodo de cero conserva la marca mínima que ya usa el componente.
Las barras de un cuarto y de la mitad del importe máximo tienen las proporciones correspondientes.

- Dos pruebas de navegador aprobadas después de observar ambas fallar antes del ajuste.
- 427 pruebas unitarias aprobadas.
- Lint: cero errores y 68 advertencias existentes.
- Compilación del dashboard aprobada con configuración de prueba.
- Revisión independiente: sin hallazgos en CSS, pruebas o workflow.

El workflow `Dashboard sales chart` ejecuta las dos regresiones de Chromium en cambios de los archivos relevantes.
Las respuestas de API de la prueba se interceptan en el navegador local.
La prueba rechaza escrituras inesperadas y no usa credenciales ni ventas de producción.

## Entrega y límites

El cambio queda en un PR separado del PR #250 de KDS.
No se publicó el cambio del dashboard en producción durante la investigación.
La aprobación, la integración y la comprobación de la gráfica publicada quedan pendientes.
No se requiere otra build de las tablets para este ajuste del dashboard.

La bitácora canónica y la evidencia completa están en Juan-PC.
El checkout es `/home/juan/umi-onca-dashboard-sales-chart-20261103`.
La evidencia completa es `/home/juan/.local/state/onca-support-20261103/dashboard-chart/`.
La evidencia depurada está en `evidence/2026-11-03-onca-dashboard-sales-chart/`.

Herramientas: Playwright 1.62.1 con Chromium, Vite 5.4.21, Node 24.21.0 y pnpm 10.29.3.
Fuentes primarias: capturas del propietario, código de SeriesChart y medidas del navegador real.
La reversión consiste en revertir el commit del dashboard; no requiere cambios de datos.
