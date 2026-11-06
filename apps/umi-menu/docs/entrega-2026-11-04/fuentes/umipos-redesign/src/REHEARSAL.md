# Verificación vigente · UMI POS y Dashboard

Revisión del 2 de noviembre de 2026. Prototipo local en http://localhost:56452/. React 18.3, Vite 6.4.5, Stageshow 0.1.0, BoardUI y Chromium de Playwright. No es una revisión ejecutada sobre Flutter, la API ni un periférico real.

## Dirección final

El usuario eligió Rediseño 2 para el POS el 3 de noviembre de 2026. Es la referencia visual vigente y la opción predeterminada: categorías sobre el catálogo, productos sin fotos con nombres destacados y colores por categoría, cuenta a la derecha, navegación compacta, plano con posiciones reales del ejemplo y roles separados. Las propuestas 1 y 3 permanecen disponibles para comparar. El dashboard recupera su identidad original después de que el usuario rechazara la primera propuesta: barra azul marino, marca umidash, Inter Tight/Source Sans 3, encabezado contextual y resumen por ingresos del mes, lealtad, estaciones, centro de acción y actividad.

El acceso conserva el archivo original del pescado como fondo completo. El formulario se integra directamente sobre la imagen oscura, con una sola superficie por campo y etiquetas exteriores. No usa tarjeta blanca ni bordes anidados. Mantiene exactamente:

> Tu operación,  
> en tiempo real.
>
> Supervisa la operación de tu negocio al momento, desde un solo panel.

El texto y el formulario se distribuyen en columnas sobre una misma imagen en escritorio, y en orden vertical en teléfono/tablet. La fotografía no está dividida en paneles.

## Pase de conservación del original y recorrido completo

La instrucción más reciente pide mantener el dashboard casi igual al actual. El shell recupera el saludo original, navegación de 244 px, filas de 44 px, grupos desplegables, contexto de sucursal y selector de negocio al pie. Se retiró el perfil duplicado del pie; permanece en el encabezado. El resumen recupera sus regiones originales. El acceso usa el logotipo umi con ondas, «Hola de nuevo», campos de 52 px y botón azul de 50 px. El contraste de los contornos es 4.26:1; el texto del botón supera 4.5:1.

El recorrido ofrece 62 pasos de propietaria y 64 con plataforma. Se verificaron todos los destinos, blancos visibles del cursor, pausa, repetición, capítulos y exploración. Girar tablet conserva la edición, la revisión y el segundo factor. Pausar o salir de la pestaña conserva escena y posición del cursor. Reencuadrar reinicia el gesto del mismo paso al continuar. El recorrido no sobrescribe el plano local.

Verificaciones de este pase, todas con salida 0 y sin errores de página:

| Suite | Comprobaciones | Alcance |
| --- | ---: | --- |
| `device-qa.mjs --dashboard-tour` | 34 | Recorrido completo Windows/iPhone, pausa, visibilidad, giro, edición, movimiento reducido y aislamiento del plano. |
| `device-qa.mjs --dashboard-auth` | 56 | Cinco formatos, frase/fondo, acceso, MFA, recuperación y preferencia de correo tras recarga. |
| `device-qa.mjs --dashboard` | 140 | Navegación real, módulos, detalles y formatos. |
| `device-qa.mjs --dashboard-mobile` | 151 | Vistas/acciones en iPhone y Android, plano, selector y conteo. |
| `dashboard-parity-qa.mjs` | 25 | Contextos, filtros, roles, clientes, regalos, dispositivos, compras e importación CSV. |
| `device-qa.mjs --dashboard-regression` | 22 | Guardado, PIN/confirmación, Owner, variantes, ruta, KDS, geometría y reportes. |
| `device-qa.mjs --interface` | 17 | Controles, fuentes, contraste y teclados. |
| `pos-parity-qa.mjs` | 49 | Rondas, anulaciones, pagos parciales/mixtos, transferencia, terminal incierta, mesas, traslado, grupos y limpieza en escritorio/móvil. |
| `operations-qa.mjs` | 54 | Caja, conteo, turnos y configuración de hardware simulada. |
| `three-flows-qa.mjs` | 29 | Menú digital, comer aquí y para llevar, roles y resultado del cobro. |

