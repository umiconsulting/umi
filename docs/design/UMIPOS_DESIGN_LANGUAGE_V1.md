# UmiPOS Design Language V1

Estado: congelado para el piloto el 13 de agosto de 2026.

## Objetivo

UmiPOS debe ser rápido, claro y seguro. Cada pantalla debe mostrar una acción principal.
La interfaz debe usar el lenguaje del operador. Los códigos técnicos solo pertenecen a Diagnósticos.

## Tipografía y dinero

- Usa el tema semántico de Flutter.
- Usa un interlineado de 1.45 a 1.5 para el texto operativo.
- Usa peso 600 para los títulos.
- Usa cifras tabulares para el dinero y para los valores que cambian.
- Da al total y al importe restante la mayor jerarquía de cada pago.
- Limita cada texto de ayuda a una acción segura.

## Espacio y superficies

- Usa la escala `4, 8, 16, 24, 32`.
- Usa un radio de 14 para los controles.
- Usa un radio de 20 para las tarjetas.
- Usa una tarjeta solo cuando agrupe una tarea o un estado.
- Usa un máximo de un color de acento por vista.
- No uses verde como color principal general.

## Controles

- Usa un objetivo táctil mínimo de 48 por 48 píxeles lógicos.
- Usa una altura de 52 píxeles para la acción principal.
- Muestra un foco visible.
- Desactiva una acción inválida y explica el requisito junto al campo.
- Usa texto y un icono cuando el color no comunique el estado por sí solo.
- Usa una confirmación para una acción destructiva o terminal.

## Estados

- `Cargando`: conserva la estructura y anuncia el progreso.
- `Procesando`: bloquea el envío duplicado.
- `Esperando aprobación`: muestra quién debe actuar.
- `Completado`: muestra la referencia, el importe y la acción siguiente.
- `Falló`: explica una acción segura.
- `Requiere recuperación`: conserva la referencia y prohíbe repetir un cobro ambiguo.

Cada estado vacío debe explicar la causa y una acción útil. Un estado vacío no debe ocupar todo el área de venta.

## Formularios y diálogos

- Asocia cada error con su campo.
- Conserva el valor válido cuando una vista previa queda obsoleta.
- Coloca el foco inicial en el primer campo requerido.
- Permite cerrar un diálogo no terminal con `Escape`.
- Restaura el foco al control que abrió el diálogo.
- Limita los sheets a 760 píxeles y permite desplazamiento.

## Pagos

- Separa `Vista previa` de `Confirmar cobro`.
- Muestra `Total`, `Asignado` y `Restante` juntos.
- Muestra cada tender y su importe.
- Explica que la terminal externa es una declaración del operador.
- Muestra el cambio después del commit.
- Separa el fallo de la impresora del éxito financiero.
- No muestres una acción para repetir un resultado financiero desconocido.

## Aprobaciones y acciones destructivas

- Muestra la operación, el alcance y el importe antes de solicitar el PIN.
- Explica una aprobación vencida en lenguaje operativo.
- Usa rojo solo para una acción destructiva o un error.
- Separa `Suspender`, `Cancelar`, `Refund` y `Void`.

## Offline, hardware y recuperación

- Mantén visible el estado offline sin bloquear las acciones permitidas.
- Explica por qué wallet, gift card y reward no están disponibles offline.
- Muestra una acción manual cuando el escáner no está disponible.
- Clasifica un resultado físico como conocido, desconocido o fallido.
- El Centro de recuperación debe mostrar qué ocurrió, qué se conoce y qué acción es segura.

## Accesibilidad

- Asigna un nombre a cada control interactivo.
- Mantén el orden visual y el orden de foco iguales.
- Usa semántica nativa antes de agregar semántica personalizada.
- Mantén un contraste mínimo WCAG AA.
- Admite texto al 200 % en los flujos críticos.
- Respeta la preferencia de movimiento reducido.
- No uses una notificación temporal como único mensaje para un error crítico.

## Diseño adaptable

- Resolución mínima certificada: 600 por 900 píxeles lógicos para el acceso.
- Resolución mínima operativa recomendada: 900 por 720 píxeles lógicos.
- Usa el carrito como panel fijo desde 900 píxeles.
- Usa un sheet del carrito bajo 900 píxeles.
- No se certifica una interfaz POS para teléfono.

## Movimiento

- Usa movimiento Material local y corto.
- Usa 120 ms para la respuesta de un control.
- Usa hasta 220 ms para una transición de superficie.
- Anima solo opacidad o transformación cuando sea posible.
- No uses movimiento decorativo en un pago.
