# Umi Menu

Menú digital de Umi. Paquete `@umi/menu`, dentro del workspace pnpm.
Este módulo contiene una demo funcional. No envía pedidos a la API, POS, KDS ni correo reales.
Los datos de Bruma, promociones, precios y horarios son ejemplos.

## Arranque y comprobaciones

Desde la raíz del repositorio, con Node 22, pnpm 10.29.3 y Python 3:

```sh
pnpm --filter @umi/menu dev
pnpm --filter @umi/menu check
pnpm --filter @umi/menu test
pnpm --filter @umi/menu build
```

Abre http://127.0.0.1:56456/index.html. Usa `?mesa=1`, `?mesa=2` o `?mesa=12` para probar mesas.
`dev` ejecuta el build antes de servir `dist/`. Detén el servidor con Ctrl+C.
No hay recarga automática: tras editar, ejecuta `build` y recarga el navegador.
El módulo no añade dependencias JavaScript. El servidor HTTP requiere Python.

## Estructura y arquitectura

```text
umi-menu/
├── src/                 HTML, CSS y lógica del navegador
├── public/
│   ├── files/           Fotografías, tema, tipografías y licencias
│   └── qr/              QR de las mesas de ejemplo
├── scripts/             Build y generador opcional de QR
├── tests/               Pruebas de las reglas simuladas
├── dist/                Sitio generado, excluido de Git
├── package.json
├── AGENTS.md            Instrucciones para agentes
├── README.md            Funcionalidad, arquitectura y troubleshooting
└── CHANGELOG.md         Bitácora y evidencia de cambios
```

La estructura separa fuentes, recursos y scripts como `umi-landing-page`.
No adopta Next.js: este prototipo sigue siendo HTML y JavaScript sin compilador.
El build limpia `dist/`, copia las fuentes de una lista explícita y agrega `public/`.
La documentación y las pruebas no se sirven al navegador.

Los scripts clásicos se cargan en este orden:

| Archivo             | Responsabilidad                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `src/state.js`      | Transiciones, estaciones y condición de cuenta activa. Exporta `MenuDemo` y admite pruebas Node. |
| `src/base.js`       | Catálogo, opciones, búsqueda, carrito y formularios originales.                                  |
| `src/app.js`        | Persistencia, seguimiento y panel del personal. Extiende funciones del prototipo base.           |
| `src/visual.js`     | Promociones, autoavance y ampliación individual de fotografías.                                  |
| `src/navigation.js` | Menú hamburguesa y manejo del foco.                                                              |
| `src/mvp.css`       | Ajustes visuales sobre `public/files/menu-redesign.css`.                                         |

Comparten funciones globales. Cambiar el orden o convertir un archivo a módulo exige revisar sus consumidores.
La limpieza conserva esta lógica; no introduce una nueva arquitectura comercial.

### Estado y límites

`localStorage`, clave `umi-menu-mvp-v1`, guarda carrito, pedidos, solicitudes de cuenta, pausa y reloj simulado.
El fragmento `#id` selecciona un pedido del mismo navegador. No es una credencial privada de producción.
El evento `storage` actualiza otras pestañas del mismo origen. No sincroniza teléfonos ni ofrece transacciones concurrentes.
`localhost`, `127.0.0.1` y distintos puertos tienen almacenamiento independiente.

Vencimiento y liberación se revisan al abrir la página y cada segundo mientras está abierta.
Avanzar el reloj desde Personal afecta todos los pedidos de la demo.
Las fechas usan el reloj del navegador; la zona horaria comercial requiere implementación en backend.
Los números de mesa de la URL son ejemplos, no credenciales seguras.

## Funcionalidad actual

- Secciones: destacados, desayunos, café y bebidas, panadería y postres. Búsqueda sin acentos.
- Producto con fotografía ampliable, opciones, extras, indicaciones y cantidad.
- Carrito persistente, edición de cantidades y total provisional.
- Promociones de ejemplo con autoavance cada cinco segundos, flechas e indicadores.
- El autoavance se pausa durante interacción, con un diálogo abierto o la pestaña oculta. Respeta movimiento reducido.
- Menú hamburguesa con Personal, Recoger, Mesa e Información. Un QR conserva su mesa.
- Recoger solicita nombre, teléfono y correo. No verifica identidad ni envía mensajes.
- Pedido de mesa pasa a preparación. Pedido para recoger requiere aceptación del personal simulado.
- Programados aceptados quedan reservados hasta su hora de preparación.
- Cocina y barra deben terminar antes de marcar listo. El cobro y la entrega se simulan sobre el mismo pedido.
- Cancelación directa pendiente; después, solicitud al personal. Programados admiten cancelación directa antes del límite.
- Pedir la cuenta requiere un pedido de esa mesa activo y sin cobrar. Un carrito sin enviar no habilita el botón.
- Pausar pedidos conserva el catálogo y las órdenes existentes. Personal permite reiniciar la demo.

