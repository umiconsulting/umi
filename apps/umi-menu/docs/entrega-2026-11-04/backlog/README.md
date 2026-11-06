# Backlog del menú digital para GitHub

**33 historias**, **13 decisiones** y **205 tareas**. Repositorio: https://github.com/umiconsulting/umi.

Estado: propuesta local revisable. Los IDs MD-Hxx/MD-Axx son referencias locales estables; consulta github_issue en backlog.json para las publicaciones registradas. Esta entrega inicial no publica issues, etiquetas ni asignaciones.

## Cómo usarlo

1. Lee la [guía de GitHub](../docs/10-historias-y-tareas-github.md) para reglas de publicación y cierre.
2. Revisa las decisiones pendientes de las historias que quieres iniciar.
3. Usa cada archivo de `historias/` como cuerpo de un issue; sus tareas quedan como checklist.
4. Al publicar, sustituye las dependencias locales por los enlaces reales de GitHub y conserva ambos identificadores.
5. Implementa con PRs atómicos a staging, prueba allí y promueve a main después de validar.

## Historias

| ID | Historia | Plan | Dependencias de código | Decisiones pendientes |
| --- | --- | --- | --- | --- |
| [MD-H01](historias/MD-H01.md) | Persistir la configuración del menú por negocio y sucursal | P01 | Ninguna | MD-A01 |
| [MD-H02](historias/MD-H02.md) | Definir productos y modalidades visibles en el menú | P02 | MD-H01 | Ninguna directa |
| [MD-H03](historias/MD-H03.md) | Pedir variantes válidas desde el QR de mesa | P03 | Ninguna | Ninguna directa |
| [MD-H04](historias/MD-H04.md) | Consultar el catálogo público de una sucursal | P04 | MD-H01, MD-H02, MD-H03 | MD-A10 |
| [MD-H05](historias/MD-H05.md) | Publicar y pausar el menú desde Dashboard | P05 | MD-H01, MD-H04 | Ninguna directa |
| [MD-H06](historias/MD-H06.md) | Organizar productos y categorías del menú desde Dashboard | P05 | MD-H02, MD-H04, MD-H05 | Ninguna directa |
| [MD-H07](historias/MD-H07.md) | Registrar una recogida pendiente sin enviarla a cocina | P06 | MD-H01, MD-H02, MD-H03 | MD-A02, MD-A03, MD-A12, MD-A13 |
| [MD-H08](historias/MD-H08.md) | Aceptar, rechazar o vencer una recogida desde el backend | P06 | MD-H07 | MD-A02, MD-A03, MD-A13 |
| [MD-H09](historias/MD-H09.md) | Configurar el plazo de aceptación en Dashboard | P06D | MD-H05, MD-H08 | MD-A13 |
| [MD-H10](historias/MD-H10.md) | Consultar un pedido mediante su enlace privado | P07 | MD-H07, MD-H08 | MD-A12 |
| [MD-H11](historias/MD-H11.md) | Cancelar directamente una recogida pendiente | P08 | MD-H08, MD-H10 | MD-A02, MD-A04 |
| [MD-H12](historias/MD-H12.md) | Solicitar y resolver cancelación de un pedido aceptado | P08 | MD-H08, MD-H10, MD-H11 | MD-A02, MD-A04 |
| [MD-H13](historias/MD-H13.md) | Atender pendientes y cancelaciones desde UmiPOS | P09 | MD-H08, MD-H12 | Ninguna directa |
| [MD-H14](historias/MD-H14.md) | Cobrar y entregar el pedido existente desde UmiPOS | P09 | MD-H13, MD-H29 | MD-A02, MD-A03 |
| [MD-H15](historias/MD-H15.md) | Consultar y armar el carrito con el diseño final | P10 | MD-H04, MD-H06 | MD-A10 |
| [MD-H16](historias/MD-H16.md) | Enviar el carrito de una mesa y avisar al personal | P11 | MD-H03, MD-H15, MD-H28 | MD-A02, MD-A03, MD-A12 |
| [MD-H17](historias/MD-H17.md) | Enviar y seguir una recogida inmediata desde el menú | P12 | MD-H09, MD-H10, MD-H11, MD-H12, MD-H13, MD-H15, MD-H28 | Ninguna directa |
| [MD-H18](historias/MD-H18.md) | Enviar avisos del pedido por correo con reintentos | P13 | MD-H08, MD-H10, MD-H11, MD-H12, MD-H29 | MD-A09, MD-A12 |
| [MD-H19](historias/MD-H19.md) | Validar remitente y entrega del correo del piloto | P13 | MD-H18 | MD-A09, MD-A11 |
| [MD-H20](historias/MD-H20.md) | Calcular horarios compatibles para el carrito | P14 | MD-H02, MD-H04 | MD-A05, MD-A06, MD-A07 |
| [MD-H21](historias/MD-H21.md) | Registrar y aceptar una recogida programada sin prepararla antes | P14 | MD-H07, MD-H08, MD-H18, MD-H20 | MD-A02, MD-A03, MD-A06, MD-A13 |
| [MD-H22](historias/MD-H22.md) | Liberar un programado a preparación a la hora correcta | P14 | MD-H21 | MD-A05, MD-A07 |
| [MD-H23](historias/MD-H23.md) | Cancelar un programado aceptado dentro de su límite | P08, P14 | MD-H11, MD-H12, MD-H21, MD-H22 | MD-A02, MD-A04, MD-A07 |
| [MD-H24](historias/MD-H24.md) | Configurar programación por sucursal y producto | P15 | MD-H05, MD-H06, MD-H20, MD-H21 | MD-A05, MD-A06, MD-A07 |
| [MD-H25](historias/MD-H25.md) | Atender reservas programadas desde UmiPOS | P16 | MD-H13, MD-H21, MD-H22, MD-H23 | Ninguna directa |
| [MD-H26](historias/MD-H26.md) | Elegir una fecha de recogida y seguir el pedido programado | P17 | MD-H17, MD-H20, MD-H21, MD-H22, MD-H23, MD-H24, MD-H25 | Ninguna directa |
| [MD-H27](historias/MD-H27.md) | Obtener enlaces y QR desde Dashboard | P18 | MD-H05, MD-H16 | MD-A10, MD-A12 |
| [MD-H28](historias/MD-H28.md) | Controlar admisión cuando no hay atención disponible | P06, P11, P12 | MD-H01, MD-H07 | MD-A08 |
| [MD-H29](historias/MD-H29.md) | Marcar listo solo cuando terminan todas las estaciones | P06, P09, P13 | MD-H08 | Ninguna directa |
| [MD-H30](historias/MD-H30.md) | Publicar una versión del menú para validación en staging | P19 | MD-H15, MD-H16, MD-H17 | MD-A10 |
| [MD-H31](historias/MD-H31.md) | Certificar los flujos completos en staging | P19 | MD-H14, MD-H16, MD-H17, MD-H18, MD-H19, MD-H23, MD-H24, MD-H25, MD-H26, MD-H27, MD-H28, MD-H29, MD-H30, MD-H33 | MD-A11 |
| [MD-H32](historias/MD-H32.md) | Promover lo validado a main y activar el piloto controlado | P19 | MD-H31 | MD-A09, MD-A10, MD-A11 |
| [MD-H33](historias/MD-H33.md) | Distinguir pedidos digitales en historial y reportes | P09, P19 | MD-H14, MD-H16 | MD-A03 |

