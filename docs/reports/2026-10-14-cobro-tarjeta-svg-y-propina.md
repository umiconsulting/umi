# Cobro con tarjeta: SVG, propina y pago dividido

Fecha: 2026-10-14. Entorno: ONCA local. Build actual: `0.1.0+109`.

## Resultado

- La cara de cobro con tarjeta usa [un SVG local](../../apps/umi-pos/assets/icons/tap_to_pay.svg) con el lector, las ondas, una tarjeta rectangular y la mano que la sostiene. El dibujo conserva su proporción en un área de 104 × 78 píxeles.
- La propina personalizada usa el teclado numérico del POS también con tarjeta. El total, el importe de la terminal y el botón Cobrar incluyen la propina. La prueba real pasó de MXN 90.00 a MXN 99.00 al introducir 10 %.
- El pago dividido acepta importes distintos. Al editar una parte, la otra toma el resto. El efectivo recibido conserva el valor que indicó el operador.
- La terminal manual muestra sólo el estado «Procesando fuera del POS». Cobrar abre un aviso final con el importe. Cerrar ese aviso deja la cuenta abierta.
- Se retiró la elección de destino del recibo en esta pantalla. La vista previa usa el destino `display`.

## Herramientas y decisión de diseño

`flutter_svg` 2.3.0 muestra el archivo SVG sin convertirlo en un mapa de bits. [Su documentación oficial](https://pub.dev/packages/flutter_svg) recomienda `SvgPicture.asset` para archivos locales. Se eligió frente a [`vector_graphics` 1.2.3](https://pub.dev/packages/vector_graphics), que requiere compilar el archivo a otro formato. Un solo icono no justifica ese paso adicional. Flutter 3.47.5 hizo el build y las pruebas. `rsvg-convert` 2.62.4 validó el SVG fuera de Flutter. ADB 1.0.41 tomó las capturas y verificó las instalaciones.

Las curvas del SVG se trazaron a partir de la imagen entregada. La imagen mide 126 × 110 píxeles. [Inkscape documenta](https://inkscape.org/es/learn/faq/) el trazado manual con Bézier y el trazado automático. Elegí curvas Bézier manuales porque el trazo automático de esta referencia pequeña conserva el desenfoque de sus bordes. ImageMagick 7.1.2-32 amplió la zona de la mano para ubicar la tarjeta, el pulgar y dos dedos doblados. [`rsvg-convert` 2.62.4](https://gnome.pages.gitlab.gnome.org/librsvg/devel-docs/product.html) renderizó cada ajuste a 104 × 78 y a seis veces ese tamaño. `xmllint` de libxml 2.15.4 validó el XML. El archivo usa trazos, fondo transparente y el color del tema. La primera versión del dibujo se estiró en la iMin; la captura permitió detectar el error y fijar su tamaño.

El build 108 corrigió otra diferencia con la referencia: el build 107 dibujaba un dedo alargado, sin tarjeta ni dedos debajo. Separé el contorno de la tarjeta del pulgar para evitar un cruce oscuro. La [referencia recibida](evidence/2026-10-14-cobro-tarjeta-svg/referencia-del-dueno.png), el [build 107](evidence/2026-10-14-cobro-tarjeta-svg/imin-icono-svg.png) y el [detalle del build 108](evidence/2026-10-14-cobro-tarjeta-svg/imin-108-mano-detalle.png) permiten comparar la forma.

El build 109 corrigió el lector ovalado. Sustituí la curva libre por un arco SVG `A31 31`: sus radios horizontal y vertical son iguales. [La especificación SVG 2 del W3C](https://www.w3.org/TR/SVG2/paths.html) define ese comando y sus dos radios. Conservé la abertura junto a la tarjeta. La [captura del build 108](evidence/2026-10-14-cobro-tarjeta-svg/imin-108-mano-detalle.png) y la [captura del build 109](evidence/2026-10-14-cobro-tarjeta-svg/imin-109-circulo-detalle.png) muestran la corrección al mismo aumento.

## Verificación

- `flutter analyze --no-pub`: sin hallazgos.
- `flutter test --no-pub test/checkout_test.dart`: 38 pruebas verdes. Cambiaron las premisas del teclado de propina, la división en partes iguales y la confirmación de terminal manual.
- `flutter test --no-pub --reporter compact`: 948 pruebas verdes.
- `flutter build apk --profile ... --build-number 107`: completó la primera versión. El build 108 incorporó el ajuste de la mano. ADB 1.0.41 confirmó `versionCode=108` en la iMin, la A9 y la A11.
- La iMin mostró el [dibujo aplastado antes](evidence/2026-10-14-cobro-tarjeta-svg/imin-icono-aplastado.png) y el [SVG del build 107](evidence/2026-10-14-cobro-tarjeta-svg/imin-icono-svg.png). También mostró el [teclado de propina](evidence/2026-10-14-cobro-tarjeta-svg/imin-propina-teclado.png), el [importe de MXN 99.00](evidence/2026-10-14-cobro-tarjeta-svg/imin-propina-importe.png), la [confirmación del cargo](evidence/2026-10-14-cobro-tarjeta-svg/imin-confirmacion-cargo.png) y la [Cuenta 182 abierta tras cerrar el aviso](evidence/2026-10-14-cobro-tarjeta-svg/imin-cuenta-sigue-abierta.png).
- En el build 108, `flutter analyze --no-pub` quedó sin hallazgos. Pasaron 38 pruebas de `checkout_test.dart` y las 948 pruebas del POS. `rsvg-convert` y `xmllint` procesaron el SVG sin errores. La [captura completa de la iMin](evidence/2026-10-14-cobro-tarjeta-svg/imin-108-mano-tarjeta.png) muestra la tarjeta y la mano en el cobro real de la Cuenta 182.
- En el build 109, `flutter analyze --no-pub` volvió a quedar sin hallazgos. Pasaron las 38 pruebas de `checkout_test.dart` y las 948 pruebas del POS. ADB confirmó la instalación del APK en las tres terminales. La [captura completa de la iMin](evidence/2026-10-14-cobro-tarjeta-svg/imin-109-circulo-perfecto.png) muestra el arco circular en el cobro de la Cuenta 182.

La API local estaba detenida al iniciar la primera prueba del build 109. El log de Android registró `apiUnavailable`. Se reinició `pnpm dev`, se abrió otra vez la app y se tomó la captura del cobro. Esta caída no se atribuye al SVG; no se modificó la API.

No se ejecutó un cargo en una terminal bancaria. Tampoco se cerró una venta ni se verificó un pago dividido real con dos medios. La A9 y la A11 sólo recibieron el build; no se recorrió el cobro en sus pantallas.

## Siguiente brecha operativa

Antes de usar transferencias reales, ONCA debe sustituir los datos bancarios DEMO y definir quién confirma el abono. La fila local de `merchant.pos_checkout_policy` aún dice `ONCA DEMO - NO TRANSFERIR`, `BANCO DE PRUEBA - NO TRANSFERIR` y CLABE `000000000000000000`; `merchant.pos_tender_fact` tiene cero pagos de tipo `bank_transfer`. La consulta de lectura fue:

```sh
docker exec umi-bv3-pg psql -U postgres -d umi_local -Atc "select bank_transfer_enabled, bank_transfer_holder_name, bank_transfer_bank_name, bank_transfer_clabe from merchant.pos_checkout_policy where location_id='54be4d9e-fa0a-4a42-b95f-402acfccade6'; select count(*) from merchant.pos_tender_fact where tender_type='bank_transfer';"
```

El endpoint local `/health` respondió HTTP 503: la base y Redis están activos, pero `schema.current` es `null`. Ese estado requiere diagnóstico antes de interpretar la señal de salud como prueba de disponibilidad. No se modificó la API ni la base en este trabajo.
