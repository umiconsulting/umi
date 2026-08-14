# Comienza aquí

[Índice](README.md) | [Glosario](../product/UMIPOS_GLOSSARY.md) | [Alcance](ALCANCE_V1.md)

## Qué es UMI

UMI es la plataforma central. Gestiona identidad, autoridad, datos del negocio, comandos, auditoría y recuperación.

## Qué es UMI POS

UMI POS es la solución de venta y operación para comercios. Usa la autoridad central de UMI.

UMI POS resuelve estas tareas:

- Configura comercios, ubicaciones, personal, dispositivos y cajas.
- Vende productos con precios, variantes y modificadores.
- Registra pagos dentro del alcance certificado.
- Mantiene hechos de ventas, inventario, recibos y reembolsos.
- Coordina cocina mediante KDS.
- Facilita auditoría, diagnóstico y recuperación.

## Quién usa el producto

- El `Owner` controla el negocio y su configuración.
- El `Manager` opera las ubicaciones que tiene asignadas.
- El `Supervisor` aprueba acciones según su permiso.
- El `Cashier` opera el POS y la caja.
- El `Staff` conserva compatibilidad con el perfil operativo definido.
- El `Viewer` consulta información sin modificarla.
- El contexto KDS administra trabajo de cocina. No crea autoridad financiera.

## Componentes principales

| Componente  | Responsabilidad                                          |
| ----------- | -------------------------------------------------------- |
| UMI API     | Autoriza y ejecuta comandos del negocio                  |
| PostgreSQL  | Conserva los hechos autoritativos                        |
| Redis       | Mantiene coordinación temporal, sesiones y colas         |
| Worker      | Procesa trabajo asíncrono con reintentos limitados       |
| Flutter POS | Ejecuta la operación de venta en un dispositivo inscrito |
| Dashboard   | Administra y consulta el negocio                         |
| KDS         | Presenta y actualiza el trabajo de cocina permitido      |

## Conceptos iniciales

Un tenant delimita datos aislados. En UMI POS, el contexto visible es el comercio y sus ubicaciones.

Una ubicación identifica el lugar operativo. Una membresía une a una persona con un rol y un alcance.

Un dispositivo es una identidad inscrita. Una caja es configuración operativa. Un turno registra custodia de efectivo.

## Alcance actual

v1 incluye API, Dashboard, POS Linux, KDS software, ventas, inventario y valor del cliente. También incluye recuperación y soporte.

v1 excluye pagos integrados, object storage, costos avanzados y artefactos Android, Windows o macOS.

Gate 13 verificará hardware, iOS, red real, sitio real y proveedores habilitados. Esta ausencia no invalida el software.

## Regla esencial

Nunca repitas una venta incierta sin consultar antes el estado autoritativo del comando.

## Orden recomendado

1. Lee [Producto y negocio](PRODUCTO_Y_NEGOCIO.md).
2. Lee [Arquitectura](ARQUITECTURA.md).
3. Lee [Seguridad, identidad y permisos](SEGURIDAD_IDENTIDAD_Y_PERMISOS.md).
4. Selecciona la guía de tu superficie operativa.
5. Usa [Solución de problemas](SOLUCION_DE_PROBLEMAS.md) durante un incidente.