`payment-layout-qa.mjs` pasó en escritorio y móvil. Comprueba límites del dispositivo, pie bajo los campos, botón alcanzable y teclado desplazable con pie fijo. En escritorio el teclado completo es visible al abrir. Se corrigió una regla heredada que colocaba el pie arriba y otra que ocultaba folio/personas/tiempo de mesa en móvil.

También pasaron TypeScript, build y los modelos de POS, filtros/importación y pausa/cancelación (6 casos). El build emite una advertencia de tamaño: entrada compartida de 1,007 kB y ExcelJS diferido de 940 kB, sin comprimir. No son mediciones de la aplicación real.

Las grabaciones `dashboard-tour-desktop-film` y `dashboard-tour-mobile-film` contienen 30 cuadros cada una del capítulo Productos. Sus informes terminaron con salida 2: huecos de muestreo y observaciones de recorte/transición. La certificación de todos los cuadros sigue inconclusa. El visor mantiene las dimensiones de dispositivo solicitadas; una ventana de navegador menor escala el marco. Los tests de interacción no sustituyen esta revisión de animación.

La matriz contiene 132 criterios. [El estado de implementación](../docs/dashboard-parity-implementation.md) mantiene las brechas de UI; tema/idioma, Wallet/marca, costos, preparación y permisos granulares siguen incompletos. Ningún resultado de la maqueta certifica integración real ni autoriza declarar paridad completa.

## Evidencia del pase anterior

Estos informes pertenecen al pase anterior a las ampliaciones de paridad y el recorrido completo del dashboard. Terminaron con cero errores de navegador en esa versión. No certifican los cambios posteriores. Los conteos son aserciones de cada suite y se solapan; no equivalen a funciones independientes del producto.

| Suite | Comprobaciones | Qué demuestra |
| --- | ---: | --- |
| `redesign-qa.mjs` | 61 | Interacción general POS, catálogo, cobro, roles, ejemplos y transiciones. |
| `operations-qa.mjs` | 54 | Configuración, hardware simulado, entradas/salidas, retiro, autorización, conteo por política y cierre local. |
| `device-qa.mjs --dashboard` | 140 | Navegación por módulos/vistas, búsquedas, detalles, preparación ilustrativa, ajustes y seis formatos. |
| `device-qa.mjs --dashboard-mobile` | 145 | 47 vistas en iPhone/Android, acciones, listas, menú, selector, mesas completas y conteo con decimales. |
| `device-qa.mjs --dashboard-auth` | 53 | Fondo original completo, texto original, ausencia de superposición, zonas seguras, contraseña visible, error, acceso, MFA y recuperación local. |
| `floor-editor-qa.mjs` | 60 | Edición por área/mesa, 7 tipos, geometría, arrastre, cuadrícula, teclado, historial, persistencia local, publicación con bloqueos y seis dispositivos. |
| `device-qa.mjs --dashboard-regression` | 16 | Guardado al confirmar, altas por columna, protección Owner, PIN oculto, estados editados, coordenadas negativas y período coherente con CSV. |
| `device-qa.mjs --select-qa` | 29 | Apertura con un clic, selección, teclado, Escape, cierre exterior y límites en cuatro formatos. |
| `device-qa.mjs --interface` | 17 | Botones de 48 px/radio 8 px, fuentes, contraste real del texto, campos de acceso de 52 px con un solo borde y teclados PIN/cobro 22 px/500. |

Informes JSON y capturas: `../shots/`. `npm run typecheck` y `npm run build` completados. Build advierte de un paquete JS de aproximadamente 869 kB sin comprimir; sigue siendo el prototipo completo con ambos productos y el visor.

Las suites de tablet vertical (31), dispositivos (40), catálogo (23), plano POS (5) y tres recorridos (29) se ejecutaron en el pase anterior de esta revisión. Sus resultados son evidencia de ese pase; no se presentan como una ejecución nueva posterior al último cambio del texto de acceso. El QA general y de Caja volvió a ejecutarse después de modificar los controles compartidos.

