# Rediseño nativo completo: UMI · Estación

## Objetivo

Construir la interfaz entera del POS en el fork local. Usar Flutter Widgets y dibujos propios. Retirar los componentes Material y Cupertino. Conservar contratos, permisos, controladores y reglas del dinero.

Directorio: `/home/juan/Projects/umiconsulting/umi-pos-estacion`. Rama: `design/pos-estacion-native`. La copia inicial conserva el estado local del repositorio original. El registro está en `../research/2026-10-08-pos-native-estacion/fork-provenance.json`.

Preferencia del usuario: abrir cada ventana en un workspace vacío. Comprobar las ventanas antes de abrir. El lanzador nativo reserva un workspace vacío y asigna la ventana del fork a ese workspace. Mantener la vista en pantalla completa.

## Herramientas y dirección

Git conserva versiones completas. Flutter 3.47.5 y Dart 3.13.4 analizan y ejecutan el cliente. Flutter Driver permite interacción nativa. Flutter Test revisa estados y regresión. Las herramientas ya están instaladas. El SDK usa BSD. Los controles propios cumplen el requisito del usuario. No se añade una biblioteca visual.

El POS es una estación del café. La identidad proviene de su colección, su pedido y sus cuentas. Usar fondo mineral `#F5F6F8`, panel blanco, tinta `#17212D`, texto secundario `#566473` y acción `#245BD6`. El oscuro conserva esos roles. Los importes usan cifras tabulares. La tipografía distingue título, producto y cuenta.

El recurso distintivo es el dibujo de instrumentos del café. Cada dibujo conserva nombre y categoría. La navegación permanece estable. El total y la acción mantienen un lugar visible. Los avisos pertenecen al área que los produce.

## Cobertura obligatoria

Acceso y registro de terminal; selección de comercio y sucursal; PIN y bloqueo; catálogo, detalle y modificadores; pedido y pedidos entrantes; mesas y servicio; cocina y preparación; cobro y recuperación incierta; venta completada, recibo e historial; cancelación, devolución y excepciones; caja, movimientos, arqueo y cierre; clientes y valor; inventario y producción; hardware y configuración; conexión, recuperación y diagnóstico.

Cada superficie incluye vacío, carga, éxito, fallo y restricciones por permiso. Los diálogos forman parte del ámbito. Retirar Material cumple una condición técnica; no demuestra calidad visual.

## Ejecución

1. Completar primitivas y aplicarlas a toda la interfaz antes de iniciar la crítica.
2. Guardar N1 íntegra y asignar **1.0**, como pidió el usuario. Esta nota fija la base de comparación.
3. Revisar N1 con capturas nativas, tareas e investigación. Registrar brechas y evidencia.
4. Construir N2 completa. Evaluar mejoras y regresiones con los mismos criterios.
5. Conservar cada versión. Investigar fuentes nuevas cuando una brecha concreta lo requiera.
6. Repetir hasta cumplir 10.0. La nota no aumenta por el número de rondas.

## Rúbrica

| Criterio                   | Peso | Evidencia                                                                  |
| -------------------------- | ---: | -------------------------------------------------------------------------- |
| Tarea y jerarquía          |  20% | Total, acción y contexto visibles; tareas completas y pasos comprensibles. |
| Calidad visual e identidad |  20% | Capturas; tipografía, proporción, ritmo y dibujos específicos del café.    |
| Cobertura y coherencia     |  15% | Todas las superficies y estados; significado consistente de controles.     |
| Adaptación                 |  15% | Caja, tablet y teléfono; teclado, nombres largos y pedidos extensos.       |
| Accesibilidad              |  15% | Objetivos de 48, contraste, foco, semántica, texto aumentado y selección.  |
| Respuesta y recuperación   |  10% | Estado observable; pago incierto sin duplicado; avisos completos.          |
| Fluidez                    |   5% | Entrada, movimiento reducido y mediciones nativas.                         |

Cada criterio recibe una nota de 1 a 10 con hechos y límites. N1 conserva 1.0 por instrucción. Las siguientes usan la rúbrica. Una corrección aislada no justifica un salto grande. Los cambios se valoran junto con las brechas anteriores.

## Finalización

