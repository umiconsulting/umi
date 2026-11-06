# Research y evidencia

Este documento distingue hechos observados, decisiones del usuario e inferencias para Umi. Una observación fechada no acredita el estado actual de producción.

## Fuentes y jerarquía

| Fuente | Fecha | Uso y límite |
| --- | --- | --- |
| Conversación del proyecto | Hasta 4 de noviembre | Decisiones de alcance y entrega, consolidadas en este paquete. No se incluye una transcripción completa. |
| [Plan con auditoría VPS](../referencias/historicas/plan-original-con-auditoria-vps-2026-11-01.md) | 1 de noviembre | Código desplegado y metadatos observados en lectura. Tiene propuestas visuales y P00 ya superados. |
| [Plan local actualizado](../referencias/historicas/plan-local-actualizado-2026-11-02.md) | 2 de noviembre | Reúne acuerdos y actualización de preparación para PRs. Sus primeras secciones conservan algunos límites históricos. |
| [Rehearsal del menú](../referencias/historicas/rehearsal-menu-2026-11-02.md) | 2 de noviembre | Desarrollo del prototipo, pruebas y límites de filmación. |
| [Capturas e informe visual](../evidencia/visual-2026-11-03/) | 3 de noviembre | Menú publicado en escritorio y móvil; escenas de configuración, aceptación, KDS y seguimiento. |
| Revisión de código local | 4 de noviembre | Contraste de las rutas del plan con HEAD y la referencia local origin/staging. No incluyó fetch o VPS. |

Cuando las fuentes discrepan, usa las decisiones actuales de esta entrega y consulta el código vigente para los hechos técnicos.

## Auditoría del VPS del 1 de noviembre

**Hechos documentados en la auditoría histórica:**

- Checkout, contenedor e imagen de producción declaraban `75680bb252fbe3079b98338a5ca737cca19f04e7`.
- El checkout denominado staging declaraba rama local `build-v3` y commit `a4246f69a87c964d4c78eb9e47571af7464b5127`.
- El runtime público de mesa conservaba `VARIANT_NOT_AVAILABLE`.
- El escritor comercial registraba `placed` y llamaba al proyector KDS sin condición de aceptación.
- `merchant.customer_order` tenía origen, modalidad, estado, versión y contexto del origen.
- Los estados observados eran `placed`, `preparing`, `ready`, `completed` y `canceled`.
- Los orígenes observados eran `whatsapp`, `pos`, `web` y `dashboard`.
- Existía `runtime.outbox_event`.
- Había SMTP Brevo configurado. No se probó entrega de correo.

Las consultas de la auditoría fueron de solo lectura. Este paquete contiene el informe, no credenciales ni una copia de la base.

**Inferencia para Umi:** la aceptación y programación necesitan controlar la proyección desde el backend. Una etiqueta nueva del POS no impide que cocina reciba el pedido.

**Pendiente:** elegir la correspondencia de los estados funcionales con el esquema y contratos vigentes. No crear columnas solo porque una consulta histórica no las mostró.

## Contraste local del 4 de noviembre

Herramientas: Git 2.50.1 y ripgrep 15.2.0. La revisión usó fuentes locales del repositorio.

| Referencia | Revisión |
| --- | --- |
| HEAD local | `dea2dfc718e4c10772a1a950c796e82a08fa5e55` |
| origin/staging local | `91aad9489ad440759e92342e6401c86092bf0e2e` |

Las diez rutas principales del plan existen. Los nueve archivos de aplicación revisados coinciden entre ambas revisiones. `packages/contract` sí difiere.

El código local conserva el rechazo de variantes, la llamada al proyector y la adopción del pedido entrante en el carrito. Véase [el mapa técnico](04-arquitectura-e-integracion.md).

No se ejecutaron pruebas de la aplicación real. No se consultó GitHub para conocer nuevos PRs. Estas referencias locales pueden estar atrasadas respecto al servidor.

## Cancelaciones: investigación de plataformas

Los resultados siguientes proceden de la investigación previa de esta conversación. No se reconsultaron las políticas el 4 de noviembre.

| Plataforma | Hallazgo previo | Límite |
| --- | --- | --- |
| Rappi, recoger en tienda | Su política distingue cancelación antes y después de confirmar la tienda. Antes de confirmar no cobra; después contempla productos y tarifa. | Política global consultada, con México incluido. No copiar su modelo de cobro al menú Umi. |
| DiDi Food, restaurantes México | La guía concede cinco minutos al restaurante para aceptar, antes de cancelar automáticamente. | Es plazo de aceptación del negocio, no una ventana gratuita universal del cliente. |
| DiDi, cancelación del consumidor | No se recuperó una política suficiente para fijar plazo y cobro exactos. | No completar el vacío con reglas de otros países. |
| Uber Eats | Se mencionó como referencia durante la conversación. | Esta entrega no conserva evidencia suficiente para afirmar su política exacta. |

Fuentes primarias conservadas como referencias:

