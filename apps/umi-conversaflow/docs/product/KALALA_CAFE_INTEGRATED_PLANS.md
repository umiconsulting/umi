# Planes Integrados para Kalala Café

## ConversaFlow + ConversaFlow Logs

Fecha: 13 de marzo de 2026

## 1. Enfoque

La propuesta para Kalala Café no debe vender solo el bot de WhatsApp. Debe venderse como una solución integrada de dos piezas:

- **ConversaFlow**: canal conversacional de ventas y atención por WhatsApp
- **ConversaFlow Logs**: consola operativa, analítica y de control para monitorear conversaciones, costos, seguridad, memoria e integraciones

Esto cambia el valor percibido del producto. Ya no es solo automatización de respuestas; es un sistema comercial-operativo con visibilidad.

## 2. Qué incluye el producto integrado

### 2.1 ConversaFlow

- atención automática por WhatsApp
- búsqueda de productos y categorías
- consulta de horarios, pagos y ubicación
- toma de pedidos
- repeat order
- pedidos para terceros
- cancelación de pedidos
- validación de horario y reglas del negocio
- memoria del cliente
- integración con catálogo
- integración operativa con Slack

### 2.2 ConversaFlow Logs

- dashboard general de actividad
- conversaciones activas
- clientes y gasto acumulado
- costos de IA
- monitoreo de integraciones
- salud de memoria/embeddings
- panel de seguridad
- trazabilidad por request
- monitoreo de errores y latencia

## 3. Por qué esto importa para pricing

Si el servicio incluyera solo un bot sencillo, `MXN 10,000` de implementación y `MXN 2,000/mes` podrían sentirse altos para algunos cafés pequeños.

Pero si el producto incluye:

- operación de pedidos
- catálogo
- memoria del cliente
- Slack para staff
- panel de monitoreo y control
- visibilidad de costos y seguridad

entonces el pricing actual ya no se compara con un bot básico, sino con una solución semi-custom de comercio conversacional.

Bajo esa lógica:

- **`MXN 10,000` implementación** sí es razonable como entrada
- **`MXN 2,000/mes` mantenimiento** también es razonable como base
- **`MXN 500` por sucursal extra** sigue viéndose bajo si cada sucursal implica configuración, operación y soporte real

## 4. Criterio recomendado para planes

Los planes deben estructurarse por complejidad operativa, no solo por "tener bot o no".

La diferencia entre planes debe venir de:

- cantidad de sucursales
- nivel de monitoreo
- operación en Slack
- profundidad de reporteo
- soporte y ajustes mensuales
- personalización comercial

## 5. Planes recomendados

## Plan 1. Starter

### Ideal para

- una sola sucursal
- operación simple
- negocio que quiere automatizar atención y pedidos básicos

### Incluye

- 1 sucursal
- configuración inicial de WhatsApp
- carga/configuración operativa inicial
- horario, dirección y métodos de pago
- menú y categorías
- atención automática de preguntas frecuentes
- búsqueda de productos
- toma de pedidos básica
- ubicación
- panel básico en ConversaFlow Logs
- monitoreo de conversaciones
- mantenimiento mensual básico

### Precio recomendado

- **Implementación:** `MXN 10,000`
- **Mantenimiento mensual:** `MXN 2,000`

### Observación

Este precio funciona bien como plan de entrada. Es suficientemente accesible y todavía deja espacio para upsell.

## Plan 2. Commerce Ops

### Ideal para

- cafés que quieren ordenar mejor la operación
- negocios con mayor volumen de pedidos
- clientes que valoran visibilidad y control

### Incluye todo lo de Starter, más:

- repeat order
- pedidos para terceros
- cancelación de pedidos
- integración operativa con Slack
- panel completo de ConversaFlow Logs
- monitoreo de costos IA
- monitoreo de integraciones
- monitoreo de seguridad
- memoria del cliente activa
- ajustes mensuales operativos

### Precio recomendado