El cliente debe cubrir la interfaz entera, compilar y pasar sus pruebas pertinentes. La inspección debe confirmar composición y operación nativas. No puede quedar una brecha crítica o importante en tareas, accesibilidad o legibilidad. Una nota de 10 sin esos resultados no cumple el objetivo.

Las preferencias artísticas siguen siendo juicios. Las pruebas automáticas no prueban por sí solas facilidad de uso. El registro distingue hechos, observaciones, inferencias y condiciones no verificadas. La ausencia de prueba conserva la brecha.

## Revisión N8 del 8 de octubre de 2026

Los tokens iniciales se conservan como historia. N8 usa fondo claro `#F1F3F4`, acento `#214EA7`, contenedor de acento `#E3EAF8` y radios 8/10.

La nota acumulativa es 5.7. Ajustes ya persiste apariencia, idioma y movimiento. N9 debe corregir los nombres accesibles, la mesa ocupada y la selección al cambiar de ancho. La inspección AT-SPI es externa. El lector hablado y el IME complejo siguen pendientes. El trabajo TPM queda fuera del diseño y de sus commits, por decisión del usuario.

## Revisión N9 del 8 de octubre de 2026

La nota acumulativa es 6.1. La lista móvil y el resumen conservan la mesa seleccionada al cambiar de ancho. La inspección externa confirma nombres y selección en controles accionables. Espacio abre el detalle con foco verificado. N10 debe confirmar el destino del traslado, corregir el fixture `dirty` y revisar la redundancia del PIN. Las pruebas aisladas aprueban 533 casos. El trabajo TPM sigue separado.

## Reorientación autorizada después de N10

El usuario observa que la composición conserva demasiado del diseño anterior y autoriza romper cualquier decisión visual previa. N11 reconstruirá la dirección completa: navegación, catálogo, pedido, estados y superficies secundarias. La nueva composición se evaluará con la misma rúbrica, investigación y tareas. La fidelidad al diseño anterior no es un criterio. La validez de importes, contratos y tareas sigue siendo una condición del POS.

## Revisión N11 y condición de marca

El usuario exige el color UMI. La fuente compartida `packages/tokens/tokens/core.json` fija azul marino `#223979` y azul `#7692CB`. Los colores iniciales del plan quedan como historia. N11 usa los tokens de marca, fondo claro `#F3F2EE` y tinta `#131F44`. Los estados de fallo, advertencia y ocupación conservan significado propio.

La composición coloca el catálogo a la izquierda y la comanda a la derecha. El teléfono abre la comanda mediante una acción fija. La navegación, las categorías y el acceso cambian su estructura. La nota acumulativa es **6.8**. La suite aislada aprueba **538** pruebas.

N12 debe unificar la terminología, añadir un cierre visible a la comanda móvil y revisar Ajustes, Caja y las superficies restantes. Debe corregir el progreso indeterminado y comprobar las propiedades visuales pendientes. La navegación de regreso requiere una prueba cuando cambia el tema sobre una ruta cubierta. La fuente primaria de Garcin aporta una crítica de legibilidad; no sustituye la prueba con operadores.

## Revisión N12 y relación entre forma y acción

N12 alcanza **7.2/10** con **541** pruebas aisladas aprobadas. Caja muestra las once denominaciones completas en 1280 × 720. Ajustes usa secciones abiertas. El progreso indeterminado tiene movimiento real y respeta la reducción de movimiento. El cierre móvil conserva la comanda.

El usuario identifica un problema adicional: Ventas conserva una forma que correspondía a una apertura desde abajo. La forma actual debe expresar su acción actual. N13 debe revisar destinos, tareas temporales, cierres y selección. La navegación debe tener una dirección propia. Conserva los colores UMI y los contratos del producto. Esta observación abre G45 y limita la evaluación de coherencia.

## Revisión N13

La nota acumulativa es **7.4/10**. La suite aislada aprueba **544** pruebas. Las secciones principales usan navegación persistente y selección real. Ventas utiliza toda su página. El detalle y la comanda conservan su estado al cambiar de sección. Caja conserva las once denominaciones visibles en 1280 × 720. El botón de regreso del detalle incluye flecha y texto en una sola acción.

N14 debe revisar los formularios al cambiar de sección, el nombre accesible del destino dentro de Más y los filtros móviles de Ventas. G42, G43 y G13 siguen pendientes. La evaluación conserva todas las brechas de tareas y dispositivos. La apariencia completa sigue abierta en un workspace vacío.

