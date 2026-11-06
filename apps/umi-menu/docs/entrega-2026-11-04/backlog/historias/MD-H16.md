# [MD-H16] Enviar el carrito de una mesa y avisar al personal

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente en mesa**, quiero **confirmar mi pedido desde el QR** para **recibirlo en mi mesa y que el personal lo vea**.

**Fase:** C · **Entregas del plan:** P11.
**Reglas de origen:** D01, D04, D08, D12, D18, D19.
**Áreas de referencia:** frontend_menu, table_order, pos, kds. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H03, MD-H15, MD-H28, MD-A02, MD-A03, MD-A12.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Contacto obligatorio, recogida y pagos desde el menú.

## Criterios de aceptación

- [ ] **MD-H16-CA01:** Un QR válido fija negocio, sucursal y mesa; el cliente no puede elegir una mesa ajena en el envío.
- [ ] **MD-H16-CA02:** No se exigen nombre, teléfono ni correo para pedir desde mesa.
- [ ] **MD-H16-CA03:** Confirmar valida el carrito, registra una sola orden y la envía a estaciones sin aceptación previa.
- [ ] **MD-H16-CA04:** El personal recibe aviso y ve origen digital junto a la modalidad de mesa, sin cambiar la insignia permanente del KDS.
- [ ] **MD-H16-CA05:** Precio cambiado, mesa no operable, pausa y timeout tienen resultados recuperables y visibles.

## Tareas

### MD-H16-T01 · Resolver credencial y contexto de mesa

- [ ] Conectar el QR y mostrar la mesa validada por API; manejar credencial inválida o mesa no operable.

**Termina cuando:** No se confía en IDs editables del navegador.

### MD-H16-T02 · Conectar confirmación sin contacto

- [ ] Enviar selección canónica con idempotencia y mostrar el total validado.

**Termina cuando:** No se añade formulario obligatorio de recogida.

### MD-H16-T03 · Conservar preparación directa y aviso

- [ ] Usar la proyección existente y el mecanismo de aviso al personal para esa sucursal.

**Termina cuando:** Una orden genera sus estaciones y el aviso correspondiente.

### MD-H16-T04 · Mostrar resultado y recuperación

- [ ] Distinguir recibido/en preparación de error; conservar acceso al resultado tras timeout.

**Termina cuando:** Reintento recupera la misma orden sin una segunda comanda.

### MD-H16-T05 · Probar QR a estaciones y POS

- [ ] Cubrir variantes, mesa ajena, precio cambiado, pausa y reintento desde navegador real.

**Termina cuando:** Un QR produce pedido correcto, aviso al personal y preparación directa.

## Validación en staging

Escanear el QR de mesa de prueba, pedir alimento+bebida y comprobar aviso en POS y productos en sus estaciones, sin pantalla de aceptación.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

