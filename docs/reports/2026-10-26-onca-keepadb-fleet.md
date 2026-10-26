# KeepADB en la flota ONCA

Fecha local: 26 de octubre de 2026

## Alcance

La flota de ONCA en Tailscale contiene cuatro equipos con nombre `onca-*`:

| Equipo | Tailscale | Estado actual de ADB | KeepADB |
| --- | --- | --- | --- |
| Caja principal | `onca-caja-principal` | `100.64.178.95:37137` conectado | Verificado: `1.8.38` |
| Barra | `onca-barra` | `100.90.102.41:44965` conectado | Verificado: `1.8.38` |
| Cocina | `onca-cocina` | Equipo fuera de línea | No documentado |
| Mesero | `onca-mesero` | `100.125.102.97:42845` conectado | Verificado: `1.8.38` |

El endpoint de Cocina se registró como `100.125.137.36:33745` a partir del
puerto local `192.168.1.200:33745`. El servicio intentará conectarlo cuando el
equipo regrese a Tailscale.

No se incluye `test-umi-a11` porque su nombre no empieza con `onca-`.

## Verificación de Caja

ADB leyó los siguientes valores en la iMin:

- Modelo `D3`, Android 11.
- Paquete `de.hohnepeople.keepadb`, versión `1.8.38`.
- `WRITE_SECURE_SETTINGS` concedido.
- `adb_wifi_enabled=1`.
- **Mantener siempre activo** habilitado.
- Webhook habilitado con
  `http://100.109.51.39:47123/keepadb`.
- Último informe correcto: `192.168.0.10:37137`.
- Tailscale y KeepADB excluidos del ahorro de batería.
- `always_on_vpn_app=com.tailscale.ipn`.
- Wi-Fi `UmiPOS`.

## Verificación de Barra

ADB leyó los siguientes valores en la A9+:

- Modelo `SM-X210`.
- KeepADB `1.8.38` con ambos permisos.
- **Mantener siempre activo** habilitado.
- Webhook habilitado con `http://100.109.51.39:47123/keepadb`.
- Último informe correcto: `192.168.0.101:44965`.
- Tailscale y KeepADB excluidos del ahorro de batería.
- `always_on_vpn_app=com.tailscale.ipn`.
- Wi-Fi `UmiPOS`.

## Verificación de Mesero

ADB leyó los siguientes valores en el equipo:

- Paquete `de.hohnepeople.keepadb`, versión `1.8.38`.
- `WRITE_SECURE_SETTINGS` concedido.
- `POST_NOTIFICATIONS` concedido.
- `adb_wifi_enabled=1`.
- Servicio en primer plano activo.
- Notificación con `Puerto 42845 @ 192.168.0.100`.
- Tailscale y KeepADB excluidos del ahorro de batería.
- `always_on_vpn_app=com.tailscale.ipn`.

La notificación es del servicio de KeepADB. También se recibió el webhook real
del equipo en esta estación. El receptor actualizó el endpoint a `42845` y
ADB quedó conectado.

## Automatización

[`scripts/onca-keepadb-provision.sh`](../../scripts/onca-keepadb-provision.sh)
prepara un equipo cuando ADB está disponible:

1. instala o actualiza KeepADB;
2. concede los permisos necesarios;
3. excluye KeepADB del ahorro de energía;
4. activa la depuración inalámbrica;
5. abre KeepADB.

El servicio de esta computadora también ejecuta esa preparación cuando aparece
un endpoint ADB nuevo. Sigue intentando los endpoints registrados cada 15
segundos. No bloquea la revisión de equipos conectados cuando otro nodo de
Tailscale está fuera de línea.

## Configuración que requiere confirmación en cada equipo

Android exige una vinculación por equipo. Después de emparejar una tablet, la
persona debe abrir **Depuración inalámbrica** y elegir **Permitir siempre en
esta red** para `UmiPOS`. Esto permite que Android reactive la depuración al
volver a esa red.

En KeepADB se deben confirmar dos opciones:

- **Mantener siempre activo**;
- webhook `http://100.109.51.39:47123/keepadb`.

KeepADB conserva la depuración activa después de reinicios y cambios de red.
No evita un emparejamiento eliminado ni la confirmación de seguridad de Android.

## Acción pendiente

Cocina está fuera de línea. El mismo procedimiento se aplicará cuando regrese.
Su puerto local y su IP de Tailscale ya están registrados.

## Prueba de reconexión

Después de configurar los tres equipos, ADB se desconectó de forma manual.
Barra volvió a conectar en el siguiente intento. Caja necesitó dos intentos
mientras Android reabría el puerto y volvió a conectar sin intervención.