## Revisión N14

La nota acumulativa es **7.7/10**. La suite aislada aprueba **545** pruebas. Caja conserva su conteo al cambiar de destino. La apertura respeta el máximo conocido. Ventas compacta los filtros del teléfono. Más identifica su destino. Los eventos del escáner respetan la sección y descartan consultas tardías.

N15 debe resolver G51: las opciones del selector deben pertenecer visualmente a su control. La revisión debe comprobar foco, teclado, cierre exterior, selección y bordes de pantalla. Conserva G13 y las tareas integrales pendientes. La nota mantiene los límites de dispositivos, voz, IME y arranque frío.

## Revisión N15

La nota acumulativa es **7.9/10**. La suite aislada aprueba **548** pruebas. Las opciones aparecen junto al control y conservan teclado, cierre y selección. Ventas conserva el filtro al cambiar de ancho. Caja conserva cantidades, subtotales y total entre escritorio, tablet y teléfono. Las capturas finales comprueban sus dimensiones reales.

N16 debe corregir las fotografías del fixture y evaluar el reconocimiento del catálogo. Debe revisar el filtro al salir de Ventas y las tareas secundarias de G39. La puntuación conserva los límites de voz, IME, dispositivos físicos, texto aumentado nativo y arranque frío. El trabajo TPM mantiene su evaluación y su historial separados.

## Revisión N16

La nota acumulativa se mantiene en **7.9/10**. La suite aislada aprueba **548** pruebas. La carta muestra imágenes reconocibles del fixture. Ventas conserva búsqueda, filtro y orden al salir hacia Caja y regresar. Las muestras no representan productos reales del comercio.

N17 debe resolver G56: buscar el nombre visible de una venta debe producir resultados coherentes. Debe probar G55: cambios rápidos de consulta con una solicitud pendiente. El propietario canónico de los resultados es la API. La interfaz conserva la propiedad del formulario. Las brechas anteriores y los límites de dispositivos permanecen en la evaluación.

## Revisión N17

La nota acumulativa es **8.0/10**. La suite aislada aprueba **555** pruebas. La API busca el nombre histórico del producto. El controlador conserva sólo la consulta vigente. La lectura fallida mantiene la venta abierta. El reintento nativo recupera el historial. La dirección visual y los colores UMI permanecen.

N18 debe revisar texto aumentado nativo, legibilidad y superficies secundarias de G39. Debe conservar las tareas, los importes y el contexto. La investigación puede cambiar cualquier decisión visual anterior. La nota mantiene los límites de voz, IME, dispositivos físicos, carga prolongada y arranque frío. El trabajo TPM permanece separado.

## Revisión N18

La nota acumulativa es **8.1/10**. La suite aislada aprueba **568 pruebas**. La preferencia de texto conserva el tamaño del sistema y aplica mínimos opcionales. La carta permite alcanzar productos. La navegación conserva palabras completas. Caja permite alcanzar su conteo. Las cantidades permanecen al cambiar la composición.

N19 debe resolver G62: el formulario y el aviso de Ventas dejan la fila incompleta con texto aumentado. Debe comprobar selección, importes y acciones en el proceso nativo. Debe ampliar G39 con tareas secundarias, datos, errores y permisos. Conserva los límites de voz, IME, dispositivos físicos, escala externa del sistema y arranque frío. El trabajo TPM permanece separado.

## Revisión N19

La nota acumulativa es **8.2/10**. La suite aislada aprueba **575 pruebas**. Ventas permite desplazar formulario, aviso y filas juntos con texto grande. Nombre, importe y acción se alcanzan. El fallo real de conexión conserva búsqueda y permite reintentar. G62 se cierra en el alcance nativo documentado.

N20 debe comprobar el recorrido de teclado con contenido diferido y ampliar G39 con tareas secundarias, datos, errores y permisos. Debe conservar la legibilidad y las acciones al mover el foco. La investigación puede cambiar cualquier distribución anterior. Mantiene los límites de voz, IME, dispositivos físicos, escala externa y arranque frío. El trabajo TPM permanece separado.

## Revisión N20