- **Implementación:** `MXN 12,000–15,000`
- **Mantenimiento mensual:** `MXN 3,000–4,000`

### Observación

Este es el plan que mejor representa el producto real que ya existe en el repo.

## Plan 3. Multi-Branch

### Ideal para

- negocios con dos o más sucursales
- operaciones con horarios/configuraciones diferentes
- equipos con más necesidad de control

### Incluye todo lo de Commerce Ops, más:

- múltiples sucursales
- configuración por sucursal
- reglas de operación por sucursal
- horarios y datos operativos por sucursal
- soporte de despliegue y validación por sucursal
- estructura para escalar administración y monitoreo

### Precio recomendado

- **Implementación base:** `MXN 12,000–15,000`
- **Sucursal extra setup:** `MXN 1,500–3,000` por sucursal
- **Mantenimiento base mensual:** `MXN 3,000–4,000`
- **Sucursal extra mensual:** `MXN 500–1,000` por sucursal

### Observación

Aquí sí conviene cobrar por sucursal adicional. `MXN 500` como cobro único se queda corto. Solo tendría sentido si fuera un duplicado casi automático sin soporte operativo adicional.

## 6. Recomendación concreta sobre tu pricing actual

Si quieres conservar una oferta comercial fácil de cerrar para Kalala Café, la recomendación más sana es:

- **Implementación base:** `MXN 10,000`
- **Mantenimiento base:** `MXN 2,000/mes`
- **Sucursal extra setup:** `MXN 2,000`
- **Sucursal extra mensual:** `MXN 500`

Eso corrige la parte más débil del esquema actual: cobrar demasiado poco por agregar sucursales.

## 7. Por qué `MXN 500` por sucursal extra no alcanza como fee único

Agregar una sucursal normalmente implica:

- horarios propios
- dirección propia
- posible WhatsApp propio
- posibles admins/operadores propios
- pruebas de flujos
- ajustes de catálogo o disponibilidad
- soporte operativo adicional
- carga adicional en monitoreo

Aunque parte del sistema se reutiliza, el esfuerzo marginal no es tan bajo como para dejarlo en `MXN 500` de una sola vez.

## 8. Cómo presentarlo al cliente

La forma más vendible para Kalala Café sería:

### Opción comercial simple

- `MXN 10,000` implementación inicial
- `MXN 2,000/mes` mantenimiento y monitoreo
- `MXN 2,000` por sucursal adicional
- `MXN 500/mes` por sucursal adicional

### Qué decir que incluye el mantenimiento

- monitoreo en ConversaFlow Logs
- revisión de errores y estabilidad
- ajustes menores de operación
- soporte básico
- mantenimiento de reglas del negocio
- revisión de integraciones

## 9. Posicionamiento correcto del mantenimiento

El fee mensual no debe venderse como "soporte técnico" solamente.

Debe venderse como:

**operación continua, monitoreo y optimización del canal de WhatsApp**

porque con `ConversaFlow Logs` ya tienes base para justificar eso de manera real.

## 10. Recomendación final

Para Kalala Café, el pricing más coherente hoy sería:

- `MXN 10,000` implementación inicial para 1 sucursal
- `MXN 2,000/mes` mantenimiento base
- `MXN 2,000` por sucursal extra en setup
- `MXN 500/mes` por sucursal extra

Y si el cliente quiere la versión más completa, con operación más fuerte y uso pleno de `ConversaFlow Logs`, puedes empujar una versión superior:

- `MXN 12,000–15,000` implementación
- `MXN 3,000–4,000/mes` mantenimiento

## 11. Conclusión

Tu precio base no está mal. Lo que está mal calibrado es la sucursal adicional.

La lógica correcta es:

- el setup base está bien como puerta de entrada
- el mantenimiento base está bien si incluye monitoreo real con Logs
- la sucursal extra necesita cobrarse más en setup
- el uso de `ConversaFlow Logs` te ayuda a defender mejor el fee mensual

En otras palabras:

**no estás caro en base; estás barato en multi-sucursal.**
