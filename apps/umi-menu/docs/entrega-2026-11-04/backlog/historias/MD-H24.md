# [MD-H24] Configurar programación por sucursal y producto

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **administrador del negocio**, quiero **definir qué productos y fechas se pueden programar** para **adaptar el canal a la operación de cada sucursal**.

**Fase:** D · **Entregas del plan:** P15.
**Reglas de origen:** D05, D06, D07, D18, D19.
**Áreas de referencia:** dashboard, horarios, catalogo. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H05, MD-H06, MD-H20, MD-H21, MD-A05, MD-A06, MD-A07.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Programación de productos sin reglas y cambios automáticos de reservas.

## Criterios de aceptación

- [ ] **MD-H24-CA01:** La sucursal puede configurar programación y los productos sus límites aprobados.
- [ ] **MD-H24-CA02:** Los campos distinguen anticipación mínima, preparación, horizonte y cancelación.
- [ ] **MD-H24-CA03:** La UI impide combinaciones inválidas y muestra el alcance efectivo sin copiar ajustes a otros negocios.
- [ ] **MD-H24-CA04:** Cambiar reglas no altera silenciosamente reservas existentes; se aplica la política aprobada.
- [ ] **MD-H24-CA05:** La vista previa de horarios refleja el mismo cálculo que usa el servidor.

## Tareas

### MD-H24-T01 · Conectar ajustes de sucursal

- [ ] Añadir calendario y programación a Menú digital, enlazando al horario canónico.

**Termina cuando:** Sin segundo calendario contradictorio.

### MD-H24-T02 · Conectar elegibilidad y reglas por producto

- [ ] Extender la edición existente para programable, fechas posteriores, anticipación/horizonte/corte.

**Termina cuando:** Producto conserva su identidad y alcance.

### MD-H24-T03 · Validar combinaciones y mensajes

- [ ] Mostrar unidades, zona horaria y explicación de errores que devuelve la API.

**Termina cuando:** No se confunden preparación y anticipación para pedir.

### MD-H24-T04 · Conservar reservas vigentes

- [ ] Presentar y aplicar el efecto aprobado de cambios de reglas sobre reservas.

**Termina cuando:** No cambia silenciosamente la hora prometida de un pedido.

### MD-H24-T05 · Verificar edición y horarios en navegador

- [ ] Guardar reglas de dos productos y consultar un carrito mixto y un cierre excepcional.

**Termina cuando:** Configuración, API y vista previa ofrecen las mismas horas.

## Validación en staging

Habilitar programación solo para panadería, cambiar horizonte y probar un carrito mixto; comprobar que otra sucursal conserva su configuración. Crear y aceptar una reserva antes de editar las reglas; comprobar hora de recogida, liberación y límite de cancelación persistidos según MD-A07, sin cambios silenciosos.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

