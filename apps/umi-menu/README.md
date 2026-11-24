# Umi Menu

Menú digital de Umi. Consume los contratos de `packages/contract` y el catálogo de `umi-api`.
Conserva el tema aprobado: azul Umi, IBM Plex Sans, Bricolage Grotesque y superficies cálidas.

## Uso local

Requisitos: Node 22, pnpm 10.29.3 y Python 3.

```sh
pnpm --filter @umi/menu dev
pnpm --filter @umi/menu check
pnpm --filter @umi/menu test
pnpm --filter @umi/menu build
```

El servidor abre el puerto 56456 en loopback. Reconstruye y recarga después de editar.

| Enlace                               | Función                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `/:handle/menu`                      | Consulta pública del restaurante. Elige sucursal si hay varias. |
| `/:handle/menu?locationId=<uuid>`    | Consulta de una sucursal del restaurante.                       |
| `/qr/:token` o `/table-order/:token` | Consulta y pedido con la credencial de mesa.                    |
| `/?token=<token>`                    | Alternativa para una credencial QR existente.                   |

Los antiguos enlaces `?mesa=1` y los QR ilustrativos de `public/qr` no autorizan pedidos.
Usa una credencial real emitida por la API. Trata el token como una credencial y evita publicarlo en registros.

## Conexión

El build usa `https://api-staging.umiconsulting.co` por defecto. Para una API local:

```sh
UMI_MENU_API_ORIGIN=http://127.0.0.1:4001 pnpm --filter @umi/menu build
```

La variable acepta un origen HTTPS o HTTP local. Se fija durante el build.
El cliente omite cookies y referentes en las llamadas públicas.
La API habilita CORS público sólo para las rutas del menú y los pedidos por token.
Las rutas privadas conservan su lista de orígenes permitidos.

| Solicitud                                        | Contrato                                      |
| ------------------------------------------------ | --------------------------------------------- |
| `GET /api/public/menu/:handle?locationId=<uuid>` | `PublicMenuResponse`                          |
| `GET /api/public/table-order/:token`             | `TableOrderMenu`                              |
| `POST /api/public/table-order/:token/orders`     | `PlaceTableOrderRequest` → `TableOrderPlaced` |

El token determina negocio, sucursal y mesa. El navegador envía productos, cantidades, opciones y notas.
La API calcula los precios y confirma el pedido. El carrito muestra un importe estimado.
El recibo muestra el importe confirmado. No afirma aceptación de cocina ni seguimiento en tiempo real.

La consulta pública reutiliza el catálogo existente. Una sucursal ajena o inactiva devuelve 404.
Sin sucursal explícita, sólo se selecciona automáticamente cuando hay exactamente una activa.
El modelo actual publica negocios activos con handle público y catálogo activo; no añade un interruptor editorial.
Consulta las decisiones y límites en [la nota de API](../../docs/research/2026-11-17-public-menu-api.md).

## Prueba local con el staging desplegado

Para consultar el endpoint QR existente desde loopback sin cambiar CORS en staging:

```sh
UMI_MENU_API_ORIGIN=http://127.0.0.1:56456 \
UMI_MENU_PROXY_API_ORIGIN=https://api-staging.umiconsulting.co \
pnpm --filter @umi/menu dev
```

Abre `/qr/:token` con una credencial emitida para una mesa de staging.
El puente local permite únicamente GET del menú público y POST del pedido por token.
No reenvía cookies, contraseñas ni encabezados de autenticación del dashboard.
El POST exige el origen local y conserva la respuesta de staging; no simula confirmaciones.
Este modo no altera el origen predeterminado del build ni la configuración de producción.
El servidor escucha sólo en `127.0.0.1`.

El 24 de noviembre se validó ONCA, mesa T3, con 64 productos y ocho productos con opciones.
El catálogo procede del endpoint QR desplegado. No se envió ningún pedido.
La credencial de prueba queda fuera del repositorio. No vuelques su token en logs o capturas.
La consulta sin QR aún requiere que la API desplegada incorpore la nueva ruta pública.
La API anterior puede omitir fotos y categorías; la interfaz conserva el respaldo visual.

## Funcionalidad y límites