## Correcciones verificadas

- La identidad del dashboard se comparó visualmente con las capturas del producto original. La revisión independiente reconoció el retorno de su estructura, marca, fuentes y navegación.
- Los formularios de móvil usan una columna; las listas sustituyen tablas anchas. El plano mantiene su geometría y las seis mesas caben en la vista ajustada.
- Configurar cobro no crea una fila. Las altas distribuyen valores por campo/columna; confirmar guarda antes de mostrar el resultado. Cambiar de módulo no descarta lo confirmado.
- Las acciones que solo representan un recorrido indican simulación, sin afirmar que alteraron saldos, existencias o dispositivos.
- El contraste medido del contorno del acceso es 4.32:1. El texto real de Entrar supera 4.5:1. Se comprueba el color del texto hijo, porque medir solo el contenedor no detectaba el texto blanco incorrecto.
- El selector inferior parecía cerrarse por un evento de scroll pendiente del autoscroll de Playwright. La prueba con desplazamiento asentado y un solo clic físico funciona. No se añadió un workaround de producción ni un reintento silencioso a la prueba.
- El editor admite coordenadas enteras incluso al rotar un objeto junto al borde. El caso fue reproducido fallando y pasó después de corregir el ajuste.

## Capturas de referencia

- `dashboard-auth-windows.png`, `dashboard-auth-iphone.png`: acceso final con frase original y campo de un solo borde.
- `dashboard-windows-overview.png`, `dashboard-iphone-overview.png`: estructura recuperada del original.
- `dashboard-windows-products.png`, `dashboard-dark-form.png`: listas y formularios.
- `floor-editor-{windows,mac,iphone,android,ipad,galaxy}.png`: editor con el marco final.
- `gold-table.png`: ejemplo Stageshow del que partió el estudio POS. El dashboard se contrasta además con el producto original, no con otra plantilla.

## Límites

El alcance funcional se detalla en [prototype-parity.md](../docs/prototype-parity.md). Las operaciones locales y simulaciones no certifican la lógica, permisos, autenticación, concurrencia, recuperación, pagos parciales ni hardware del producto. No se ha creado PR, fusionado ni desplegado. [staging-integration-audit.md](../docs/staging-integration-audit.md) registra la secuencia propuesta y las comprobaciones reales necesarias.

La certificación de todos los cuadros de animación sigue **inconclusa**. Las grabaciones históricas `roles-wide` y `roles-mobile` tuvieron huecos de muestreo y observaciones de transición. Las pruebas de interacción llegan al resultado esperado, pero no prueban todos los cuadros ni certifican animación completa.


## Task 3F — tres diseños, 2 de noviembre de 2026

La propuesta1 se conserva; la2 ahora usa categorías horizontales y teclas de trabajo con fotos parciales; la3 retoma el menú navy/pestañas/comanda del UMI original con entradas horizontales. Se reutilizaron los frames, el ejemplo base `table-edit`, Workspace/Scene y el tour existente. Referencias inspeccionadas: `public/actual.png`, `/private/tmp/umi-inspo-zavo.png` y `/private/tmp/umi-zavo-pos-screen.png`. Dirección, auditoría y alcance en [redesign-three-options.md](../docs/redesign-three-options.md).

Evidencia nueva: `shots/option2-revision/` y `shots/option3/`, separada de la anterior opción2. Cada una contiene `tour-windows.png` y `tour-phone-dark.png`, con sus reportes/logs íntegros. Las cuatro hojas (28 capturas/54.8s) muestran el recorrido hasta recibo y el resultado se mantiene. Se revisaron PIN, carta/cuenta, modificadores, recepción, mapa, KDS, pago, caja, ajustes y resultado; ambos temas y los perfiles Windows/Mac/iPhone/Android/iPad/Galaxy están en capturas/matriz.

