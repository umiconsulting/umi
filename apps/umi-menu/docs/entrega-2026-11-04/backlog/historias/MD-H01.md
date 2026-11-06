# [MD-H01] Persistir la configuración del menú por negocio y sucursal

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **responsable del negocio**, quiero **guardar y consultar si el menú está publicado y recibe pedidos** para **controlar cada sucursal sin afectar otras**.

**Fase:** A · **Entregas del plan:** P01.
**Reglas de origen:** D01, D07, D18, D19.
**Áreas de referencia:** configuracion, contratos, permisos. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-A01.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Interfaz del Dashboard, nuevos pedidos y programación.

## Criterios de aceptación

- [ ] **MD-H01-CA01:** Una sucursal nueva obtiene los valores aprobados en MD-A01; la recepción incompleta permanece desactivada.
- [ ] **MD-H01-CA02:** Publicación, recepción y modalidades son valores independientes y sobreviven al reinicio de la API.
- [ ] **MD-H01-CA03:** Un actor sin permiso o de otro negocio no puede leer ajustes administrativos ni modificarlos.
- [ ] **MD-H01-CA04:** La pausa de recepción no borra ni cambia pedidos existentes y no modifica el canal WhatsApp.
- [ ] **MD-H01-CA05:** La lectura devuelve el alcance efectivo según la precedencia aprobada y conserva compatibilidad con clientes actuales.

## Tareas

### MD-H01-T01 · Definir el contrato de configuración

- [ ] Contrastar ajustes actuales y fijar la lectura/escritura de publicación, recepción y modalidades con alcance de negocio/sucursal.

**Termina cuando:** Contrato revisado con valores iniciales y matriz de permisos de MD-A01.

### MD-H01-T02 · Persistir ajustes aislados del canal WhatsApp

- [ ] Implementar almacenamiento y migración aditiva si hace falta, con validación del alcance y del esquema existente.

**Termina cuando:** Lectura tras reinicio conserva los valores; columnas whatsapp_* no se usan como configuración genérica.

### MD-H01-T03 · Aplicar permisos y precedencia

- [ ] Conectar los guardas de acceso y resolver el valor efectivo sin permitir IDs de sucursal ajenos.

**Termina cuando:** Casos autorizado, sin permiso y negocio ajeno tienen resultados explícitos.

### MD-H01-T04 · Proteger pedidos y compatibilidad al pausar

- [ ] Hacer que la escritura de recepción solo cambie admisión futura y documentar la desactivación del canal.

**Termina cuando:** Un pedido sintético existente conserva estado, total e identificador después de la pausa.

### MD-H01-T05 · Probar persistencia y aislamiento

- [ ] Añadir pruebas con dos negocios y dos sucursales del primero; ejecutar contratos, API y PostgreSQL pertinente.

**Termina cuando:** Guardar/leer, reinicio, herencia aprobada, permisos y pausa pasan con evidencia; migración probada sobre esquema nuevo y existente.

## Validación en staging

Crear dos negocios sintéticos; alternar publicación y recepción de una sucursal, reiniciar API y comprobar aislamiento y pedidos previos.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

