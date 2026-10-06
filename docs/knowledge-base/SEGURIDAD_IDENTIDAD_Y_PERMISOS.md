# Seguridad, identidad y permisos

[Índice](README.md) | [Solución de problemas](SOLUCION_DE_PROBLEMAS.md) | [Glosario](../product/UMIPOS_GLOSSARY.md)

## Aislamiento de datos

El tenant delimita datos aislados. El comercio y la ubicación definen el contexto operativo visible.

Una membresía une una identidad con un comercio, un rol y las ubicaciones permitidas. El servidor verifica este contexto en cada comando protegido.

RLS significa seguridad por fila. PostgreSQL filtra filas según el contexto autorizado.

`FORCE RLS` aplica la política incluso al propietario normal de la tabla. La cuenta de la aplicación no es superusuario.

Ocultar un botón mejora la experiencia. No crea seguridad. UMI API y PostgreSQL toman la decisión final.

### Ejemplos

- Un Manager asignado a Ubicación A puede operar A según sus permisos.
- El mismo Manager no puede escribir en Ubicación B sin una asignación válida.
- Un Viewer puede leer lo permitido. No puede convertir su petición en una mutación.
- KDS puede cambiar preparación. No puede crear cobros ni reembolsos.

## Identidad y sesión

El login crea una sesión mediante credenciales válidas. Las cookies seguras no exponen el token al JavaScript normal.

La sesión expira y puede renovarse según la política. Logout y revocación invalidan el acceso futuro.

El POS también usa PIN para cambiar el operador autorizado. El PIN no sustituye la identidad inscrita del dispositivo.

Las invitaciones, restablecimientos y aprobaciones usan tokens limitados. La acción valida uso, caducidad y contexto.

El backend almacena hashes de contraseña. No conserva una contraseña recuperable ni la expone a los clientes.

CSRF protege comandos basados en cookies. CORS limita orígenes permitidos. Ninguno sustituye RBAC o RLS.

### Ciclo completo

1. Login normaliza el correo y verifica la contraseña.
2. MFA exige el segundo factor configurado antes de emitir una sesión.
3. La sesión entrega una cookie de acceso y una cookie de renovación.
4. La renovación rota el token y verifica que la sesión siga vigente.
5. Logout revoca la sesión actual y limpia las cookies.
6. Global logout revoca todas las sesiones, salvo la excepción solicitada cuando aplica.

El acceso puede usar una cookie de sesión o una cookie persistente con `remember`. El servidor controla su vigencia.

### Contraseña y restablecimiento

El restablecimiento exige un mínimo de ocho caracteres. El backend usa `scrypt` con sal y conserva solo el hash.

Forgot password devuelve la misma respuesta para un correo conocido o desconocido. Esta regla evita enumerar usuarios.

El token dura 15 minutos. Se guarda como hash, se usa una vez y después queda inválido.

Un cambio de contraseña revoca las sesiones Dashboard del usuario. Después, el usuario inicia una sesión nueva.

### Invitación

El estado `invited` pertenece al login. No describe el estado laboral de la membresía.

No supongas que una invitación fue entregada. Confirma el canal vigente y la aceptación antes de dar acceso operativo.

### Fallas del ciclo

| Falla                    | Comprobación                     | Acción segura                                 |
| ------------------------ | -------------------------------- | --------------------------------------------- |
| Contraseña incorrecta    | Mensaje genérico `401`           | Verifica el correo o inicia restablecimiento  |
| Renovación inválida      | Sesión y revocación              | Inicia login otra vez                         |
| Logout global inesperado | Auditoría y cambio de credencial | Confirma revocación o cambio de contraseña    |
| Enlace expirado          | Hora y uso del token             | Solicita otro enlace                          |
| Invitación pendiente     | Estado del login y canal         | Reenvía solo mediante el flujo autorizado     |
| Cookie ausente           | HTTPS, dominio y proxy           | Corrige el ambiente. Conserva cookies seguras |

## Roles actuales

| Rol         | Alcance               | Autoridad normal                                  | Operación sensible                            | Operación prohibida                |
| ----------- | --------------------- | ------------------------------------------------- | --------------------------------------------- | ---------------------------------- |
| Owner       | Comercio              | Configuración, personas, dispositivos y operación | Asignar autoridad y política                  | Eliminar al último Owner           |
| Admin       | Comercio              | Administración delegada y operación autorizada    | Gestionar dispositivos y hardware             | Tomar autoridad reservada al Owner |
| Manager     | Ubicaciones asignadas | Caja, recuperación, excepciones e inventario      | Reembolsos, ajustes y aprobaciones permitidas | Operar otra ubicación sin permiso  |
| Supervisor  | Ubicación             | Supervisión de checkout y cocina                  | Aprobar acciones con permiso vigente          | Administrar el comercio            |
| Cashier     | Ubicación             | Venta, caja propia y operación diaria             | Usar valor autorizado                         | Administrar usuarios o política    |
| Staff       | Ubicación             | Compatibilidad con Cashier                        | Acciones permitidas al perfil                 | Ampliar su alcance                 |
| Viewer      | Ubicación concedida   | Lectura explícita                                 | Ninguna mutación                              | Cambiar hechos o hardware          |
| KDS/service | Estación y ubicación  | Preparación de cocina permitida                   | Recall o prioridad según permiso              | Crear autoridad financiera         |

Consulta la matriz exacta en `docs/product/UMIPOS_PILOT_RBAC.md`.

## Invariantes

- Conserva siempre un Owner válido.
- Revalida permisos y ubicación durante la confirmación final.
- Rechaza un dispositivo revocado antes de una operación protegida.
- Vincula una aprobación a acción, alcance, importe y caducidad.
- No uses `super_admin` como rol de producto.
- No ignores RLS durante una investigación.
- No pongas secretos en el frontend, logs, tickets o archivos de ejemplo.
- No cambies CORS o cookies para resolver un permiso denegado.

## Fallas comunes

| Estado | Significado probable            | Acción                                                   |
| ------ | ------------------------------- | -------------------------------------------------------- |
| `401`  | Falta sesión válida             | Inicia sesión otra vez. Verifica cookie, reloj y entorno |
| `403`  | La identidad no tiene autoridad | Verifica rol, permiso, ubicación y estado de membresía   |
| `409`  | El estado cambió                | Recarga y revisa el cambio antes de reintentar           |
| `429`  | El límite protege el servicio   | Espera el intervalo indicado. No cambies la política     |

## Sospecha de cruce

1. Detén la operación afectada.
2. Registra comercio, ubicación, usuario, dispositivo y hora.
3. Conserva la referencia y el correlation ID.
4. Revisa auditoría y el contexto de sesión.
5. Verifica la política RLS aplicable.
6. Escala como P0 si existió lectura o escritura no autorizada.