## Orden de implementación por dependencias

Las filas muestran capas del grafo, no sprints, fechas o asignaciones paralelas. Cerrar antes las decisiones de cada historia. La numeración del ID no determina el orden.

| Capa | Historias cuyos predecesores están en capas anteriores |
| --- | --- |
| 1 | [MD-H01](historias/MD-H01.md), [MD-H03](historias/MD-H03.md) |
| 2 | [MD-H02](historias/MD-H02.md) |
| 3 | [MD-H04](historias/MD-H04.md), [MD-H07](historias/MD-H07.md) |
| 4 | [MD-H05](historias/MD-H05.md), [MD-H08](historias/MD-H08.md), [MD-H20](historias/MD-H20.md), [MD-H28](historias/MD-H28.md) |
| 5 | [MD-H06](historias/MD-H06.md), [MD-H09](historias/MD-H09.md), [MD-H10](historias/MD-H10.md), [MD-H29](historias/MD-H29.md) |
| 6 | [MD-H11](historias/MD-H11.md), [MD-H15](historias/MD-H15.md) |
| 7 | [MD-H12](historias/MD-H12.md), [MD-H16](historias/MD-H16.md) |
| 8 | [MD-H13](historias/MD-H13.md), [MD-H18](historias/MD-H18.md), [MD-H27](historias/MD-H27.md) |
| 9 | [MD-H14](historias/MD-H14.md), [MD-H17](historias/MD-H17.md), [MD-H19](historias/MD-H19.md), [MD-H21](historias/MD-H21.md) |
| 10 | [MD-H22](historias/MD-H22.md), [MD-H24](historias/MD-H24.md), [MD-H30](historias/MD-H30.md), [MD-H33](historias/MD-H33.md) |
| 11 | [MD-H23](historias/MD-H23.md) |
| 12 | [MD-H25](historias/MD-H25.md) |
| 13 | [MD-H26](historias/MD-H26.md) |
| 14 | [MD-H31](historias/MD-H31.md) |
| 15 | [MD-H32](historias/MD-H32.md) |

