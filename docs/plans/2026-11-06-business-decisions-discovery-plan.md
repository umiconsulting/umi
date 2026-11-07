# De las preguntas de ONCA a las decisiones de negocio en UMI

Fecha: 6 de noviembre de 2026.
Estado: primera entrega implementada, con verificación local. Las decisiones confirmadas rigen esta entrega.
Responsable del producto: dirección de UMI. Ejecución técnica: rama `feat/sales-analysis-20261106`.

## Propuesta

Convertir la solicitud de ONCA en una capacidad reutilizable para tomar decisiones y revisar sus resultados.
La base principal es dar visibilidad del negocio al administrador para que pueda tomar decisiones.
El recorrido propuesto es: dato confiable, pregunta, oportunidad, acción y resultado.
Cada negocio configura sus productos, grupos comerciales, horarios y objetivos.

ONCA aporta un caso inicial y un posible entorno de validación.
La prioridad de producto debe considerar otros negocios y el costo de atenderlos.
El mensaje del cliente permite programar este trabajo después de la entrega del POS.
No establece una fecha ni demuestra demanda fuera de ONCA.

La propuesta amplía el alcance por niveles conceptuales.
Cada nivel agrega decisiones y actores; no representa una multiplicación de ingresos ni un compromiso de construirlo todo.

## Decisiones confirmadas en la entrevista

### Promesa principal de UMI

Dirección eligió dos promesas: operar mejor y mejorar los resultados del negocio.
La primera cubre pedidos, cocina, cobro y administración.
La segunda cubre ventas, margen y regreso de clientes.
La respuesta no establece una prioridad entre las dos ni el alcance de cada entrega.
El papel de las personas en el acompañamiento y su forma de cobro siguen abiertos.

### Mercado inicial y profundidad

Dirección prioriza restaurantes, cafeterías y otros negocios de alimentos.
UMI debe perfeccionar la técnica y la operación para ese mercado antes de ampliar a otros sectores.
La capacidad derivada de ONCA debe servir a distintos negocios dentro de ese mercado.
La respuesta todavía no define qué tipos de establecimiento se atenderán primero ni cómo se medirá ese dominio operativo.

### Usuarios de la visibilidad del negocio

Dirección confirma dos usuarios: dueño o dirección, y gerente o encargado.
La capacidad debe ayudar a ambos a entender el negocio y tomar decisiones.
Sus preguntas, frecuencia de consulta y alcance de información se precisarán durante la entrevista.
Esta definición de usuarios no cambia los roles ni los permisos existentes.

### Punto de partida funcional

Dirección elige comenzar con las cinco preguntas del cliente.
El foco inicial cubre compras conjuntas, productos por visita, horarios, unidades por ticket y variación del ticket promedio.
Las respuestas deben servir a restaurantes y cafeterías con productos y grupos configurables.
ONCA aporta el ejemplo; la definición conserva el alcance general acordado para el mercado de alimentos.
La secuencia y el alcance de la primera entrega requieren resolver las definiciones de las métricas.

### Alcance de sucursales

Dirección confirma varias sucursales del mismo negocio desde el inicio.
La experiencia debe ofrecer análisis por sucursal, comparación entre sucursales y resultados del negocio completo.
Los indicadores del negocio deben calcularse desde sus totales y denominadores; no mediante promedios simples de los promedios de cada sucursal.
Las comparaciones deben indicar periodo, cobertura y alcance autorizado.
Esta decisión no autoriza comparaciones entre negocios distintos.

### Fuente del historial inicial

Dirección elige comenzar con las ventas registradas en UMI y acumular historial.
La importación desde otros POS o archivos queda fuera del primer alcance.
Las comparaciones por temporada deben indicar el historial disponible y los periodos que todavía no se pueden comparar.
La primera entrega no promete reconstruir temporadas anteriores al historial confiable de UMI.

### Importe del ticket promedio principal

