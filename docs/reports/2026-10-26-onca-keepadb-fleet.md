# KeepADB en la flota ONCA

Fecha local: 26 de octubre de 2026

## Alcance

La flota de ONCA en Tailscale contiene cuatro equipos con nombre `onca-*`:

| Equipo | Tailscale | Estado actual de ADB | KeepADB |
| --- | --- | --- | --- |
| Caja principal | `onca-caja-principal` | Puerto `5555` cerrado | No documentado |
| Barra | `onca-barra` | Ningún puerto actual acepta ADB | Instalado y configurado el 24 de octubre |
| Cocina | `onca-cocina` | Equipo fuera de línea | No documentado |
| Mesero | `onca-mesero` | `100.125.102.97:42845` conectado | Verificado: `1.8.38` |

No se incluye `test-umi-a11` porque su nombre no empieza con `onca-`.

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
segundos.

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

Barra y Caja están encendidas y responden a Tailscale. Sus puertos ADB están
cerrados. Hay que desbloquear ambas, abrir Depuración inalámbrica, permitir
siempre la red `UmiPOS` y proporcionar los nuevos puertos de vinculación.

Cocina está fuera de línea. El mismo procedimiento se aplicará cuando regrese.
