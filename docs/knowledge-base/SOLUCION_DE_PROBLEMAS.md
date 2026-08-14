# Solución de problemas

[Índice](README.md) | [Incidentes](INCIDENTES_SOPORTE_Y_DIAGNOSTICO.md) | [Diagnóstico del Owner](GUIA_DE_DIAGNOSTICO_DEL_OWNER.md)

**No edites manualmente hechos financieros o de inventario para corregir un incidente.**

| Síntoma                   | Comprobaciones                   | Causa probable                | Acción segura                       | Escala                 |
| ------------------------- | -------------------------------- | ----------------------------- | ----------------------------------- | ---------------------- |
| No puede iniciar sesión   | Ambiente, reloj, cookie, estado  | Credencial o sesión inválida  | Reautentica y revisa health         | P1 si afecta operación |
| `401`                     | Sesión y caducidad               | Sesión ausente o expirada     | Login nuevo                         | P1 si persiste         |
| `403`                     | Rol, permiso, ubicación          | Autoridad insuficiente        | Corrige membresía autorizada        | P0 si hubo bypass      |
| Ubicación incorrecta      | Contexto y asignación            | Selección o grant incorrecto  | Detén y corrige antes de vender     | P0 si ya atribuyó mal  |
| Owner no gestiona usuario | Rol y último Owner               | Salvaguarda o permiso         | Añade otro Owner o corrige alcance  | P1                     |
| Dispositivo revocado      | Estado y credencial              | Revocación válida             | Reinscribe con autorización         | P1                     |
| Caja no disponible        | Ubicación, dispositivo, estado   | Asignación incorrecta         | Corrige configuración               | P1                     |
| Diferencia de turno       | Fondo, ventas, movimientos       | Conteo o movimiento omitido   | Revisa hechos y registra variación  | P1/P0                  |
| Producto ausente          | Archivo, ubicación, categoría    | No aplicable o no disponible  | Corrige catálogo                    | P1 si bloquea venta    |
| Código de barras ausente  | Código y producto                | Código ausente o incorrecto   | Usa búsqueda manual                 | P2                     |
| Inventario no cuadra      | Libro de hechos y proyección     | Diferencia o hecho pendiente  | Ejecuta la conciliación             | P0/P1                  |
| Venta parece detenida     | Comando y conexión               | Respuesta pendiente o perdida | Consulta comando original           | P0/P1                  |
| Venta incierta            | Venta, pago y recibo             | Respuesta perdida             | No reintentes. Consulta autoridad   | P0                     |
| Posible duplicado         | Identidad y conteo               | Reintento o percepción        | Compara hechos y clave idempotente  | P0                     |
| Recibo no imprime         | Venta y tarea de impresión       | Falla física                  | Usa recuperación o `COPY`           | P1/P2                  |
| Reembolso falla           | Elegibilidad y permiso           | Estado o aprobación obsoleta  | Recarga y revisa vista previa       | P0/P1                  |
| KDS desconectado          | Pulso y estación                 | Red o sesión                  | Reconecta. Concilia la instantánea  | P1                     |
| Tarjeta KDS duplicada     | ID e instantánea                 | Vista obsoleta                | Recarga. No completes ambas         | P1                     |
| API no disponible         | `/health/live` y `/health/ready` | Proceso o dependencia         | Restaura la dependencia             | P0/P1                  |
| Redis no disponible       | Redis y disponibilidad           | Servicio caído                | Restaura Redis                      | P1                     |
| Proceso retrasado         | Cola y fallos terminales         | Dependencia o tarea dañada    | Corrige la causa. Reinicia una vez  | P1                     |
| Migración falla           | Log y versión de esquema         | Orden o entorno incorrecto    | Detén la versión                    | P0/P1                  |
| Dashboard no inicia       | Configuración y versión          | Configuración inválida        | Corrige valores no secretos         | P1                     |
| CORS o CSP bloquea        | Origen y cabeceras               | Lista incorrecta              | Corrige política del ambiente       | P1                     |
| Cookie no persiste        | HTTPS y dominio                  | Política secure/same-site     | Corrige proxy y origen              | P1                     |
| Versión incorrecta        | Identidad de la versión          | Artefacto equivocado          | Retira RC incorrecto. Despliega RC2 | P0/P1                  |
| Proveedor deshabilitado   | Modo de pago                     | Función fuera de alcance      | Usa efectivo o terminal manual      | No aplica              |
| Objetos deshabilitados    | Política de RC2                  | Función fuera de alcance      | Mantén el servicio deshabilitado    | No aplica              |
| Diferencia financiera     | Ventas, pagos, reembolsos        | Diferencia autoritativa       | Detén y reconcilia                  | P0                     |

## Regla de investigación

Empieza por identidad, ambiente, comercio, ubicación, usuario, dispositivo, caja y hora. Después identifica el hecho autoritativo.

Conserva el identificador de transacción y el identificador de correlación. Evita secretos, PIN, tokens y contactos completos.