Dirección elige el importe de productos después de descuentos, con las propinas separadas.
En el ejemplo de $200 en productos, $20 de descuento y $15 de propina, el indicador usa $180.
El importe cobrado de $195 corresponde a una medida distinta.
El tratamiento de impuestos y denominadores sigue pendiente de definición.
Las devoluciones requieren las dos vistas acordadas en la siguiente decisión.
El cálculo actual que incluye propinas requiere alineación con esta decisión.

### Dos vistas de devoluciones

Dirección confirma ambas vistas.
Una vista muestra el resultado de la venta original con sus devoluciones.
La otra muestra las ventas y las devoluciones en las fechas en que ocurrieron.
En el ejemplo de una venta de $180 el lunes y una devolución de $60 el martes, el resultado de esa venta es $120.
La vista de movimientos muestra la venta de $180 el lunes y la devolución de $60 el martes.
Ambas vistas derivan de los mismos hechos y deben indicar su criterio temporal.
La devolución se conserva como compensación separada; el recibo original permanece inmutable.

### Categorías y grupos de análisis

Dirección confirma el uso de las categorías existentes del catálogo y de grupos de análisis propios.
El administrador debe poder combinar productos de distintas categorías para responder preguntas comerciales.
Los grupos de análisis complementan la clasificación del catálogo.
Su creación no requiere cambiar la categoría con la que se presenta o administra un producto.
Las reglas de solapamiento y de clasificación histórica requieren definición durante el diseño.

### Hora del análisis comercial

Dirección elige la hora del pedido para analizar las ventas por horario.
Una mesa que pide a las 9:00 y paga a las 10:00 aparece a las 9:00 en ese análisis.
El agregado actual usa la hora de compromiso de la venta y requiere alineación con esta decisión.
El diseño debe precisar el evento del pedido y el tratamiento de rondas adicionales y de pedidos offline.
Esta decisión no cambia la fecha de los movimientos de cobro ni la política de devoluciones.

### Alcance de la primera entrega

Dirección prioriza la visibilidad confiable en la primera entrega.
Debe responder las cinco preguntas, permitir explorar productos y horarios, y comparar sucursales.
Incluye las categorías, los grupos de análisis y los criterios de importes, devoluciones y horarios ya acordados.
La detección de oportunidades y las sugerencias de acciones corresponden a una entrega posterior.
La ayuda para ejecutar acciones y medir resultados conserva su lugar como destino del producto.
La base técnica debe alinear los cálculos actuales con estas definiciones antes de ampliar los análisis.

### Primer usuario y reutilización técnica

Dirección confirma a ONCA como usuario de la primera versión.
La capacidad debe funcionar técnicamente para los demás clientes mediante la misma implementación y configuración por negocio.
Las consultas, los contratos y la interfaz deben conservar el alcance de negocio y sucursal.
Los nombres de productos, grupos y horarios de ONCA no deben fijarse en el código compartido.
La primera versión no depende de incorporar otro negocio como piloto real.
La validación técnica debe cubrir datos de otros negocios mediante escenarios de prueba y respetar su aislamiento.
La disponibilidad de cada análisis depende de que el negocio tenga los hechos de ventas necesarios en UMI.

### Destino de la capacidad

Dirección elige llegar al acompañamiento de la ejecución.
Dirección aclara que la base principal es la visibilidad del administrador y su capacidad para decidir.
UMI debe mostrar datos, detectar oportunidades, explicar sus razones y proponer acciones.
También debe ayudar a aplicar la acción y revisar si funcionó.
La ayuda para ejecutar y medir debe partir de esa visibilidad y conservar la decisión del administrador.
Este destino se puede alcanzar por etapas; todavía no fija el alcance de la primera entrega.
La respuesta no define qué acciones ejecutará el software, cuáles requieren confirmación ni cuáles corresponden a personas.
El alcance inicial de lectura de Umiko sigue vigente hasta resolver esas responsabilidades y sus permisos.

## Dirección documentada y alcance de la evidencia

