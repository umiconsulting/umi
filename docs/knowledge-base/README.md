# Base de Conocimiento de UMI POS

Estado: canónica para `UMI POS Pilot RC2`, versión `6.0.0-pilot.rc2`.

Esta base explica el producto, la operación y el soporte. Empieza en [Comienza aquí](START_HERE.md).

## Ruta de aprendizaje

1. [Comienza aquí](START_HERE.md)
2. [Producto y negocio](PRODUCTO_Y_NEGOCIO.md)
3. [Arquitectura](ARQUITECTURA.md)
4. [Seguridad, identidad y permisos](SEGURIDAD_IDENTIDAD_Y_PERMISOS.md)
5. [Comercios, usuarios, dispositivos y cajas](COMERCIOS_USUARIOS_DISPOSITIVOS.md)
6. [POS Flutter](POS_FLUTTER.md)
7. [Dashboard](DASHBOARD.md)
8. [KDS](KDS.md)

## Operación del negocio

- [Catálogo e inventario](CATALOGO_E_INVENTARIO.md)
- [Ventas, recibos y reembolsos](VENTAS_RECIBOS_Y_REEMBOLSOS.md)
- [Turnos, clientes y valor](TURNOS_CLIENTES_Y_VALOR.md)
- [Trabajadores y observabilidad](TRABAJADORES_Y_OBSERVABILIDAD.md)

## Operación técnica

- [Despliegue, respaldo y recuperación](DESPLIEGUE_RESPALDO_Y_RECUPERACION.md)
- [Solución de problemas](SOLUCION_DE_PROBLEMAS.md)
- [Incidentes, soporte y diagnóstico](INCIDENTES_SOPORTE_Y_DIAGNOSTICO.md)
- [Desarrollo, mapa de código, datos y API](DESARROLLO_CODIGO_DATOS_Y_API.md)
- [Gestión de versiones](GESTION_DE_VERSIONES.md)

## Alcance y comunicación

- [Alcance de v1](ALCANCE_V1.md)
- [Cómo explicar UMI POS](COMO_EXPLICAR_UMIPOS.md)
- [Historias de punta a punta](HISTORIAS_DE_PUNTA_A_PUNTA.md)
- [Preguntas frecuentes](FAQ.md)
- [Glosario](../product/UMIPOS_GLOSSARY.md)
- [Validación física diferida](../certification/UMIPOS_DEFERRED_HARDWARE_VALIDATION.md)

## Handoff

- [Guía de diagnóstico para el Owner](GUIA_DE_DIAGNOSTICO_DEL_OWNER.md)
- [Lista de transferencia](OWNER_HANDOFF_CHECKLIST.md)
- [Manifiesto](MANIFEST.md)

## Regla de autoridad

PostgreSQL y UMI API conservan la verdad del negocio. Las aplicaciones muestran datos y envían comandos autorizados.

No uses una pantalla, Redis, KDS ni un dispositivo como fuente final de dinero, inventario o autoridad.
