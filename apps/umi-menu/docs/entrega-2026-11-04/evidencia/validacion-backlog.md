# Validación del backlog y ampliación de la entrega

Fecha: 4 de noviembre de 2026. Alcance: documentación, historias, tareas, dependencias y conservación de las fuentes recibidas. Esta ampliación no implementa el menú digital.

## Revisión de contenido

Se contrastaron los acuerdos D01–D19, las entregas P01–P19/P06D, los pendientes A01–A13 y las rutas técnicas del repositorio local. GitHub Issues sustituye las referencias históricas a Azure Boards para este proyecto.

La revisión corrigió las dependencias de disponibilidad, reservas y despliegue; trasladó la vista previa al momento en que existe el frontend y asignó la prueba de exclusión de recogida a su API. Separó el cierre de una historia de implementación del cierre de promoción y piloto. Añadió la historia de origen en historial/reportes y la conservación de ese origen al cobrar en POS.

Se mantienen como decisiones pendientes los valores y políticas todavía no elegidos. Los IDs MD-Hxx/MD-Axx son locales; no hay números de GitHub asignados.

## Comprobaciones reproducibles

Desde la raíz del paquete:

```sh
python3 scripts/generar-backlog.py
python3 scripts/validar-backlog.py
python3 scripts/verificar-paquete.py
```

El generador produce las historias, decisiones, índices y CSV desde `backlog/backlog.json`. El validador comprueba campos, IDs, ciclos, cobertura, correspondencia de tareas exportadas, enlaces locales y hashes de las 1,218 copias de origen. El verificador de integridad usa el manifiesto final `SHA256SUMS`.

Los resultados de la comprobación están en [validacion-backlog.json](validacion-backlog.json).

Resultado de esta revisión: **33 historias, 13 decisiones pendientes y 205 tareas**; 15 capas de dependencias sin ciclos. Cobertura de los 19 acuerdos Dxx y las 20 entregas Pxx. Se comprobaron 209 enlaces locales en 63 documentos vigentes y las 1,218 copias originales, sin errores. Regenerar el backlog por segunda vez produjo los mismos archivos y hashes.

## Límites

La ausencia de ciclos o enlaces rotos no certifica la implementación ni cierra decisiones de producto. Las rutas técnicas corresponden al checkout local fechado; no se actualizó el remoto durante esta tarea.

No se ejecutaron pruebas de la API, PostgreSQL, POS, KDS o entrega de correo en esta ampliación. La validación anterior del prototipo conserva su fecha y alcance. No se publicaron issues o PRs, no se desplegó el sitio y no se promovió código a staging o main.

Las fuentes del prototipo, sus recursos, las skills y las referencias copiadas conservan los hashes de la primera entrega. El ZIP original se conserva; la ampliación se distribuye como un ZIP v2 independiente.
