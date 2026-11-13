# Inventario: fundamento y propuestas para revisión

Fecha: 2026-11-11. Alcance: decisiones D01–D09 de la entrega de inventarios.

El usuario autorizó implementar las propuestas y revisarlas al final en el mismo PR. Este documento define las reglas propuestas y sus límites. No acredita por sí mismo implementación, pruebas, configuración de producción ni entrega de mensajes.

Estado final y guía para revisores: [implementación, propuestas y validación](../plans/2026-11-12-inventory-planning-handoff.md). Ese documento distingue lo implementado de las alternativas de investigación y registra las comprobaciones pendientes.

## Herramientas y costo de adopción

**Hecho verificado localmente:** Node.js `22.23.4`, pnpm `10.29.3`, Vitest `2.1.9` en la API y Playwright `1.62.1` ya están instalados. Se obtuvieron con `node --version`, `pnpm --version` y la lectura de sus `package.json`.

**Propuesta Umi:** usar PostgreSQL y TypeScript/JavaScript del backend existente. La media por día de semana requiere sumas, conteos y fechas; no requiere un servicio predictivo ni otra dependencia. PostgreSQL determina la fecha operativa. El backend conserva fracciones con `BigInt` hasta el redondeo final. Vitest comprueba las reglas y Playwright comprueba la interacción. La alternativa, si el historial no alcanza, es mostrar «Historial insuficiente».

| Herramienta        | Versión o referencia                                                                | Licencia y mantenimiento                                                                         | Costo de adopción                                    |
| ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Node.js / `BigInt` | Local: 22.23.4                                                                      | Node usa MIT y avisos de terceros. La página de versiones mantiene Node 22 como LTS.             | Sin dependencia nueva.                               |
| PostgreSQL         | Documentación 17; versión real del servidor debe constar en la evidencia de pruebas | PostgreSQL License. La documentación oficial mantiene la rama 17 entre las versiones soportadas. | Reutilizar esquema, permisos y consultas existentes. |
| Vitest             | Local API: 2.1.9                                                                    | MIT, según el manifiesto instalado. No se comprobó que esta versión sea la última.               | Reutilizar la suite existente.                       |
| Playwright         | Local: 1.62.1                                                                       | Apache-2.0, según el manifiesto instalado. No se comprobó que esta versión sea la última.        | Reutilizar navegador y recorridos existentes.        |