La nota acumulativa es **8.3/10**. La suite aislada aprueba **588 pruebas**. El recibo conserva datos canónicos y diferencia apertura de impresión. La referencia enfocada se revela y se identifica. El recorrido nativo devuelve foco y conserva la búsqueda. G63 y G64 se cierran en su alcance documentado.

N21 debe evaluar recibos y listas extensos, costo de contenido y navegación por teclado. Debe ampliar G39 con datos, errores y permisos nativos de superficies secundarias. La investigación puede cambiar cualquier composición anterior. Mantiene voz, IME, escala externa, dispositivos físicos, impresión y arranque frío como condiciones pendientes. TPM permanece separado.

## Revisión N21

La nota acumulativa es **8.4/10**. La suite aislada aprueba **596 pruebas**. Los recibos extensos construyen líneas cercanas y permiten desplazamiento por teclado desde las acciones. La revisión mantiene importes canónicos y distingue stress local de venta real. G65 y G66 se cierran en su alcance comprobado.

N22 debe corregir G67: «Comanda» se parte dentro de la palabra en navegación horizontal al 200%. Debe revisar los demás destinos, selección y retorno con texto aumentado. Debe ampliar G39 con datos, errores y permisos nativos de superficies secundarias. Conserva listas extensas de ventas, memoria e inicio frío como tareas pendientes. Mantiene voz, IME, escala externa, operadores, dispositivos físicos e impresión como condiciones pendientes. TPM permanece separado.

## Revisión N22

La nota acumulativa se mantiene en **8.4/10**. La suite aislada aprueba **612 pruebas**. La navegación responde a etiquetas y constraints reales. G67 se cierra en idiomas, escalas y dimensiones comprobados. La sección permanece al ampliar y reducir. La revisión conserva Escape, elección y apertura por teclado, sin declarar conformidad APG ni lector hablado.

N23 debe resolver G68: retorno equivalente al desaparecer Más durante resize a rail. Debe resolver G69: acciones truncadas en comanda al 200%. Debe repetir los casos observados y revisar altura disponible, etiquetas e importes. Debe continuar G39 con datos, errores y permisos nativos de secciones secundarias. Conserva listas extensas de ventas, memoria e inicio frío, voz, IME, escala externa, operadores, dispositivos físicos e impresión como condiciones pendientes. TPM permanece separado.

## Revisión N23

La nota acumulativa permanece en **8.4/10**. La suite aislada aprueba **621 pruebas**. G68 y G70 se cierran en retorno equivalente y continuidad de activación. La navegación conserva identidad al cambiar de idioma, composición y lista controlada de destinos permitidos. El editor nativo conserva foco; la geometría demuestra que su texto queda recortado en horizontal al 200%.

N24 debe resolver G71: recuperar una región suficiente para leer búsqueda y caret en 812 × 375 al 200%. Debe resolver G69: verbos truncados en las acciones de comanda. Debe revisar el presupuesto de cabecera, barras fijas, contenido y teclado antes de añadir filas. Debe repetir importes canónicos, último artículo, acción primaria y cierre. Continúa G39 con datos, errores y permisos nativos secundarios. Mantiene listas extensas de ventas, memoria e inicio frío, operadores, voz, IME, escala externa, dispositivos físicos e impresión como condiciones pendientes. TPM permanece separado.

## Revisión N24

La nota acumulativa permanece en **8.4/10**. La suite aislada aprueba **628 pruebas**. G69 y G71 se cierran en las composiciones e idiomas medidos. La revisión conserva palabras, consulta, importes y cierre; cancela la confirmación de vaciado y conserva la comanda. La altura escasa utiliza desplazamiento en lugar de truncamiento o reducción de texto.

N25 debe resolver G72: Nueva venta tiene foco antes del cambio de cabecera y el editor lo recibe después, sin una decisión del operador. Debe conservar la intención del control equivalente, sin activarlo ni enfocar un control no permitido. Debe revisar los demás controles de cabecera y cambios de texto/idioma. Continúa G39 con datos, errores y permisos nativos secundarios. Mantiene listas extensas de ventas, memoria e inicio frío, operadores, voz, IME, escala externa, dispositivos físicos e impresión como condiciones pendientes. TPM permanece separado.

## Revisión N25