El gate automático de los cuatro films quedó **inconcluso, exit2**, con17/14/19/16 líneas de gate para2 desktop/2 phone/3 desktop/3 phone, respectivamente. Gaps máximos117.3/73.3/86.4/76.6ms. Incluye transiciones enteras de pantalla y overrides/framing heredados; no se certifican los frames omitidos ni se afirma rehearsal passed. Se mantuvieron los detectores sin exclusiones artificiales. El film desktop2 precede una corrección dirigida de20px en espacio del teclado: `payment-windows.png`, `payment-1440.png` y `payment-layout-qa.log` posteriores muestran el estado corregido; el resto de films corresponde a ese estado final.

Verificación por diseño: selector11, matriz95, auditoría54 combinaciones/4 aserciones, tres flujos29, roles45, paridad49, operaciones54 y auditoría final dirigida7, todas PASS; layout de pago exit0. Auditorías de tamaño real: labels>=12px, targets>=44px y sin overflow horizontal en los casos medidos. Fotografías sin filtros/máscaras en los dos temas; foco Tab y reduced-motion probados. La escala externa del frame de teléfono se conserva. Root confirmó0 píxeles distintos en1 antes/después y build/typecheck pasan. No hubo hardware/banco/native reales ni auditoría completa de lector de pantalla.

## Task 3G — PIN y venta diferenciados, 2 de noviembre de 2026

La propuesta2 ahora prescinde de fotos de productos, también en modificadores y Ajustes. Mantiene teclas de tamaño variado y usa un PIN central con selección visible de operador. La propuesta3 recupera la navegación navy, pestañas y Frecuentes del UMI original, con nombre completo a18px, categoría escrita, borde de categoría y precio alineado; su PIN usa una banda de identidad navy y un área de acceso separada. Se conservan los frames, el ejemplo base, los objetivos del cursor y la coreografía anteriores. La preferencia de fotos de1 y la cuenta sobreviven al cambio de diseño; la navegación recuerda la elección de cada propuesta.

Evidencia local nueva en `shots/product-identity/`: producto126, PIN89, paisajes17, no-regresión de encaje9 y matriz existente2 de catálogo96, todas sin errores de navegador. Los conteos se solapan. Incluyen ambas propuestas/temas, teléfonos y tablets verticales/horizontales. Se corrigió el pie de página fuera del viewport en PIN horizontal2 de iPad/Galaxy y3 de Galaxy; todos los controles medidos conservan al menos44px y las etiquetas12px. Venta1 mantiene una captura byteidéntica. No se creó una comparación de píxeles específica de PIN1.

La revisión independiente aprobó especificación y calidad sin hallazgos. Typecheck y build final completados. El build conserva la advertencia previa de tamaño de chunks. Publicado en `https://215aa642.umi-stageshow.pages.dev/`, disponible mediante `https://umi-stageshow.pages.dev/`. Root verificó42criterios públicos de selección, fotos, cuenta, PIN y roles; los recorridos reales comenzaron en cada PIN nuevo, cambiaron2→3 y3→2 durante venta y llegaron al recibo pagado. Otras13comprobaciones públicas de POS/dashboard pasaron; ambos informes carecen de errores de navegador y recursos.

El resultado público valida la interacción y el destino de los recorridos, no cada cuadro de animación. No se repitieron los cuatro films anteriores ni se afirma `rehearsal passed`: el análisis automático histórico sigue inconcluso. Esta entrega corresponde al prototipo web, sin certificar integración nativa, hardware ni mejoras medidas con operadores.

## Complete directions 3H — 2026-11-02

The existing Stageshow product/frame/tour is the starting composition; no device chrome, animation system or story targets were replaced. Source references: the original UMI screenshot and the two approved Zavo catalogue images. Other operational surfaces are UMI design extrapolations.

All ten operational surfaces now follow complete direction2 (working zones/keys) or direction3 (comanda/register). Root reviewed the first composed pass and requested bounded fit corrections: a reserved-width modifier inspector, full floor geometry, a true payment document footer, complete phone keypads, denomination-field density, explicit cash operation keys and a continuous mobile ledger for3. These corrections are included without a second visual concept.