Los ejemplos usan cinco minutos para aceptar, veinte para preparar y treinta de límite previo para cancelar programados.
Estos valores no son una política aprobada para producción.

## Acuerdos de producto conservados

Estas reglas provienen de la documentación original. No acreditan que la integración exista.

- Pago en el negocio. Sin reparto, registro obligatorio, pago en línea ni OTP por SMS en la primera versión.
- Configuración por negocio y sucursal desde Dashboard; publicación y recepción son ajustes independientes.
- Catálogo compartido: precios, variantes, opciones y disponibilidad se validan en `umi-api`.
- Mesa por QR llega a preparación sin aceptación previa y avisa al personal con su mesa.
- Recoger exige aceptación. «Recibido» no significa «aceptado»; pendientes no deben llegar a KDS.
- Programados tienen una hora compatible con todo el carrito. Aceptación y liberación son operaciones distintas.
- Backend conserva la verdad comercial. KDS representa preparación y requiere finalizar todas las estaciones.
- POS debe adoptar, cobrar y entregar la misma orden. No crear otra venta ni cobrar dos veces.
- Cancelación y liberación deben resolver concurrencia, inventario y permisos sobre preparación iniciada.
- Origen digital y modalidad son datos distintos. Mostrar origen en POS y reportes; no imponer una insignia permanente al KDS.
- Correo y seguimiento web son los canales iniciales. Fallar el correo no revierte el pedido.
- El contacto escrito no prueba identidad ni permite acceder al saldo, historial o lealtad de otra persona.
- El servidor debe aislar negocios, limitar abuso, validar credenciales QR y hacer idempotentes los reintentos.
- Conservar IBM Plex Sans, Bricolage Grotesque, azul Umi, superficies cálidas y fotografías aprobadas.
- Las promociones visuales y pedir la cuenta fueron solicitados después del plan inicial. No implican campañas automatizadas ni pagos web.
- GitHub Issues es el seguimiento elegido. PRs funcionales a `staging`; probar allí antes de promover a `main`.
- El PR solo documental P00 fue descartado. No se reintroduce como requisito.

### Integración y decisiones pendientes

La ubicación `apps/umi-menu` está decidida. La API y PostgreSQL deberán sustituir la simulación local.
El flujo objetivo es Menú → `umi-api` → persistencia comercial → proyección KDS, con POS y Dashboard como clientes.
Contratos compartidos pertenecen a `packages/contract`; migraciones, a `db/migrations`.
Revisa el código vigente antes de reutilizar rutas o esquemas del plan original.

| Referencia histórica | Decisión pendiente                                                                 |
| -------------------- | ---------------------------------------------------------------------------------- |
| MD-A01               | Herencia negocio/sucursal, valores iniciales y permisos de configuración.          |
| MD-A02               | Reserva o descuento de inventario y efectos de cancelación, rechazo y vencimiento. |
| MD-A03               | Relación entre pedido, cuenta, preparación, adopción en POS y cobro.               |
| MD-A04               | Permisos de cancelación y día operativo.                                           |
| MD-A05               | Preparación para cantidades y carritos mixtos.                                     |
| MD-A06               | Programados fuera del horario y comienzo de aceptación.                            |
| MD-A07               | Capacidad, calendario, anticipación, horizonte y cambios con pedidos existentes.   |
| MD-A08               | Disponibilidad de personal/dispositivos y pausa automática.                        |
| MD-A09               | Remitente, respuestas, rebotes y entrega real de correo.                           |
| MD-A10               | Dominio, rutas y despliegue; la ubicación del módulo ya está resuelta.             |
| MD-A11               | Negocio, sucursal y responsable del piloto.                                        |
| MD-A12               | Abuso, credenciales, expiración y retención del contacto.                          |
| MD-A13               | Plazo de aceptación y cambios con pendientes.                                      |

El plan histórico tiene 33 historias y 205 tareas. Sus IDs son referencias locales, no números de GitHub.
Orden orientativo: configuración y variantes → catálogo → ciclo de pedidos y POS → correo → programación → QR y piloto.
MD-H01 dependía de MD-A01; MD-H03 cubría variantes de mesa. No se consideran historias terminadas por existir esta demo.
Los criterios detallados y fuentes anteriores pueden recuperarse del historial Git del módulo, antes de esta limpieza.

## Verificación

Ejecuta las comprobaciones indicadas arriba. Las diez pruebas de reglas cubren aceptación, rechazo, vencimiento,
cancelación, reservas, liberación, estaciones, cobro único y cuenta activa.

