# Menú digital: recomendaciones para Umi

Fecha de consulta: 2026-11-17. Rama: `hc_digital_menu_connect`.

**Inferencia Umi — decisión.** El siguiente paso debe hacer confiable el recorrido «consultar → personalizar → revisar → enviar». La amplitud debe venir del catálogo y de las capacidades habilitadas por sucursal. No debe venir de mostrar todos los módulos del restaurante al comensal.

## Alcance e instrumentos

**Hecho documentado — alcance.** Esta revisión combina fuentes oficiales de cuatro proveedores: Square, Toast, Lightspeed y Soft Restaurant, referente regional de México. Compara patrones documentados. No evalúa precios, contratación, disponibilidad comercial en México ni pantallas de compra operadas por nosotros. No se enviaron pedidos ni se modificó staging.

**Hecho documentado — instrumentos.** Se usaron búsqueda y lectura web integradas, `rg` 15.2.0 y lectura local del repositorio. El entorno disponible tenía Node 22.23.4 y pnpm 10.29.3. No se instalaron dependencias. `rg` usa MIT/Unlicense; Node usa MIT y pnpm usa MIT. Las versiones son del equipo, no versiones de los servicios comparados. El lector web no expone una versión independiente. El costo de adopción para esta investigación fue cero paquetes nuevos; esto no afirma costos de infraestructura o licencias de proveedores.

**Hecho documentado — método.** Se consultó primero documentación del proveedor y después estándares. Se revisaron el README y CHANGELOG de `apps/umi-menu`, `base.js`, `visual.js` y recursos del tema. La inspección local corresponde al punto de partida de esta rama; otros agentes realizan la integración en paralelo. Este archivo no acredita el comportamiento de su resultado final.

**NO VERIFICADO.** No se hizo una revisión exhaustiva de cambios de versión de los cuatro servicios, ni una medición de Core Web Vitals de Umi en producción. No hay datos de entrevistas, conversión ni tiempos de atención que permitan prometer mejoras comerciales.

## Continuidad

**Hecho documentado.** Los antecedentes son [la comparación de proveedores del 15 de septiembre](2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md), [PoloTab del 12 de octubre](2026-10-12-polotab-menu.md), el [README del menú](../../apps/umi-menu/README.md) y su [CHANGELOG](../../apps/umi-menu/CHANGELOG.md). PoloTab estudia el POS del operador; no demuestra cómo debe funcionar un menú web del comensal.

**Hecho documentado — se conserva.** El menú aprobado usa azul Umi, IBM Plex Sans, Bricolage Grotesque y fotografías. El alcance acordado excluye delivery, registro obligatorio, pago en línea y OTP por SMS para la primera versión. El catálogo y los precios pertenecen al backend. El cambio de conexión no justifica rediseñar estas decisiones.

**Inferencia Umi — cambio en esta revisión.** La prioridad pasa del prototipo visual a la confianza operativa: sucursal correcta, catálogo publicado, precios vigentes, recepción comprobada y recuperación ante fallos. Este informe agrega criterios para esa transición; no reabre el diseño aprobado ni propone reducir ahora la suite de pruebas.

## Cuatro patrones útiles

Cada celda describe documentación, no una prueba de la interfaz real. «NO VERIFICADO» no significa que el proveedor carezca de la capacidad.