La primera entrega recomendada sigue siendo MD-H01, después de resolver MD-A01. MD-H03 no depende funcionalmente de ella y puede prepararse por separado.

## Decisiones pendientes

| ID | Decisión | Historias directamente afectadas |
| --- | --- | --- |
| [MD-A01](decisiones/MD-A01.md) | Alcance, precedencia y permisos de configuración | MD-H01 |
| [MD-A02](decisiones/MD-A02.md) | Inventario y efectos de cierre del pedido | MD-H07, MD-H08, MD-H11, MD-H12, MD-H14, MD-H16, MD-H21, MD-H23 |
| [MD-A03](decisiones/MD-A03.md) | Correspondencia entre pedido, preparación, cuenta y cobro | MD-H07, MD-H08, MD-H14, MD-H16, MD-H21, MD-H33 |
| [MD-A04](decisiones/MD-A04.md) | Permisos y día operativo al cancelar | MD-H11, MD-H12, MD-H23 |
| [MD-A05](decisiones/MD-A05.md) | Duración de preparación para cantidades y carritos mixtos | MD-H20, MD-H22, MD-H24 |
| [MD-A06](decisiones/MD-A06.md) | Programados fuera de horario | MD-H20, MD-H21, MD-H24 |
| [MD-A07](decisiones/MD-A07.md) | Límites de programación, capacidad y cambios de reglas | MD-H20, MD-H22, MD-H23, MD-H24 |
| [MD-A08](decisiones/MD-A08.md) | Señal de atención disponible y pausa | MD-H28 |
| [MD-A09](decisiones/MD-A09.md) | Remitente, respuestas y fallos de correo | MD-H18, MD-H19, MD-H32 |
| [MD-A10](decisiones/MD-A10.md) | Ubicación, dominio y rutas del frontend | MD-H04, MD-H15, MD-H27, MD-H30, MD-H32 |
| [MD-A11](decisiones/MD-A11.md) | Negocio y sucursal del piloto | MD-H19, MD-H31, MD-H32 |
| [MD-A12](decisiones/MD-A12.md) | Protección de acceso público y datos de contacto | MD-H07, MD-H10, MD-H16, MD-H18, MD-H27 |
| [MD-A13](decisiones/MD-A13.md) | Plazo de aceptación y cambios con pendientes | MD-H07, MD-H08, MD-H09, MD-H21 |

## Archivos de trabajo

- [Datos completos del backlog](backlog.json): fuente editable de historias, criterios y tareas.
- [Tabla de historias y decisiones](historias.csv).
- [Tabla completa de tareas](tareas.csv).
- [Correspondencia con entregas del plan](mapa-entregas.md).

Los CSV son tablas para revisión o adaptación a una herramienta. No se presentan como un formato de importación automática soportado por GitHub.

Para regenerar los documentos después de editar backlog.json, ejecuta `python3 scripts/generar-backlog.py` desde la raíz del paquete. Esto no modifica GitHub.
