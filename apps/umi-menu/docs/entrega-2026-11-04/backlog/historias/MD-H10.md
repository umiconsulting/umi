# [MD-H10] Consultar un pedido mediante su enlace privado

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **cliente**, quiero **abrir el seguimiento de mi pedido** para **conocer el estado sin registrarme ni depender del correo**.

**Fase:** B · **Entregas del plan:** P07.
**Reglas de origen:** D11, D12, D13, D18, D19.
**Áreas de referencia:** ordenes, contratos, permisos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H07, MD-H08, MD-A12.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Autenticación de clientes y avisos por correo.

## Criterios de aceptación

- [ ] **MD-H10-CA01:** El enlace permite leer únicamente el pedido correspondiente y los datos necesarios para su seguimiento.
- [ ] **MD-H10-CA02:** No se autoriza por número secuencial, teléfono, correo o cambio de identificador de negocio.
- [ ] **MD-H10-CA03:** El seguimiento distingue pendiente, aceptado, preparación y resultados terminales según el contrato aprobado.
- [ ] **MD-H10-CA04:** Recargar o perder conexión permite recuperar el estado vigente; el fallo de correo no bloquea la consulta.
- [ ] **MD-H10-CA05:** Expiración, límites de acceso y caché siguen MD-A12; no se expone historial de cliente.

## Tareas

### MD-H10-T01 · Emitir credencial de seguimiento limitada

- [ ] Definir credencial, almacenamiento/validación y caducidad conforme MD-A12.

**Termina cuando:** No contiene datos privados innecesarios ni sustituye membresía del negocio.

### MD-H10-T02 · Exponer la proyección pública del pedido

- [ ] Definir DTO con líneas, total, sucursal, modalidad, tiempos y acciones permitidas.

**Termina cuando:** No incluye historial, claves internas ni datos de otros clientes.

### MD-H10-T03 · Resolver recuperación de estado

- [ ] Proveer lectura actualizable usando la infraestructura existente; definir tratamiento de desconexión.

**Termina cuando:** Reconsulta devuelve el estado del pedido original.

### MD-H10-T04 · Aplicar límites y caché privada

- [ ] Evitar enumeración, acceso cruzado y almacenamiento público del resultado.

**Termina cuando:** Credencial errónea o expirada no entrega datos.

### MD-H10-T05 · Probar autorización y continuidad

- [ ] Cubrir reintento, enlace alterado, número público, correo coincidente y fallo de proveedor de avisos.

**Termina cuando:** Solo la credencial válida accede a su pedido.

## Validación en staging

Abrir dos pedidos con sus enlaces; intercambiar IDs/credenciales y comprobar aislamiento. Recargar tras un cambio de estado y tras un fallo de correo.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