Manual flows and animated story checks ran through existing three-flows and role-flow suites for both directions. Existing parity and operations suites covered payment/rounds/tables and cash/hardware. The focused state probe confirms fields, counts, selected tables, partial-payment records and unknown terminal attempts survive 3 → 1 → 2 switches. Geometry covers all supported target device/orientation pairs; the shortest tablet safe heights are included.

Artifacts live under `shots/full-directions/`. Some early review frames were superseded by final images at the same per-state filenames; independent original1 evidence is preserved under `before-design1`. Tests are browser simulations; native API, real terminal/receipt hardware, real cash policies and deployment are outside this implementation. Root owns final build, immutable review and public tours/Pages regression.

Final compact-payment check: the change band stretches to370px on iPhone and380px on Android; its label/value rectangles are separated by262.8/272.8px in both themes and both designs. This corrects an inherited desktop alignment without changing the payment state or keypad. Recorded in `phone-payment-band-metrics.json`.

Root closure: independent complete-direction review passed with no findings. Final build passed, preserving the existing chunk-size warning. Published bd540773;53 public checks and13 shared Pages checks passed with no browser/resource errors. All six actual tours (digital/here/takeaway for2/3) reached paid135 receipts. Original1 comparison was28/30 pixel-identical after settling; two KDS frames retain33/64 localized pixels near glyphs, with no concrete composition regression established. This is not a30/30 identity claim or automatic motion certification.

Pedidos3 follow-up: user feedback identified an awkward stretched register and duplicated identity. It now uses one informative header and expanded ruled comanda, with note/total/attend ending; accepting replaces it with the existing empty/resume action. Root inspected Windows/light, dark iPhone and portrait tablets. Scoped source review passed; the four reviewed hashes match the built source. Focused14 device/theme cases and29 existing three-flow checks passed, as did typecheck/build. Evidence under `shots/incoming3-followup/`.

Published correction: `https://a2eb13dc.umi-stageshow.pages.dev/`, served by `https://umi-stageshow.pages.dev/`. Root public21 checks passed, including acceptance/empty/resume in Windows/iPhone/Galaxy and the digital tour through paid135 receipt, with no browser/console/resource errors. An immediate earlier attempt saw previous markup and a CSS MIME mismatch during rollout; subsequent stable/immutable HTML and CSS hash checks matched the final build before the unchanged helper passed. No cache-busting or weaker assertions were used. Native/backend/hardware and every animation frame remain uncertified by these browser checks.

Design2 list correction (2026-11-03): fixed44px account/table Buttons clipped58/66px Row content and kept amounts beside names. The scoped fix lets rows determine Button height and spans labels across the available width; an installed ScrollFade accompanies the bounded desktop list and resets on remount. Row data/callbacks, map geometry and1/3 list markup are preserved. Root reproduced the failing containment check before editing, then passed14 local device/theme cases and7 public cases covering complete row bounds, final-table selection, map roundtrip, fade reset and account039 restoration. Source review, typecheck and build passed (existing size warning retained). Published `https://4bb7e0db.umi-stageshow.pages.dev/`; stable shared link updated. Evidence/report: `/private/tmp/umi-list2-review/validation.md`.


Catalogue/KDS/menu follow-up (2026-11-03): design2 product sizes now follow the existing sample-sales top three (Latte24, Concha20, Americano16), with a quiet Más pedido label and stable product IDs. Nuevo pedido uses the existing primary BoardUI control; footer reference links were removed while photo credits remain. KDS2 now hides/restores ready station rounds with a live count and reclaimed column space; no scene mutation is performed by the filter. Digital menu photographs now occupy their own clear image area above names/prices, with complete contained photos in product details. The canonical menu stylesheet is synchronized into both interactive and tour builds. The existing Stageshow/device compositions and animation script are preserved.