Fuentes: [licencia de Node 22.23.4](https://github.com/nodejs/node/blob/v22.23.4/LICENSE), [versiones de Node](https://nodejs.org/en/about/previous-releases), [licencia de PostgreSQL](https://www.postgresql.org/about/licence/), [documentación PostgreSQL 17](https://www.postgresql.org/docs/17/functions-datetime.html).

La consulta inicial de TypeScript en el `node_modules` raíz no resolvió el paquete. Esto no prueba que falte en los workspaces. No se asigna aquí una versión no verificada.

## Evidencia externa

**Hecho documentado:** _Forecasting: Principles and Practice_ presenta la media y el método ingenuo estacional como referencias simples. Recomienda evaluar con observaciones posteriores al entrenamiento. MAE mide errores absolutos en las unidades originales; MAPE presenta problemas cuando hay valores cero. La validación temporal no utiliza observaciones futuras para construir cada pronóstico. [Capítulo 5, métodos y evaluación](https://otexts.com/fpp3/toolbox.html).

**Decisión con fundamento:** una referencia semanal permite comparar el resultado con una regla comprensible. Mostrar MAE por producto evita comparar directamente errores de magnitudes y unidades distintas. La ventana de 56 días y el mínimo de cuatro observaciones son decisiones Umi; la fuente no acredita que sean óptimos.

**Hecho documentado:** ECMAScript define `BigInt` como enteros de precisión arbitraria. Su división trunca; el código debe definir el redondeo. [Especificación de `BigInt`](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-bigint).

**Hecho documentado:** PostgreSQL permite convertir una marca temporal con `AT TIME ZONE` y operar con fechas e intervalos. [Funciones de fecha y hora](https://www.postgresql.org/docs/17/functions-datetime.html).

Se usaron documentación oficial, especificación y el libro de los autores. Las rutas antiguas `simple-methods.html`, `accuracy.html` y `tscv.html` redirigieron al capítulo `toolbox.html`; la consulta continuó en esa página. No fue necesario recurrir a blogs ni redes sociales.

## D01. Horizonte y fecha

**Propuesta Umi:** calcular el día operativo con la zona horaria y `business_day_start` del negocio. La próxima compra es el primer día configurado estrictamente posterior al día operativo actual. El periodo incluye hoy y termina el día anterior a esa compra.

Si hoy es día de compra, se supone que la compra de hoy ya se resolvió. Con una sola selección semanal, el horizonte contiene siete días. Sin días configurados, el resultado queda sin horizonte y sin cantidades sugeridas.

El cálculo incluye todo el día actual, aunque parte de sus ventas ya ocurrió. Esta decisión puede aumentar la estimación restante. Debe aparecer como límite visible. No se debe presentar como predicción intradía.

**Límite:** un día habitual de compra no garantiza que el proveedor entregue antes de abrir. El negocio debe ajustar su mínimo para cubrir esa diferencia.

## D02. Método, observaciones y productos nuevos

**Propuesta Umi:** estimar cada producto y variante por separado. Para cada día futuro, promediar las ventas netas del mismo día de semana en los 56 días operativos completos anteriores. Excluir hoy del entrenamiento. Exigir al menos cuatro ocurrencias observables de cada día requerido.

Un producto nuevo o sin cuatro ocurrencias devuelve una cantidad desconocida. No sustituirla por cero. No imputar semanas anteriores a su primera observación válida.

**Hipótesis explícita:** si la única fecha de inicio disponible es la primera venta, los días posteriores sin filas pueden contarse como cero solamente bajo la hipótesis de captura continua. Una fila ausente no demuestra que el negocio estuvo abierto ni que el POS sincronizó todas sus ventas. Un cierre excepcional, una desconexión o una importación incompleta pueden sesgar el resultado. Si se detecta falta de cobertura, marcar historial insuficiente; no inventar ceros. No inferir un calendario de apertura a partir de los días de compra.

**Validación propuesta:** reservar los últimos siete días completos. Entrenar solamente con los 56 días anteriores a ese bloque. Comparar la media semanal y el último mismo día de semana. Mostrar MAE y número de días evaluados por producto. Si falta historia, dejar MAE sin valor. Esto es un bloque de validación; no equivale a una validación temporal completa con múltiples orígenes.

## D03. Ventas, anulaciones y devoluciones

**Propuesta Umi:** usar unidades de ventas confirmadas. Restar cantidades compensadas por devoluciones y anulaciones confirmadas, sin producir demanda negativa. Asociar la corrección al día operativo de la venta original. No incluir carritos abiertos, intentos de cobro ni pedidos cancelados antes de confirmar la venta.

Mantener separadas las variantes. Usar su asignación de inventario específica; si no existe, aplicar la asignación general que permite la operación actual.

**Control contra fuga temporal:** para validar un pronóstico histórico, las devoluciones del entrenamiento deben limitarse a las conocidas antes del corte de entrenamiento. Descontar una devolución posterior proporciona información futura al modelo. Registrar la política temporal del objetivo de validación por separado.

No pronosticar importe de ventas en esta primera regla. Unidades previstas y costo de reposición son magnitudes distintas.

## D04. Existencias y consumo previsto

**Propuesta Umi:** usar la disponibilidad canónica: existencias menos reservas, daño y cuarentena. Conservar saldos negativos. Excluir compras en tránsito hasta que se registre su recepción.

Convertir las ventas previstas con las recetas vigentes, sus rendimientos y conversiones. La implementación final lee componentes inmediatos de las tablas canónicas, conserva la aritmética de rendimientos/conversiones y descuenta preparaciones compartidas antes de propagar demanda. La expansión a hojas usada para costos no basta para descontar existencias de preparaciones. No mezclar la receta histórica con una compra destinada a producir la receta actual.

Si una receta, conversión o rendimiento no se puede resolver, identificar el dato faltante. Evitar una sugerencia completa que omita consumo desconocido. Un producto expresamente marcado como ajeno al inventario no requiere ingredientes.

La consulta es de lectura: no registra consumo, compras ni preparación.

## D05. Cantidad sugerida

**Propuesta Umi:** `reposición = max(0, consumo previsto + mínimo configurado − disponible)`.

El mínimo existente actúa como reserva al final del horizonte. No agregar un porcentaje oculto. Un mínimo ausente implica que no hay reserva configurada; no implica que no haya consumo. Conservar esta distinción en la explicación.

El saldo negativo aumenta la reposición. Una compra recibida o un ajuste modifica la disponibilidad del siguiente cálculo. No cambiar estos saldos desde la pantalla de planificación.

## D06. Unidades, empaque y costo

**Propuesta Umi:** mostrar la unidad base y escala del artículo. Sumar fracciones exactas y redondear hacia arriba una sola vez al final, en la menor unidad representable. Verificar el rango seguro antes de convertir a JSON numérico.

No deducir tamaño de empaque ni proveedor. La agrupación y el redondeo por caja requieren datos comerciales que la entrega no garantiza.

Para estimar el costo, reutilizar la fuente vigente: compras recibidas antes que costo inicial manual. Costo desconocido permanece desconocido; un costo explícito cero sí es cero. Mostrar que el importe es una estimación de reposición, sin prometer precio del próximo proveedor.

## D07. Canal y destinatario

**Propuesta Umi:** el dashboard muestra el estado de faltantes. El correo al dueño es un canal opcional, desactivado de forma predeterminada. Se reutiliza el adaptador de correo. La implementación usa una comprobación periódica y una identidad persistente en PostgreSQL; no añade una cola nueva.

El destinatario debe obtenerse de una membresía activa con rol de dueño del mismo negocio. No tomar el correo del usuario que abrió la pantalla. Verificar dirección habilitada, preferencias y autorización del negocio.

**Hecho de código:** `apps/umi-api/src/shared/adapters/email.adapter.ts` requiere host SMTP y remitente; permite un relay local sin autenticación. Esto acredita capacidad de código, no configuración ni entrega real.

**UNVERIFIED:** credenciales, remitente, preferencias, cola y entrega de producción. Las pruebas deben usar un receptor local. El PR no debe afirmar que el correo real está activo sin evidencia.

## D08. Frecuencia, repetición y resolución

**Propuesta Umi:** un resumen diario a las 09:00 locales cuando haya faltantes explicables y el dueño active correo. Una clave única por negocio, destinatario, fecha operativa y tipo de aviso evita envíos repetidos por consultas o reintentos.

La consulta del plan no envía mensajes. Un proceso programado decide si existe un aviso pendiente. Una compra o ajuste puede resolver el faltante; el siguiente cálculo debe reflejarlo. Si la condición desapareció antes del envío, omitir el aviso.

La implementación registra `sending`, `sent` y `unknown`. El adaptador SMTP no permite distinguir de forma fiable un rechazo de una aceptación cuya respuesta se perdió; por eso no se reintentan automáticamente los resultados inciertos. Un caso omitido por ausencia de faltantes o preferencias desactivadas no reserva un intento. El proveedor puede aceptar un correo y perderse la respuesta; sin idempotencia del proveedor, no prometer entrega exactamente una vez. Debe existir evidencia del tratamiento de ese caso antes de activar envíos reales.

El resumen lleva al plan o al artículo y explica fecha, disponibilidad y cantidad propuesta. No usar «urgente» cuando faltan historia o recetas.

## D09. Política de inventario

**Hecho de código:** `db/36_pos_inventory.sql` define una política por negocio y sucursal, con vigencia, versión y huella. `pos-inventory.repository.ts` verifica vigencia y huella antes de escrituras.

**Propuesta Umi:** el backend debe crear y renovar la política dentro del flujo autorizado de inventario. La operación debe ser idempotente por negocio y sucursal. La renovación conserva restricciones y opciones existentes; no sustituye decisiones del dueño por defaults.

Para una política nueva, usar valores conservadores del esquema: bloqueo de saldo negativo, reservas requeridas, mutaciones sin conexión desactivadas y aprobaciones según los umbrales existentes. Una política caducada requiere una nueva emisión; nunca ignorar la comparación de huella de un cliente antiguo.

Probar negocio nuevo, política ausente, vencida y vigente, dos solicitudes simultáneas, sucursal ajena y cliente con huella anterior. El fixture no prueba el alta automática si creó la política antes del recorrido.

## Guía para revisar el PR

1. Comparar estas propuestas con el código final y el documento de pruebas del PR.
2. Revisar un negocio sin historial y otro con ventas completas por al menos nueve semanas.
3. Repetir el cálculo con variantes, devolución posterior al corte y cierre excepcional.
4. Comprobar día de compra actual, domingo, cambio de mes y corte operativo distinto de medianoche.
5. Revisar recetas incompletas, subrecetas, escalas, saldo negativo y costo ausente.
6. Comprobar el aislamiento del negocio y de la sucursal, también en lecturas y guardados tardíos.
7. Verificar los avisos con receptor local, reintento, resolución del faltante y preferencias desactivadas.
8. Registrar resultados reales y límites. Las reglas documentadas no sustituyen la prueba de implementación.