- [Rappi: política de cancelaciones](https://legal.rappi.com.co/global/politica-de-cancelaciones-de-rappi/).
- [DiDi: cómo funciona una orden](https://web.didiglobal.com/mx/food/restaurantes/guias/como-funciona-una-orden/).
- [DiDi: cancelaciones y ganancias](https://web.didiglobal.com/mx/food/restaurantes/preguntas-frecuentes/las-cancelaciones-afectan-mis-ganancias/).
- [DiDi: índice legal](https://web.didiglobal.com/mx/legal/). La página dinámica del consumidor no fue recuperable en aquella revisión.

**Inferencia para Umi:** separar cancelación del cliente, rechazo del negocio y vencimiento por falta de aceptación. Combinar estado y hora límite para programados.

**Decisión del usuario:** pago en negocio. Las penalizaciones comerciales de plataformas de reparto no se trasladan a Umi.

## Cancelaciones en el producto existente

El [ADR del 12 de octubre](../referencias/umi/docs/architecture/2026-10-12-cancelar-despues-de-empezar-adr.md) documenta la anulación de líneas ya preparadas.

Su regla final identifica el permiso `order.void_after_preparation.approve`, concedido a `admin` en el piloto. La autorización se liga a la operación y versión de cuenta.

El ADR también describe el día operativo, la anulación comercial y el registro de preparación iniciada. No demuestra por sí solo que el nuevo flujo de pedidos digitales esté integrado.

**Consecuencia:** “aceptación del personal” no autoriza a cualquier empleado a cancelar cualquier pedido preparado. Las tareas deberán reconciliar el nuevo flujo con esos permisos.

La [investigación de KDS](../referencias/umi/docs/research/2026-10-13-kds-cierre-cuentas-comandas/README.md) aporta fuentes y límites sobre cierre, cuentas y comandas.

## Correo, SMS, WhatsApp y ConversaFlow

**Decisión vigente:** correo y seguimiento web. Capturar nombre, teléfono y correo para recogida, sin OTP. WhatsApp no bloquea la primera versión.

**Hecho del código:** `email.adapter.ts` usa SMTP/Nodemailer y admite remitente y respuesta configurables. Un `messageId` no acredita entrega real.

**Antecedente histórico:** Brevo estaba configurado en el VPS el 1 de noviembre. Faltan remitente operativo, rebotes, respuestas y prueba con destinatarios autorizados.

**ConversaFlow:** existe [research local del 20 de octubre](../referencias/umi/docs/research/2026-10-20-conversaflow-architecture-and-costs.md), con código y fuentes. Distingue cola, aceptación de Twilio y entrega. El adaptador actual de texto no demuestra por sí solo un flujo completo de plantillas o alta de remitentes.

Se debatió usar Twilio y números por negocio. No se aprobó la arquitectura de alta ni un número compartido. Comprar un número y habilitarlo como remitente WhatsApp son pasos que requieren revisar por separado. Las exigencias actuales de Twilio/Meta deberán verificarse si se retoma ese canal.

El [research de precios](../referencias/umi/docs/research/2026-10-20-conversaflow-pricing-sources.md) conserva fuentes oficiales y supuestos. Es histórico y corresponde a ConversaFlow. No es un presupuesto del menú digital ni una cotización vigente.

## Diseño, herramientas y licencias

| Herramienta | Uso observado | Fuente y límite |
| --- | --- | --- |
| Stageshow 0.1.0 | Marcos, escenas y cursor. | Kit local, licencia MIT incluida. Es una simulación. |
| BoardUI | Botones, formularios y controles compartidos. | Componentes instalados en `components/`; registro oficial documentado en NOTICE. |
| Unslop | Corrección de textos, jerarquía, espaciado y coherencia. | Skill de Damir Sokolovsky, CC BY 4.0. Crédito conservado. |
| React 18.3.1 y Vite 6 | Prototipo y compilación. | Manifiestos y lockfiles incluidos. |
| Playwright Core | Navegación y capturas. | No emula dispositivos físicos ni acredita integración. |
| Wrangler 4.156.0 | Publicación previa en Pages. | Dependencia fijada. La entrega no ejecuta despliegues. |

Las fotografías del menú proceden de Unsplash según el README original. Las fuentes incluyen sus licencias OFL. El [inventario](09-inventario-y-procedencia.md) indica sus rutas.

## Evidencia visual y límites de los informes

El 3 de noviembre se compararon el HTML/CSS público del menú y el JavaScript principal con la compilación local. Los tres coincidían byte por byte.

- HTML del menú: `878b78c57f9f92a3e355580d45ab6dd4bf75bacd1103c7a7137e2dea7c37806f`.
- CSS del menú: `d5251601f95dd0357a5f806d3ce983a52845022d5368ea18e7f7e9f3a06068e0`.
- JavaScript principal `index-BGyiuBRa.js`: `14eaa27f1c2a7974458bafc4773d5a17a5513dccd6e03ada0e58dd9bb3a609ea`.

La revisión capturó 16 pantallas, sin errores de página ni recursos HTTP faltantes. Cuatro esperas automáticas del marcador `data-mark="fin"` vencieron en vista fija. Las escenas sí se capturaron y revisaron. Los archivos `tour-*-failure.png` nombran ese fallo de espera, no una certificación de error funcional de la escena.

Los informes anteriores de 70 comprobaciones corresponden al despliegue del 2 de noviembre. No se ejecutaron de nuevo contra la publicación del 3 de noviembre. La filmación también conserva límites de cobertura temporal. No afirmar que se certificó cada fotograma.

Pendientes visuales/funcionales observados: correo ausente en el formulario interactivo y poco contraste en los iconos laterales del POS dentro del recorrido.

## Fuentes de Codex consultadas para esta entrega

Se consultó [la documentación oficial de skills](https://developers.openai.com/codex/skills/) el 4 de noviembre. Se incluye [el texto recuperado](../referencias/externas/codex-skills-2026-11-04.txt).

La búsqueda web del conector devolvió error sin contenido. La recuperación directa por HTTPS con curl funcionó. Esta fuente respalda las rutas `.agents/skills`, la estructura de una skill y su detección por Codex.