La nota acumulativa sube a **8.5/10**; **637 pruebas aisladas** pasan. Se cierran G72 y G73 para los controles y condiciones medidos. El foco conserva la intención de acción, y Nueva venta conserva su capacidad anunciada después del cambio de texto desde una sección oculta. Se mantienen G69/G71 y los colores UMI. El retiro de una acción por permisos usa sesión controlada; no reemplaza una prueba de autorización nativa.

N26 debe ampliar G39 con un pedido entrante y ticket de cocina poblados, un rol adicional y un fallo/reintento. Debe distinguir preparación instrumental de acción del operador y conservar datos de la fixture. Las opciones de un menú ya abierto durante resize quedan pendientes. Listas extensas de ventas, memoria e inicio frío, operadores, voz, IME, escala externa, dispositivos físicos e impresión siguen siendo condiciones para alcanzar 10.0. El benchmark N21 no se extrapola y TPM permanece separado.

## Revisión N26

Revisión del 9 de octubre. Nota acumulativa **8.6/10**; **650 pruebas aisladas** pasan. Los tickets crecen con texto y espacio local. La identidad, cantidad y espera permanecen completas; Hoy/Today distingue el conteo. La sesión controla cada permiso de cocina y el código de negativa coincide con la API. Se mantienen las correcciones anteriores y UMI.

N27 debe continuar G39 con la adopción completa de un pedido entrante, operación autorizada de cocina y preparación/inventario poblados. Debe diagnosticar el aviso de conexión observado después de recuperar datos sin atribuirlo todavía a red o autorización. El cambio de rol y reanudación deben conservar líneas, notas, importes y evidencia de lifecycle. Menús abiertos durante resize, operadores, voz, IME, escala externa, listas extensas de ventas, memoria/inicio frío y dispositivos/impresión físicos siguen pendientes antes de 10.0. TPM permanece separado.

## Revisión N27 e integración principal

La nota acumulativa alcanza **8.7/10**; la suite del principal aprueba **667 pruebas**.
El usuario elige `/home/juan/Projects/umiconsulting/umi` como destino.
La implementación está integrada en su árbol de trabajo, con los cambios locales anteriores conservados.
El [plan de cierre](2026-10-09-pos-estacion-complete.md) conserva cobertura, fuentes y límites por superficie.

G78 se cierra para la carrera de conexión reproducida después de salir de Cocina.
G79 y G80 se cierran para verbos, unidades y cantidades exactas de inventario.
La [decisión N27](../research/2026-10-08-pos-native-estacion/N27-decision.md) distingue fallos de producto y errores de instrumento.
La maqueta del principal queda sola en workspace 3, con comanda MXN 48.00 y texto del sistema.
TPM permanece separado de la integración, puntuación e historia de diseño.

La siguiente evaluación debe comprobar la parte empírica de G39: adopción, cocina autorizada y preparación poblada.
Debe continuar con operadores, voz, IME, escala externa, menús abiertos durante resize y listas extensas de ventas.
Debe comprobar memoria/inicio frío, dispositivos e impresión físicos antes de declarar 10.0.
La presencia de código y las pruebas automáticas no sustituyen esas observaciones.

## Decisión del propietario del 11 de octubre: la carta no dibuja

El propietario pidió retirar el dibujo de la carta. La tarjeta de un producto sin foto es un bloque
sólido con el **color de su categoría** y las **iniciales del producto**, como en el diseño
anterior. El dibujo de línea que estaba detrás de las iniciales se leía como ruido detrás de un
nombre que la tarjeta ya muestra.

El color no se define en la terminal. El propietario lo cambia en el panel, en **Productos →
Categorías**, y la terminal lo toma del campo `color` de la categoría. Cuando la categoría no
define color, la terminal deriva un tono estable del nombre para que la categoría siga leyéndose
como un bloque.

Medido el 11 de octubre: la tarjeta muestra el bloque y las iniciales en el POS de escritorio, con
los colores de ONCA (`Pan` `#f58231`, `Bebidas` `#4363d8`, `Pizzas` `#e6194b`); la prueba
`a product with no photo is a block of its category colour with its initials` fija la regla; y la
suite del POS aprueba **674 pruebas**. El dibujo retirado se conserva fuera de la aplicación, en
`design-probes/removed_catalog_sketch/`, para no perder el trazo.
