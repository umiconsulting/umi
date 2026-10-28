# Brief de imágenes: Kalala Café para Umi Cash

Fecha: 2026-10-24. Estado: referencias verificadas y prompts listos. Generación pendiente en Gemini.

## Actualización 15:45

Llegó una foto real del mostrador de El Gran Ribera, con una empleada real. Eso reabre la escena del mostrador para Ribera. El plan final queda así:

- **Ribera** para el momento en el mostrador. Ver [2026-10-24-ribera-scan-brief.md](2026-10-24-ribera-scan-brief.md).
- **Kalala** para el detalle del pase y la terraza. Este documento.

La conclusión anterior —no inventar un escaneo en Kalala— sigue vigente. Kalala no tiene una foto cercana del mostrador con personal. Ribera sí la tiene ahora.

## Decisión

Usar **Kalala Café, sucursal Chapultepec**, para las imágenes de Umi Cash. No representar un escaneo con personal inventado.

La razón es una limitación de las fuentes públicas. Kalala tiene fachada e interior reales, pero no una foto cercana del mostrador con una persona atendiendo. Las tomas disponibles son:

- La fachada real, en [Google Maps](https://www.google.com/maps/place/?q=place_id:ChIJpWoxlw3bvIYR8GI0bpK8mJk). Foto de Julian Herrera, julio de 2023.
- El interior y la barra, en la misma ficha de Maps. Es un fotograma de un video de 10 segundos, tomado desde una mesa. La barra queda al fondo y el fotograma tiene controles de reproducción.
- El interior de **Plaza Congreso**, en el [Instagram oficial](https://www.instagram.com/kalalacafe/reel/DeNb9G-gsY1/). Es otra sucursal y la toma es abierta.
- La captura real del pase de Kalala y una versión demo saneada.

Por eso, la escena de “alguien escanea el pase en el mostrador” obliga a inventar el mostrador y al empleado. Ese fue el fallo de la imagen de El Gran Ribera. La decisión editorial es no repetirlo.

Si el cliente envía una foto propia del mostrador y del personal, se rehace la escena con esa base. Mientras no exista, se usan las dos imágenes sin caras de este brief.

## Lo que no se debe hacer

- No inventar al empleado, la caja, el lector ni un uniforme.
- No publicar el QR real del pase. Usar el pase demo.
- No mezclar Chapultepec con Plaza Congreso.
- No poner el ventanal floral detrás de la pantalla del teléfono. Compite con el pase.
- No sustituir la tarjeta gráfica de El Gran Ribera sin decidir antes qué pasa con esa marca.

## Set de referencias

| Archivo                             | Fuente                                | Uso                                                                                                   |
| ----------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `01-kalala-barra-chapultepec.jpg`   | Fotograma de Maps, septiembre de 2023 | Materiales de la barra: azulejo rojo y blanco, lámparas de fibra, máquina de espresso, bóveda blanca. |
| `02-kalala-fachada-chapultepec.jpg` | Maps, julio de 2023                   | Identidad del local: arcos blancos, teja terracota, reja rosa, letras KALALA, flores.                 |
| `03-kalala-interior-congreso.jpg`   | Instagram, octubre de 2026            | Referencia alterna. No usar en la misma imagen que Chapultepec.                                       |
| `04-wallet-kalala-captura.jpg`      | Captura del cliente                   | Contexto del pase completo. No usar como pantalla final.                                              |
| `05-wallet-kalala-pase-demo.jpg`    | Captura del cliente, QR sustituido    | Pase exacto para la pantalla. QR de demostración.                                                     |
| `06-kalala-logo.png`                | Activo de la landing                  | Logotipo para composición posterior, no para la pantalla.                                             |

El QR del pase demo apunta a `https://umi.mx/demo/KLC-0001` y decodifica correctamente. No es un pase válido.

`01` y `03` tienen poca resolución: son un fotograma de 424 × 800 y una captura de 360 × 640. Sirven para composición, materiales y color. No sirven como archivo de publicación.

## Orden de adjuntos en Gemini

1. `01-kalala-barra-chapultepec.jpg`
2. `02-kalala-fachada-chapultepec.jpg`
3. `05-wallet-kalala-pase-demo.jpg`

No adjuntes la captura completa de Wallet. Tiene fondo negro, puntos de carrusel y el QR real.

## Prompt A: el pase en la barra

Imagen principal, vertical 4:5. Es la toma de detalle.

> Usa la Imagen 1 como la barra real de Kalala Café Chapultepec y la Imagen 3 como el pase exacto. La Imagen 2 solo confirma la identidad del local.
>
> Reencuadra la Imagen 1 en vertical 4:5 y acerca el punto de vista a la barra, a la altura de una persona de pie. Conserva la bóveda blanca, el azulejo rojo y blanco, la barra de piedra clara, las dos lámparas de fibra y la máquina de espresso. Elimina al personal, el maniquí y los objetos sueltos.
>
> En primer plano, una mano derecha sostiene un iPhone 15 Pro a la altura del pecho. La pantalla mira a la cámara y tiene una inclinación de 10 grados. El teléfono ocupa el 45% del ancho. La pantalla muestra el pase de la Imagen 3 sin cambios: verde bosque, franja rosa, oso con anteojos, nueve sellos, “KALALA CAFÉ”, “IN FREE COFFEE WE TRUST”, “SALDO $50.00”, “VISITAS FALTANTES 9 visitas”, “RECOMPENSA Bebida gratis”, QR y “KLC-DEMO-0001”. No redibujes el QR, el texto ni los sellos. Si no puedes conservarlos, deja la pantalla negra y limpia.
>
> Fondo desenfocado a f/2.8. La barra se reconoce, pero no compite. Luz natural de ventana, sombras suaves, blancos cálidos, verdes y rosas fieles. Aspecto de Fujifilm GFX100 II con GF55mm, fotografía editorial. Sin HDR, sin halos, sin superficies plásticas.
>
> Sin caras, sin clientes, sin empleados. Solo la mano y el teléfono. No pongas el ventanal floral detrás de la pantalla.

## Prompt B: el pase en la terraza

Imagen de contexto, horizontal 3:2 o vertical 4:5. Es la toma del lugar.

> Usa la Imagen 2 como la fachada real de Kalala Café Chapultepec. Conserva la geometría: muro blanco, arcos, teja terracota, reja rosa, piso de terracota, letras KALALA y ventanal con flores. No cambies la fachada ni inventes otro local.
>
> En primer plano, sobre una mesa de madera clara junto a la reja, coloca un iPhone 15 Pro apoyado a 20 grados y una taza de café de Kalala. La pantalla muestra el pase de la Imagen 3, exacto. El teléfono y la taza ocupan el tercio inferior. La fachada queda detrás, desenfocada a f/2.8.
>
> Luz de tarde lateral, sombras largas suaves, terracota cálida, flores rosas y naranjas fieles. Fujifilm GFX100S con GF45mm a f/4. Sin HDR. Sin personas, sin manos. No inventes texto en la taza. No pongas el QR real.

## Prompt C: el escaneo, solo como reconstrucción

No es una toma documental. Úsala solo si aceptas reconstruir el mostrador y las manos del personal. No la presentes como una foto real del equipo de Kalala.

> Usa la Imagen 1 como la barra real de Kalala Café Chapultepec. Reencuadra en horizontal 3:2 desde el lado del cliente, a 35 grados de la barra y a la altura de los ojos.
>
> Muestra el gesto completo: la mano del cliente sostiene el iPhone con el pase hacia la cámara trasera de un segundo iPhone que sostiene la persona que atiende, al otro lado de la barra. Solo se ven manos y antebrazos. Ninguna cara, ningún uniforme identificable. La cámara del equipo apunta al QR del pase. El empleado no mira su propio teléfono. La distancia entre los teléfonos es de 15 a 20 cm. La barra, el azulejo y las lámparas quedan como contexto.
>
> Luz natural lateral, contraste contenido, textura real. No inventes una caja, un lector, un uniforme ni una persona. Si no puedes conservar el pase, deja la pantalla del cliente limpia.

## Postproducción

1. Genera dos versiones de cada toma: una con el pase y otra con la pantalla negra.
2. Conserva la versión de pantalla negra. Compón el pase demo con perspectiva, brillo y reflejos.
3. Sustituye el QR por el QR demo. Nunca uses el código real.
4. Revisa el texto al 100%: “KALALA CAFÉ”, “SALDO $50.00”, “9 visitas”, “Bebida gratis”.
5. Exporta a 2x del tamaño CSS. Vertical 4:5: 1600 × 2000. Horizontal 3:2: 2400 × 1600. sRGB, JPEG calidad 85.

## Uso en la landing

La sección Cash usa dos tarjetas con logotipo y tira de sellos. Una foto dentro de esas tarjetas rompe su lenguaje gráfico.

- Usa la vertical 4:5 en un panel propio, junto al texto de Cash.
- Usa la horizontal 3:2 como banda de contexto antes o después de las tarjetas.
- Mantén las tarjetas de Kalala y El Gran Ribera como prueba de marca. La foto no reemplaza el logotipo.

## Verificación pendiente

- Aprobación del cliente para usar la imagen del local.
- Aprobación del texto y del pase demo.
- Revisión de la imagen final contra la captura del pase.
- Prueba de la imagen en la landing a 1440 px y a 390 px.

## Referencias

- [Investigación de referencias visuales](/home/juan/Projects/umiconsulting/umi/docs/research/2026-10-24-wallet-cafe-visual-references.md)
- [Instagram de Kalala Café](https://www.instagram.com/kalalacafe/)
- [Ficha de Maps de Kalala Chapultepec](https://www.google.com/maps/place/?q=place_id:ChIJpWoxlw3bvIYR8GI0bpK8mJk)
- [Nota de Luz Noticias sobre cafeterías de Culiacán](https://www.luznoticias.mx/2025-06-07/sinaloa/cafes-aesthetics-que-puedes-encontrar-en-culiacan-para-pasar-un-buen-rato/247588)
