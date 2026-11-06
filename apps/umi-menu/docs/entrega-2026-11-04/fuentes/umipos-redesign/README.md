# UMI POS + Dashboard · Prototipo de rediseño

Vista local: **http://localhost:56452/**.

Vista para compartir: **https://umi-stageshow.pages.dev/**. Incluye POS, Dashboard, Menú digital y el selector de dispositivos. El enlace es público y usa datos de ejemplo.

Para publicar una actualización con la sesión de Cloudflare autorizada: `npm run deploy:pages`. La configuración y la verificación están en [docs/cloudflare-pages.md](docs/cloudflare-pages.md).

Maqueta interactiva de React y Stageshow. Conserva las fuentes y el azul UMI. Usa componentes reales de BoardUI para acceso, configuración y Caja, adaptados con Unslop al mismo acabado plano de la operación.

## Diseño elegido del POS

El usuario eligió **Rediseño 2** el 3 de noviembre de 2026. Es la referencia visual para la implementación del POS y la opción predeterminada de Stageshow, incluidos los escenarios del personal dentro del recorrido del menú digital. La referencia incluye acceso con PIN, venta, modificadores, cuenta, pedidos, mesas y plano, Barra/Cocina, cobro, Caja y configuración.

Las propuestas 1 y 3 quedan disponibles para comparar mediante el selector o los enlaces `?design=1` y `?design=3`. La elección visual conserva el requisito de mantener las funcionalidades actuales; la integración y sus verificaciones se registran en la matriz de aceptación y el plan de staging.

## Dashboard

