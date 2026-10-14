# N16: reconocer el producto y conservar la consulta

## Imágenes del fixture

**OV.** Americano muestra tres tazas, dos con dibujo de leche. Cheesecake muestra un pastel de chocolate. Las capturas de N15 conservan ambas discrepancias. Un título o un texto alternativo correcto no cambia el contenido de la fotografía.

La búsqueda llega a las páginas originales de los fotógrafos. Se inspeccionan los archivos de imagen, no sólo los títulos del buscador. La [primera foto de café](https://unsplash.com/photos/a-black-and-white-photo-of-a-coffee-cup-8GUEJrrwRKk), de Dmitry Vechorko, se publicó el 27 de septiembre de 2019. **OV.** La taza está tapada y muestra otra marca. Se descarta para esta tarea, aunque el autor menciona Americano.

La [foto de hoch3fotografie](https://unsplash.com/photos/white-ceramic-mug-with-black-coffee-4ixsP2VXDMY) se publicó el 17 de junio de 2020. **OV.** Muestra una taza abierta con café negro. La [foto de Dillon Lobo](https://unsplash.com/photos/a-slice-of-creamy-cheesecake-on-a-white-plate-Al7xJd9TUGc) se publicó el 8 de agosto de 2025. **OV.** Muestra una rebanada de cheesecake en un plato blanco.

**HD.** Las páginas identifican autor, fecha y licencia. La [licencia de Unsplash](https://unsplash.com/license) permite descarga y uso, incluido uso comercial, con las exclusiones descritas por su titular. Los [registros locales](N16-media-candidates/sources.json) conservan URL, fecha, tamaño, decisión y SHA-256. Los archivos originales descargados permiten repetir la inspección.

**I.** Estas fotos sirven como muestras reconocibles del fixture. No certifican la receta del comercio ni representan sus productos reales. La preparación exacta de la bebida no se puede deducir de su apariencia. La aplicación conserva el nombre y el precio como referencias principales.

La [actualización](N16-media-update.json) cambia exactamente dos filas de `merchant.product_media`. Usa una transacción con base, comercio, UUID del producto y URL anterior comprobados. El [SQL equivalente](N16-media-fixture.sql) documenta las condiciones. Otro producto llamado Americano queda fuera por su UUID. La corrección del fixture no añade reglas de negocio ni modifica datos de producción.

## Consulta de Ventas

**OV.** Ventas conserva sus controles al cambiar de ancho en N15, pero los recrea al salir hacia Caja. La consulta vuelve a su valor inicial. La prueba de N16 comprueba filtro, búsqueda y orden después de salir y regresar.

**Decisión con fundamento.** Ventas conserva su superficie después de la primera visita. `Offstage`, `ExcludeFocus` y `TickerMode` mantienen estado, excluyen foco oculto y detienen animaciones ocultas. La [documentación de Offstage](https://api.flutter.dev/flutter/widgets/Offstage-class.html) explica por qué conservar el estado exige controlar también foco y animación.

La superficie recibe una propiedad de actividad. Al regresar, actualiza el historial con su filtro, búsqueda y orden conservados. El controlador sigue como propietario de los resultados y de las acciones comerciales. El formulario conserva sólo su estado de presentación. La prueba usa el repositorio para comprobar los parámetros de la nueva consulta.

La corrección no demuestra todavía la respuesta ante cambios rápidos de filtro durante una solicitud pendiente. Esa condición requiere una tarea aparte. Tampoco demuestra conservación tras cerrar la sesión del operador: esa sesión debe descartar su contexto.

**OV, G56.** La búsqueda `croissant` conserva sus controles, pero devuelve una vista vacía. El [registro de lectura](N16-sales-search-gap.json) confirma una venta suspendida con producto Croissant y sin nombre asignado. La interfaz usa el producto como título. La consulta de la API omite el nombre de producto. Esta brecha conserva la nota de N15 y exige otra corrección.

## Relación con la investigación artística

El archivo de Garcin y la rama Carecore conservan el marco crítico anterior. **I.** La identidad debe acompañar el reconocimiento. Una fotografía atractiva de otro alimento rompe esa relación. La corrección cambia la muestra; la estructura conserva los dibujos propios, las proporciones de la carta y los colores UMI.

La lectura artística orienta el criterio. La prueba, la consulta y la captura nativas prueban el comportamiento observado. El número de pruebas no mide belleza ni facilidad de uso por sí solo.
