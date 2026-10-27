# Flota ONCA

## Inventario

| Equipo | Tailscale | Modelo | Función |
| --- | --- | --- | --- |
| Caja | `onca-caja-principal` / `100.64.178.95` | iMin D3 | UmiPOS |
| Barra | `onca-barra` / `100.90.102.41` | SM-X210 | UmiKDS |
| Cocina | `onca-cocina` / `100.125.137.36` | SM-X210 | UmiKDS |
| Mesero | `onca-mesero` / `100.125.102.97` | SM-X133 | UmiPOS |

No uses las direcciones `192.168.*` desde esta computadora. Usa Tailscale.
El puerto ADB es dinámico. No intentes fijarlo.

## Diagnóstico

```bash
python3 scripts/onca-support-doctor.py --expected-build 333
```

El diagnóstico revisa:

- identidad del host;
- Tailscale de los cuatro equipos;
- endpoint reportado por KeepADB;
- conexión ADB;
- modelo y versión de Android;
- versión de UmiPOS;
- `DEBUGGABLE`;
- VPN siempre activa;
- `adb_wifi_enabled`;
- KeepADBService;
- exclusión de Tailscale y KeepADB del ahorro de batería.

Usa `--repair` para reiniciar el receptor y ejecutar `adb connect` sobre
endpoints activos. Revisa el resultado; no supongas que reparó todos.

## Reconoce cuatro estados

| Estado | Significado | Acción |
| --- | --- | --- |
| Tailscale offline | La tablet no tiene red o está apagada | Pedir revisión física de energía y Wi-Fi |
| Tailscale online, ADB offline | Android o KeepADB cerró depuración | Abrir KeepADB y revisar configuración |
| ADB offline con endpoint activo | El puerto existe pero el transporte falló | `adb connect IP:PUERTO` y reiniciar el servicio |
| ADB conectado, app incorrecta | Transporte sano, binario incorrecto | Instalar la build y firma aprobadas |

## Recupera una iMin

La documentación de iMin indica que la depuración USB se cierra después de un
reinicio. Una pulsación corta sólo bloquea la pantalla. Una pulsación larga
presenta Apagar y Reiniciar.

Cuando alguien tenga acceso físico:

1. Despierta y desbloquea la iMin.
2. Abre `Settings > Battery` y activa **Transmission Mode**.
3. Abre **Depuración inalámbrica** y permite siempre la red `UmiPOS`.
4. Abre KeepADB.
5. Confirma **Mantener siempre activo**.
6. Confirma webhook `http://100.109.51.39:47123/keepadb`.
7. Confirma que Tailscale es la VPN siempre activa.
8. Vuelve a ejecutar el diagnóstico.

Si ADB aparece:

```bash
scripts/onca-keepadb-provision.sh 100.64.178.95:PUERTO
```

Después verifica:

```bash
adb -s 100.64.178.95:PUERTO shell settings get global adb_wifi_enabled
adb -s 100.64.178.95:PUERTO shell settings get secure always_on_vpn_app
adb -s 100.64.178.95:PUERTO shell settings get global boot_count
```

El último valor ayuda a confirmar si hubo un reinicio.

## Revisa versiones y firma

```bash
adb -s "$SERIAL" shell dumpsys package co.umiconsulting.umi_pos.estacion |
  grep -E 'versionCode=|versionName=|version:|DEBUGGABLE'
```

La versión mínima actual es `333`. El certificado de producción es:

```text
14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051
```

Antes de declarar una instalación correcta, verifica también que UmiPOS abra y
que el operador pueda entrar. La pantalla de PIN no demuestra un login válido.

## Evita falsos positivos

- Un punto verde de Tailscale no prueba que ADB esté activo.
- Un transporte ADB conectado no prueba que UmiPOS tenga la build correcta.
- Una app en pantalla de PIN no prueba que el operador pueda entrar.
- Una prueba unitaria no prueba el flujo real.
- Un pago aprobado en la terminal no prueba que exista una venta.
