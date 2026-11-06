# Paridad funcional como condición del rediseño

Requisito del usuario, 2 de noviembre de 2026: el rediseño debe conservar todas las funcionalidades actuales. Mostrar las rutas no acredita el flujo ni sus reglas. El trabajo de Stageshow continúa con ese requisito; la maqueta no autoriza sustituir los controladores y permisos reales por su estado local.

1. Completar el recorrido del dashboard con capítulos, pausa, avance manual y dispositivos. Conservar pantalla al explorar, detenerse al cambiar formato y no escribir sobre borradores durante la reproducción.
2. Auditar cada función contra el código actual y staging. Crear una matriz con fuente, pantalla, subflujo, permisos, estados, prueba de aceptación y resultado observado.
3. Cerrar diferencias del dashboard: contexto de negocio/sucursal; filtros propios; consulta y edición; variantes/opciones; inventario; equipo, dispositivos y permisos. Usar fuentes actuales, componentes BoardUI y la identidad aprobada. El guardado y las operaciones externas siguen identificados como simulación local.
4. Cerrar diferencias operativas del POS: rondas de comanda, mesas/cuentas, cobros parciales/mixtos/transferencia/propina y estados de terminal. Conservar separación de Caja/Barra/Cocina y políticas de conteo. No inventar operaciones ausentes del producto actual.
5. Revisar independientemente el resultado, ejecutar verificaciones funcionales y responsive, filmar el recorrido y documentar evidencia y brechas restantes. Ninguna simulación o prueba del prototipo acredita integración de API, hardware o permisos del servidor.

## Registro de ejecución

- El prototipo es una carpeta aislada sin Git. El repositorio real permanece de sólo lectura; no hay despliegue ni PR en este trabajo del visor.
- Recorrido inicial: 62 pasos de propietaria; 64 con plataforma. Verificación preliminar completa en Windows e iPhone: todas las vistas alcanzadas, sin blancos de cursor ausentes. Faltan revisión de animación y comprobaciones de interrupción.
- Revisión de pausa y configuración: las identidades de los 62/64 pasos conservan el subpaso correcto; las seis pruebas puras de reloj/cancelación pasan. La pausa normal y la suspensión fuera de pantalla deben conservar el gesto y su tiempo restante. Cambiar dispositivo, orientación o preferencia de movimiento detiene el recorrido en el mismo paso; al continuar se reinicia el gesto de ese paso, incluida la escritura de ejemplo. Esto no reinicia la navegación ni los formularios en modo Explorar. La verificación del ciclo de vida del navegador se registra aparte.
- Auditoría independiente en curso. Se confirmaron diferencias de UI, además de integraciones pendientes; no se declara paridad completa.
- Las fuentes de la aplicación se congelan durante pruebas de navegador y grabaciones. Los cambios de documentación pueden continuar.
- Pase de conservación del original: navegación, resumen y acceso recuperados; revisión visual contra las capturas y fuentes reales. El recorrido completo pasó 34 comprobaciones en Windows/iPhone y conserva edición/revisión/MFA al girar tablet. [REHEARSAL](../src/REHEARSAL.md) registra pruebas, correcciones y límites de animación.
- Las ampliaciones locales del dashboard y POS pasaron sus suites de navegador. Persisten brechas de UI y de integración en la matriz y el reporte de implementación. No se declara paridad total ni preparación completa para staging.