Independent scoped review PASS with zero findings. Local catalogue67, KDS98, menu-photo41 and existing menu-flow19 checks passed; typecheck/menu build/main build passed with the previous chunk-size warning. Published78ee2d29; stable-URL catalogue39, KDS56 and menu-photo41 checks passed with no browser/resource errors. Counts overlap. Evidence and five-file hash manifest: /private/tmp/umi-priority-ready-photos-review/. This is a prototype with illustrative sales/photos, not a backend popularity integration. Automatic motion certification remains inconclusive; native work remains paused.


Más pedido tag follow-up (2026-11-03): the plain label now uses the installed BoardUI Badge with4px/8px padding and the existing ink/surface semantic pair, inverting automatically in dark mode. Root inspected local Windows/light and iPhone/dark and the actual public Windows frame. Scoped review PASS, zero findings; typecheck/build pass with the existing chunk warning. Local67 and public39 existing catalogue checks exit0, no browser errors. Published56c53128 at the stable umi-stageshow.pages.dev URL. Both reviewed source hashes still match. The popularity ranking, product actions and other designs are unchanged. Evidence: /private/tmp/umi-popular-tag-review/.


Product-name hierarchy follow-up (2026-11-03): design2 names now use the18px/26px/600 BoardUI title composite. Más pedido is a12px/500 outlined badge with transparent fill.112px base rows and8px vertical padding preserve full2line names while all desktop sample products/prices remain visible; popular products still span2rows. Scoped one-file review PASS, zero findings; typecheck and final build pass with existing chunk warning. Existing catalogue67 checks pass. Local and public geometry each cover14 device/theme states and168 product observations, no contained-text/price/overlap problems or browser errors. Root reviewed final Windows/light, iPhone/Pan and dark phone compositions. Published8ca5e066 at https://umi-stageshow.pages.dev/. Reviewed CSS hash and prior main.tsx hash still match. Evidence: /private/tmp/umi-product-hierarchy-review/.


Selected POS direction (2026-11-03): the user chose Rediseño 2 as the winning redesign. Root/unspecified/invalid design URLs now open2, the picker marks it Elegido, and the default Workspace used by digital-menu staff scenes follows2. Explicit1/3 links and switching remain available. README and the current REHEARSAL direction identify2 as the implementation reference, with full current functionality still required. Scoped review PASS, zero findings; typecheck/build pass with the existing chunk warning. Local and stable-public probes each record33 observations: default PIN/sale/phone/KDS2, explicit designs honored, added Americano preserved through1→3→2,18 staff embed states on desktop/phone all2/no overflow, and the actual default Comer aquí tour reaches its paid receipt with65 change. No browser/resource errors. Publishedb1adc1e9 at https://umi-stageshow.pages.dev/. Reviewed source hashes match before this documentation append. Evidence: /private/tmp/umi-selected-design-review/. Arrival at receipt is not exhaustive animation-frame certification. Native/integration work remains paused; this choice records the visual target, not runtime acceptance.


## Native Android implementation — 2026-11-04

The user resumed native implementation after selecting Rediseño 2. The [draft PR #252](https://github.com/umiconsulting/umi/pull/252) targets staging. Final native product source is2fd267ed; this prototype remains the visual authority at releaseb1adc1e9. No prototype UI changed for this native checkpoint.

| Acceptance area | Current evidence |
| --- | --- |
| Selected presentation | Real Android phone and tablet captures, including account before/after, partial payment, count and both map orientations. |
| Native source |1,292 Flutter tests pass; five existing Linux skips. Full analyzer has zero errors/warnings and three existing infos. |
| Operation | Native note/quantity, interrupted-connection recovery, cold restart, partial cash, manual confirmation and zero-variance shift close. Two-station work retains its sibling. |
| Open baseline failures | Digital binding plus manual ring-up duplicates preparation. Refused account switching after a partial payment can leave optimistic local lines. |
| External limits | Physical printer/drawer, real payment provider, variance/handoff and final native table grouping remain unverified. |

The [native runtime report and twelve captures](https://github.com/umiconsulting/umi/blob/feat/redesign-parity/docs/reports/2026-11-03-pos-design2-native-runtime.md) identify each exact checkpoint. This draft supports team tests; it does not certify complete operational acceptance or authorize production promotion.
