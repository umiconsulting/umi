# [MD-H27] Obtener enlaces y QR desde Dashboard

**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.
**Estado local:** Propuesta para revisión.
No tiene número de issue asignado.

## Historia

Como **administrador del negocio**, quiero **obtener el enlace público y los QR correctos** para **compartir el menú y colocarlo en las mesas**.

**Fase:** E · **Entregas del plan:** P18.
**Reglas de origen:** D01, D07, D18, D19.
**Áreas de referencia:** dashboard, table_order, configuracion. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).

## Dependencias

Para implementar: MD-H05, MD-H16, MD-A10, MD-A12.
Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.

## Alcance excluido

Inventar un plano nuevo o permitir edición del ID de mesa por el cliente.

## Criterios de aceptación

- [ ] **MD-H27-CA01:** Dashboard muestra enlace y QR general de la sucursal y QR de sus mesas existentes.
- [ ] **MD-H27-CA02:** Cada QR resuelve el alcance correcto; no crea mesas paralelas ni credenciales sin control.
- [ ] **MD-H27-CA03:** Copiar/descargar y abrir la vista previa conservan rutas estables del entorno.
- [ ] **MD-H27-CA04:** La regeneración o revocación sigue la política aprobada y advierte su efecto sobre QR impresos.
- [ ] **MD-H27-CA05:** Un usuario sin permiso no obtiene controles administrativos de otra sucursal.

## Tareas

### MD-H27-T01 · Reutilizar identidad y credenciales de mesa

- [ ] Conectar el inventario real de mesas con sus mecanismos actuales de token.

**Termina cuando:** Sin nueva autoridad de mesas o secretos públicos de administración.

### MD-H27-T02 · Construir enlaces por entorno

- [ ] Aplicar dominio/ruta de MD-A10 y distinguir general de mesa.

**Termina cuando:** Un QR de staging no apunta accidentalmente a main/producción.

### MD-H27-T03 · Añadir copiar, descargar y vista previa

- [ ] Presentar enlaces y QR en Dashboard con negocio/sucursal visibles.

**Termina cuando:** Se puede obtener y verificar el QR sin herramientas externas.

### MD-H27-T04 · Aplicar revocación/regeneración aprobada

- [ ] Usar MD-A12 y documentar impacto sobre impresos y enlaces previos.

**Termina cuando:** La operación es explícita y respeta permisos.

### MD-H27-T05 · Verificar con lectura real de QR

- [ ] Abrir QR general y de dos mesas desde dispositivo de prueba.

**Termina cuando:** Cada uno carga sucursal/mesa correctas; los revocados se rechazan según política.

## Validación en staging

Descargar e inspeccionar QR general y dos mesas; escanearlos y comprobar negocio/sucursal/mesa y entorno.

Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.

## Entrega y cierre

- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.
- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.
- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.
- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.
- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.
- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.

