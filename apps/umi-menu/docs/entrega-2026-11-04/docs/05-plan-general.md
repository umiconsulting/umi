# Plan general de entrega

## Objetivo y alcance del plan

Entregar un menú conectado con Umi, desde consulta y configuración hasta pedido, preparación, seguimiento y cobro en negocio.

Este es el mapa general por capacidades. La descomposición detallada está en [el backlog](../backlog/README.md): 33 historias, 13 decisiones pendientes y 205 tareas. El [mapa técnico](11-mapa-tecnico-y-pruebas.md) identifica archivos y pruebas existentes. Las decisiones aún abiertas se resuelven antes de fijar contratos y esquemas nuevos.

La especificación de referencia está en [contexto](01-contexto-y-decisiones.md) y [flujos](02-flujos-y-reglas.md). Las brechas técnicas están en [arquitectura](04-arquitectura-e-integracion.md).

## Forma de trabajo acordada

- Actualizar staging antes de implementar cada entrega.
- Aislar el trabajo en una rama o worktree del repositorio real.
- Completar localmente el comportamiento y sus comprobaciones antes de abrir el PR.
- Usar PRs atómicos con base `staging`.
- Tras integrar cada cambio, probarlo en staging antes de promoverlo a `main`.
- Tratar la promoción a main como un paso posterior. El PR de desarrollo no apunta a main.
- Mantener juntos los cambios acoplados de contrato, persistencia, cliente y pruebas cuando la compatibilidad los exija.
- Incluir documentación y reversión en el PR funcional.
- Mantener desactivados los recorridos incompletos.
- No abrir un PR solo para este plan. P00 quedó descartado.
- Vincular el issue de GitHub cuando exista. Los identificadores Pxx y MD-Hxx son referencias locales, no números de issue o PR.

## Fases

| Fase | Resultado | Entregas candidatas |
| --- | --- | --- |
| A. Base y catálogo | Configuración aislada, opciones válidas y menú público de datos reales. | P01–P05 |
| B. Ciclo inmediato | Pendiente, aceptación, rechazo, vencimiento, cancelación y seguimiento, atendidos desde POS. | P06–P09 y P06D |
| C. Cliente y avisos | Diseño aprobado conectado; mesa y recogida con correo. | P10–P13 |
| D. Programación | Reglas, reserva y liberación por hora, configurables y operables. | P14–P17 |
| E. Publicación y piloto | Enlaces y QR estables, despliegue preparado y validación de una sucursal. | P18–P19 y piloto |

La tabla no impone trabajo completamente secuencial. P03 y P10 pueden avanzar cuando sus dependencias estén disponibles. La activación pública espera el flujo completo de su modalidad.

## Entregas candidatas

Cada fila describe un resultado que permite una revisión independiente. La revisión técnica puede subdividirlo si mantiene el objetivo y la compatibilidad.

| ID | Resultado funcional | Depende de | Evidencia de aceptación |
| --- | --- | --- | --- |
| P01 | Persistir y consultar publicación, recepción y modalidades por negocio/sucursal. | Revisión de base y decisión A01. | Permisos, aislamiento, valores iniciales y pausa sin pérdida de pedidos. |
| P02 | Persistir visibilidad y modalidades de productos. | P01. | Reglas del catálogo aplicadas en servidor sin afectar otro negocio. |
| P03 | Admitir variantes en el flujo público existente de mesa. | Revisión del contrato vigente. | Variante, precio y modificadores válidos; reintento sin duplicación. |
| P04 | Exponer catálogo público por sucursal. | P02, P03. | Solo datos públicos; opciones y precios canónicos; publicación respetada. |
| P05 | Administrar publicación y contenido desde Dashboard. | P01, P02, P04. | Recorrido en navegador con alcance visible y catálogo compartido. |
| P06 | Registrar y resolver recogida inmediata en la API; persistir el plazo de aceptación y su contrato. | P01, P02, P03; decisiones A02–A04, A13. | Pendiente sin KDS; aceptar proyecta una vez; rechazar y vencer impiden preparar; plazo configurable aplicado. |
| P06D | Administrar el plazo de aceptación desde Dashboard. | P05, P06. | Alcance visible, permisos y plazo válido; valor real antes de activar recogida inmediata. |
| P07 | Consultar un pedido con enlace privado. | P06. | Acceso a un solo pedido, sin enumeración o historial ajeno. |
| P08 | Resolver cancelación directa y solicitudes. | P06, P07; permisos e inventario definidos. | Carreras de aceptar/cancelar producen un resultado válido; solicitud no cancela por sí sola. |
| P09 | Atender y cobrar recogidas desde UmiPOS. | P06, P08. | Alerta sonora y contador de pendientes; aceptación, rechazo, solicitud y cobro sobre el mismo pedido. |
| P10 | Conectar el catálogo con el diseño aprobado. | P04. | Catálogo y detalle reales en móvil/escritorio, sin sustituir el diseño. |
| P11 | Enviar pedidos desde QR de mesa. | P03, P10. | Mesa correcta, total validado, aviso y reparto a estaciones, sin duplicados. |
| P12 | Enviar y seguir recogida inmediata desde el menú. | P06D, P07, P08, P09, P10. | Contacto con correo sin OTP; pendiente explícito; seguimiento y cancelación coherentes. |
| P13 | Emitir correos por eventos de pedido. | P06, P07, P08. | Destinatario, negocio y enlace correctos; reintentos controlados; fallo aislado del pedido. |
| P14 | Validar, reservar y liberar pedidos programados. | P06, P08, P13; decisiones A05–A07. | Una hora compatible; reserva sin KDS temprano; liberación y cancelación concurrentes seguras. |
| P15 | Configurar programación desde Dashboard. | P05, P14. | Horarios y reglas por producto/sucursal, con errores visibles. |
| P16 | Atender programados desde UmiPOS. | P09, P14. | Hora visible, reserva distinta de preparación y recuperación tras desconexión. |
| P17 | Elegir y seguir recogida programada desde el menú. | P12, P14, P15, P16. | Carritos mixtos, cierres, zona horaria y límite de cancelación correctos. |
| P18 | Administrar enlaces y QR desde Dashboard. | P05, P11. | Identidad correcta de negocio/sucursal/mesa y manejo de credenciales existentes. |
| P19 | Preparar configuración de publicación del menú. | Flujos a activar completos; P13, P18. | Rutas estables, entornos, vista previa, observabilidad y reversión documentadas. |

