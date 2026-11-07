# Análisis de compras para decisiones del negocio

Fecha: 6 de noviembre de 2026. Estado: implementada y verificada localmente. Primera entrega: ONCA. Implementación compartida para los negocios de UMI.

## Resultado solicitado

El administrador consulta cinco preguntas: grupos comprados juntos, pares frecuentes, horas de venta, piezas por ticket y evolución del ticket promedio.
La entrega da visibilidad para decidir. Las sugerencias, la ejecución de acciones y su evaluación quedan para entregas posteriores.
La dirección confirmó ambas vistas de devoluciones, categorías y grupos propios, y comparación entre sucursales desde esta entrega.
El [descubrimiento](2026-11-06-business-decisions-discovery-plan.md) conserva las decisiones y la ampliación de producto por niveles.

## Definiciones verificables

- La fuente contiene ventas confirmadas en UMI. El recibo original permanece intacto.
- La venta de productos usa el total congelado del recibo menos su propina. Incluye impuestos y descuentos aplicados.
- La venta neta resta las devoluciones confirmadas, también sin propina.
- El ticket promedio divide esa venta neta entre los tickets de venta del periodo. Sin tickets, devuelve `null`.
- Un ticket totalmente devuelto permanece en el denominador. Las piezas pueden quedar en cero.
- El promedio del negocio usa la suma de importes y tickets. Evita promediar los promedios de sucursales.
- La fecha de venta conserva el día operativo congelado en el recibo. La hora comercial procede del pedido original.
- `sale_result` ajusta las ventas del periodo con todas sus devoluciones confirmadas hasta la consulta.
- `period_movements` resta las devoluciones en su fecha operativa de confirmación. Incluye devoluciones de ventas anteriores al periodo.
- En movimientos, el promedio puede ser negativo o no aplicar. Es un cociente contable, no el gasto de un cliente típico.
- Cada ticket cuenta una sola vez para presencia de productos. Varias piezas o renglones iguales no multiplican la frecuencia.
- Las visitas de mesa agrupan tickets con el mismo identificador de visita y sucursal, dentro del periodo consultado.
- Los tickets sin visita identificada quedan fuera de esa agrupación. La interfaz muestra la cobertura.
- Las compras conjuntas usan piezas restantes en `sale_result` y piezas originales en `period_movements`.
- Los grupos superpuestos requieren dos productos distintos para registrar una compra conjunta.
- Las categorías y los grupos actuales se aplican al historial. No se afirma que sean su clasificación histórica.
- La frecuencia conjunta divide compras con A y B entre todas las compras elegibles.
- La frecuencia condicional divide compras con A y B entre compras con A. Se muestran sus conteos.
- Las tablas de horas, días y meses muestran movimientos observados. La hora del pedido no cambia la fecha contable. No prueban demanda, apertura ni estacionalidad.

## Responsabilidades y alcance

`umi-api` consulta los hechos, resuelve permisos y calcula medidas. El Dashboard presenta el contrato.
El cálculo puro de importes está separado del cálculo de compras conjuntas y del acceso a PostgreSQL.
Los grupos pertenecen al negocio. Admiten productos de varias categorías, nombres únicos y versiones para evitar sobrescrituras simultáneas.
Las tablas nuevas aplican RLS y claves compuestas para impedir productos de otro negocio.
La lectura requiere `sale.lifecycle` y la autoridad existente de sucursal (`resolveLocationAuthority`).
La edición de grupos exige administración del negocio y alcance del negocio completo.
Los usuarios de una sucursal reciben ese alcance aunque omitan el filtro.

La interfaz conserva Resumen, Tabla dinámica y Recibos. Análisis de compras es la vista inicial de Ventas.
El Resumen previo identifica sus cobros con propina y antes de devoluciones. La tabla previa identifica importes antes de descuentos.
La primera entrega limita cada consulta a 731 días, 20,000 tickets y 100,000 pares distintos.
Muestra hasta 100 pares frecuentes. Admite 5,000 productos, 200 grupos y 500 productos por grupo.
Una consulta que supera los límites devuelve un error explícito; no presenta un resultado parcial como completo.

## Criterios de aceptación

1. El ejemplo de $200 menos $20 de descuento muestra $180 de venta y separa $15 de propina.
2. La misma venta conserva su hora de pedido aunque se cobre después.
3. Una devolución del día siguiente cambia el resultado de la venta o los movimientos, según la vista elegida.
4. La consulta de movimientos incluye una devolución aunque la venta quede fuera del periodo.
5. Los grupos configurables y las categorías responden la compra conjunta sin multiplicar por cantidad de piezas.
6. Los filtros permiten negocio completo y sucursal, según la autoridad del usuario.
7. Un usuario no obtiene datos de otro negocio ni amplía su autoridad con un filtro.
8. Los grupos guardados sobreviven a la recarga. Un cambio con versión anterior recibe un conflicto.
9. Los periodos vacíos muestran su estado. Los denominadores vacíos no producen porcentajes inventados.
10. Las pruebas usan el esquema real de PostgreSQL y el Dashboard se verifica con clics en Chromium.

## Evidencia técnica y decisiones

Hecho documentado: PostgreSQL permite agrupar fechas con la zona horaria explícita.
Fuente: [PostgreSQL, funciones de fecha y hora](https://www.postgresql.org/docs/current/functions-datetime.html).
Hecho documentado: las frecuencias conjunta y condicional usan distintos denominadores.
Fuente: [mlxtend, association rules](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/association_rules/).
Inferencia para UMI: una consulta acotada sobre hechos existentes evita introducir otro servicio antes de medir su necesidad.
Separar responsabilidades sigue el [principio de responsabilidad única de Robert C. Martin](https://blog.cleancoder.com/uncle-bob/2014/05/08/SingleReponsibilityPrinciple.html).

Los índices cubren el alcance de ventas, las fechas de recibos y las devoluciones de cada venta.
PostgreSQL no crea índices automáticamente en las columnas que referencian una clave externa.
Fuente: [PostgreSQL 17, restricciones](https://www.postgresql.org/docs/17/ddl-constraints.html).

Herramientas: PostgreSQL 17, Vitest 2.1.9, Playwright sobre Chromium, Zod 3, TypeScript y Prettier 3.9.4.
Se usan las herramientas ya presentes en el repositorio. No se agrega una dependencia analítica.

La validación local usa datos sintéticos en una base aislada. La validación con el historial real de ONCA requiere la promoción al entorno correspondiente.
Esta rama no cambia producción.
