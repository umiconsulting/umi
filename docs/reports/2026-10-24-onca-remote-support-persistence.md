# Persistencia del soporte remoto de ONCA

Fecha local: 24 de octubre de 2026

## Objetivo

Evitar que las tablets de ONCA pierdan el acceso de soporte cuando se reinician,
cambian de red o Android renueva el puerto de depuración inalámbrica. Tailscale
proporciona el transporte; KeepADB conserva activa la depuración inalámbrica y
publica el puerto nuevo a esta computadora.

## Dispositivos y accesos

| Dispositivo | Modelo | IP de Tailscale | ADB observado |
| --- | --- | --- | --- |
| Caja principal | iMin D3 | `100.64.178.95` | `5555` fijo |
| Barra | Samsung Galaxy Tab A9+ | `100.90.102.41` | Dinámico; `44917` después del reinicio de prueba |
| Mesero | Samsung Galaxy Tab A11 | `100.125.102.97` | Dinámico; `35893` al momento de la configuración |
| Cocina | Galaxy Tab A9+ | `100.125.137.36` | Sin conexión; configuración pendiente |
| A11 de pruebas | Galaxy Tab A11 | `100.107.181.80` | Sin conexión; no se modificó |

Las direcciones `192.168.0.x` que muestran las tablets pertenecen a la red Wi-Fi
de ONCA y no son alcanzables desde esta computadora. El soporte remoto debe usar
las IP `100.x` de Tailscale.

## Configuración aplicada

### Caja principal

- Tailscale está designado como VPN siempre activa.
- Tailscale quedó fuera de la optimización de batería y con ejecución en segundo
  plano permitida.
- ADB continúa en el puerto fijo `5555`.

### Barra y Mesero

- Tailscale está designado como VPN siempre activa.
- Tailscale y KeepADB están excluidos de la optimización de batería.
- KeepADB `1.8.38` tiene `WRITE_SECURE_SETTINGS` y permiso de notificaciones.
- `Mantener siempre activo` está habilitado y usa la política de todas las redes
  Wi-Fi, sin restricción por red de confianza.
- La depuración inalámbrica permanece habilitada.
- El webhook privado apunta a
  `http://100.109.51.39:47123/keepadb`, accesible únicamente por Tailscale.

### Estación de soporte

- Servicio de usuario `onca-adb-register.service`, habilitado al arranque y con
  `linger` activo.
- Implementación: `/home/juan/.local/bin/onca-adb-register.py`
- Estado persistente: `/home/juan/.local/state/onca-adb-endpoints.json`
- El receptor escucha sólo en `100.109.51.39:47123`.
- El firewall permite el puerto TCP `47123` únicamente desde
  `100.64.0.0/10`, el rango privado de Tailscale.
- Cuando KeepADB informa un puerto nuevo, el receptor ejecuta
  `adb connect <IP-Tailscale>:<puerto>` y reintenta si la tablet no está lista.

## Prueba de persistencia

El 24 de octubre a las 17:20 se reinició la tablet de Barra de forma remota.

1. Tailscale regresó sin intervención manual.
2. Android cambió el puerto ADB de `41827` a `44917`.
3. KeepADB publicó el endpoint nuevo a las 17:21:42.
4. El receptor conectó ADB automáticamente en 197 ms y la tablet volvió a quedar
   disponible para soporte.
5. `always_on_vpn_app`, la depuración inalámbrica, KeepADB y el webhook
   conservaron su configuración después del reinicio.

El puerto ADB es dinámico por diseño de Android. No se intenta fijar ese puerto:
el flujo persistente es Tailscale más el anuncio y reconexión automática del
puerto vigente.

Como prueba adicional, a las 17:28 se ejecutó `adb disconnect` contra Barra. El
servicio detectó la ausencia en la siguiente revisión y restableció ADB por el
mismo endpoint en 239 ms.

El reinicio también llevó a UmiPOS a la pantalla normal de PIN de operador. La
conexión de soporte siguió disponible, pero la sesión del operador debe
autenticarse de nuevo; Tailscale y ADB no eluden el PIN.

## Operación

Comprobar el receptor:

```bash
curl -fsS http://100.109.51.39:47123/health
systemctl --user status onca-adb-register.service
journalctl --user -u onca-adb-register.service -n 50 --no-pager
```

Comprobar dispositivos:

```bash
tailscale status
adb devices -l
```

## Pendientes

- Configurar KeepADB y el webhook en Cocina cuando la tablet vuelva a estar en
  línea.
- La A11 de pruebas está fuera de línea; se puede aplicar el mismo procedimiento
  antes de volver a usarla para validación.
- El puerto de Mesero es válido para la sesión actual; si se reinicia, KeepADB
  debe anunciar y conectar el puerto nuevo sin que soporte intervenga.
