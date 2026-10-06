# Certificación de UX de UmiPOS — Gate 8A

Fecha: 13 de agosto de 2026.

## Resultado

`COMPLETE WITH OBSERVATIONS`

La revisión certificó los flujos críticos de operador. No queda un defecto P0 o P1 controlado por código.

## Alcance certificado

| Área                      | Evidencia                                                     | Resultado |
| ------------------------- | ------------------------------------------------------------- | --------- |
| Enrolamiento y PIN        | Estados localizados, un campo, validación, teclado y bloqueo  | PASS      |
| Shell, catálogo y escáner | Identidad, conexión, búsqueda, grid, ráfaga y fallback manual | PASS      |
| Carrito y configuración   | Jerarquía, variantes, modificadores, cantidad, total y scroll | PASS      |
| Cliente y loyalty         | Anónimo, búsqueda, contacto protegido, reward y aprobación    | PASS      |
| Checkout y tender         | Efectivo, terminal manual, wallet, gift card y pago mixto     | PASS      |
| Venta posterior           | Éxito, recibo, venta siguiente, suspensión y cancelación      | PASS      |
| Refund y turno            | Vista previa, aprobación, compensación, conteo ciego y cierre | PASS      |
| Operación                 | Inventario, KDS, hardware, offline y recuperación             | PASS      |
| Estados                   | Carga, vacío, error, conflicto y resultado desconocido        | PASS      |
| Acceso                    | Teclado, foco, semántica, texto al 200 % y touch              | PASS      |
| Diseño adaptable          | Escritorio, escritorio compacto y tablet                      | PASS      |
| Idioma                    | Español primario e inglés completo                            | PASS      |

## Auditoría del sistema de diseño

| Elemento                    | Clasificación | Decisión                                                 |
| --------------------------- | ------------- | -------------------------------------------------------- |
| Tema Material 3 y color UMI | KEEP          | Conserva la identidad violeta.                           |
| Espacio `UmiSpacing`        | KEEP          | Mantiene la escala de cinco pasos.                       |
| Tarjetas y campos           | REFINE        | Centraliza radios y espacio interno.                     |
| Botones y controles         | CONSOLIDATE   | Define 48 píxeles y 52 píxeles para la acción principal. |
| Tipografía y dinero         | REFINE        | Define jerarquía, interlineado y cifras tabulares.       |
| Errores visibles            | CONSOLIDATE   | Traduce códigos a instrucciones para el operador.        |
| Componentes duplicados      | RETIRE        | No se creó un segundo sistema de componentes.            |

## Registro de defectos

| Pantalla      | Nivel | Problema                                                         | Impacto                        | Corrección                                             | Estado |
| ------------- | ----- | ---------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------ | ------ |
| Enrolamiento  | P1    | La acción aceptaba una longitud inválida.                        | Creaba un intento inútil.      | La acción permanece desactivada hasta ocho caracteres. | CLOSED |
| PIN           | P1    | La acción aceptaba menos de cuatro dígitos.                      | Creaba un intento inútil.      | La acción permanece desactivada hasta cuatro dígitos.  | CLOSED |
| Clientes      | P1    | Un error mostraba el código interno.                             | El cajero no sabía qué hacer.  | La vista usa una instrucción localizada.               | CLOSED |
| Sistema común | P1    | Foco, tamaños táctiles y tipografía no tenían una regla central. | Las pantallas podían divergir. | El tema define los tokens del piloto.                  | CLOSED |
| Prueba base   | P1    | Esperaba un contrato y un acceso anteriores.                     | Ocultaba la experiencia real.  | La prueba usa contrato 2.12.0 y un campo de registro.  | CLOSED |

## Recorridos

El recorrido rápido cubrió PIN, tres productos, cantidad, efectivo y venta siguiente.
El segundo recorrido cubrió cliente, modificadores, reward y pago mixto.
Las superficies eliminan pasos redundantes sin omitir una confirmación financiera.

El recorrido de fallos cubrió PIN incorrecto, permiso, estado obsoleto, saldo insuficiente, gift card inválida, hardware, KDS, API, offline y aprobación vencida.
Cada fallo tiene una salida segura. Un resultado desconocido no ofrece otro cobro.

## Evidencia visual y técnica

Las pruebas enfocadas verifican semántica, foco, localización, tamaño compacto y texto al 200 %.
Las pruebas de dominio visual existentes cubren checkout, cliente, caja, refund, inventario y recuperación.
Los builds Linux y Web verifican las superficies reales de Flutter.

No se usa una prueba golden como autoridad visual. La infraestructura actual no define goldens canónicos.

## Observaciones

- Falta la validación táctil con hardware real.
- Falta la validación con impresora, cajón, escáner y customer display reales.
- Falta Xcode y un iPad real para la observación conjunta con KDS.
- Falta la preferencia estética final del Owner.
- Un proveedor de pago externo permanece fuera del alcance.
