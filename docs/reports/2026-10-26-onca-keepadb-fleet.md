# KeepADB en la flota ONCA

Fecha inicial: 26 de octubre de 2026. Actualización: 27 de octubre de 2026

## Alcance

La flota de ONCA en Tailscale contiene cuatro equipos con nombre `onca-*`:

| Equipo         | Tailscale             | Estado actual de ADB             | KeepADB              |
| -------------- | --------------------- | -------------------------------- | -------------------- |
| Caja principal | `onca-caja-principal` | `100.64.178.95:43761` conectado  | Verificado: `1.8.38` |
| Barra          | `onca-barra`          | `100.90.102.41:44965` conectado  | Verificado: `1.8.38` |
| Cocina         | `onca-cocina`         | `100.125.137.36:35147` conectado | Verificado: `1.8.38` |
| Mesero         | `onca-mesero`         | `100.125.102.97:42845` conectado | Verificado: `1.8.38` |

Los puertos son dinámicos. La tabla muestra la última lectura del diagnóstico.
Caja sigue pendiente de recuperar ADB sin permiso local después de un reinicio.

No se incluye `test-umi-a11` porque su nombre no empieza con `onca-`.

## Verificación inicial de Caja, 26 de octubre

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

## Verificación inicial de Barra, 26 de octubre

ADB leyó los siguientes valores en la A9+:

- Modelo `SM-X210`.
- KeepADB `1.8.38` con ambos permisos.
- **Mantener siempre activo** habilitado.
- Webhook habilitado con `http://100.109.51.39:47123/keepadb`.
- Último informe correcto: `192.168.0.101:44965`.
- Tailscale y KeepADB excluidos del ahorro de batería.
- `always_on_vpn_app=com.tailscale.ipn`.
- Wi-Fi `UmiPOS`.

## Verificación inicial de Cocina, 26 de octubre

ADB leyó los siguientes valores en la segunda A9+:

- Modelo `SM-X210`.
- KeepADB `1.8.38` con ambos permisos.
- **Mantener siempre activo** habilitado.
- Webhook habilitado con `http://100.109.51.39:47123/keepadb`.
- Último informe correcto: `192.168.0.102:37123`.
- Tailscale y KeepADB excluidos del ahorro de batería.
- `always_on_vpn_app=com.tailscale.ipn`.
- Wi-Fi `UmiPOS-5G`.

## Verificación inicial de Mesero, 26 de octubre

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

## Integridad de la instalación

La revisión final encontró el mismo paquete activo en los cuatro equipos:

- nombre `de.hohnepeople.keepadb`;
- `versionCode=135`;
- versión `1.8.38`;
- misma firma de instalación;
- paquete habilitado;
- `KeepADBService` en primer plano;
- `WRITE_SECURE_SETTINGS` concedido.

Las cuatro conexiones ADB respondieron en la misma revisión. No quedaron
transportes duplicados ni equipos `onca-*` pendientes.

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
esta red** para la red `UmiPOS` actual. Esto permite que Android reactive la depuración al
volver a esa red.

En KeepADB se deben confirmar dos opciones:

- **Mantener siempre activo**;
- webhook `http://100.109.51.39:47123/keepadb`.

KeepADB intenta recuperar la depuración si la orden guardada sigue encendida.
«Mantener siempre activo» no sustituye esa orden ni el permiso de Android.
La prueba de Caja muestra que la autorización puede solicitarse de nuevo al reiniciar.

## Prueba de reconexión del 26 de octubre

Después de configurar los cuatro equipos, ADB se desconectó de forma manual.
Barra volvió a conectar en el siguiente intento. Caja necesitó dos intentos
mientras Android reabría el puerto y volvió a conectar sin intervención.
Cocina volvió a conectar en el siguiente intento sobre `37123`.

## Verificación del 27 de octubre

El diagnóstico final terminó con código 0 en los cuatro equipos, con UmiPOS 333.
El receptor está habilitado y activo. El usuario juan tiene `Linger=yes`.
La VPN siempre activa y las excepciones de batería están correctas.

Una desconexión ADB se recuperó en 10.04 segundos.
Los dos reinicios de Caja agotaron 210 segundos sin ADB.
El primero omitió el arranque de KeepADB por `persisted_intent_off`.
La activación desde KeepADB corrigió esa orden guardada.
El segundo inició KeepADB, pero Android pidió otra vez el permiso de red.
El sistema registró `Expected keyStore, but got tag=null`.

El propietario aceptó el permiso. Caja publicó el puerto 43761 y ADB volvió.
El contador de arranques quedó en 6.
El propietario entró de nuevo a UmiPOS y se observó la pantalla principal.
La recuperación automática después de reiniciar Caja sigue pendiente.

En esta iMin D3 no aparece **Transmission Mode**.
No se aplicó un ajuste desconocido en su lugar.

Consulta el [incidente 007](./2026-10-27-onca-production-bug-007.md)
y el [análisis de fuentes](../research/2026-10-27-onca-keepadb-boot-recovery.md).
Evidencia: [doctor final](./evidence/2026-10-27-onca-support/doctor-final.json).

## Identidad del firmware y versión de aplicación

Caja informa firmware `1.0.3.4.23_230926` y dispositivo `rk3566_rgo`.
Su actualizador `com.neostra.update` tiene versión 5.28.
No se identificó una corrección oficial confirmada para la autorización ADB después de reiniciar.

La última build de producción identificada es 333.
Los cuatro APK instalados son idénticos al APK final por SHA-256.
La firma es la release esperada y ninguna instalación es depurable.
Evidencia: [identidad del APK](./evidence/2026-10-27-onca-support/latest-build-final.json).
