# Pendientes y validación

## Decisiones por cerrar

Las responsabilidades de esta tabla son propuestas de participación. No asignan personas ni fechas comprometidas.

| ID | Decisión | Cerrar antes de | Participación sugerida |
| --- | --- | --- | --- |
| A01 | Precedencia de ajustes entre negocio y sucursal; valores iniciales; permisos de edición. | P01. | Producto y backend. |
| A02 | Cuándo reservar o descontar inventario; efectos de rechazo, vencimiento y cancelación. | P06 y P08. | Backend, inventario y operación. |
| A03 | Correspondencia entre aceptación, preparación, estado comercial, cuenta y cobro existente. | P06 y P09. | Backend y POS. |
| A04 | Permisos de cancelación, especialmente después de iniciar preparación y al cambiar de día operativo. | P08. | Producto, backend y POS. |
| A05 | Fórmula de preparación para cantidades y carritos mixtos. | P14. | Operación y backend. |
| A06 | Admitir programados mientras el negocio está cerrado y cuándo empieza su aceptación. | P14. | Producto y operación. |
| A07 | Capacidad de horarios, excepciones, anticipación, horizonte y cancelación; valores configurables reales. | P14 y piloto. | Operación y producto. |
| A08 | Cómo detectar personal/dispositivos disponibles y cuándo pausar pedidos inmediatos. | Activar P11/P12 según modalidad. | POS, backend y operación. |
| A09 | Remitente, respuesta al negocio, dominio de correo, rebotes y prueba de entrega. | Activar P13. | Operación y backend. |
| A10 | Dominio, rutas, ubicación del frontend y acceso a Cloudflare. | P10/P19 según impacto. | Arquitectura y operación. |
| A11 | Negocio/sucursal del piloto y responsable de atención. | Piloto. | Producto y operación. |
| A12 | Límites de abuso, expiración/rotación de enlaces y retención de datos de contacto. | API pública de pedidos/seguimiento. | Backend y producto. |
| A13 | Alcance, valor inicial y límites del plazo de aceptación; tratamiento de cambios con pedidos pendientes. | P06; valor real antes de activar recogida. | Producto, operación y backend. |

El plazo exacto de aceptación no está aprobado como un valor universal. Los minutos y días del prototipo son ilustrativos.

## Brechas conocidas del prototipo

| Brecha | Acción al implementar |
| --- | --- |
| Formulario interactivo pide solo nombre y teléfono. | Añadir correo con el mismo diseño. El adaptador del recorrido ya lo representa. |
| Estado de pedidos simulado y memoria local. | Consumir contratos y persistencia reales. |
| Aceptación, KDS, pago y correo representados en escenas. | Validar cada integración en su entorno real. |
| Valores de Bruma fijos. | Cargar configuración y catálogo del negocio/sucursal. |
| Poco contraste en iconos laterales del POS del recorrido, observado el 3 de noviembre. | Revisar contra la versión vigente antes de corregir; conservar el diseño elegido. |
| Scripts QA con rutas de Chromium del autor y selectores antiguos. | Adaptar el ejecutable y comprobar selectores antes de usarlos como evidencia actual. |
| Filmación con cobertura temporal inconclusa. | Repetir la revisión de movimiento si se modifica el recorrido. |

## Matriz mínima de validación del producto

| Área | Caso | Resultado requerido |
| --- | --- | --- |
| Aislamiento | Configurar negocio A y consultar B. | Ningún dato o ajuste cruza el alcance. |
| QR | Alterar negocio, sucursal o mesa. | Rechazo; no se crea pedido ajeno. |
| Catálogo | Enviar producto oculto, agotado o modalidad prohibida. | Rechazo del servidor. |
| Opciones | Omitir opción obligatoria o enviar variante inválida. | Error identificable; sin pedido parcial. |
| Precio | Cambiar precio antes de confirmar. | Nueva revisión visible y total canónico. |
| Idempotencia | Repetir envío tras timeout. | Mismo pedido y mismo resultado. |
| Mesa | Enviar pedido válido. | Preparación y aviso al POS, sin espera de aceptación. |
| Recogida | Crear pendiente. | No aparece en KDS. |
| Aviso en POS | Llega una recogida pendiente. | Alerta sonora y contador; el personal puede abrir el pedido. |
| Plazo | Cambiar el plazo configurado y dejar vencer un pedido. | Se respeta la política acordada; no se prepara un vencido. |
| Aceptación | Aceptar dos veces o desde dos clientes. | Una transición y una proyección. |
| Concurrencia | Aceptar y cancelar al mismo tiempo. | Un resultado válido y consistente. |
| Rechazo/vencimiento | Intentar aceptar un pedido cerrado. | Rechazo de transición inválida. |
| Programación | Mezclar productos con reglas distintas. | Solo horarios compatibles con todos. |
| Calendario | Cierre, excepción y zona horaria. | Fecha y hora válidas, sin anticipación insuficiente. |
| Liberación | Repetir trabajo programado después de caída. | Una preparación, sin adelanto ni duplicación. |
| Cancelación programada | Cancelar mientras se libera. | No queda un cancelado que se prepara después. |
| Solicitud | Pedir cancelación de un aceptado. | Sigue activo hasta resolución autorizada. |
| Permisos | Cancelar un preparado sin autorización. | Respeta la política vigente de Umi. |
| Estaciones | Barra termina y cocina no. | Pedido agregado sigue en preparación. |
| Cobro | Adoptar y cobrar un pedido del menú. | Una orden comercial y un cobro correcto. |
| Correo | Fallo o reintento del proveedor. | Pedido intacto; fallo trazable y reintento controlado. |
| Identidad | Escribir teléfono/correo de otro cliente. | No expone historial, saldo ni identidad ajena. |
| Seguimiento | Enumerar números de pedido o usar enlace ajeno. | Acceso limitado por credencial. |
| Pausa | Pausar recepción con pedidos activos. | Menú visible; pedidos activos conservados. |
| Conexión | Dispositivo cae antes/después de aceptar. | Política explícita y recuperación sin duplicados. |
| Adaptación | Móvil, escritorio, teclado y nombres largos. | Controles accesibles y contenido legible. |

## Entornos y prueba pertinente

- API y contratos: pruebas de autorización, reglas y compatibilidad.
- Persistencia: PostgreSQL real para transacciones, restricciones y carreras.
- Migraciones: esquema nuevo y datos sintéticos existentes.
- Dashboard y menú: navegador real con clics, formularios y capturas.
- POS y KDS: cliente nativo y dispositivos pertinentes, según el playbook del repositorio.
- Correo: receptor local de pruebas; después, prueba real con destinatarios autorizados.
- Piloto: evidencia del pedido completo y del procedimiento de pausa/recuperación.

Lee [el playbook incluido](../referencias/umi/docs/development/LOCAL_VERIFICATION_PLAYBOOK.md) como referencia. Usa su versión vigente en el repositorio para ejecutar el producto.

## Lo que no acredita una prueba

Un build correcto no prueba permisos. Un recorrido Stageshow no prueba estados comerciales. Un mensaje aceptado por SMTP no prueba entrega. Un marco iPhone no prueba el dispositivo físico.

Los informes incluidos tienen fecha y alcance. Registra nueva evidencia cuando cambie el código o el entorno relevante.