El selector del visor cambia entre POS, Dashboard y Menú digital. Los tres comparten los botones Explorar / Recorrido y el mismo estilo de selección. Accesos directos: [Resumen](http://localhost:56452/?app=dashboard&view=overview), [iPhone](http://localhost:56452/?app=dashboard&view=overview&device=iphone), [Plano](http://localhost:56452/?app=dashboard&view=floor), [Acceso](http://localhost:56452/?app=dashboard&view=login).

La propuesta conserva la identidad del dashboard original: barra azul marino, marca umidash, Inter Tight y Source Sans 3, encabezado del negocio y resumen de ingresos del mes, lealtad, estaciones y actividad. Las tablas, formularios y navegación usan controles BoardUI; el acceso mantiene el pescado original como fondo completo. El formulario se integra sobre el fondo oscuro, sin tarjeta blanca ni bordes anidados; cada campo tiene una sola superficie.

La dirección vigente mantiene el dashboard casi igual al actual. Se recuperan el saludo, la densidad de navegación, los grupos desplegables y la composición del resumen. El acceso usa la marca umi con sus ondas, «Hola de nuevo» y el botón azul del original. Los cambios se limitan a legibilidad, controles y adaptación de formatos.

El [recorrido del dashboard](http://localhost:56452/?app=dashboard&play) incluye acceso, segundo factor y todos los destinos: 62 pasos de propietaria, 64 con plataforma. Ofrece capítulos, pausa, anterior/siguiente y exploración de la pantalla visible. [Versión iPhone](http://localhost:56452/?app=dashboard&play&device=iphone). La pausa conserva el gesto; cambiar de formato pausa en el mismo paso y vuelve a iniciar su gesto al continuar.

Incluye 18 módulos de navegación y perfil, 47 vistas y separación entre propietario y plataforma. El editor del plano incluye áreas, siete elementos, propiedades, arrastre, historial, cuadrícula, zoom y publicación condicionada por mesas ocupadas afectadas. Las funciones del código actual están inventariadas en [docs/dashboard-current-inventory.md](docs/dashboard-current-inventory.md). La corrección de identidad está documentada en [docs/dashboard-original-identity.md](docs/dashboard-original-identity.md).

Acceso de ejemplo: **sofia@example.com / UmiDemo2026**. MFA de ejemplo: **135790**, con `?app=dashboard&view=login&auth=mfa&method=totp`. Recuperación y envío de correo son simulados.

La [matriz de aceptación](docs/redesign-functional-acceptance.md) registra 132 criterios y sus fuentes. El [estado de implementación](docs/dashboard-parity-implementation.md) separa avances locales de brechas pendientes. Mostrar todas las vistas no acredita paridad funcional. El [plan de integración en staging](docs/staging-integration-audit.md) enumera los PR, verificaciones y límites; no se ha abierto un PR ni modificado las aplicaciones reales.

## Menú digital

La sección [Menú digital](https://umi-stageshow.pages.dev/?app=menu) reúne la maqueta del cliente y el [recorrido por pasos](https://umi-stageshow.pages.dev/?app=menu&menuView=tour). Permite explorar productos, opciones, carrito, recogida, mesa y seguimiento; el recorrido comparte controles BoardUI y marcos de dispositivo con el Dashboard, e incluye pausa, repetición, modalidad y avance por capítulo. El menú interactivo usa el selector de dispositivos y conserva el pedido al cambiar de formato.

El origen es el prototipo local vecino `../umi-menu-preview/`, versión `menu-v6.html`, con el diseño de este proyecto. `npm run build:menu` sincroniza el menú y construye el recorrido bajo `public/menu-digital/`. La publicación ejecuta este paso antes de generar `dist`, por lo que no depende de servidores localhost. `scripts/menu-preview-state.js` conserva el estado de la maqueta en la pestaña del visor; no escribe en almacenamiento remoto.

Las escenas del personal reutilizan los componentes de este redesign: Dashboard para configurar, Workspace para recibir y cobrar, y Kitchen para preparar. La ruta `/?embed=menu-staff` recibe el estado de la escena y devuelve los objetivos medidos del cursor. No mantiene una copia visual del POS o Dashboard anterior.

El menú independiente está en [/menu-digital/menu.html](https://umi-stageshow.pages.dev/menu-digital/menu.html). Bruma y sus pedidos son ficticios. El correo sigue representado en las escenas; la maqueta interactiva captura nombre y teléfono. No se envían pedidos, correos ni pagos reales.

## Recorridos

Los tres recorridos empiezan con acceso por PIN:

| Recorrido | Cuenta | Servicio |
| --- | --- | --- |
| Menú digital | 043 · Lucía Hernández | Para llevar |
| Comer aquí | 042 · Mesa 03 | En mesa |
| Para llevar | 044 · Mostrador | Para llevar |

Caja recibe o toma el pedido, envía la comanda y consulta el avance. Barra recibe y prepara bebidas; Cocina recibe y prepara alimentos. Cada estación ve sólo sus productos. Caja confirma la entrega y cobra. El ejemplo termina con $135 cobrados, $200 recibidos y $65 de cambio.

El selector **Dispositivo de vista previa** incluye PC/Windows, Mac/macOS, iPhone 17 Pro/iOS, Pixel 8/Android, iPad Air 11″ y Samsung Galaxy Tab A11. Las tablets ofrecen **Vertical / Horizontal**. Cambiar de dispositivo conserva la cuenta; girar la tablet conserva también el conteo en curso. Sin selección explícita, el visor usa iPhone en ventanas pequeñas y Windows en ventanas amplias.

Los formatos de pantalla son 1280 × 780 para escritorio, 402 × 874 para iPhone, 412 × 915 para Pixel, 820 × 1180 para iPad y 800 × 1340 para Galaxy Tab. Son escenarios de maquetación, no emuladores ni mediciones del escalado de un dispositivo físico. Los marcos usan los componentes Phone y Window de Stageshow, con variantes de tablet y Windows. Los controles se mantienen fuera de las zonas del sistema.

“Ver recorrido completo” reproduce la secuencia, incluido el PIN inicial. Las transiciones animadas de rol representan estaciones ya abiertas. “Explorar” conserva el estado visible. El selector de usuarios pertenece al visor; sus cambios manuales requieren el PIN correspondiente.

PIN de demostración: Caja **2580**, Barra **3690**, Cocina **1470**. Las autorizaciones gerenciales de Caja usan **4826**. La entrega de turno usa **6842** para Sofía, la cajera entrante de muestra. Estas claves públicas sólo operan la maqueta.

## Distribución

- Escritorio: productos a la izquierda, categorías sobre el catálogo y cuenta a la derecha. La cuenta conserva su posición al cobrar.
- Navegación: Venta, Pedidos, Mesas y Caja. Configuración queda al pie. El control de despliegue está dentro de la barra, bajo el logo, sobre fondo neutro.
- UMI permanece visible con el menú contraído y en móvil.
- Todo muestra botones independientes con nombre, categoría escrita, precio y superficie propia de cada categoría. No hay separadores por grupos ni signos `+` en productos.
- El POS elegido identifica productos sin fotos: nombre destacado, categoría y precio. Los tres más pedidos de los datos de ejemplo tienen botones mayores y una etiqueta discreta. Las fotografías nítidas se reservan al menú digital del cliente.
- Las opciones del Latte reemplazan el catálogo; la cuenta sigue visible en escritorio. En móvil ocupan el área de trabajo y vuelven a la cuenta si se abrieron desde ella.
- Móvil usa categorías compactas, regreso a la carta arriba de la cuenta y acciones de envío/cobro juntas al pie. En tablets verticales, las categorías van sobre los productos y la cuenta conserva una columna lateral.
- El plano conserva posiciones y formas. Las mesas libres usan verde. Móvil permite ver el plano completo o ampliarlo.
- El acceso muestra turno, mesas libres y pedidos del menú digital pendientes antes del teclado PIN.

## Configuración y Caja

La organización se basa en la lectura del código del POS actual. El inventario con fuentes está en [docs/current-pos-options.md](docs/current-pos-options.md).

Configuración agrupa dispositivos, impresión, pantalla y sesión. Incluye impresora de tickets, cajón, registro manual, conexión USB/red/puerto de terminal, prueba, activación, impresora principal y registro local de pruebas. Impresión conserva los dos ajustes visibles del POS actual: impresión al cobrar y una a tres copias. El KDS sólo ofrece pantalla y sesión.

Caja permite entradas, salidas, retiro a caja fuerte, solicitud autorizada de apertura del cajón, suspensión, reanudación y entrega del turno. El cierre sigue conteo → revisión de diferencia → conciliación → confirmación. Se puede recontar, volver al turno o abrir otro con fondo por denominación. En móvil, Movimientos, Turno y Cierre tienen pestañas propias. Las entradas, salidas y retiros tienen identificación de color, icono y efecto. Los campos usan fondo y borde visibles; el importe incluye el signo $. El conteo usa cantidades por denominación, botones +/−, subtotales y total automático, incluyendo $0.50. El total y el envío quedan fijos al recorrer la lista. La política de demostración predeterminada es ciega: el esperado sólo se revela después de enviar el conteo. El preset `?screen=cash&cashPolicy=visible` permite revisar la alternativa de política con importe total y esperado visible; esta elección pertenece al visor, no al cajero. Ambas políticas siguen los campos del POS actual. El esperado cambia con los movimientos. El cobro en efectivo de la cuenta del recorrido se añade al resumen local de esa sesión.

Las pruebas de hardware y las autorizaciones son simulaciones. No se imprimen tickets, se abre un cajón físico ni se modifica efectivo real. El mensaje del visor identifica las acciones simuladas.

## Límites de la maqueta

No hay autenticación real, API ni sincronización. El plano, el correo recordado y determinados registros del dashboard usan almacenamiento local. Los ejemplos operativos del POS se reinician al recargar. Cambiar de recorrido reinicia esos ejemplos; los accesos directos `?screen=...` sirven para revisar pantallas sin completar el PIN. Cambiar usuario conserva las cuentas y el turno compartido del ejemplo.

Las políticas y los permisos de Caja son ejemplos locales; en el POS real dependen del servidor. La maqueta incluye rondas, pagos parciales/mixtos, transferencia, propina y estados ilustrativos de terminal. No demuestra recuperación de un proveedor real, errores de hardware, reimpresión controlada ni operación sin conexión. Registro de dispositivos y pruebas sólo modifican datos locales. Idioma, escala de texto y modo Medianoche representan opciones del POS; la maqueta avisa de sus límites al seleccionarlas. El dashboard conserva pendientes sus controles originales de tema e idioma. La animación respeta el movimiento reducido del sistema.

El plano y las fotos no representan dimensiones ni recetas verificadas de ONCA. Los créditos de las doce fotos están en [public/products/SOURCES.txt](public/products/SOURCES.txt).

## Ejecución y comprobación

Dependencias propias en este directorio; ya no se comparte `node_modules` con la maqueta anterior. Stageshow 0.1.0, React 18.3.1, Vite 6.4.5, BoardUI CLI 0.5.9 / 2026.11.1, Tailwind CSS 4 y Playwright Core. El POS usa IBM Plex Sans y Bricolage Grotesque; el dashboard conserva Inter Tight y Source Sans 3 del producto original.

```sh
npm ci
npm run dev
npm run typecheck
npm run build
npm run build:menu
node scripts/digital-menu-pages-qa.mjs http://127.0.0.1:56453
node scripts/viewer-redesign-qa.mjs http://127.0.0.1:56453
npm run qa
node scripts/access-qa.mjs
node scripts/operations-qa.mjs
node scripts/device-qa.mjs
node scripts/three-flows-qa.mjs
node scripts/redesign-flow-qa.mjs
node scripts/redesign-qa.mjs --catalog-only
node scripts/redesign-qa.mjs --tables-only
node scripts/device-qa.mjs --tablet-audit
node scripts/device-qa.mjs --dashboard
node scripts/device-qa.mjs --dashboard-mobile
node scripts/device-qa.mjs --dashboard-auth
node scripts/device-qa.mjs --dashboard-tour
node scripts/stage-pause-qa.mjs
node scripts/pos-model-qa.mjs
node scripts/pos-parity-qa.mjs
node scripts/device-qa.mjs --dashboard-regression
node scripts/device-qa.mjs --interface
node scripts/device-qa.mjs --select-qa
node scripts/floor-editor-qa.mjs
```

[REHEARSAL](src/REHEARSAL.md) registra evidencias y límites de verificación. El estudio modifica únicamente esta maqueta local.

Referencias: [Zavo](https://dribbble.com/shots/27383772-Zavo-POS), [Vita](https://dribbble.com/shots/17980547-Vita-POS-Daytime-mode), [Elinext](https://dribbble.com/shots/22369294-Restaurant-POS-System) y las imágenes de [Polotab](https://www.polotab.com/). La composición de Polotab se refleja para dejar la cuenta a la derecha, por petición del usuario. Véase [NOTICE](NOTICE.md) para los créditos de Stageshow, Unslop y BoardUI.
