# Plantillas e importación de inventario

## Alcance aprobado

El propietario descarga e importa artículos y recetas desde el dashboard en CSV y Excel (.xlsx).
La vista previa precede a la confirmación. Un resultado descargable identifica cada fila y receta.
El usuario pidió ambos formatos y autorizó continuar. La entrega amplía el PR 242, con base `staging`.
Los commits son atómicos. El PR permanece abierto para aprobación.

## Decisión

El dashboard interpreta el archivo y envía los comandos administrativos existentes.
El backend conserva los permisos, las transacciones, las versiones, la auditoría y la deduplicación.
No se crea una segunda ruta de escritura ni un servicio de importación.

Se consideraron tres opciones:

- Una pantalla sobre los comandos actuales: suficiente para lotes acotados; reutiliza las reglas existentes.
- Un endpoint de importación: útil para cargas mayores; duplicaría coordinación sin una necesidad actual.
- Trabajos asíncronos: permiten archivos grandes, pero requieren almacenamiento, seguimiento y operación adicionales.

Se elige la primera opción. Cada artículo y cada receta completa forman una escritura independiente.
Una receta inválida no guarda ingredientes parciales. Otras recetas válidas pueden guardarse después de confirmar.

## Archivo y plantillas

- Formatos: CSV UTF-8 y Excel .xlsx. No se aceptan .xls, .xlsm ni fórmulas.
- Máximo: 2 MiB por archivo, 500 filas de datos, 100 recetas y 200 ingredientes por receta.
- Los archivos se interpretan en un Web Worker con límite de 15 segundos y cancelación.
- Las cantidades usan punto decimal y hasta seis decimales. No se redondean ni se aceptan exponentes.
- Los códigos se conservan como texto. Los nombres nunca identifican registros.
- CSV admite coma o punto y coma, campos entre comillas, saltos de línea y BOM.
- Los encabezados desconocidos o repetidos y los archivos mal formados se rechazan con explicación.
- Las filas vacías se omiten. Los errores conservan el número de fila original.
- Excel contiene una hoja `Articulos` o `Recetas`, más `Guia`, `Ejemplos` y las referencias necesarias.
- La hoja de datos se entrega vacía. Los ejemplos nunca se importan automáticamente.
- CSV tiene encabezados vacíos de datos; la pantalla ofrece guía, ejemplos y referencias como descargas separadas.
- Las descargas de resultados neutralizan fórmulas en CSV; Excel escribe texto, nunca fórmulas.

### Artículos

Columnas obligatorias: `codigo,nombre,tipo,unidad,decimales`.
Columnas opcionales: `costo_unitario,existencia_minima,cantidad_preparacion,vida_util_dias`.
Los tipos y unidades tienen códigos estables documentados y etiquetas sencillas en la guía.
Se aceptan los códigos actuales del contrato para evitar otra clasificación.
Los valores opcionales vacíos conservan el valor existente. En registros nuevos equivalen a ausencia.
El costo admite cero y hasta dos decimales; se convierte exactamente a centavos.
Las cantidades opcionales usan la escala del artículo. Los días van de 0 a 3650.

La referencia `publicReference` identifica el artículo dentro del negocio.
Un código repetido en el archivo invalida todas sus filas, aunque sus valores coincidan.
Un artículo archivado produce un error. No se reactiva por importación.
Tipo, unidad y decimales de un artículo existente no pueden cambiar.
Los artículos nuevos usan `tracked` y `allow_and_flag`, como el registro manual actual.
Las actualizaciones conservan las políticas actuales. Los registros sin diferencias no generan comandos.
La importación no incluye saldos iniciales: las entradas requieren compras o ajustes con almacén explícito.

### Recetas

Columnas: `producto_id,variante_id,rendimiento,unidad_rendimiento,ingrediente_codigo,cantidad,unidad`.
Solo `variante_id` es opcional. Una fila representa un ingrediente.
`producto_id` y `variante_id` son referencias estables existentes, copiables desde la descarga de productos.
La descarga muestra nombres junto a los identificadores; el usuario no debe escribirlos de memoria.
El par producto/variante agrupa la receta. La variante debe pertenecer al producto.
Los ingredientes se resuelven por código del artículo activo del mismo negocio.
Un ingrediente repetido, un rendimiento incoherente o cualquier fila inválida rechaza el grupo completo.
El archivo representa la lista completa de ingredientes: actualizar reemplaza esa lista mediante una nueva versión.
Se conserva la vida útil existente. No se reemplaza una asignación de venta incompatible sin la revisión manual existente.
Las recetas idénticas no crean nuevas versiones.