Recorrido manual en móvil y escritorio:

1. Revisa categorías, búsqueda, promociones y foto ampliada. Confirma que no faltan recursos.
2. Agrega productos con opciones, recarga y comprueba cantidades y total.
3. Envía una recogida con datos sintéticos. Acepta en Personal, termina las estaciones y simula el cobro.
4. Crea otra orden para probar rechazo, vencimiento, cancelación y programación.
5. En mesa vacía, comprueba que Pedir la cuenta esté deshabilitado incluso con carrito.
6. Envía un pedido de mesa. Solicita la cuenta y verifica la mesa en Personal.
7. Pausa entradas: los pedidos existentes y el menú deben conservarse.

Las pruebas locales no acreditan PostgreSQL, SMTP, POS nativo o staging.
Para integración, consulta el [playbook vigente](../../docs/development/LOCAL_VERIFICATION_PLAYBOOK.md).
Comprueba precios canónicos, aislamiento, reintentos y carreras con bases de prueba y revisiones desplegadas.

## Troubleshooting

| Síntoma                                   | Comprobación y solución                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Puerto 56456 ocupado                      | Identifica el proceso antes de detenerlo. Para probar otro puerto, sirve `dist/` con `python3 -m http.server 56457 --bind 127.0.0.1 --directory apps/umi-menu/dist`. |
| Cambios no visibles                       | Ejecuta `pnpm --filter @umi/menu build` y recarga con Ctrl+Shift+R. El servidor no observa cambios.                                                                  |
| Fotografías, CSS o scripts 404            | Sirve `dist/` después del build. `public/` contiene solo recursos, no el sitio completo.                                                                             |
| Lista de carpetas en vez del menú         | Es un servidor antiguo que apunta a `public/`. Detén ese proceso y ejecuta `pnpm --filter @umi/menu dev`.                                                            |
| Pedidos desaparecen al cambiar de URL     | Mantén el mismo navegador, protocolo, host y puerto. No hay sincronización entre dispositivos.                                                                       |
| Se muestran pedidos de pruebas anteriores | Personal → Borrar datos y reiniciar demo. Esto elimina únicamente el almacenamiento de esta demo.                                                                    |
| Pedir la cuenta deshabilitado             | Requiere un pedido enviado, activo y sin cobrar de esa mesa. Un carrito no constituye cuenta.                                                                        |
| Carrusel no avanza                        | Comprueba movimiento reducido, foco, puntero, diálogo abierto o pestaña oculta.                                                                                      |
| QR abre una dirección incorrecta          | Los SVG incluidos apuntan a loopback. Regénéralos para la dirección de red correcta y reconstruye.                                                                   |
| No llega correo o no aparece en POS       | Comportamiento esperado: ambas integraciones siguen pendientes.                                                                                                      |
| Fallo de guardado local                   | Comprueba permisos o espacio del navegador. No se garantiza persistencia en modo privado.                                                                            |

### QR opcionales

Los SVG incluidos funcionan sin instalar paquetes. Para regenerarlos se necesita Python `qrcode`:

```sh
python3 apps/umi-menu/scripts/generar-qr.py --base-url http://IP-DEL-EQUIPO:56456
pnpm --filter @umi/menu build
```

Para probar desde un teléfono en la misma red, sirve `dist/` con `--bind 0.0.0.0`.
El panel Personal debe abrirse en ese mismo navegador; esta demo no comparte pedidos entre dispositivos.

## Recursos y procedencia

Fotografías ilustrativas de Unsplash, conservadas del prototipo aprobado:

| Archivo         | Identificador original             |
| --------------- | ---------------------------------- |
| `toast.jpg`     | `photo-1484723091739-30a097e8f929` |
| `coffee.jpg`    | `photo-1541167760496-1628856ab772` |
| `croissant.jpg` | `photo-1555507036-ab1f4038808a`    |
| `sandwich.jpg`  | `photo-1528735602780-2552fd46c7af` |
| `cake.jpg`      | `photo-1533134242443-d4fd215305ad` |

Licencias OFL: [IBM Plex](public/files/IBM-Plex-OFL.txt) y [Bricolage](public/files/Bricolage-OFL.txt).
La interfaz activa procede de `menu-v6.html` y su tema aprobado, con las extensiones del MVP.
No utiliza los runtimes Stageshow ni BoardUI del archivo histórico retirado.
La revisión editorial anterior usó la guía Unslop de Damir Sokolovsky (CC BY 4.0),
[atribución conservada](https://creativecommons.org/licenses/by/4.0/). No se distribuye esa skill con este módulo.

Consulta [CHANGELOG.md](CHANGELOG.md) para los cambios y resultados de verificación.
