# Primer pago dividido en un solo toque — 22 October 2026

## Resultado

El primer pago de una cuenta dividida ya termina con un solo toque en
`Cobrar`. La app no abre el aviso `Iniciar cobro dividido` y no pide pulsar
`Continuar`.

La prueba real usó la Cuenta 032 en la iMin:

1. Consumo total: MXN 80.00.
2. Primera persona: MXN 40.00 en efectivo.
3. Después de un toque, la pantalla mostró `Pagado MXN 40.00` y
   `Falta MXN 40.00`.
4. La segunda persona pagó MXN 40.00 en efectivo.
5. El botón `Cerrar cuenta` completó la venta.

El servidor registró dos pagos parciales y ninguno rechazó la operación.

## Defecto de cuenta cerrada

La pantalla anterior pertenecía a la Cuenta 031. La cuenta ya estaba cancelada
desde otra pantalla. La app vieja mostró un botón de cobro válido y el API
respondió `409 OPTIMISTIC_VERSION_CONFLICT`.

El build nuevo trata `RESOURCE_NOT_FOUND` como una cuenta cerrada. La pantalla
muestra el motivo arriba del contenido y no ofrece el botón de cobro. Este
cambio conserva la regla de no aceptar dinero sobre una cuenta que ya no
existe.

## Invariantes

- El estado financiero sigue en el servidor.
- El primer pago usa una sola identidad idempotente.
- Un doble toque no crea un segundo abono.
- Un fallo de red conserva el comando para reintentar el mismo pago.
- Una cuenta cerrada no acepta un cobro nuevo.
- El cierre guarda el monto recibido y el cambio en el pago parcial.

## Verificación

| Check | Result | Evidence |
| --- | --- | --- |
| Primer abono, un toque | pass | screenshots below |
| Primer POST parcial | `201`, 1054 ms | API log |
| Segundo POST parcial | `201`, 1136 ms | API log |
| Cierre de cuenta | `201`, 683 ms | API log |
| Cart state | `committed`, version 3 | production DB |
| Partial payments | two rows, MXN 40.00 each | production DB |
| Flutter suite | 1,143 passed | local run |
| Flutter analyze | no issues | local run |
| API suite | 2,087 passed, 29 skipped | local run |
| API typecheck and lint | pass | local run |

Evidence:

- [Before the first payment](evidence/2026-10-22-split-first-payment/00-before-first-payment-build322.png)
- [After one tap](evidence/2026-10-22-split-first-payment/01-after-first-payment-one-tap-build322.png)
- [Balance complete](evidence/2026-10-22-split-first-payment/02-balance-complete-build322.png)
- [Old canceled-account screen](evidence/2026-10-22-split-first-payment/03-stale-cancelled-account-build321.png)

## Artifact and device state

- APK: `apps/umi-pos/build/app/outputs/flutter-apk/app-production-profile.apk`
- Build: `1.0.0` (`322`)
- SHA-256:
  `91163d9164217be34aa0bd06bc20e0e6c7b25e3db22f454ec9f836de55536eed`
- Signer:
  `8146b847a358a9cd54eddecbe8921a998287d3f59e1e52bdca5e121d21da3346`
- iMin D3: build 322 installed and online as Admin ONCA.
- Galaxy Tab A9: build 322 installed and showing the KDS.
- Galaxy Tab A11: build 322 installed and showing the catalogue.
- API production: `f0908e1`, healthy.

## Remaining risk

The closed-account state has widget coverage. The old production account was
not cancelled again for a second destructive device test. The new build shows
the closed-account refusal before it permits a charge.
