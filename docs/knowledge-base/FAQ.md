# Preguntas frecuentes

[Índice](README.md) | [Glosario](../product/UMIPOS_GLOSSARY.md) | [Problemas](SOLUCION_DE_PROBLEMAS.md)

## ¿UMI POS tiene un backend separado?

No. UMI API y PostgreSQL conservan la autoridad. POS, Dashboard y KDS son clientes especializados.

## ¿Qué es NEXO ahora?

NEXO es material histórico o de referencia. `NEXO LEGACY RUNTIME DEPENDENCY: NONE`.

## ¿Puede un Cashier acceder a otra ubicación?

Solo si una membresía y permiso válidos lo autorizan. La interfaz no decide este acceso.

## ¿Qué ocurre si cae internet?

Las funciones online se bloquean. El POS nativo permite solo comandos offline autorizados, como efectivo bajo política.

## ¿Puede duplicarse una venta?

El diseño usa identidad, huella e idempotencia. Ante incertidumbre, consulta el comando original antes de repetir.

## ¿Puede editarse una venta completada?

No. Un reembolso añade un hecho separado y conserva la venta.

## ¿Cómo funciona un reembolso?

El servidor valida elegibilidad, permiso, aprobación e importe. Después crea una compensación inmutable.

## ¿Qué diferencia existe entre recibo e impresión?

El recibo es un hecho del negocio. La impresión es un efecto físico. COPY no crea otra venta.

## ¿Qué ocurre si KDS se desconecta?

Conserva el trabajo conocido, bloquea acciones inseguras y concilia una nueva instantánea al reconectar.

## ¿Cómo se mantiene el inventario?

El ledger conserva hechos. Las proyecciones los resumen. La reconciliación detecta una diferencia no explicada.

## ¿Qué ocurre si se detiene el proceso de tareas?

Los hechos confirmados permanecen. El trabajo asíncrono se retrasa hasta una recuperación segura.

## ¿Qué dispositivos tienen una versión v1?

Linux POS tiene el artefacto certificado. KDS software está completo. Gate 13 cubre hardware e iOS.

## ¿iPad está certificado?

El software KDS está certificado. La prueba física y el signing no están certificados todavía.

## ¿Los pagos integrados están habilitados?

No. Cash y manual terminal están certificados. Manual terminal no afirma autorización del proveedor.

## ¿Object storage es requerido?

No para RC2. Permanece deshabilitado.

## ¿Cómo se protegen las gift cards?

El sistema enmascara la identidad y protege el secreto. Nunca lo registra en logs normales.

## ¿Qué hago si no concilian los números?

Detén operaciones relacionadas. Ejecuta la conciliación y compara hechos. No edites datos manualmente.