- Productos, categorías, fotografías HTTPS, precios y opciones provienen de la API.
- La búsqueda ofrece un botón para borrar consultas sin resultados y anuncia el conteo de productos.
- Sin foto real se usa un fondo ilustrativo difuminado y un icono según categoría o nombre. Los productos sin tipo reconocido usan una imagen genérica desenfocada.
- Las fotos reservan espacio y tienen respaldo si fallan; las primeras tarjetas cargan sin demora diferida.
- Los controles principales tienen objetivos táctiles de 44 píxeles y foco visible.
- Las tarjetas giran para mostrar detalles completos. El botón + agrega una unidad o abre las opciones del producto.
- La cara posterior admite desplazamiento, retorno al pulsar el reverso o Escape y movimiento reducido.
- La búsqueda admite acentos. El detalle muestra opciones obligatorias y límites de selección.
- El botón + abre el modal para variantes u opciones; los productos simples entran directamente al carrito.
- La API publica variantes activas por sucursal y valida la selección y el precio al recibir el pedido.
- Una API anterior sin variantes abre el modal y explica que faltan las presentaciones; no se inventan opciones ni precios.
- Sin QR válido, el menú permite consultar productos y sucursales.
- Las respuestas inválidas o los errores muestran una recuperación explícita; no hay catálogo de ejemplo como respaldo.
- No hay recogida, programación, promociones, cocina simulada, solicitud de cuenta ni panel público de personal.
- El pago se realiza en caja. No se incorpora registro obligatorio, reparto ni pago web.

El carrito y el último recibo usan `localStorage`, separado por un hash del contexto.
No se guarda el token en la clave. El almacenamiento antiguo de la demo se ignora.
Antes del POST se guarda el cuerpo y una clave de idempotencia. Un fallo incierto conserva ambos.
El reintento envía la misma solicitud, incluso después de recargar. La API deduplica la clave.
El navegador bloquea cambios mientras el envío está pendiente. Consulta al personal si el problema persiste.
Los bloqueos del navegador coordinan pestañas del mismo origen. Se requiere HTTPS o localhost y un navegador actualizado.
El almacenamiento debe estar disponible para enviar. No se sincronizan borradores entre teléfonos.
No borres los datos del navegador para resolver un envío incierto.

## Estructura y herramientas

`src/` contiene la interfaz; `public/`, los recursos; `dist/` es generado y no se versiona.
Los scripts se cargan como API, estado, catálogo, aplicación, fotografías y navegación.
`api.js` usa los esquemas y las rutas compartidas. esbuild 0.28.2 lo empaqueta para el navegador.
Se conserva JavaScript sin framework. El servidor Python añade el fallback de rutas que falta en `http.server` básico.
El build añade `_redirects` y `_headers` para Cloudflare Pages. Otro host debe configurar el mismo fallback y los referentes.
El dominio y el despliegue comercial permanecen fuera de este cambio.

Fuentes de herramientas: [esbuild](https://esbuild.github.io/api/), MIT;
[Python HTTP server](https://docs.python.org/3/library/http.server.html), PSF;
[Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).
Se usa Node 22.23.4 y Playwright 1.62.1 para la verificación local.
No se añade un servicio externo de pago.

## Verificación

La única prueba nueva comprueba que el reintento conserva el cuerpo y la clave tras un fallo de red.
El recorrido de navegador usa respuestas controladas y datos sintéticos: no crea pedidos en staging.
Cubre mesa, opción obligatoria, recarga tras fallo, confirmación, total del servidor y consulta por sucursal.
La suite existente de API y contratos valida regresiones compartidas.
Esto no acredita un pedido persistido en PostgreSQL ni la revisión desplegada de staging.
La nueva ruta pública necesita el despliegue de esta revisión antes de su uso remoto.

Para el piloto, acuerda un restaurante y una mesa de pruebas antes de enviar un pedido remoto.
Consulta el [playbook](../../docs/development/LOCAL_VERIFICATION_PLAYBOOK.md) y
[la investigación de menús](../../docs/research/2026-11-17-digital-menu-recommendations.md).

## Recursos

Se conservan las fuentes y sus licencias OFL:
[IBM Plex](public/files/IBM-Plex-OFL.txt) y [Bricolage](public/files/Bricolage-OFL.txt).
Las fotografías ilustrativas históricas permanecen como recursos; el catálogo activo usa fotos de la API.
El tema procede del prototipo aprobado `menu-v6.html`.
La revisión editorial anterior usó Unslop de Damir Sokolovsky, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
La skill no se distribuye con el módulo.
