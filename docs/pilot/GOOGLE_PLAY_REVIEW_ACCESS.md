# Acceso de Google Play a UmiPOS

## Decisión

El seeder crea datos operativos. La migración crea solo la estructura del acceso.
No contiene cuentas, contraseñas ni PIN. No cambia el esquema sellado de build-v3.

El acceso reutilizable autoriza exclusivamente el comercio reservado
`a1100000-0000-4000-8000-000000000001`. Una restricción SQL impide asignarlo a otro comercio.
Solo el operador de la base puede crear, cambiar o desactivar esta concesión.
El backend solo puede leerla. La API de comercios no puede crearla.

Cada instalación recibe una solicitud temporal y una credencial propia por el flujo existente.
El PIN, los permisos, el aislamiento y la prueba del dispositivo siguen activos.
La autorización automática solo admite terminales POS Android.
Los códigos normales conservan la aprobación manual y el vencimiento de cinco minutos.

## Preparación

Aplica `supabase/migrations/20261114000000_app_review_access.sql` antes de desplegar la API nueva.
Ejecuta el seeder desde la raíz del repositorio con Node.js 22 y las dependencias instaladas.
Introduce estos valores mediante variables de entorno. Guarda sus valores fuera del repositorio.

| Variable                | Uso                                                  |
| ----------------------- | ---------------------------------------------------- |
| `DATABASE_URL`          | Conexión administrativa a la base del entorno        |
| `PGSSLROOTCERT`         | Certificado CA para conexiones remotas               |
| `REVIEW_SEED_CONFIRM`   | `isolated-demo`                                      |
| `REVIEW_API_URL`        | API del mismo entorno, sin barra final               |
| `REVIEW_ADMIN_PASSWORD` | Contraseña aleatoria de al menos 20 caracteres       |
| `REVIEW_SETUP_CODE`     | Código aleatorio de ocho letras mayúsculas o números |
| `REVIEW_OPERATOR_PIN`   | PIN aleatorio de cuatro a seis dígitos               |

```sh
node scripts/umi-play-review-seed.mjs
```

El seeder puede repetirse. Conserva los pedidos y las ventas del comercio demo.
El usuario `play-review@umipos.invalid` tiene autoridad de propietario solo en ese comercio.
La API normal configura su PIN con la clave de firma del entorno.
La concesión se activa después de comprobar el inicio de sesión y configurar el PIN.
El código y el PIN no caducan. La cuenta no depende de una prueba gratuita.

El catálogo contiene cuatro productos ficticios. El pago en efectivo no requiere una caja física ni un turno abierto.
No se crean integraciones de pago, correo, mensajería o facturación para este comercio.
El administrador debe conservar este aislamiento y verificarlo antes de cada revisión.

## Datos para Play Console

Nombre: `UmiPOS Google Play review`.
El campo de usuario puede indicar `play-review@umipos.invalid`.
Explica en inglés que el acceso utiliza el código de registro y el PIN proporcionados.
El usuario y la contraseña de administración no sustituyen ese primer paso.

Instrucciones base, que se deben completar con los valores privados comprobados:

> Open the app. On the device enrollment screen, enter the enrollment code provided here.
> Enrollment completes automatically. On the operator sign-in screen, enter the PIN provided here.
> The account opens UmiPOS Google Play Demo, a separate business with fictional products.
> Select a product and use Cash to complete a sample sale. No physical payment terminal is needed.
> The enrollment code is reusable across installations. No OTP, email verification, payment, or manual approval is required.

Comprueba el flujo desde dos instalaciones nuevas contra la API que utiliza el AAB enviado.
Comprueba también una venta en efectivo y la denegación del acceso a otros comercios.
No declares estas pruebas como realizadas si solo se ejecutaron pruebas unitarias.

## Desactivación

Desactiva `runtime.app_review_access.enabled` para impedir instalaciones nuevas.
Esto conserva las credenciales ya emitidas. Revoca los dispositivos demo desde la administración para cerrar esos accesos.
Desactiva el personal demo para impedir inicios de sesión nuevos por PIN.
No borres ventas ni registros operativos para desactivar el acceso.