La [base de producto y negocio](../knowledge-base/PRODUCTO_Y_NEGOCIO.md) sitúa a UMI en restaurantes y cafeterías de México.
Describe continuidad entre pedido, cocina, cobro y siguiente visita.
Presenta ONCA como usuario del flujo operativo y otros clientes como usuarios de Cash.
La mezcla de estas referencias no demuestra adopción completa del POS por todos los clientes.

El [alcance de v1](../knowledge-base/ALCANCE_V1.md) excluye reportes empresariales avanzados fuera del Dashboard existente.
El código actual contiene capacidades que esa descripción general no detalla, incluidos costos y clasificación del menú.
Cada afirmación de capacidad debe identificar su implementación y su estado de entrega.

La [investigación de Umiko](../research/2026-10-29-umiko-agent-harness.md) conserva una intención de producto: asistente del cliente, inicialmente de lectura.
El [laboratorio de agentes](../../tools/agent-lab/README.md) usa datos ficticios.
Sus resultados no certifican una experiencia de Umiko publicada.
El código de ventas sí incluye una narrativa opcional con IA; son alcances diferentes.

La inspección parte del checkout local `release/onca-pilot-20261014`, commit `597f8ba6`, con cambios locales preexistentes.
Se contrastó el agregado de ventas con las referencias locales `origin/main` (`3f0afd46`) y `origin/staging` (`e68ed51e`).
La implementación central del agregado coincide en esas referencias.
Estas referencias y la lectura estática no certifican el despliegue de ONCA ni la calidad de su historial.

El [informe de capacidades](../research/2026-11-06-sales-growth-capability-audit.md) detalla la evidencia del código.

## Nivel 0 Las cinco preguntas de ONCA

| Pregunta                                            | Necesidad que expresa                                | Capacidad general                                            | Decisión posible                                          |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| ¿Qué porcentaje incluye pan y café?                 | Conocer la presencia conjunta de grupos comerciales. | Coocurrencia configurable de productos y grupos.             | Probar una sugerencia o una combinación.                  |
| ¿Qué productos se compran en una visita?            | Entender la composición de la compra.                | Análisis de canasta con una unidad de observación explícita. | Revisar carta, exhibición o venta complementaria.         |
| ¿Qué horas venden más y cuáles tienen oportunidad?  | Entender demanda y capacidad por horario.            | Ventas por franja y contexto operativo.                      | Probar horario, producción o una oferta.                  |
| ¿Cuántas piezas se venden por ticket?               | Entender el tamaño de la compra.                     | Unidades por transacción y su distribución.                  | Revisar complementos, presentación y paquetes.            |
| ¿Cómo varía el ticket por día, horario o temporada? | Distinguir patrones y cambios.                       | Comparación temporal con muestras y periodos comparables.    | Ajustar surtido, precios o campañas y revisar resultados. |

Estas preguntas no especifican una herramienta, un modelo de IA ni un almacén analítico nuevo.
Primero hay que precisar la decisión y el significado del indicador.

## Nivel 1 De productos particulares a comportamiento de compra

La pregunta general es: ¿cómo se compone cada compra y cómo cambia entre contextos?
El sistema debe servir a pan y café, desayuno y bebida, o plato y complemento.
Los grupos pertenecen a la configuración del negocio.
Un grupo comercial puede necesitar una clasificación distinta de la categoría visible del catálogo.

La primera experiencia puede permitir elegir dos grupos y ver:

- Total de transacciones válidas y total con ambos grupos.
- Porcentaje sobre todas las transacciones.
- Porcentaje de compras de A que también incluyen B.
- Comparación con la presencia habitual de B.
- Periodo, sucursal, tamaño de muestra y cobertura de clasificación.
- Ventas de ejemplo que expliquen el resultado.

