# Acceso para la revisión de Google Play

Fecha: 14 de noviembre de 2026.

## Decisión propuesta

**Inferencia de Umi:** usar un comercio de demostración en producción, con datos ficticios y acceso normal del POS. El revisor necesita un código de registro reutilizable y un PIN de operador. Un usuario con correo y contraseña, por sí solo, no permite entrar desde una instalación nueva.

La API debe resolver el código de demostración a un único comercio y una única sucursal. Después debe emitir credenciales normales por dispositivo. La sesión del operador debe conservar los controles normales de permisos, producto y aislamiento del comercio.

## Herramientas y evidencia

- Búsqueda: `ripgrep` 15.2.0, disponible en esta máquina. Fuente: archivos del repositorio.
- Investigación externa: herramienta web, documentación oficial de Google Play. Versión del servicio no expuesta.
- Habilidades consultadas: `research` y `product-feature-review`.
- Alcance: inspección de código. No se probó el flujo nativo ni se consultaron credenciales de producción.

## Ruta actual desde una instalación nueva

**Hechos del código:**

1. `EntryController.initialize()` comprueba `CredentialVault.deviceIdentity()`.
2. Si falta la identidad registrada, muestra `enrollmentRequired`.
3. La pantalla muestra **Enroll this device** y un campo **Enrollment code** de ocho caracteres alfanuméricos.
4. `EntryGateway.claimPairing()` envía el código, ID de instalación, plataforma, tipo de dispositivo y clave pública.
5. La ruta es `POST /api/v1/devices/pairing/claim`.
6. El servidor devuelve una sesión con `awaiting_approval`.
7. El POS consulta `POST /api/v1/devices/pairing/:pairingSessionId/poll` y puede recibir avisos por socket.
8. Un administrador aprueba mediante `POST /api/v1/merchants/:merchantId/devices/enrollment-requests/:requestId/approve`.
9. El POS guarda la credencial del dispositivo y confirma su recepción mediante `acknowledge`.
10. El POS muestra el PIN. `EntryController.loginWithPin()` usa el comercio y la sucursal de la credencial registrada.
11. Tras autenticar el PIN, el POS resuelve el contexto y abre la sesión del operador.

Fuentes: [entry_controller.dart](../../apps/umi-pos/lib/features/entry/entry_controller.dart), [entry_gateway.dart](../../apps/umi-pos/lib/features/entry/entry_gateway.dart), [entry_surface.dart](../../apps/umi-pos/lib/features/entry/entry_surface.dart), [devices.controller.ts](../../apps/umi-api/src/modules/devices/devices.controller.ts).

## Barreras comprobadas

- `DevicesService.beginForReplacement()` crea códigos con vencimiento de cinco minutos.
- `DevicesRepository.claimPairing()` exige estado `created`, plataforma y tipo coincidentes. El código queda en `awaiting_approval` tras el primer uso.
- La aprobación exige intervención de una cuenta con `device.enroll` y producto POS habilitado.
- El código actual no sirve como credencial reutilizable para varias instalaciones.
- `AuthService.pinLogin()` exige dispositivo válido, ID de instalación, credencial y prueba criptográfica cuando corresponde.
- El operador necesita correo, PIN válido y acceso a una suscripción POS activa o de prueba.
- La creación de personal admite PIN de cuatro a ocho dígitos. El material del PIN incluye hash, sal y hash de búsqueda.

Fuentes: [devices.service.ts](../../apps/umi-api/src/modules/devices/devices.service.ts), [devices.repository.ts](../../apps/umi-api/src/modules/devices/devices.repository.ts), [auth.service.ts](../../apps/umi-api/src/modules/auth/auth.service.ts), [staff.service.ts](../../apps/umi-api/src/modules/staff/staff.service.ts).

## Requisito externo

**Hecho documentado:** Google acepta una cuenta de demostración y otros recursos necesarios para acceder a las funciones restringidas. Exige credenciales reutilizables, siempre disponibles y válidas desde cualquier ubicación. Las instrucciones deben estar en inglés. Los códigos de un solo uso requieren una alternativa reutilizable.

Fuente primaria: [Requirements for providing sign in details for review](https://support.google.com/googleplay/android-developer/answer/15748846?hl=en).

No hay un requisito de correo y contraseña si la aplicación utiliza otra forma de entrada. En este POS, las instrucciones deben describir el código de registro y el PIN.

## Diseño mínimo recomendado

**Inferencia de Umi:** conservar el campo de ocho caracteres. Añadir una concesión de registro reutilizable, revocable y restringida al comercio de demostración. Su secreto debe residir en configuración del servidor o como hash protegido. Las instrucciones y el secreto se entregan por Play Console, no dentro del repositorio.

Tras validar la concesión, el backend crea una solicitud de registro y la aprueba automáticamente para esa instalación. El resto del intercambio debe usar las respuestas y credenciales normales. Debe producir un evento de auditoría que identifique la concesión y el dispositivo, sin registrar el secreto.

Controles propuestos:

- Fijar comercio, sucursal y tipo de dispositivo en el servidor.
- Comprobar que el comercio tiene el marcador explícito de demostración esperado.
- Conservar el límite de intentos por IP e instalación y la prueba de la clave del dispositivo.
- Admitir reutilización y varias instalaciones sin reemplazar dispositivos de otros revisores.
- Hacer idempotente el reintento desde la misma instalación.
- Permitir revocar la concesión sin modificar la autenticación de comercios reales.
- Mantener la suscripción del comercio demo activa durante las revisiones y futuras actualizaciones.
- Usar datos ficticios, un operador exclusivo y permisos suficientes para revisar las funciones publicadas.
- Desactivar integraciones con dinero real, facturación real y envíos externos para ese comercio.

**Alternativa:** entregar acceso al dashboard para generar y aprobar dispositivos. Reutiliza todo el código actual, pero añade un segundo producto y pasos manuales. Es menos simple para el revisor y conserva la caducidad de cinco minutos.

## Pruebas de aceptación

1. Una instalación nueva con el código demo obtiene una credencial normal y llega al PIN sin intervención.
2. El PIN abre la sesión del operador en el comercio demo y muestra productos ficticios.
3. Una segunda instalación puede repetir el mismo proceso.
4. El reintento desde la primera instalación conserva una identidad coherente.
5. Un código incorrecto, una concesión revocada o un comercio distinto fallan de forma segura.
6. La concesión demo nunca registra un dispositivo en un comercio real.
7. El código de cinco minutos de un comercio real mantiene su aprobación manual.
8. La prueba real del dispositivo, los permisos y los límites de intento siguen activos.
9. Las operaciones de prueba no envían correos o mensajes a clientes ni ejecutan cobros reales.

## Pendientes no verificados

- No se identificó una concesión reutilizable ya implementada en el flujo actual.
- No se certificó un comercio demo de producción, su plan ni su conjunto de permisos.
- Falta probar el flujo completo en el AAB y desde una instalación limpia.
- Falta comprobar las dependencias de caja, turno, terminal y catálogo para una venta completa.
- El diseño de revocación y los límites de dispositivos requieren una decisión de implementación.
- Ninguna credencial aparece en este documento.
