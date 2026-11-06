# Contexto y decisiones

## Objetivo

Crear un menú web para varios negocios que usan Umi. El cliente consulta productos, personaliza su pedido y lo envía al negocio.

El negocio configura el canal desde Umi Dashboard. El personal trabaja desde UmiPOS. Cocina, barra y otras estaciones reciben sus productos en KDS.

Un merchant es un negocio de Umi. Cada negocio puede tener varias sucursales. Las opciones deben respetar ambos niveles.

## Origen y evolución

| Momento | Resultado |
| --- | --- |
| Conversación inicial | Menú público, pedido desde mesa y recogida, conectado con UmiPOS. |
| Planeación operativa | Pago en negocio, aceptación para recogida, programación por producto y reglas de cancelación. |
| Notificaciones | Se exploraron WhatsApp, Twilio y SMS. Se eligió correo y seguimiento web para la primera versión. |
| Diseño inicial | Referencia de composición: `https://menus.colegastudio.com/demo`. |
| Revisión de textos | El usuario pidió quitar textos artificiales y conservar el diseño. Se retiró “Bruma · Centro” sobre el título. |
| 1 de noviembre | Borrador funcional y auditoría del VPS de solo lectura. |
| Revisión de entrega | El usuario descartó el PR #244 solo documental. Pidió implementar localmente y abrir PRs funcionales atómicos a staging. |
| 2 de noviembre | Integración del menú y recorrido en Stageshow, con los componentes del redesign local. |
| 3 de noviembre | El usuario señaló la versión publicada como diseño final del menú. Revisión visual y comparación con la compilación local. |
| 4 de noviembre | Preparación de esta entrega y de la continuidad con otra persona que usa Codex. Descomposición en historias y tareas; el usuario confirma GitHub como seguimiento. |

El estado actual del PR #244 no se consultó para esta entrega. La decisión vigente es no repetir ese PR documental.

## Acuerdos del producto

| ID | Decisión | Motivo o consecuencia |
| --- | --- | --- |
| D01 | Admitir mesa por QR y recogida. | Son dos modalidades del mismo canal. |
| D02 | Cobrar en el negocio. | El menú no procesa pagos en línea. |
| D03 | Recogida requiere aceptación. | El personal comprueba disponibilidad y capacidad antes de preparar. |
| D04 | Mesa pasa a preparación sin aceptación previa. | La mesa está identificada y el personal recibe el aviso. |
| D05 | Permitir elegir hora de recogida. | El cliente puede pedir de inmediato o programar. |
| D06 | Permitir otros días según producto y configuración. | Las reglas varían entre negocios. |
| D07 | Configurar desde Umi Dashboard. | Evitar un segundo administrador del menú. |
| D08 | Conservar origen y modalidad como datos distintos. | “Web” no sustituye “Comer aquí” o “Para llevar”. |
| D09 | Mostrar origen en POS, detalle y reportes. | Permite distinguir pedidos digitales de presenciales. |
| D10 | No añadir una insignia permanente de origen al KDS. | La estación necesita modalidad, productos, opciones y estado. |
| D11 | Recogida pide nombre, teléfono y correo; sin OTP. | El usuario descartó la verificación telefónica por costo. |
| D12 | Mesa no exige datos de contacto. | El QR y la mesa dan el contexto operativo. |
| D13 | Avisos iniciales por correo y seguimiento web. | El cliente puede consultar el pedido aunque falle el aviso. |
| D14 | Cancelación según estado y, para programados, hora límite. | Evitar cancelar directamente algo que ya se prepara. |
| D15 | Programado aceptado permanece reservado hasta su liberación. | Aceptar no adelanta la preparación. |
| D16 | “Listo” requiere terminar todas las estaciones involucradas. | Una bebida lista no completa un pedido con alimentos pendientes. |
| D17 | Cobrar y entregar el mismo pedido comercial. | Evitar órdenes y ventas duplicadas. |
| D18 | PRs funcionales atómicos con base staging. Probar en staging antes de promover a main. | Cada entrega tiene un objetivo verificable; desarrollo no va directamente a main. |
| D19 | Usar GitHub Issues para las historias y tareas del menú digital. | Aclaración explícita del usuario; sustituye Azure Boards para este proyecto. Los borradores locales aún no son issues publicados. |

## Diseño aprobado

La referencia es el [menú publicado](https://umi-stageshow.pages.dev/?app=menu) y su [recorrido](https://umi-stageshow.pages.dev/?app=menu&menuView=tour).

- Menú del cliente: IBM Plex Sans y Bricolage Grotesque, azul Umi, superficies cálidas y categorías de colores suaves.
- Catálogo con fotografías y tarjetas completas. Escritorio muestra el pedido al lado; móvil usa una acción fija inferior.
- Producto con opciones, extras, indicaciones y cantidad. Carrito, confirmación y seguimiento conservan el mismo lenguaje visual.
- Visor con orden y botones consistentes entre POS, Dashboard y Menú digital.
- Recorrido por escenas, con pausa, repetición y avance. El usuario eligió esta modalidad de revisión.
- Las escenas del personal reutilizan los componentes del redesign. No deben reproducir el POS o Dashboard antiguos.

El proyecto del POS tiene otras propuestas visuales y una selección posterior denominada “Rediseño 2”. No cambia la referencia v6 del menú del cliente.

El Dashboard conserva su identidad propia, con Inter Tight y Source Sans 3. No debe recibir automáticamente las fuentes del menú.

Bruma, Centro, mesa 12, Ana, pedido #1042, precios y horarios son datos ficticios. Las fotografías tampoco representan el catálogo de un negocio real.

## Fuera de la primera versión

- Pago en línea y entrega a domicilio.
- Registro obligatorio del cliente y verificación por SMS.
- Alta automática de números WhatsApp para cada negocio.
- Decidir un número compartido o un número por negocio para WhatsApp.
- Campañas promocionales.
- Rediseñar de nuevo el menú aprobado.
- Convertir toda la maqueta del POS/Dashboard en producto como parte del menú digital.

El prototipo contiene funciones de otros proyectos para dar contexto. Su presencia no amplía el alcance del menú.
