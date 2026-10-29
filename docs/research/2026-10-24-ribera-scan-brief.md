# Brief: completar la foto de El Gran Ribera

Fecha: 2026-10-24. Estado: foto real recibida. Un prompt principal. Generación pendiente en Gemini.

## Activo

La foto `01-ribera-mostrador-real.jpg` es una toma real del mostrador de El Gran Ribera. Mide 1179 × 1484 px y tiene formato vertical 4:5.

La foto muestra la barra de madera, el mosaico gris, la vitrina de pasteles, la caja registradora, las lámparas colgantes y una empleada real de perfil, con camiseta negra, delantal marrón y un tatuaje en el antebrazo.

No muestra un cliente, un teléfono ni la acción de escaneo. Esa parte se completa con IA.

## Decisión

Usar la foto como base y completarla. No regenerar el local ni cambiar a la empleada.

El prompt sigue la línea del prompt de Ribera de la conversación del 24 de octubre:

- La foto original manda sobre el lugar y las personas.
- El pase es la única referencia exacta de la pantalla.
- La luz y la textura deben parecer las de la foto, no las de un estudio.
- No se inventa mostrador, personal, caja ni lector.

## Base académica

La literatura reciente es consistente: los editores actuales siguen bien las instrucciones y producen imágenes plausibles, pero fallan en consistencia, identidad, manos y texto pequeño.

