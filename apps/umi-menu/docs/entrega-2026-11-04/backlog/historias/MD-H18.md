# [MD-H18] Enviar avisos del pedido por correo con reintentos

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente que recoge**, quiero **recibir avisos del negocio con mi enlace de seguimiento** para **conocer los cambios sin depender de mantener abierta la página**.

**Fase:** C · **Entregas del plan:** P13.
**Reglas de origen:** D13, D18, D19.
**Áreas de referencia:** correo, jobs, ordenes. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H08, MD-H10, MD-H11, MD-H12, MD-H29, MD-A09, MD-A12.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

WhatsApp, SMS, campañas y garantía de lectura del destinatario.

## Criterios de aceptación

- [ ] **MD-H18-CA01:** Se producen avisos de pendiente, aceptación, listo, rechazo, cancelación y vencimiento por eventos confirmados.
- [ ] **MD-H18-CA02:** Cada aviso identifica al negocio, sucursal y pedido y contiene el enlace privado correcto.
- [ ] **MD-H18-CA03:** Un reintento del evento no crea otro pedido ni envía avisos ilimitados; la política de deduplicación y reintento es explícita.
- [ ] **MD-H18-CA04:** Un fallo SMTP conserva el estado comercial y deja un resultado observable y recuperable.
- [ ] **MD-H18-CA05:** El sistema distingue encolado, aceptado por proveedor, fallo y entrega si existe evidencia de proveedor; no registra lectura sin evidencia.

## Tareas

### MD-H18-T01 · Definir eventos y deduplicación de avisos

- [ ] Revisar rutas outbox existentes y añadir eventos de correo de pedido con clave por transición/destinatario.

**Termina cuando:** Correo nuevo tiene productor y consumidor identificados, sin suponer que ya existen.

### MD-H18-T02 · Crear plantillas transaccionales del negocio

- [ ] Preparar contenido para los seis eventos con sucursal, total/horario cuando aplique y enlace privado.

**Termina cuando:** No incluyen promociones ni contactos de otro negocio.

### MD-H18-T03 · Integrar worker con adaptador SMTP

- [ ] Usar los mecanismos existentes y remitente/respuesta aprobados; persistir resultado sin alterar pedido.

**Termina cuando:** El fallo de correo no revierte aceptación o cancelación.

### MD-H18-T04 · Implementar reintentos y observación

- [ ] Definir límites, espera, deduplicación y manejo de fallo terminal; registrar aceptación sin llamarla entrega.

**Termina cuando:** Eventos repetidos y proveedor caído dejan estados verificables.

### MD-H18-T05 · Probar con receptor de correo local

- [ ] Ejecutar eventos repetidos, destinatario incorrecto, timeout y recuperación con pedido real de prueba.

**Termina cuando:** Plantillas, enlaces y destinatarios correctos; pedido intacto ante fallo.

## Validación en staging

Usar un receptor de pruebas, simular caída y recuperar el envío. Verificar aviso correcto para cada transición sin duplicar el pedido.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