Se aceptan unidades base o conversiones activas del propio artículo con política `exact`.
La conversión y el consumo por unidad de rendimiento deben ser exactos a la escala del artículo.
Se reutiliza `componentBaseQuantity` para el cálculo de consumo; se rechaza cualquier residuo o desbordamiento.
El backend sigue validando referencias, ciclos, versiones y permisos al guardar.
Los artículos deben importarse antes que las recetas que los utilizan.

## Vista previa, confirmación y recuperación

La pantalla muestra `Nuevo`, `Actualizar`, `Sin cambios`, `Duplicado` o `Error`, con la causa y las filas.
Un resumen indica cuántos registros válidos se guardarán y cuántos se rechazarán.
El botón `Importar N artículos/recetas` es una confirmación explícita; `Cancelar` no escribe nada.
La confirmación de recetas indica que actualizar reemplaza todos los ingredientes de esas recetas.

La carga de referencias consulta todas las páginas y falla de forma visible si una página no llega.
No se genera una vista previa con catálogos incompletos.
Los comandos llevan la versión observada. Un cambio concurrente genera un error; nunca sobrescribe cambios silenciosamente.

Antes de enviar, se conserva un diario en sessionStorage con el negocio, los comandos exactos y sus identidades.
Una escritura en almacenamiento que falla bloquea el envío. No se guardan credenciales.
El diario conserva el lote y el resultado de cada comando para reabrir la pantalla o recargar la pestaña.
Cada reintento usa el mismo commandId, idempotencyKey, targetAggregateId y contenido.
Un comando exitoso no se repite. Un resultado ambiguo detiene el lote hasta que el propietario lo reintente.
Los errores 401, 403 y 429 detienen el lote; los demás errores definitivos se informan por registro.
Los envíos son secuenciales, separados por al menos 400 ms, para respetar el límite de solicitudes.
Cambiar de negocio o cerrar la pantalla detiene los comandos que todavía no comenzaron.
El comando en curso conserva el negocio original; su resultado se guarda en el diario original.
Una nueva importación requiere terminar o resolver la anterior; un resultado ambiguo no se descarta.
Un archivo reimportado se compara con el estado actual y no crea duplicados ni versiones idénticas.

## Implementación y fuentes

Hecho documentado: ExcelJS 4.4.0 lee y escribe .xlsx en navegador y distingue celdas de fórmula.
Fuente: https://github.com/exceljs/exceljs/tree/v4.4.0 y README del tag, consultados el 2026-10-31.
La vista web de GitHub omitió el README; se consultó el archivo oficial en raw.githubusercontent.com.
Hecho documentado: Papa Parse 5.7.0 interpreta CSV y ofrece `escapeFormulae` al exportar.
Fuente: https://www.papaparse.com/docs y los metadatos oficiales de npm, consultados el 2026-10-31.
Estas bibliotecas no estaban instaladas. Ambas funcionan sin interacción y solo se agregan al dashboard.
El costo es una dependencia para Excel y otra para CSV, cargadas dentro del worker al usar la función.
Se prefieren a un parser propio por las reglas de comillas, codificación y tipos de celda.
La alternativa read-excel-file/write-excel-file exige dos bibliotecas para Excel; ExcelJS también permite detectar fórmulas.
Inferencia específica de Umi: los comandos actuales cubren la atomicidad requerida por artículo y receta.
Fuentes locales: `recipes.ts`, `inventory-authoring.service.ts`, `inventory-authoring.repository.ts` y `administrative-command.jsx`.

## Verificación y exclusiones

Pruebas de archivos reales CSV/XLSX, cantidades exactas, agrupación, duplicados, versiones y recuperación.
Pruebas del dashboard con clics reales: descargar, importar, cancelar, confirmar, reintentar y descargar resultados.
Una prueba con backend y PostgreSQL comprueba las filas, las versiones y el consumo de una venta con receta importada.
Se comprueba móvil, teclado, permisos y cambio de negocio.
Fotos de compras, pronóstico y avisos al propietario corresponden a las siguientes fases.
No se fusiona el PR, no se despliega producción y no se envían avisos.