| Proveedor y fuente oficial                                                                                                                                                                                                                                                        | Hecho documentado                                                                                                                                                                                  | Inferencia Umi                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [Square: pedido por QR](https://squareup.com/help/us/en/article/7142-set-up-self-serve-ordering-and-qr-codes-with-square-online)                                                                                                                                                  | Asocia pedidos con estaciones como mesas; permite pausar pedidos por ubicación y configurar horarios. Los pedidos entran al circuito de POS y preparación.                                         | Mostrar sucursal y mesa antes de enviar. Una pausa debe conservar la consulta y explicar por qué no se puede pedir. |
| [Toast: Mobile Order & Pay](https://pos.toasttab.com/products/mobile-order-and-pay)                                                                                                                                                                                               | Documenta el menú móvil conectado al POS, personalización y actualización de disponibilidad. Incluye cobro como parte de su producto.                                                              | Reutilizar catálogo y disponibilidad. Su cobro no obliga a incorporarlo en el alcance actual de Umi.                |
| [Lightspeed: perfiles de servicio](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260803546769-Creating-Order-Anywhere-service-profiles) y [pedidos](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260803553189-Placing-orders-using-Order-Anywhere) | Distingue perfiles para consultar el menú, pedir en mesa y recoger. En mesa se usa el QR correspondiente; los modificadores se eligen antes de revisar el pedido.                                  | Separar consulta pública de autorización para pedir. Una URL de restaurante no debe inventar una mesa.              |
| [Soft Restaurant: Menú Digital](https://softrestaurant.com/addons/menu-digital)                                                                                                                                                                                                   | Documenta fotos, descripciones, grupos de modificadores y funciones de servicio con requisitos operativos. Este producto se presenta para tabletas; no se trata aquí como equivalente a un QR web. | Pedir cuenta o llamar al personal solo tiene valor si hay una persona o sistema que recibe y atiende la solicitud.  |

**NO VERIFICADO — comparación limitada.** No se verificaron autenticación obligatoria, política de reintentos, aislamiento entre restaurantes, accesibilidad completa ni rendimiento real de estos productos. No se transfieren esas garantías a Umi. Tampoco se infiere que una prestación publicada esté incluida en todos sus planes.

**Tradeoff respaldado.** Lightspeed demuestra que consultar y pedir pueden ser modos distintos. Square demuestra que aceptar pedidos puede depender de ubicación y horario. Para Umi, un catálogo visible no debe implicar que cocina acepta pedidos en ese momento. Las fuentes están en la tabla anterior.

## Ahora: confianza y claridad

Todas las propuestas de esta sección son **inferencias Umi**, salvo el estándar citado expresamente.

1. **Contexto visible y estable.** Mostrar restaurante, sucursal y, con QR válido, mesa. Para `/:handle/menu`, elegir sucursal si hay varias, con dirección y horario suficientes para distinguirlas. No pedir permiso de geolocalización como requisito. Si cambia la sucursal, explicar que se revisará o limpiará el carrito; nunca transportar silenciosamente sus productos.
2. **Consulta y pedido como capacidades.** Permitir ver el catálogo sin cuenta. Con QR, usar el contexto que devuelve la API; no aceptar restaurante, sucursal o mesa elegidos por el navegador. Sin QR, conservar consulta pública. Activar recogida u otros servicios solo cuando existan contratos y operación reales. Retirar de la experiencia pública las simulaciones de personal y estados de preparación por temporizador.
3. **Catálogo listo para publicar.** Exponer únicamente productos, variantes y grupos publicados para esa sucursal. Mostrar agotados sin acciones que fallen después. Si no hay productos, dar un estado vacío útil, no productos de prueba. Validar foto, descripción, moneda y disponibilidad antes de publicar. Las promociones requieren contenido y vigencia reales; no conservar ofertas de demostración.
4. **Personalización breve y verificable.** Mostrar grupos obligatorios, límites de elección y costos adicionales junto a las opciones. Conservar notas por producto y cantidades editables. Resumir esas elecciones en el carrito. No usar un campo libre para sustituir variantes o modificadores estructurados.
5. **Precios bajo autoridad del servidor.** Enviar identificadores, opciones y cantidades conforme al contrato. Tratar los importes calculados en pantalla como una estimación hasta que el servidor los confirme. Si cambia un precio o se agota un producto, conservar el resto del carrito, identificar la línea afectada y pedir revisión. No aceptar silenciosamente un total mayor. El servidor debe resolver impuestos, cargos y disponibilidad; no agregar reglas paralelas en JavaScript.
6. **Envío recuperable.** Bloquear dobles clics durante el envío. Cada intento lógico necesita una clave de idempotencia estable que el servidor reconozca; deshabilitar el botón por sí solo no evita duplicados. Un timeout puede ocurrir después de que el servidor aceptó el pedido: mostrar «No pudimos confirmar la recepción», conservar el identificador y recuperar o reintentar el mismo intento. No crear otro identificador automáticamente. Si el contrato no permite recuperar este caso, registrar esa limitación y resolverla antes de prometer reintentos seguros.
7. **Confirmación honesta.** Mostrar «Recibido» solo con respuesta comprobable del backend y referencia de pedido. «En preparación» exige un estado operativo real. Una alerta local, una escritura en localStorage o un reloj no acreditan recepción por cocina. Mostrar cómo solicitar ayuda si falla la confirmación.
8. **Red intermitente.** Conservar el carrito como borrador, separado por restaurante, sucursal y contexto de mesa. Señalar desconexión y permitir volver a intentar la consulta. Al reconectar, revalidar catálogo, opciones y precio antes de enviar. No prometer pedido offline ni mandar pedidos en segundo plano al reconectar sin que el comensal sepa qué pasó.
9. **QR y separación de negocios.** Tratar el token como credencial limitada, con validación y alcance resueltos por la API. No usarlo como identificador de cliente. No copiarlo a analítica, errores, URLs de imágenes o registros innecesarios. No incluir secretos de staging en el bundle. Añadir expiración o revocación conforme al modelo operativo, límites de envío y política de referencias. Ningún identificador enviado por el navegador debe permitir cruzar de restaurante.

**Hecho documentado — revisión antes de confirmar.** WCAG 2.2 contempla mecanismos para revisar, corregir o revertir envíos relevantes en [3.3.4](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html). **Inferencia Umi.** Un único resumen final editable, con mesa y total, es suficiente. No agregar confirmaciones repetidas a cada toque.

## UI que conservar y pulir

**Inferencia Umi.** Conservar el diseño aprobado y priorizar nombre, descripción breve, precio y foto real. Mantener categorías y búsqueda; el carrito debe mostrar cantidad y total sin tapar productos ni el foco del teclado. Usar un solo CTA principal según el modo: consultar, revisar carrito o enviar. Evitar banners decorativos, métricas inventadas, insignias «popular» sin datos y recomendaciones automáticas sin una utilidad probada.

**Inferencia Umi.** En móvil, dar más espacio a los nombres largos y modificadores que a los mensajes de marca. La foto ampliada debe cerrar con Escape, devolver el foco y ofrecer un botón accesible. Probar teclado, lector de pantalla, zoom y reducción de movimiento. Los errores deben estar junto al campo y anunciarse, no depender solo de color o de un toast que desaparece.

**Hecho documentado.** [WCAG 2.2, 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) establece un mínimo de 24 × 24 píxeles CSS o excepciones de separación, entre otras. **Inferencia Umi.** Adoptar 44 × 44 como objetivo propio para cantidad, cerrar, categorías y envío. No presentar 44 × 44 como el mínimo obligatorio de ese criterio AA. Una auditoría completa de conformidad queda **NO VERIFICADA**.

## Rendimiento y caché

**Hecho observado en archivos, no en red.** El prototipo conserva cinco TTF de aproximadamente 114–198 KB cada uno y cinco JPG de aproximadamente 48–215 KB. Esto es peso de archivos del repositorio, no transferencia inicial medida. `base.js` ya usa carga diferida en varias fotos. Las plantillas inspeccionadas no especifican dimensiones HTML en esas imágenes. El tema usa `font-display: swap`.

**Tradeoff respaldado.** La [guía oficial de carga diferida](https://web.dev/articles/browser-level-image-lazy-loading) recomienda usar el mecanismo nativo para fotos fuera de pantalla y evitar retrasar imágenes críticas visibles. **Inferencia Umi.** Servir tamaños ajustados a cada tarjeta con `srcset`/`sizes`, formatos modernos con alternativa, y reservar su espacio con dimensiones o proporción. No descargar la foto ampliada para cada tarjeta. Medir antes de agregar un optimizador externo o una librería.

**Inferencia Umi.** Revisar fuentes WOFF2 y subconjuntos con caracteres necesarios, conservando sus licencias OFL. No cargar pesos que no se usan. Reutilizar JavaScript simple y la capa HTTP existente; no agregar un framework, SDK o service worker por esta conexión.

**Hecho documentado.** [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2) define las directivas de caché: `no-cache` exige validación antes de reutilizar; `no-store` impide almacenar. **Inferencia Umi.** Dar caché prolongada a recursos con nombre versionado. Diseñar por separado la del catálogo público, con identidad de restaurante/sucursal y revalidación. Evitar cachés compartidas de respuestas que contienen contexto del token o del pedido; preferir `no-store` donde corresponda. Conservar un borrador no autoriza a reutilizar precios vencidos. No introducir funcionamiento offline completo en esta fase.

**Hecho documentado — objetivos de experiencia.** [Web Vitals](https://web.dev/articles/vitals) define objetivos buenos de LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1, evaluados en el percentil 75 y separados por móvil/escritorio. Son objetivos, no resultados medidos de Umi.

**Inferencia Umi — presupuesto inicial propuesto.** Para un piloto, acordar ≤ 500 KB transferidos para el primer viewport con caché vacía y ≤ 150 KB por imagen de tarjeta servida. Son límites de trabajo de Umi, ajustables tras medir; no estándares universales ni garantías. Registrar bytes reales, dispositivo, red, caché y cantidad de productos. Complementar laboratorio con métricas de campo; un puntaje Lighthouse aislado no acredita INP real ni conversión.

## Después, con evidencia de uso

Todas las propuestas son **inferencias Umi**. Activarlas de forma gradual y por sucursal.

| Mejora                            | Condición para incorporarla                                   | Límite de alcance                                                                                 |
| --------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Idiomas y filtros alimentarios    | Contenido mantenido por el restaurante; demanda observada     | No inventar alérgenos ni traducciones sensibles. Distinguir preferencia de garantía de seguridad. |
| Reordenar productos               | Hay pedidos reales y problema repetido de tiempo de selección | Revalidar precio y disponibilidad; sin registro obligatorio.                                      |
| Llamar al personal o pedir cuenta | Un receptor real, estado y tiempo de atención medibles        | Una solicitud activa por mesa; confirmar recepción, evitar spam y alertas sin responsable.        |
| Recomendaciones simples           | Hay datos o relaciones editoriales publicadas                 | Una sugerencia pertinente, sin ventanas que bloqueen ni «popular» ficticio.                       |
| Recogida y programación           | Backend, capacidad, horarios y aceptación están conectados    | Ocultar servicios no disponibles. No simular tiempos ni confirmaciones.                           |

**Inferencia Umi — puerta de entrada para funciones nuevas.** Pedir un problema observado, dueño operativo, datos de entrada confiables, criterio de éxito y capacidad de apagado. Si una función no pasa estos cinco puntos, no debe entrar al menú principal.

## Evitar por ahora

**Inferencia Umi.** Evitar login forzoso, descargas de app, permisos al abrir, chat de IA como sustituto del catálogo, video de fondo, carruseles adicionales, promociones invasivas, gamificación, pagos o delivery fuera del alcance, y un panel de operador dentro del menú público. Evitar el reintento ciego de pedidos y cualquier estado que avance por tiempo en lugar de datos reales. No adoptar otra plataforma, repositorio o servicio para resolver esta integración.

**Inferencia Umi — alternativa descartada.** La segunda opción sería lanzar una experiencia completa de comercio con pago, fidelización, recomendaciones y seguimiento. Se descarta ahora porque agrega dependencias operativas y validaciones antes de comprobar que catálogo y pedidos son confiables. El patrón documental de Toast puede servir después; no es un requisito para el primer lanzamiento.

## Comprobaciones para el piloto

Todas son **criterios propuestos de Umi**, no resultados de esta investigación:

- Verificar consulta sin QR, sucursal correcta, QR válido/inválido y producto agotado.
- Probar modificadores obligatorios, cambio de precio y recuperación del carrito sin cruzar de negocio.
- Interrumpir la conexión antes y después de aceptar un pedido; demostrar que el mismo intento no crea dos pedidos. Registrar un pedido aceptado y el estado que recibe el cliente.
- Medir carga móvil con catálogo real, fotos lentas y sin foto; comprobar teclado, foco, zoom y texto largo.
- Medir errores de carga, intentos de envío, confirmaciones, reintentos y duplicados con identificadores mínimos. Excluir tokens y datos personales de la telemetría. Buscar cero duplicados en los casos controlados; no extrapolar esa prueba a una garantía absoluta.

## Registro de fuentes y límites

**Hecho documentado.** Las URLs oficiales consultadas están junto a las afirmaciones. La extracción web pudo leer las fuentes usadas; no hubo un host bloqueado para una afirmación retenida en este informe. La búsqueda general de GloriaFood solo produjo una página de recursos de partners con poca información pertinente; se excluyó en lugar de completar huecos con opiniones. Los estudios previos del repositorio se usaron como antecedentes y no sustituyen documentación vigente.

**NO VERIFICADO — evidencia visual.** No se nombra ni evalúa ninguna pantalla concreta de un producto competidor; no se hicieron capturas ni juicios sobre su apariencia. La matriz compara capacidades documentadas. Evaluar visualmente sus flujos requerirá abrir demostraciones operables y capturar cada pantalla. Este límite evita presentar imágenes comerciales como prueba de interacción. Las recomendaciones visuales de Umi se basan en el tema aprobado y la lectura de su código, no en una nueva auditoría de navegador.

**NO VERIFICADO — pendientes.** Disponibilidad comercial y planes por país; flujos reales completos de proveedores; métricas de producción; contratos exactos del resultado final de la integración paralela; política de rotación del QR; deduplicación efectiva del servidor; pruebas reales en teléfonos y red de restaurante. Resolver los puntos operativos con el código y las pruebas del cambio, no con esta comparación.
