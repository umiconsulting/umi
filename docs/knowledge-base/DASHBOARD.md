# Manual del Dashboard

[Índice](README.md) | [Permisos](SEGURIDAD_IDENTIDAD_Y_PERMISOS.md) | [Diagnóstico](GUIA_DE_DIAGNOSTICO_DEL_OWNER.md)

Dashboard es la superficie administrativa y de consulta. No sustituye al POS para la venta operativa.

## Módulos

| Módulo        | Usuario                            | Datos y acciones                                    | Regla, error común y recuperación                                  |
| ------------- | ---------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| Overview      | Owner y Manager                    | Resumen, estado y accesos rápidos                   | Verifica comercio y ubicación. Un vacío puede indicar un filtro    |
| Settings      | Owner y Admin                      | Región, recibo y política operativa                 | Guarda cambios revisados. Recarga un conflicto obsoleto            |
| Users/Members | Owner y Admin                      | Personas, roles, ubicaciones y estado               | Protege al último Owner. Revisa membresía ante un `403`            |
| Devices       | Owner y Admin                      | Inscripción, confianza, asignación y revocación     | Reinscribe solo con autorización. La revocación no cambia historia |
| Registers     | Owner, Admin y Manager             | Caja, ubicación, dispositivo y estado               | Una caja no es un turno. Revisa asignación si no está disponible   |
| Hardware      | Roles autorizados                  | Estado, prueba, cola y recuperación                 | Consulta el comando antes de repetir una prueba                    |
| Catalog       | Owner, Admin y Manager             | Productos, categorías, opciones y disponibilidad    | Revisa ubicación y archivo cuando falta un producto                |
| Inventory     | Manager y roles concedidos         | Saldos, ledger, ajustes, conteos y traslados        | Reconcilia antes de corregir una diferencia no explicada           |
| Sales         | Owner, Manager y Viewer autorizado | Filtros, totales, estado, actor y detalle           | Los hechos terminales no se editan. Usa la referencia              |
| Receipts      | Operación autorizada               | Recibo oficial, COPY e impresión                    | Una falla física no borra el recibo                                |
| Refunds       | Manager o permiso equivalente      | Elegibilidad, vista previa, aprobación y resultado  | Recarga estado obsoleto. No repitas un resultado incierto          |
| Shifts        | Manager y roles de caja            | Apertura, movimientos, conteo, variación e historia | No cambies ventas para cuadrar efectivo                            |
| Customers     | Roles concedidos                   | Perfil, contacto, consentimiento e historia         | Respeta la proyección. Evita PII en soporte                        |
| Loyalty       | Manager y administración           | Política, puntos, rewards e historia                | Separa la política actual de los hechos históricos                 |
| Wallet        | Roles concedidos                   | Saldo, autorizaciones, débito y reversión           | No presenta un saldo editable. Reconcilia hechos                   |
| Gift cards    | Roles concedidos                   | Emisión, estado, valor e historia                   | No copies el secreto. Usa la identidad enmascarada                 |
| Recovery      | Manager y soporte                  | Estado conocido, incertidumbre y acción segura      | No existe una acción para repetir todo                             |
| Audit         | Owner, Manager y soporte           | Actor, ubicación, tiempo, evento y correlación      | Filtra primero. El JSON técnico queda secundario                   |
| Diagnostics   | Owner y soporte                    | Salud, disponibilidad, versión y dependencias       | Redacta secretos. Escala un servicio no disponible                 |

## Uso seguro

- Verifica comercio y ubicación antes de una mutación.
- Lee el motivo de una acción deshabilitada.
- No uses una URL directa para evitar un permiso.
- No interpretes una falla de impresión como una falla de venta.
- No cierres un caso de recuperación sin evidencia terminal.

## Errores

`401` requiere una sesión válida. `403` indica falta de autoridad. `409` indica estado obsoleto o conflicto.

`429` exige esperar. Un error exige revisar salud y disponibilidad funcional antes de repetir una mutación.

## Fuente

- Superficies: `apps/umi-dashboard/src/screens/`
- Navegación: `apps/umi-dashboard/src/lib/module-registry.js`
- Autenticación: `apps/umi-dashboard/src/lib/auth.jsx`
- Contexto: `apps/umi-dashboard/src/lib/merchant-context.jsx`
