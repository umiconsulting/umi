# Implementación de propina en cobro dividido

Fecha: 2026-10-21

## Resultado

La propina ahora se captura por cada pago parcial. El operador puede elegir
0 %, una opción de la política o un importe manual.

La pantalla muestra:

- La base sugerida después de descuentos y antes de impuestos.
- El importe exacto de cada porcentaje.
- La persona que recibe la propina.
- La igualdad `consumo + propina = cobro`.

La política del local decide si la propina pertenece al dueño de la cuenta o a
la persona que procesa el cobro.

## Persistencia

La migración
[`052_tip_attribution_for_split_payments.sql`](../migration/build-v3/migrations/052_tip_attribution_for_split_payments.sql)
agrega:

- `tip_attribution` a `merchant.pos_checkout_policy`.
- `service_operator_user_id` a `merchant.pos_partial_payment`.
- `processed_by_user_id` a `merchant.pos_partial_payment`.
- `tip_recipient_user_id` a `merchant.pos_partial_payment`.

Las filas históricas conservan sus columnas de empleado en `null`. La tabla
prohíbe cambiar un pago confirmado. Las filas nuevas guardan los tres actores.

## Contrato y configuración

- El contrato subió a `2.44.0`.
- `TipPolicy.attribution` acepta `account_owner` o `payment_processor`.
- El Dashboard permite cambiar la atribución en **Caja y turnos**.
- La opción predeterminada es el dueño de la cuenta.

## Pruebas

### Automáticas

- API completa: 2.077 pruebas pasaron; 29 integraciones se omitieron por
  configuración.
- Dashboard: 379 pruebas pasaron.
- POS, alcance modificado: 90 pruebas pasaron.
- Flutter analyze: sin hallazgos.
- Contrato generado: verificado.
- Migración: aplicada dos veces a la base local con datos.

La suite completa de Flutter ejecutó 1.121 pruebas y conserva tres fallos en
`order_entry_flow_test.dart`. Los fallos se reproducen fuera de los archivos de
esta implementación. El lint de la API conserva dos errores en
`pos-offline.service.ts` y su prueba.

### Flujo real en iMin D3

Se usó el paquete aislado `co.umiconsulting.umi_pos`.

- APK: `0.1.0+188`.
- SHA-256:
  `48f8b27d2ef6c92538224b2fb3ad76c4053ab19749746cc42ed134620e3d4d9c`.
- Consumo: MXN 50.00.
- Impuesto incluido: MXN 6.90.
- Base antes de impuestos: MXN 43.10.
- Propina del 10 %: MXN 4.31.
- Cargo: MXN 54.31.
- Pago: efectivo.
- Resultado: cuenta cerrada.

La fila creada guardó al mismo usuario como dueño de la cuenta, procesador y
destinatario. El carrito fue `d97fd131-2bc2-4d5a-9bb4-e1303f5625c9` y el tramo
`15455042-6860-4e56-9ff3-611f06452205`.

La captura está en
[`imin-final-tip-suggestion.png`](evidence/2026-10-21-tip-split-implementation/imin-final-tip-suggestion.png).

## Verificación en producción

El 2026-10-22 se activó la propina para ONCA en
`merchant.pos_checkout_policy`:

- opciones de 10 %, 15 % y 20 %;
- propina porcentual y de importe manual habilitadas;
- límite de propina de MXN 1,000;
- propina asignada al dueño de la cuenta.

En el build `321`, la iMin mostró simultáneamente la propina de este pago y el
efectivo recibido. Un consumo de MXN 50.00 con propina de 10 % produjo un cargo
de MXN 54.31. Al recibir MXN 100.00, la pantalla mostró un cambio de MXN 45.69
sin ocultar ninguna acción.

La captura está en
[`imin-tip-and-change-build321.png`](evidence/2026-10-21-tip-split-implementation/imin-tip-and-change-build321.png).

### Barrido del dispositivo

El barrido recorrió Comanda, Cuentas, KDS, Ventas, Caja y Ajustes.

- 48 controles seguros fueron pulsados.
- Cero cierres o reinicios inesperados.
- Cero excepciones de Flutter.
- Un control llamado `Actualizar` en KDS no cambió el contenido visible.
- Siete controles desaparecieron después de una acción previa. El instrumento
  no los contó como fallos.

El barrido encontró dos acciones de Caja con una altura táctil de 39 px. La
corrección se verificó en el build 188:

```text
Caja · 7 pressable · 0 under 48px · 0 unnamed
```

Los informes están en
[`device-inventory.md`](evidence/2026-10-21-tip-split-implementation/device-inventory.md),
[`device-clicks.md`](evidence/2026-10-21-tip-split-implementation/device-clicks.md)
y
[`cash-target-after-fix.md`](evidence/2026-10-21-tip-split-implementation/cash-target-after-fix.md).

## Estado de la terminal

El paquete original `co.umiconsulting.umi_pos.estacion` ya tenía el almacén
seguro roto antes de esta prueba. La prueba usó una instalación estándar
aislada. No se borraron los datos de ese paquete.

La verificación global de esquema no terminó porque la base local no tiene el
versionado de Gate 6A ni cuatro fixtures de seguridad. La migración propia sí
pasó dos veces.
