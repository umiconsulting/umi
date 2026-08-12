# Kit de operaciones del piloto de UmiPOS

Este documento es el punto de entrada para el alta y la operación del piloto. Usa superficies autorizadas. No requiere SQL, Supabase ni llamadas manuales a la API.

## Matriz de preparación

| Área         | Configuración           | Responsable           | Herramienta                   | Verificación       | Recuperación          | Estado |
| ------------ | ----------------------- | --------------------- | ----------------------------- | ------------------ | --------------------- | ------ |
| Comercio     | identidad, zona, moneda | Admin técnico y Owner | aprovisionamiento + Dashboard | contexto correcto  | soporte               | READY  |
| Ubicación    | perfil y horario        | Owner/Admin           | Dashboard                     | selector           | corregir perfil       | READY  |
| Cajas        | ubicación y estado      | Owner/Admin           | Dashboard Operaciones         | caja activa        | reconfigurar          | READY  |
| Usuarios     | identidad y estado      | Owner/Admin           | Dashboard                     | acceso             | revocar/restaurar     | READY  |
| Roles        | permisos mínimos        | Owner/Admin           | Dashboard                     | tarea permitida    | corregir asignación   | READY  |
| POS          | confianza y caja        | Admin                 | Dashboard Dispositivos        | bootstrap          | revocar/reinscribir   | READY  |
| Hardware     | asignación primaria     | Admin/Manager         | Dashboard Hardware            | diagnóstico        | reasignar             | READY  |
| Catálogo     | productos y precios     | Owner/Admin           | Dashboard Catálogo            | venta de prueba    | editar/archivar       | READY  |
| Cocina       | estación y rutas        | Admin                 | Dashboard Cocina              | orden de prueba    | corregir ruta         | READY  |
| Inventario   | mapeo y apertura        | Manager               | Dashboard Inventario          | balance/conteo     | ajuste o conteo       | READY  |
| Clientes     | alta opcional           | Caja/Manager          | POS/Dashboard                 | perfil             | corrección autorizada | READY  |
| Loyalty      | política                | Owner                 | Dashboard                     | historial          | ajuste aprobado       | READY  |
| Rewards      | regla                   | Owner                 | Dashboard                     | vista previa       | desactivar política   | READY  |
| Gift cards   | límites y emisión       | Owner/Admin           | Dashboard/POS                 | historial seguro   | recuperación          | READY  |
| Efectivo     | fondo y límites         | Owner/Manager         | POS/Dashboard                 | turno              | conciliación          | READY  |
| Recibos      | impresión y COPY        | Owner/Admin           | POS/Dashboard                 | prueba             | consulta/reimpresión  | READY  |
| Offline      | acciones elegibles      | Owner/Admin           | política del POS              | replay             | recuperación          | READY  |
| KDS          | par y estación          | Admin/Cocina          | Dashboard/KDS                 | heartbeat          | reasignar/reconectar  | READY  |
| Respaldo     | frecuencia y destino    | Soporte técnico       | runtime del piloto            | checksum           | repetir/escalar       | READY  |
| Recuperación | permisos y cola         | Manager/Admin         | Centro de recuperación        | resultado terminal | escalar               | READY  |
| Soporte      | severidad y referencias | Soporte               | bundle/health                 | caso trazable      | escalamiento          | READY  |
| Despliegue   | manifest y smoke        | Admin técnico         | scripts del piloto            | smoke              | rollback              | READY  |
| Cierre       | turno y excepciones     | Manager               | POS/Dashboard                 | turno cerrado      | conciliación          | READY  |

## Perfil de configuración

Copia `config/umipos-pilot-business-profile.json` fuera del repositorio. Cambia `profileType` a `pilot`. Resuelve cada `OWNER_DECISION_REQUIRED`. No agregues secretos.

## Alta de un comercio

El alta de la raíz del comercio es una acción de aprovisionamiento técnico. El Dashboard requiere una membresía existente. Después del aprovisionamiento, completa estos pasos:

1. Inicia sesión como Owner/Admin.
2. Confirma el comercio activo.
3. Configura el perfil, la zona horaria y la moneda.
4. Configura la ubicación y sus horarios.
5. Configura la caja en `Operaciones > Cajas`.
6. Invita a los usuarios y asigna los permisos mínimos.
7. Inscribe el POS desde `Dispositivos`.
8. Asigna la caja, la ubicación y el hardware.
9. Configura el catálogo y las rutas de preparación.
10. Inicializa el inventario con comandos de inventario.
11. Configura las políticas comerciales.
12. Ejecuta `pnpm pilot:readiness`.

No uses la fixture de certificación para un comercio real. El despliegue limpio la habilita solo con `PILOT_CERTIFICATION_CONFIRM=disposable`.

## Ubicación, caja y dispositivos

Confirma el comercio, la ubicación, la zona, el horario y el estado activo. Configura una caja activa. Vincula un POS inscrito, la impresora primaria, el cajón y el escáner. Configura la estación KDS y la versión de política.

Para inscribir el POS:

1. Instala el artefacto de Linux.
2. Inicia UmiPOS e introduce el código de registro.
3. Aprueba la solicitud en Dashboard.
4. Asigna la ubicación y la caja.
5. Confirma la confianza, el login por PIN y el bootstrap.

