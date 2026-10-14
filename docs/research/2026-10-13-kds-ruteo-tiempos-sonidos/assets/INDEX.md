# Índice de capturas

Fecha: 2026-10-13. Clase: navegador de escritorio, ventana Chromium real, viewport 1280 × 900.
Herramienta: Playwright 1.62.1 sobre Chromium 153.0.8010.52 mediante CDP 9222.
Las capturas de página son documentos públicos renderizados. Los recortes «producto» son imágenes del proveedor dentro del documento.
Ninguna captura corresponde a una cuenta comercial autenticada del competidor.

| Archivo                           | Fuente                                                                                                                      | Contenido y alcance                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| toast-prep-stations.png           | https://support.toasttab.com/en/article/Prep-Stations-Basics                                                                | Página: estaciones y asignación; HTTP 200                       |
| toast-kds-sounds.png              | https://doc.toasttab.com/doc/platformguide/adminKdsConfigQuickRef.html                                                      | Página: referencia de configuración KDS; HTTP 200               |
| toast-product-routing.png         | https://doc.toasttab.com/doc/platformguide/adminAssigningPrepStationsMenuBuilder.html                                       | Recorte de producto: excepción de herencia por ítem; HTTP 200   |
| square-kds-settings.png           | https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android                                            | Página: timers y sonido; HTTP 200; no panel autenticado         |
| square-kds-routing.png            | https://squareup.com/help/us/en/article/8170-filter-orders-by-category-with-square-kds                                      | Página: categorías de cocina; HTTP 200; no panel autenticado    |
| lightspeed-kds-settings.png       | https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0             | Página con ejemplos de producto; HTTP 200                       |
| lightspeed-wait-times-product.png | https://k-series-support.lightspeedhq.com/hc/en-us/articles/22708154090267-Using-the-Kitchen-Display-System-2-0             | Recorte de producto: Wait Times; HTTP 200                       |
| lightspeed-routing-product.png    | https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-the-Kitchen-Display-System-2-0        | Recorte de producto: pestaña Menu categories; HTTP 200          |
| fresh-kds-sounds.png              | https://www.fresh.technology/es/kds-features/sounds                                                                         | Página y ejemplo de tonos; HTTP 200                             |
| fresh-sound-product.png           | https://www.fresh.technology/es/kds-features/sounds                                                                         | Recorte de producto: tonos por evento; HTTP 200                 |
| fresh-kds-time.png                | https://www.fresh.technology/kds-features/on-time-caution-late-ticket-headers                                               | Página y ejemplo de antigüedad; HTTP 200                        |
| parrot-kds.png                    | https://soporte.parrotsoftware.com.mx/es_MX/configuracion-de-pos/conecta-tu-kds-kitchen-display-system                      | Página: conexión del KDS; HTTP 200; sin campos avanzados        |
| softrestaurant-kds.png            | https://softrestaurant.zohodesk.com/portal/es/kb/articles/4-personalizaci%C3%B3n-del-monitor-de-producci%C3%B3n             | Página: video de personalización; HTTP 200; video no transcrito |
| softrestaurant-manual.png         | https://softrestaurant.com/recursos/manuales?download=193%3Ades-mnl-sr11-manual-de-usuario-soft-restaurant-11-v1-0&start=25 | Evidencia de bloqueo HTTP 404; no es pantalla de producto       |
| fudo-kds.png                      | https://soporte.fu.do/es/articles/11730998-sistema-de-monitor-de-cocina-kds                                                 | Página: tiempos, sonidos y aviso al mesero; HTTP 200            |

Reproducción: abre la fuente con Playwright conectado mediante `chromium.connectOverCDP('http://127.0.0.1:9222')`.
Fija el viewport. Espera el documento y las imágenes. Usa `page.screenshot({ fullPage: true })` para página.
Para recorte, usa `locator('img[alt="..."]').screenshot()` sobre la imagen del ejemplo.
El manual tiene dos rutas fallidas: su descarga y `/recursos/manuales`, ambas HTTP 404.
