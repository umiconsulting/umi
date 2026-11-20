# Evidencia para la política de privacidad de UmiPOS

Fecha: 12 de noviembre de 2026. Alcance: revisión de código, sin datos de producción ni credenciales.

## Instrumentos y límites

- `ripgrep` 15.2.0 para buscar código; lectura directa de los archivos como fuente primaria.
- Herramienta web para consultar las políticas oficiales actuales de Google Play y Firebase.
- No se ejecutó una captura de tráfico ni se inspeccionó un AAB final. Los permisos indicados corresponden al manifiesto fuente, no al manifiesto fusionado.

## Hechos documentados en el repositorio

| Tema                       | Evidencia y alcance                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicación                 | `apps/umi-pos/android/app/build.gradle.kts:107`: `applicationId` predeterminado `co.umiconsulting.umi_pos`, con posible sustitución mediante propiedad de Gradle.                                                                                                                                                                                                                                        |
| SDK                        | `apps/umi-pos/pubspec.yaml`: Firebase Core 4.15.0, Firebase Messaging 16.7.0, almacenamiento seguro 9.2.4, preferencias 2.5.3 y SQLite. No declara SDK de anuncios, Analytics, Crashlytics o Sentry. Esto no certifica todas las dependencias transitivas del artefacto.                                                                                                                                 |
| Permisos                   | `apps/umi-pos/android/app/src/main/AndroidManifest.xml`: Internet, multicast WiFi y notificaciones; USB host opcional. No declara cámara, micrófono, ubicación ni lectura de contactos del teléfono.                                                                                                                                                                                                     |
| Identidad del dispositivo  | `apps/umi-pos/lib/features/entry/entry_gateway.dart:78`: envía código de vinculación, identificador de instalación, plataforma, tipo de dispositivo y clave pública al servicio de Umi.                                                                                                                                                                                                                  |
| Autenticación local        | `apps/umi-pos/lib/core/security/credential_vault.dart`: guarda tokens de acceso y renovación, identificadores de dispositivo, comercio, sucursal y sesión de operador en el almacén seguro. Cerrar sesión borra claves de sesión; la instalación y la confianza del dispositivo tienen ciclos distintos.                                                                                                 |
| Clientes                   | `apps/umi-pos/lib/features/customer_value/customer_value_surface.dart:720`: crea clientes con nombre y correo/teléfono opcionales. La pantalla distingue consentimiento de recibos, lealtad y marketing. Crear el cliente no concede consentimiento de marketing.                                                                                                                                        |
| Perfil e historial         | `apps/umi-pos/lib/features/customer_value/customer_value_repository.dart`: consulta clientes, historial, recompensas, saldo y tarjetas de regalo. `packages/contract/generated/dart/lib/umi_contract.dart:4299` y `:5283` definen nombre, contactos, idioma, consentimientos, estado y fechas.                                                                                                           |
| Operación y datos locales  | `apps/umi-pos/lib/core/storage/local_working_copy.dart`: SQLite contiene catálogo, cuentas/carritos, documentos y dispositivos de red con dirección/puerto. `apps/umi-pos/lib/features/offline/offline_journal.dart` conserva comandos de operación para recuperación y sincronización. No afirmar que todos los datos locales están cifrados: las credenciales y el SQLite tienen mecanismos distintos. |
| Conexión                   | `apps/umi-pos/lib/core/config/app_config.dart:203` exige HTTPS fuera de desarrollo y pruebas. No afirmar que toda comunicación local de hardware utiliza TLS.                                                                                                                                                                                                                                            |
| Notificaciones             | `apps/umi-pos/lib/features/kitchen/kitchen_push_notifications.dart:57` inicializa Firebase y solicita permiso. Registra el token FCM, plataforma y sesión de operador en Umi. Al cerrar sesión revoca el registro de Umi, pero deliberadamente no borra el token Firebase.                                                                                                                               |
| Contenido enviado a Google | `apps/umi-api/src/modules/pos-push/pos-push.service.ts:104`: la notificación incluye folio/cuenta, mesa y nombre de producto; datos adicionales contienen identificadores de orden, cocina, artículo, evento y carrito. No solo se envía el token.                                                                                                                                                       |
| Proveedores visibles       | Firebase/Google está probado por el flujo anterior. El backend tiene adaptador de correo SMTP/Brevo (`apps/umi-api/src/shared/adapters/email.adapter.ts`) y configuración PostgreSQL/Supabase (`apps/umi-api/src/shared/database/pg.service.ts`). Su presencia no demuestra qué proveedor está activo en producción ni qué flujo de UmiPOS usa correo.                                                   |
| Aviso existente            | `apps/umi-landing-page/src/app/aviso-de-privacidad/page.tsx` es un borrador para el formulario de demos, no una política completa de UmiPOS. Identidad legal, domicilio, proveedores y conservación figuran como pendientes. Correo público existente: `hola@umiconsulting.co`.                                                                                                                          |