Repite la inscripción si el código expiró. Revoca una credencial obsoleta. Corrige la ubicación desde Dashboard. Escala una versión incompatible.

## Roles recomendados

- Owner/Admin: configuración, usuarios, auditoría y políticas.
- Manager: aprobaciones, reembolsos, conteos, ajustes y recuperación.
- Supervisor: operación del turno dentro de sus permisos.
- Cashier y Staff: venta, recibo y manejo del turno asignado.
- Viewer: consulta sin mutaciones.
- KDS: preparación mediante el contexto KDS.

Aplica el mínimo permiso necesario. La persona que solicita una operación sensible no debe aprobarla cuando la política lo prohíbe.

## Hardware

Registra cada equipo con una referencia pública. Asigna el transporte, la ubicación y la caja. Selecciona la impresora primaria. Ejecuta una prueba de impresora, cajón y escáner. Usa el simulador solo en desarrollo o certificación.

El código está listo para impresora, cajón y escáner genéricos. La certificación física sigue pendiente.

## Catálogo e inventario

Configura categorías, productos, variantes, modificadores, códigos, precios y estado. Marca los productos que requieren preparación. Asigna su ruta de cocina. Archiva en vez de borrar un producto publicado.

Mapea cada producto inventariable. Registra el stock inicial como un hecho de apertura. Configura el umbral bajo. Haz un conteo ciego opcional. Corrige un error con un ajuste o una conciliación. Nunca sobrescribas el balance.

## KDS

Configura la ubicación, la estación y las rutas. Empareja el dispositivo KDS. Confirma el heartbeat y la instantánea. Ejecuta una orden de prueba hasta `Complete`. Prueba la reconexión y `Recall`. La certificación física de iPad queda pendiente.

## Clientes, loyalty y gift cards

Permite ventas anónimas. Recopila un contacto solo con permiso. Mantén el marketing como opción. El Owner debe decidir la tasa, el umbral y la expiración antes de activar loyalty o rewards.

Las gift cards empiezan desactivadas. El Owner decide el valor máximo, la expiración, el riesgo al portador y la entrega del código. Conserva el límite de revelación. Usa el historial seguro para consultas y recuperación.

## Políticas de efectivo, recibos y offline

El sistema registra el hecho financiero. El personal mantiene la custodia física del efectivo. Registra el fondo, las entradas, las salidas, los retiros, el conteo ciego, la variación y el cierre.

Usa impresión automática según la política. Usa `COPY` para una copia. Si aparece `UnknownOutcome`, consulta el comando. No repitas la transacción financiera.

Offline permite una venta elegible en efectivo y un recibo provisional. Bloquea stored value, rewards y mutaciones sensibles. Cuando regrese la conexión, espera el replay y resuelve cada conflicto.

## Caminata de preparación comercial

Ejecuta esta caminata en un despliegue limpio con la fixture designada:

1. Confirma el comercio, la ubicación y la caja.
2. Confirma Owner, Manager y Cashier.
3. Inscribe el POS y asigna el simulador.
4. Revisa el catálogo, la ruta KDS y el inventario.
5. Revisa loyalty y la política de gift cards.
6. Inicia POS, abre el turno y crea una venta en efectivo.
7. Confirma inventario, KDS y recibo.
8. Crea una venta con cliente y confirma loyalty.
9. Ejecuta un reembolso aprobado.
10. Resuelve una falla simulada de impresión.
11. Cierra el turno y revisa auditoría.
12. Ejecuta `pnpm pilot:readiness`.

La fixture crea datos antes de la caminata. La caminata usa Dashboard, POS y KDS. No usa SQL ni una llamada manual a la API.

## Caminata de roles

- Owner/Admin configura una caja y revisa auditoría.
- Manager aprueba un reembolso y concilia inventario.
- Cashier vende y no administra permisos.
- KDS prepara y no ejecuta administración de Dashboard.
- Viewer consulta y no muta.

Escala una tarea no disponible al rol superior. No amplíes permisos para evitar la aprobación.

## Bloqueadores restantes

| Clasificación          | Observación                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| BLOCKS PHYSICAL PILOT  | impresora, cajón, escáner, display e iPad reales                      |
| BLOCKS PRODUCTION ONLY | DNS, TLS público, nube, respaldo del proveedor y firma de plataformas |
| NON-BLOCKING           | proveedor de pagos, analytics y certificación final de UX             |

## Documentos relacionados

- [Listas diarias](UMIPOS_OPENING_CLOSING_CHECKLISTS.md)
- [Guía de caja](UMIPOS_CASHIER_QUICKSTART.md)
- [Guía de Manager](UMIPOS_MANAGER_QUICKSTART.md)
- [Guía de cocina](UMIPOS_KITCHEN_QUICKSTART.md)
- [Soporte](UMIPOS_SUPPORT_RUNBOOK.md)
- [Despliegue](../deployment/UMIPOS_PILOT_DEPLOYMENT.md)
- [Respaldo y restore](../deployment/UMIPOS_BACKUP_RESTORE.md)
