# MVP local del menú Umi

Demo funcional para revisar con datos ficticios. No es la integración de producción.

## Abrir

Puedes abrir `index.html` con Chrome para revisar la demo sin instalar dependencias.
Para enlaces, QR y sincronización entre pestañas, usa un servidor local desde la raíz del paquete:

```sh
python3 -m http.server 56455 --bind 127.0.0.1 --directory mvp-local
```

Abre http://127.0.0.1:56455/index.html. Detén el servidor con Ctrl+C.

- Recogida: `http://127.0.0.1:56455/index.html`
- Mesa 1: `http://127.0.0.1:56455/index.html?mesa=1`
- Mesa 2: `http://127.0.0.1:56455/index.html?mesa=2`
- Mesa 12: `http://127.0.0.1:56455/index.html?mesa=12`

Usa siempre el mismo origen. `localhost` y `127.0.0.1` guardan datos separados.
La persistencia al abrir archivos directamente depende del navegador. El servidor es la opción recomendada para revisar los flujos.

## Alcance

- Diseño v6: fotografías, IBM Plex Sans, Bricolage Grotesque y paleta aprobada.
- Secciones: destacados, desayunos, café y bebidas, panadería y postres.
- Búsqueda, opciones, extras, indicaciones y carrito persistente.
- Tres promociones ficticias con precios de combo y productos seleccionables.
- Carrusel automático cada cinco segundos, con deslizamiento, flechas, indicadores y teclado. Sin botón de pausa. Se pausa durante la interacción y empieza detenido si el sistema pide movimiento reducido.
- Ficha del producto con ampliación opcional de su propia foto. No navega a otros productos.
- Movimiento suave y respeto a la preferencia de movimiento reducido.
- Recogida con nombre, teléfono y correo; pago en el negocio.
- Mesa identificada por enlace o QR. Pedidos asociados a su número.
- Solicitud de cuenta por mesa, visible en el panel «Personal».
- Seguimiento local, aceptación, rechazo con motivo, vencimiento y cancelaciones.
- Cocina y barra deben terminar antes de marcar el pedido listo.
- Recogida programada: reserva, liberación por hora y límite de cancelación.
- Simulación de cobro y entrega sobre el mismo pedido.
- Pausa de pedidos nuevos y reinicio de la demo.

## Recorrido de revisión

1. Abre una promoción o producto. Revisa foto, opciones y cantidad.
2. Agrega productos de cocina y barra. Recarga para comprobar el carrito.
3. Confirma una recogida con `Ana Demo`, `6690000000` y `ana@example.com`.
4. En «Personal», acepta el pedido. Termina solo barra: el pedido debe seguir en preparación.
5. Termina cocina. Simula el cobro y la entrega. No debe aparecer otro cobro disponible.
6. Crea otro pedido. Prueba cancelación pendiente, rechazo o vencimiento.
7. Programa croissants para mañana. Acepta: debe quedar reservado. Avanza el reloj desde «Personal» para liberar.
8. Abre el enlace de mesa 1. Pide un producto: debe ir a preparación sin aceptación.
9. Pulsa «Pedir la cuenta». Comprueba «Mesa 1» en el panel del personal y marca la solicitud atendida.
10. Pausa pedidos. El catálogo y los pedidos existentes deben seguir disponibles.
11. Revisa a 390 y 1440 px, navegación por teclado, carrusel y ampliación individual.

## QR en un teléfono

Los QR incluidos apuntan a `127.0.0.1` y solo sirven en el equipo que ejecuta el servidor.
Para probar un teléfono en la misma red, inicia el servidor con `--bind 0.0.0.0` y genera QR con la IP del equipo:

```sh
python3 mvp-local/generar-qr.py --base-url http://IP-DEL-EQUIPO:56455
```

El generador requiere el paquete Python `qrcode`, disponible en el equipo revisado. Los SVG ya incluidos no requieren instalarlo.

Los pedidos viven en el navegador del teléfono. El panel «Personal» debe abrirse en ese mismo navegador. Esta demo no sincroniza pedidos entre dispositivos.

## Límites explícitos

- No hay API, PostgreSQL, POS Flutter, KDS real ni proveedor de correo conectado.
- El navegador controla la simulación. No hay autoridad comercial del servidor ni protección de QR de producción.
- Un enlace de seguimiento recupera datos del mismo navegador. No es un enlace privado de producción.
- La demo no reserva inventario, aplica impuestos reales ni verifica disponibilidad del negocio.
- Horarios, promociones y plazos son ejemplos: no resuelven las decisiones MD-Axx.
- La liberación y el vencimiento se calculan al abrir la página y mientras permanece abierta.
- Avanzar el reloj afecta todos los pedidos de la demo. Reiniciar restablece la hora.
- La persistencia entre pestañas es auxiliar; no ofrece transacciones ni garantías frente a escrituras simultáneas.
- La solicitud de cuenta es un aviso simulado. No procesa un pago.

## Origen y cambios de alcance

La interfaz deriva de `fuentes/umi-menu-preview/.superpowers/brainstorm/18629-1793487079/content/menu-v6.html` y `menu-redesign.css`.
Se preservaron las fuentes originales y la compilación de entrega. Las licencias de fuentes están en `files/`.
Fotografías ilustrativas de Unsplash, con la procedencia documentada en `fuentes/umi-menu-preview/README.md`.

El usuario autorizó una demo local. Durante la tarea solicitó pedir la cuenta por mesa, promociones, interacciones visuales y conservar las secciones y el estilo. Estas adiciones no se registraron como decisiones de producción ni como historias terminadas en staging.

Referencias de interacción consultadas el 5 de noviembre de 2026:

- https://www.vintotap.com/en/qr-menu — ficha individual con fotografía y descripción.
- https://www.doxmenu.com/ — navegación por productos, pedido y solicitud de cuenta.
- https://www.lookdigitalsignage.com/es/menu-digital — promociones fotográficas para pantallas. Adaptación propia al móvil.
- Capterra: índice de software de catering; no se usó como referencia de interacción. Su enlace publicitario no fue recuperable.
- El enlace de Colega Studio no fue recuperable. El diseño local aprobado sigue siendo la referencia visual.

No se descargaron imágenes de esas páginas.

## Comprobaciones

```sh
node mvp-local/state.test.cjs
node --check mvp-local/base.js
node --check mvp-local/state.js
node --check mvp-local/app.js
node --check mvp-local/visual.js
```

Consulta `VALIDACION.md` para los resultados y límites de esta revisión.