| Tema              | Fuente                                                                                                                                                                                | Dato                                                                                                                                                    | Lectura                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Edición difícil   | [TECCI](https://google-deepmind.github.io/tecci/)                                                                                                                                     | Ningún modelo supera el 22% de éxito global. La consistencia de imagen queda en 30-44%.                                                                 | El caso de Ribera es difícil: arquitectura, manos, identidad y texto.      |
| Identidad         | [Persistent Identity Preservation](https://arxiv.org/abs/2609.04151)                                                                                                                  | Nano Banana 2 baja de 0.65 a 0.50 tras cuatro ediciones. Con caras pequeñas baja de 0.70 a 0.49. Los cambios de pose de cabeza son el caso más difícil. | Girar la cabeza de la empleada es el punto más frágil.                     |
| Manos             | [HandRefiner](https://arxiv.org/abs/2311.17957)                                                                                                                                       | Los modelos de difusión generan dedos de más o formas irregulares.                                                                                      | La mano del cliente y el cambio de la taza a teléfono necesitan revisión.  |
| Texto             | [LexiAlign](https://doi.org/10.1007/s00371-025-04345-2)                                                                                                                               | Un método especializado llega a 88.4% de OCR en un benchmark sintético.                                                                                 | El texto pequeño del pase no es fiable.                                    |
| QR                | [DiffQRCoder](https://openaccess.thecvf.com/content/WACV2025/html/Liao_DiffQRCoder_Diffusion-Based_Aesthetic_QR_Code_Generation_with_Scanning_Robustness_Guided_WACV_2025_paper.html) | Un QR generado por difusión puede quedar en 60% de lectura. Un método especializado sube a 99%.                                                         | No generar el QR. Componerlo.                                              |
| Detección humana  | [As Good as a Coin Toss](https://dl.acm.org/doi/10.1145/3729417)                                                                                                                      | La detección media ronda el 50%, cerca del azar.                                                                                                        | Que no se note no significa que la imagen sea correcta.                    |
| Edición general   | [GEdit-Bench, reportado en ReasonEdit](https://openaccess.thecvf.com/content/CVPR2026/papers/Yin_ReasonEdit_Towards_Reasoning-Enhanced_Image_Editing_Models_CVPR_2026_paper.pdf)      | Gemini 2.5 Flash ronda 8/10 en consistencia semántica y calidad perceptual.                                                                             | El modelo es bueno para ediciones fáciles. El problema es la consistencia. |
| Fidelidad 2026    | [Nano Banana Pro, 14 tareas y 40 datasets](https://arxiv.org/abs/2512.15110)                                                                                                          | Mejor calidad subjetiva, pero pierde en métricas de referencia y alucina detalles plausibles.                                                           | El problema no es que se vea mal; es que no es fiel.                       |
| Restauración 2026 | [Nano Banana 2 en restauración](https://arxiv.org/abs/2604.03061)                                                                                                                     | Los prompts concisos con restricciones de fidelidad funcionan mejor. Hay brecha entre calidad perceptual y fidelidad.                                   | Exigir fidelidad, no belleza.                                              |
| Razonamiento 2026 | [GRADE](https://arxiv.org/abs/2603.12264)                                                                                                                                             | 20 modelos; el mejor logra 46.2% global.                                                                                                                | Incluso el estado del arte falla en ediciones difíciles.                   |

Las filas de manos y QR son de 2024-2025. Los papers de 2026 siguen tratando la anatomía de las manos, el OCR y la escaneabilidad como problemas abiertos.

Conclusión para esta foto: la escena, la luz y el relleno se pueden completar con buena calidad. El riesgo está en la identidad de la empleada y en las manos. El pase y el QR se componen en postproducción.

## Lo que se debe conservar

- El encuadre vertical, la perspectiva y el aspecto de cámara de teléfono.
- La barra, el mosaico, la vitrina, la caja, los estantes y las lámparas.
- La cara, el pelo, la ropa, el delantal, el tatuaje y la postura de la empleada.
- La luz cálida de las lámparas y la luz fría de la ventana.

## Lo que no se debe hacer

- No inventar otro mostrador, otra caja, otro lector ni otro personal.
- No cambiar la identidad de la empleada.
- No publicar el QR real del pase.
- No poner un QR legible en la pantalla.
- No añadir texto, logotipos ni precios que no existan.
- No aplicar HDR, piel plástica ni luces de neón.

## Orden de adjuntos en Gemini

1. `01-ribera-mostrador-real.jpg`
2. `02-ribera-pase-demo.jpg`

La segunda imagen es solo la referencia de color y diseño del pase. En la escena, la pantalla se ve en ángulo y no es legible.

## Referencias de perspectiva

El tablero `06-tablero-perspectiva.jpg` resume las tres composiciones que sí se usan en fotografía de producto:

1. `03-ref-perspectiva-cliente-presenta.jpg`: el cliente presenta el teléfono a la altura del pecho. La cámara está sobre su hombro y la barista queda al otro lado.
2. `04-ref-perspectiva-escaner-lado.jpg`: el escáner llega desde el lado, en diagonal. El teléfono del cliente está horizontal y visible.
3. `05-ref-perspectiva-manos.jpg`: close-up de manos y pantalla. La cámara ve el QR de tres cuartos.

La corrección: el teléfono del cliente no va apoyado en la barra y el de la empleada no va directamente encima. Los dos teléfonos forman una diagonal. La cámara ve la pantalla de tres cuartos, no de canto.

Son fotos de stock con marca de agua. Sirven como referencia de composición, no como activo de la landing. No las adjuntes a Gemini; el prompt ya describe la geometría.

## Perspectiva elegida

La perspectiva es un **plano sobre el hombro, con el teléfono del cliente en primer plano**. No es un plano general del mostrador.

- El teléfono del cliente manda: nítido, grande, con la pantalla y el QR visibles de tres cuartos.
- El teléfono de la barista entra desde la izquierda, un poco más atrás, con la lente apuntando a la pantalla.
- La barista queda en el medio fondo, suave, con el brazo extendido. Su cara se reconoce, pero no compite.
- El café y la barra quedan desenfocados.

Es la perspectiva de `07-tablero-perspectiva-elegida.jpg`: el primer plano vende el pase; el medio fondo cuenta que alguien lo escanea.

## Prompt principal: completar la foto

> Completa la Imagen 1. No la reinterpretes ni la regeneres. Es una foto documental del mostrador real de El Gran Ribera. Conserva el encuadre vertical 4:5, la perspectiva de la cámara y el aspecto de cámara de teléfono. Conserva la arquitectura, la barra de madera, el mosaico, la vitrina, la caja registradora, las lámparas, los estantes y la luz. Conserva a la empleada: su cara, su pelo, su camiseta negra, su delantal, su tatuaje y su postura. No gires su cabeza, no cambies su expresión, no la embellezcas ni cambies su identidad.
>
> Añade la acción con la perspectiva de una foto editorial de producto. La cámara está sobre el hombro derecho del cliente, a la altura del pecho, inclinada 25 grados hacia abajo.
>
> En el primer plano, la mano derecha del cliente sostiene un iPhone 15 Pro en vertical, a la altura del pecho, por encima de la barra. La pantalla se inclina hacia arriba y hacia la barista; la cámara la ve de tres cuartos. El teléfono del cliente está nítido y ocupa el 40% del ancho. El antebrazo del cliente entra desde el borde inferior derecho, desenfocado; no muestres su cara.
>
> La barista está detrás de la barra, con el cuerpo a 1-1.5 m. Inclina apenas el torso y extiende el brazo derecho hacia el teléfono del cliente. Su iPhone entra desde la izquierda, justo por encima del teléfono del cliente. La cámara trasera de su iPhone apunta hacia abajo, directamente a la pantalla del cliente. La parte trasera de su teléfono mira a nuestra cámara; la pantalla de su teléfono no se ve. La lente queda a 10-15 cm de la pantalla. La barista mira la pantalla sin girar la cabeza.
>
> El foco está en el teléfono del cliente y en el pase. El teléfono de la barista queda un poco más suave; la barista, la barra, la vitrina y las lámparas quedan reconocibles pero desenfocadas, como en una foto editorial a f/2.8.
>
> La pantalla del cliente muestra el pase de la Imagen 2 con perspectiva, reflejos y un brillo suave que lo separe de la barra. El fondo terracota y la franja de sellos se reconocen; el texto y el QR no son legibles. No inventes una interfaz, un saldo ni un código. Si no puedes conservar el diseño, deja la pantalla limpia para composición posterior.
>
> Mantén la luz cálida de las lámparas y la fría de la ventana. No corrijas el balance de blancos. Tonos cálidos contenidos, textura fotográfica real, sin HDR, sin halos, sin piel plástica.
>
> Elimina el icono circular de silencio de la esquina inferior derecha. La canasta y la campana de vidrio quedan visibles. No añadas manos extra, dedos extra ni teléfonos extra. No inventes otro mostrador, otro personal, otra caja, otro lector, decoración ni logotipos. No añadas texto. No cambies el color del delantal, del mosaico ni de la madera. No cambies el encuadre ni la posición de la cámara. El resultado debe parecer la misma foto, completada un segundo después.

La literatura marca el giro de cabeza como el punto más frágil. Este prompt no lo pide: la empleada baja la mirada sin mover la cabeza. El gesto se lee por los dos teléfonos. Si aun así la cara cambia, hazlo en dos pasos: primero la mano del cliente; después el teléfono de la empleada.

## Si la identidad se rompe

Reduce la edición. Haz una pasada solo con la mano y el teléfono del cliente. En otra pasada, cambia solo la taza por el teléfono de la empleada. No toques la cabeza. Es preferible una acción menos explícita a una cara distinta.

## Postproducción

1. Pide dos versiones: una con el pase y otra con la pantalla negra.
2. Conserva la versión de pantalla negra. Compón el pase demo con perspectiva y brillo.
3. Usa el QR demo. Nunca el código real.
4. Revisa la cara de la empleada al 100%. Si cambió, descarta la imagen.
5. Exporta a 1600 × 2000 px, sRGB, JPEG calidad 85.

## Permisos y publicación

- La empleada es una persona real e identificable. El cliente debe autorizar el uso de su imagen.
- La foto es del cliente. Confirma que se puede publicar.
- Si no hay autorización, recorta a la empleada o usa la foto solo como referencia interna.
- No presentes la escena como una foto documental del escaneo. Es una composición editorial.

## Uso en la landing

- La vertical 4:5 funciona en un panel propio, junto al texto de Cash.
- El tono cálido de Ribera contrasta con el verde y rosa del pase de Kalala. Usa las dos imágenes como pareja: Ribera para el mostrador, Kalala para el detalle del pase.
- No pongas la foto dentro de las tarjetas de logotipo. Rompe el lenguaje gráfico de la sección.