La frecuencia conjunta y la probabilidad condicionada responden preguntas diferentes.
La documentación primaria de [reglas de asociación](https://rasbt.github.io/mlxtend/user_guide/frequent_patterns/association_rules/) define soporte, confianza y lift.
El lift compara la coocurrencia observada con la esperada bajo independencia.
Una asociación detectada no demuestra el efecto de ofrecer un descuento.

Hipótesis de producto: una configuración por negocio permite reutilizar esta capacidad sin desarrollar reportes por cliente.
Validación: resolver el mismo trabajo en ONCA y en otro escenario con catálogo distinto.

## Nivel 2 De comportamiento a decisiones comerciales rentables

La pregunta general es: ¿qué cambio conviene probar y con qué límite económico?
Las decisiones incluyen combinaciones, sugerencias del personal, precios, surtido y promociones.
El análisis debe considerar ventas, unidades y margen cuando existan costos suficientes.

Un ticket mayor puede coexistir con menos transacciones o menor margen.
La revisión de resultados debe incluir esas medidas para evitar una lectura parcial.

El código ya ofrece lecturas de costos, costo de receta, margen diario y clasificación del menú.
El [controlador de costos](../../apps/umi-api/src/modules/inventory-costing/inventory-costing.controller.ts) expone esas capacidades.
El [servicio de costos](../../apps/umi-api/src/modules/inventory-costing/inventory-costing.service.ts) conserva costos desconocidos como valores ausentes.
La disponibilidad de esas rutas no demuestra cobertura suficiente de recetas y compras en un negocio.

Hipótesis de producto: priorizar oportunidades con contexto económico produce decisiones más útiles que ordenar productos por popularidad.
Validación: un responsable elige una acción, registra su costo y revisa ventas, transacciones y margen disponible.

## Nivel 3 De venta a desempeño del negocio completo

La pregunta general es: ¿qué limita el resultado del negocio y qué decisión debe tomar el responsable?

| Área           | Pregunta                                            | Datos adicionales o condición                                                                      |
| -------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Demanda        | ¿Llegan suficientes compras en cada franja?         | Horarios abiertos, canales y periodos comparables. El POS no observa todas las personas que pasan. |
| Conversión     | ¿Se pierden oportunidades de compra?                | Tráfico, intentos o pedidos abandonados. Las ventas cerradas no bastan.                            |
| Canasta        | ¿Qué lleva cada compra y qué se puede complementar? | Productos, cantidades, grupos y transacciones conciliadas.                                         |
| Recurrencia    | ¿Regresan los clientes y con qué frecuencia?        | Identidad atribuida, cobertura y definición de visita.                                             |
| Disponibilidad | ¿Se agotan productos cuando hay demanda?            | Historial de existencias, disponibilidad y horarios. La venta ausente no prueba demanda perdida.   |
| Producción     | ¿Qué conviene preparar y cuánto se desperdicia?     | Recetas, producción, mermas y ventas por periodo.                                                  |
| Servicio       | ¿La capacidad limita las ventas?                    | Tiempos de pedido y preparación, colas y contexto de operación.                                    |
| Personal       | ¿La asignación de trabajo corresponde a la demanda? | Turnos laborales y costos. El turno de caja no representa toda la plantilla.                       |

Este nivel incorpora las capacidades de POS, cocina, inventario, clientes y Cash.
No supone que sus indicadores compartan hoy la misma definición ni la misma cobertura.

Hipótesis de producto: la continuidad operativa documentada permite explicar más decisiones con datos relacionados.
Validación: elegir una restricción concreta y comprobar qué datos faltan antes de desarrollar otra pantalla.

## Nivel 4 De un negocio a un producto repetible de UMI

La pregunta general es: ¿cómo recibe este valor otro negocio sin depender de desarrollo particular?

La experiencia propuesta permite:

1. Configurar los grupos y objetivos relevantes.
2. Revisar si los datos permiten contestar la pregunta.
3. Consultar un resultado con su fuente y sus límites.
4. Elegir una acción y un responsable.
5. Volver al resultado de esa acción.

Dashboard puede conservar la consulta y el detalle.
Umiko puede explicar los mismos indicadores y ayudar a encontrarlos, conforme a su dirección inicial de lectura.
Los cálculos necesitan un contrato común para evitar cifras distintas entre interfaces.
La selección de un motor de agentes es una decisión separada de este descubrimiento.

Hipótesis de producto: el valor principal es ayudar al responsable a decidir y revisar, con una configuración sostenible.
Validación: medir tiempo de configuración, uso repetido, decisiones tomadas y costo de acompañamiento.

## Nivel 5 Del producto al modelo de negocio de UMI

La pregunta general es: ¿cómo convierte UMI esta capacidad en valor sostenible para clientes y empresa?

| Opción comercial            | Valor que tendría que demostrar                                | Costo o condición por validar                                                 |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Incluida en la suscripción  | Mayor adopción y permanencia por decisiones útiles.            | Costo de soporte, configuración e infraestructura dentro del margen del plan. |
| Plan superior               | Valor recurrente que un comprador distingue y acepta pagar.    | Disposición de pago y separación clara frente al plan base.                   |
| Acompañamiento con software | Ejecución y revisión que el negocio no puede sostener solo.    | Horas por cliente, capacidad del equipo y margen del servicio.                |
| Oferta combinada            | Autoservicio para consultas y ayuda para decisiones complejas. | Una entrega que el cliente entienda y UMI pueda repetir.                      |

Estas opciones son hipótesis. No hay un precio aprobado en la documentación revisada.
La decisión requiere entrevistas y evidencia de uso y resultados.
La posible expansión a otros sectores requiere casos propios.

Para UMI, medir adopción, permanencia, conversión comercial y costo de atención.
Separar estas medidas de las ventas y el margen del restaurante.
Un mejor resultado del cliente y un negocio rentable para UMI necesitan evidencia propia.

## Qué responde el código actual

| Pregunta de ONCA                    | Estado observado en código                                                                            | Trabajo pendiente                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Pan y café juntos                   | Hay líneas y productos de ventas comprometidas. No se encontró una consulta dedicada de coocurrencia. | Definir grupos, denominador y política de ventas válidas; entregar consulta y explicación.          |
| Productos de la misma visita        | Hay líneas por compra y relaciones operativas para visitas de mesa.                                   | Definir visita y cobertura. La identidad de una mesa no resuelve compras anónimas en mostrador.     |
| Horas de mayor venta                | Existe agregado por hora y serie temporal.                                                            | Alinear importes y fecha comercial; incorporar contexto para evaluar oportunidad.                   |
| Piezas por ticket                   | Existen unidades vendidas y cantidad de ventas en el resumen.                                         | Definir unidades, devoluciones y denominador; mostrar cociente y distribución.                      |
| Ticket por día, horario o temporada | Existe ticket promedio del rango y agrupación temporal de importes.                                   | Agregar denominadores por franja, rangos y comparaciones útiles. Validar historial para temporadas. |

La [pantalla de ventas](../../apps/umi-dashboard/src/screens/ventas-report.jsx) usa el resumen y una narrativa opcional.
El [repositorio del resumen](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.repository.ts) calcula los indicadores.
El [servicio de ventas](../../apps/umi-api/src/modules/dashboard-operations/dashboard-operations.service.ts) aplica permisos y prepara la narrativa.

### Base que requiere una definición consistente

- `salesSummary` llama ventas netas a la suma de `receipt_snapshot.grand_total`.
- El [calculador de checkout](../../apps/umi-api/src/modules/pos-checkout/checkout-calculator.ts) incluye propina en `grandTotal`.
- La consulta del resumen no resta hechos de devolución o anulación de ese agregado.
- Los importes por producto y hora usan precio por cantidad; no reparten descuentos del total.
- El rango usa el día calendario local como referencia y filtra por fecha comercial del recibo.
- La hora agrupada es la de compromiso de la venta. Puede diferir de la hora del pedido o del consumo.
- La clasificación del producto usa el catálogo consultado. El historial necesita una política para cambios de categoría.
- La consulta de productos tiene un límite de 200. Una suma de filas visibles puede quedar incompleta.

Son hallazgos de implementación, no una medición de diferencias en ventas reales de ONCA.
La primera entrega debe permitir explicar y conciliar los importes.

El [repositorio de clientes](../../apps/umi-api/src/modules/customers/customers.repository.ts) usa días comerciales distintos como aproximación de visitas.
Dos visitas del mismo cliente en un día pueden quedar unidas por esa definición.
La medida debe mostrar su alcance cuando se use para recurrencia.

## Definiciones por resolver durante la entrevista

Estas definiciones son propuestas de trabajo. Todavía no modifican el glosario canónico.

| Término              | Propuesta o decisión pendiente                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Venta                | Conservar la transacción comprometida e inmutable del glosario existente.                                                          |
| Pago                 | Conservar el hecho de pago. Varios métodos no deben multiplicar la cantidad de ventas.                                             |
| Recibo               | Conservar la representación de una transacción. Una reimpresión no agrega una venta.                                               |
| Ticket analítico     | Elegir explícitamente una transacción cerrada como unidad, si dirección confirma ese trabajo.                                      |
| Visita               | Definir una ocasión de consumo y sus identificadores. Una fecha o un pago son aproximaciones distintas.                            |
| Ingreso de productos | Acordar descuentos, impuestos y devoluciones; separar propinas y recargas de valor almacenado.                                     |
| Unidades por ticket  | Cantidad vendida según unidad comercial dividida entre transacciones válidas. No contar modificadores como piezas automáticamente. |
| Margen               | Indicar qué costos incluye. El margen de producto no equivale a utilidad completa del negocio.                                     |
| Oportunidad          | Hipótesis de mejora que incluye evidencia, acción posible, responsable y forma de evaluación.                                      |
| Resultado atribuible | Cambio evaluado mediante un diseño que permita distinguir el efecto de la acción de otros cambios.                                 |

Para grupos A y B: porcentaje conjunto = tickets con A y B / tickets válidos.
La compra condicionada de B entre compradores de A usa tickets con A como denominador.
Cada resultado muestra ambos conteos y evita divisiones entre cero.
Los grupos requieren una regla para productos que pertenecen a ambos conjuntos.
La presencia de un mismo producto no debe crear una asociación consigo mismo.

Las devoluciones necesitan dos lecturas posibles: resultado comercial de la venta y movimiento del periodo de devolución.
La entrevista debe resolver cuál responde cada pregunta.
Las cantidades devueltas requieren atribución a líneas; un importe devuelto no determina por sí solo las piezas.

La [documentación de fechas de PostgreSQL](https://www.postgresql.org/docs/18/functions-datetime.html) distingue conversiones de zona horaria.
La fecha comercial requiere además la política operativa de UMI.

La [guía de NIST sobre estacionalidad](https://www.itl.nist.gov/div898/handbook/pmc/section4/pmc443.htm) define patrones periódicos.
Un rango mensual permite describir ese rango; no basta para declarar una temporada anual recurrente.

## Plan inicial por entregas verificables

Cada entrega debe recorrer la fuente, el contrato y la experiencia que usa el responsable.
La ejecución de esta entrega no incluye estimaciones de tiempo.

| Entrega                           | Dependencia                 | Resultado demostrable                                                          | Criterio de aceptación                                                                                                 |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| D0 Decisiones y definiciones      | Ninguna.                    | Glosario acordado y un caso de decisión con responsable.                       | Se resuelven ticket, visita, dinero, unidades, prioridad y negocio de contraste.                                       |
| D1 Resumen de ventas conciliable  | D0.                         | El dueño entiende importes, transacciones, unidades y cobertura en un periodo. | Casos con descuento, propina, devolución, pago mixto, división de cuenta y cambio de día explican sus cifras.          |
| D2 Grupos que se compran juntos   | D1.                         | El dueño configura A y B y consulta su presencia conjunta.                     | Mismos cálculos con dos catálogos diferentes; conteos trazables; muestra y grupos sin clasificar visibles.             |
| D3 Comparación temporal útil      | D1.                         | El dueño compara transacciones, unidades e ingreso medio por franja y día.     | La franja usa la hora acordada; el periodo parcial se identifica; un cierre sin ventas se distingue de falta de datos. |
| D4 Oportunidad con acción         | D2 o D3, según la decisión. | Una oportunidad muestra evidencia, contexto, responsable y revisión prevista.  | La acción tiene una razón comprensible, límites de datos y una medida de resultado.                                    |
| D5 Piloto de decisión y resultado | D4.                         | El responsable ejecuta una acción y revisa sus resultados.                     | Se registran exposición, fechas, costo, cambios simultáneos y medidas acordadas.                                       |
| D6 Validación de oferta repetible | D5 y otro caso de cliente.  | UMI puede repetir la entrega y medir su costo.                                 | Se revisan uso, configuración, soporte, resultado y disposición de pago.                                               |

D2 y D3 pueden avanzar en paralelo cuando D1 esté resuelta.
D4 debe elegir una primera decisión; no necesita esperar todas las familias de análisis.
El registro del piloto puede comenzar con un procedimiento manual suficiente para la evaluación.
Una automatización adicional requiere un costo manual observado y un beneficio concreto.

### Comprobación de la base

Usar escenarios de aceptación con comportamiento externo:

1. Una venta con pan y café cuenta una vez aunque tenga pago mixto y varias impresiones.
2. Una compra con dos unidades del mismo producto suma dos unidades y una presencia del producto.
3. La división de una cuenta cambia tickets conforme a la regla acordada y conserva la visita cuando exista identidad.
4. La anulación previa y la devolución posterior siguen su política explícita.
5. Una propina cambia el dinero cobrado y conserva el ingreso de productos.
6. La repetición de un comando offline conserva una sola transacción al reconciliarse.
7. La fecha comercial respeta la política de cierre y la zona horaria.
8. Los totales de producto explican descuentos, filas limitadas y productos sin clasificación.
9. Un negocio y una sucursal reciben sólo la información autorizada.
10. Un periodo sin muestra y un costo desconocido conservan su estado explícito.

Estos son criterios futuros. En esta fase se realizó una inspección estática, sin ejecución de pruebas del producto.

## Medición del piloto

Elegir una acción pequeña y una población definida.
Ejemplo: ofrecer un complemento a compras elegibles en una franja con capacidad disponible.
El ejemplo no presupone un descuento ni que la combinación detectada sea una oportunidad rentable.

Registrar la línea base, la acción, las oportunidades de ofrecerla y su adopción.
Revisar ingreso por ticket, cantidad de transacciones, unidades, margen disponible y esfuerzo del personal.
Cuando falte identidad de visita, expresar el resultado por transacción.

Un aumento del promedio puede deberse a menos compras pequeñas, cambios de precio o composición de clientes.
La [investigación de Microsoft sobre interpretación de métricas](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/08/2017-08-KDDMetricInterpretationPitfalls.pdf) documenta estos problemas de evaluación y el valor de experimentos controlados.
Si sólo existe comparación antes y después, reportar un cambio observado y sus factores concurrentes.
El volumen y el diseño del piloto determinarán qué efecto se puede detectar.

Fijar metas después de medir la línea base.
La propuesta todavía no promete un porcentaje de crecimiento ni una duración para demostrarlo.

## Entrevista para la siguiente iteración

Las primeras 22 preguntas se presentaron en la conversación.
Se conservan aquí para que las respuestas actualicen el mismo plan.

### Dirección y oferta

1. ¿Qué debe ser UMI en tres años: software operativo, plataforma de crecimiento, consultoría con software u otra oferta?
2. ¿Restaurantes y cafeterías de México siguen como prioridad comercial?
3. ¿Qué otros clientes se quieren atender y qué evidencia existe de sus necesidades?
4. ¿Qué documento o decisión constituye el plan de negocio vigente?
5. ¿Qué resultado pesa más hoy: rentabilidad del cliente, ventas del cliente, permanencia o nuevas ventas de UMI?
6. ¿UMI debe mostrar datos, sugerir acciones o también ayudar a ejecutarlas?
7. ¿Qué papel debe cumplir Umiko en ese recorrido?
8. ¿Esta capacidad pertenece al plan base, a un plan superior o al acompañamiento?

### Capacidad y compromisos

9. ¿Qué personas y capacidad de desarrollo se pueden dedicar?
10. ¿Hay fecha o compromiso adicional con ONCA?
11. ¿Qué entregas actuales conservan prioridad?
12. ¿Qué otros negocios pueden validar el caso y qué historial se puede consultar con autorización?

### Definiciones y uso

13. Si una mesa consume $600 y divide en tres cuentas, ¿interesan $600 por visita, $200 por ticket o ambos?
14. ¿Se prioriza ingreso por visita, unidades, margen o frecuencia de regreso?
15. ¿Cada negocio necesita definir sus grupos comerciales además de las categorías del catálogo?
16. ¿Qué decisión se quiere cubrir primero: combinaciones, sugerencias, precios, producción, horarios o lealtad?
17. ¿Quién ejecutará la acción y revisará su resultado?
18. ¿Se necesita revisión semanal priorizada, consulta libre o ambas experiencias?

### Repetibilidad y valor

19. ¿Qué dos negocios o escenarios servirán como contraste con ONCA?
20. ¿Qué evidencia permitiría cobrar por esta capacidad?
21. ¿Cuánto acompañamiento y configuración por cliente puede sostener UMI?
22. ¿Qué resultado haría descartar o cambiar esta línea?

### Preguntas que dependen de los hallazgos

23. ¿El indicador principal debe excluir impuestos y propinas? ¿Cómo se llamará el total efectivamente cobrado?
24. ¿Las devoluciones corrigen el periodo de la venta o se evalúan como movimiento del periodo actual? ¿Se requieren ambas vistas?
25. ¿La hora de interés corresponde al pedido, al cobro o al consumo?
26. ¿Qué fecha de inicio y qué huecos tiene el historial confiable de cada negocio?
27. ¿Hay recetas y compras suficientes para calcular costos de los productos que se quieren promover?
28. ¿Qué proporción de ventas permite reconocer al cliente y distinguir visitas repetidas?
29. ¿Qué factores externos deben registrar los pilotos: promociones, cierres, cambios de precio o disponibilidad?
30. ¿Cuánto tiempo por semana puede dedicar el dueño o encargado a decidir y revisar?
31. ¿Se busca comparar sucursales del mismo negocio? ¿Cómo se ajustará su contexto operativo?
32. ¿Se quiere evaluar otros proveedores de POS como fuentes futuras? ¿Qué cliente justifica esa ampliación?

## Decisiones para cerrar esta fase

- Confirmar la dirección de negocio y el primer comprador.
- Elegir una decisión inicial que también sirva fuera de ONCA.
- Acordar el significado de las medidas y su cobertura mínima.
- Ejecutar la primera entrega sin estimaciones de tiempo.
- Designar responsables de la acción y del piloto.
- Convertir el tramo acordado en una especificación y entregas con dependencias.

Las skills `to-spec` y `to-tickets` permiten esa conversión cuando exista un tramo definido.
Azure Boards es el tracker canónico documentado por UMI.
La primera entrega está autorizada. La especificación está en [Análisis de compras](2026-11-06-sales-analysis-spec.md).

## Método y herramientas

Se usaron `product-feature-review`, `grill-with-docs`, `domain-modeling`, `task-router` y `research`.
Se revisaron `to-spec`, `to-tickets` y `owner-insights-migration` para evaluar su aplicación.
Las referencias antiguas a ConversaFlow en algunas skills se subordinan a `AGENTS.md` y al código actual.
`apps/umi-api` conserva la autoridad del negocio; Dashboard consume sus contratos.

La búsqueda usó ripgrep 15.2.0 y Git con referencias locales explícitas.
La skill `research` pidió una auditoría en segundo plano, conservada en el informe enlazado.
La consulta de fuentes externas usó documentación primaria de métricas, fechas y evaluación.
No se instaló una herramienta analítica: la primera entrega usa PostgreSQL y los propietarios existentes.

Los archivos de esta fase siguen el destino de planes e investigación establecido por el repositorio.