## Requisitos externos documentados

Google Play exige una política pública en una página estable, sin acceso ni restricción geográfica, vinculada desde Play Console y desde la app. Debe identificar la app o el desarrollador, ofrecer contacto y explicar datos, finalidades, destinatarios, protección, conservación y eliminación. Fuente: [User Data](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en).

Si la app permite crear cuentas de usuario, Google exige mecanismos de solicitud de eliminación dentro y fuera de la app. Esto requiere revisar el flujo real de alta: crear una ficha de cliente de un restaurante no equivale necesariamente a crear una cuenta de usuario de la app. Fuente: [Account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

Firebase documenta que FCM utiliza identificadores de instalación para dirigir notificaciones. Conserva esos identificadores hasta una solicitud de eliminación; después aplica su proceso de eliminación. Fuente: [Privacy and Security in Firebase](https://firebase.google.com/support/privacy). No extrapolar esta retención a todo Umi.

## Inferencias para el texto público

- Debe nombrar expresamente UmiPOS y puede indicar su identificador Android.
- Debe separar datos del titular/operador de los datos que el restaurante introduce sobre sus clientes.
- Puede explicar alojamiento/base de datos, mensajería y soporte como clases de destinatarios; solo nombrar proveedores verificados.
- Puede ofrecer solicitudes de privacidad por el correo público existente. No prometer un proceso automático ni plazos de eliminación no verificados.
- No afirmar que UmiPOS no recopila datos personales, que nunca comparte información, ni que cerrar sesión elimina todos los datos.

## Pendientes no verificados

1. Resuelto para UmiPOS: el usuario confirmó el nombre legal y el domicilio público del responsable. El aviso independiente del formulario de demos conserva su estado de borrador.
2. Lista y regiones de los proveedores activos en producción; contratos y transferencias internacionales.
3. Plazos de conservación aprobados y procedimiento operativo de eliminación, incluidas copias y registros fiscales.
4. Ausencia de compraventa de datos, publicidad o entrenamiento de modelos a nivel de toda la plataforma. El SDK de la app no prueba una política empresarial.
5. Enlace dentro de UmiPOS: la búsqueda de `privacy`, `privacidad` y `legal` no encontró una política o enlace público. Hay una explicación de consentimientos en el perfil de clientes.
6. Requisitos de eliminación de cuenta: no se probó la experiencia de creación/eliminación de cuentas ni un endpoint integral de eliminación.

El plazo de 30 días del diario offline es un campo técnico. `docs/research/2026-11-06-agenda-journal-offline.md` advierte que falta confirmar su uso y la decisión de retención. No presentarlo como compromiso general de Umi.

## Implementación y verificación de la página

El usuario confirmó el nombre de la persona física responsable y sustituyó el domicilio inicial por un domicilio público de contacto. La página usa únicamente el último domicilio. El texto final está en `apps/umi-landing-page/src/app/privacidad-umipos/page.tsx`. La ruta pública prevista es `https://www.umiconsulting.co/privacidad-umipos`.

Se reutilizó Next.js 15.5.20 y la exportación estática existente de Cloudflare Pages. El footer incorpora un enlace a la política de UmiPOS. El aviso del formulario de demos mantiene su alcance independiente. La directiva `noindex` solicita exclusión de índices de búsqueda, pero no restringe el acceso público.

La compilación estática pasó. Playwright 1.62.1 con Chromium verificó el enlace desde el footer y la ruta en 1440 × 1000 y 390 × 844. No hubo errores JavaScript ni desbordamiento horizontal. Ambas vistas contienen once secciones, el correo de privacidad y la dirección nueva, sin la dirección sustituida ni marcadores de borrador. Las capturas locales están en `/home/juan/Projects/umiconsulting/privacy-policy-evidence-20261112/`.

Los plazos numéricos de conservación y los proveedores concretos de producción siguen sin verificación operativa. El texto expone criterios de conservación y clases de proveedores, sin inventar plazos o prometer eliminación automática. El enlace dentro de la app nativa requiere un cambio de UmiPOS distinto del despliegue web.

Fuente legal consultada: [LFPDPPP vigente](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf), artículos 2 y 15, para identidad y domicilio del responsable persona física.