Esta versión elimina la dependencia de P00. Explicita el enlace privado para P13 y añade P06D para que la edición del plazo tenga una entrega responsable. La tabla es un resumen por capacidades; el orden concreto de implementación y sus dependencias se consulta en el backlog. La [correspondencia entre ambos](../backlog/mapa-entregas.md) cubre todas las entregas P01–P19 y P06D.

## Primera entrega recomendada

**P01: configuración persistente por negocio y sucursal.**

Antes de codificar:

1. Actualizar staging y leer las instrucciones del módulo.
2. Identificar ajustes, horarios, permisos y contratos reutilizables.
3. Definir la precedencia negocio/sucursal y los valores iniciales.
4. Delimitar la respuesta pública y la respuesta administrativa.
5. Diseñar las comprobaciones de aislamiento y de pausa.

La entrega incluye contratos y migración solo si su comportamiento los requiere. La UI, los pedidos reales y la programación no son requisitos para demostrar esta persistencia.

No activar recepción desde una opción de configuración hasta que exista el flujo que la atiende.

## Condiciones para abrir cada PR

- Objetivo y resultado revisables.
- Dependencias integradas en staging antes de abrir el PR funcional. Su diff frente a staging debe contener solo el objetivo declarado.
- Pruebas del comportamiento y de regresiones relevantes.
- Compatibilidad documentada de contratos y clientes.
- Capturas o recorrido cuando cambia una interfaz.
- Migración probada con esquema nuevo y datos sintéticos existentes, cuando corresponda.
- Forma de desactivar entradas nuevas y preservar pedidos en curso.
- Descripción basada en el cambio final y evidencia real, sin afirmar verificaciones no ejecutadas.

## Piloto

La secuencia de promoción es: **trabajo local → PR atómico a staging → pruebas en staging → promoción revisada a main**. Las pruebas locales no sustituyen la validación en staging.

Seleccionar negocio y sucursal. Cargar catálogo, productos programables, horarios, valores operativos y remitente reales.

Validar mesa, recogida inmediata y programación de extremo a extremo. Incluir rechazo, vencimiento, cancelación, varias estaciones y fallo de correo.

Comprobar recuperación ante desconexión y reintentos. Confirmar un solo cobro y seguimiento accesible. Registrar quién atiende incidencias y cómo se pausa el canal.

P19 prepara la publicación. La fecha y la activación del piloto son decisiones operativas posteriores.

## Historias y tareas disponibles

Cada archivo de [historias](../backlog/README.md) incluye actor, necesidad, resultado, alcance excluido, decisiones Dxx, entregas Pxx, dependencias, criterios de aceptación, tareas concretas y escenario de staging. Las decisiones MD-Axx conservan la correspondencia con A01–A13 del documento de pendientes.

Una tarea tiene una acción y una condición de terminación. No implica un PR separado por capa o archivo: el PR conserva las piezas acopladas necesarias para demostrar su objetivo.

GitHub Issues es el registro elegido por el usuario. La [guía de GitHub](10-historias-y-tareas-github.md) explica cómo publicar sin duplicar issues y cómo cerrarlos con evidencia. Esta entrega contiene borradores locales; no publica issues ni crea un PR documental.
