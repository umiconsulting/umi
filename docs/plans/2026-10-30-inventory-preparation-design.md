# Preparación directa en el dashboard

El usuario autorizó continuar con la preparación directa después del arreglo móvil.
La entrega usa un PR separado, abierto para aprobación.

## Comportamiento

- Desde Recetas, una receta activa de artículo muestra «Preparar».
- Desde Preparación, «Nueva preparación» permite elegir cualquier artículo activo con receta, aunque no tenga cantidad objetivo.
- El propietario elige cuánto preparar y revisa los ingredientes antes de confirmar.
- La confirmación descuenta los ingredientes y suma la cantidad preparada en un solo movimiento de preparación.
- La cancelación conserva el inventario. Un reintento después de perder la respuesta conserva la identidad del mismo comando.
- Si cambia la receta después de la revisión, se exige revisar de nuevo antes de confirmar.
- Las recetas de productos y variantes siguen destinadas al consumo por venta. La preparación requiere una receta asociada a un artículo de inventario.
- La operación requiere una sucursal, un almacén válido y el permiso existente `inventory.production.produce`.
- Las reglas existentes de saldo negativo siguen vigentes. El formulario explica los rechazos sin cambiar esas reglas.
- El resumen muestra la cantidad registrada y el lote. No se requiere configurar una cantidad objetivo para preparar.

## Cantidades

El backend actual siempre consume los ingredientes del rendimiento de un lote de receta.
La nueva cantidad planificada permite preparar medio lote o varios lotes con conversiones exactas.
Ejemplo: una receta rinde 10 piezas y usa 1 kg de harina. Preparar 5 piezas consume 0.5 kg; preparar 20 consume 2 kg.
Los clientes anteriores conservan la interpretación de cantidad obtenida respecto al rendimiento del lote de receta.
El dashboard nuevo envía la misma cantidad como planificada y obtenida. La captura de merma de rendimiento no forma parte de esta pantalla.

La lista sugerida usa `max(0, objetivo + consumo previsto - existencia disponible)`.
Una mayor demanda aumenta la cantidad sugerida. La existencia negativa se trata como cero disponible, como en el contrato actual.
Este cálculo conserva la ventana actual; el pronóstico por días de compra permanece en una fase posterior.

## Diseño técnico

Se conserva el comando administrativo existente `inventory.production.produce` y su registro canónico de movimientos.
Se agrega `inventory.production.preview` para calcular los ingredientes de una cantidad mediante la misma función del backend.
La vista previa no registra existencias ni lotes. Las cantidades no se calculan con los valores redondeados del explorador de recetas.
La respuesta incluye una huella de la receta y sus ingredientes, calculada por el servidor.
La confirmación compara esa huella contra el plan que va a registrar. Incluye cambios de subrecetas que afecten los ingredientes.
La huella no autoriza operaciones ni sustituye los permisos o el aislamiento por negocio.
Se agregan campos opcionales al contrato, sin editar migraciones aplicadas ni cambiar el generador de SDK.
Los campos nuevos admiten nulo y lo tratan como omisión, para conservar la serialización de los clientes Dart anteriores.

## Validación

Pruebas PostgreSQL: medio lote, varios lotes, conversiones exactas, subrecetas, reversión completa ante rechazo y reintentos.
Pruebas de permisos, otro negocio, otra sucursal, artículo archivado y receta cambiada o retirada.
Pruebas del cálculo sugerido con demanda cero y creciente.
Chromium real: preparar desde Recetas y Preparación, sin objetivo, cancelar, confirmar, reintentar y revisar saldos reales.
Verificar escritorio y móvil. Conservar las vistas locales anteriores y sus datos de prueba.

## Restricciones

- Worktree: `/private/tmp/umi-inventory-preparation-20261030`.
- Rama: `feat/inventory-dashboard-preparation`; base inicial `18e067d6`.
- Incorporar cualquier corrección posterior del PR móvil antes de publicar esta rama.
- Conservar los PRs abiertos. No fusionar, activar auto-merge ni desplegar producción.
- No enviar avisos ni leer o cambiar datos de producción.
- Usar lenguaje sencillo y comandos atómicos. Conservar permisos, auditoría, costos y versiones.
- No editar el checkout original ni otros worktrees.

Fuentes de la decisión: contrato `ProductionRecord`, comando administrativo existente, repositorio `PosInventoryRepository.produce` y cálculo `prepList`.
Son hechos del código local. La vista previa común evita dos cálculos distintos de consumo.
