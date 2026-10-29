# ONCA, incidente de producción 010: cobro en efectivo de la cuenta 020

Fecha local: 27 de octubre de 2026.

## Estado

El error se reprodujo mediante clics reales en Caja iMin, con UmiPOS 333.
La cuenta pasó de MXN 60.00 a MXN 100.00 después de agregar dos productos.
El propietario confirmó que recibió los MXN 100.00 completos en efectivo y autorizó registrar el cobro en el POS.

La consulta de producción de 2026-10-27T21:08:54.611Z confirmó cero pagos, ventas, intentos y borradores para la cuenta.
Los clics de diagnóstico no registraron dinero en la API.
El cobro terminó mediante un clic real en el POS a las 21:30:48.975Z.
La API confirmó una venta, un pago en efectivo de MXN 100.00 y el recibo 0019.
El saldo pendiente y el cambio son cero.
La corrección del cliente tiene 181 pruebas aprobadas y análisis sin incidencias.
La revisión final no encontró bloqueadores. La build 334 quedó instalada y verificada en las cuatro tablets.

## Evidencia del flujo real

| Momento UTC | Acción en Caja                                       | Resultado                                                 |
| ----------- | ---------------------------------------------------- | --------------------------------------------------------- |
| 20:53:46    | Cobrar desde la cuenta 020                           | La pantalla de cobro muestra MXN 100.00                   |
| 20:55:02    | Elegir Efectivo                                      | La pantalla conserva MXN 100.00                           |
| 20:56:41    | Pulsar Cobrar por MXN 100.00 una vez                 | La confirmación cambia el total y el recibido a MXN 60.00 |
| 21:03:19    | Pulsar la segunda confirmación por MXN 60.00 una vez | Aparece el error reportado                                |
| 21:07:55    | Cerrar el aviso                                      | La cuenta conserva sus tres productos y MXN 100.00        |
| 21:08:20    | Abrir Centro de recuperación                         | Servidor: 86; aceptadas: 53; conflictos: 0; cola: 0       |
| 21:08:54    | Consulta de producción de sólo lectura               | Sin pago, venta, intento ni checkout de la 020            |

El segundo clic se ejecutó para reproducir el aviso con autorización del propietario.
No se repetirá sin verificar antes el resultado del pago.
El total autorizado para registrar es MXN 100.00.

Mensaje literal:

> No pude confirmar el estado actual de la cuenta. Revisa la conexión y el Centro de recuperación antes de cobrar. Si la terminal ya confirmó un pago, no lo repitas.

La API no registró un POST de checkout para ese intento.
El cliente agrupa varios códigos locales en ese aviso.
El código local exacto del fallo real permanece sin capturar.
Las pruebas confirmaron los dos defectos siguientes; no se atribuye un código interno por inferencia.

## Cuenta y productos

- Carrito: `61fd1209-2094-4ac2-8b65-4bf1bd449fdc`.
- Cuenta diaria: 020, fecha comercial 2026-10-27.
- Estado consultado: `draft`, `building_cart`, versión 6, para llevar.
- Orden existente: `996aa98c-3a10-4756-a7ac-1572a44f76c7`.

| Producto     | Cantidad |   Importe | Estado de cocina consultado |
| ------------ | -------: | --------: | --------------------------- |
| Capuccino    |        1 | MXN 60.00 | Enviado                     |
| Coricos pack |        1 | MXN 30.00 | Sin enviar                  |
| Chocorico    |        1 | MXN 10.00 | Sin enviar                  |

Esta cuenta pertenece al 27 de octubre.
Es distinta de la cuenta 020 del 26, que ya quedó conciliada.

## Defectos reproducidos y corrección

1. `CartCommandQueue._settleAfterReplay` excluía `accepted`, `duplicate` y `archived`, pero omitía `resolved`.
   Los comandos resueltos conservan historia; no requieren otro envío.
   El Centro de recuperación mostró varias entradas resueltas y los comandos recientes 85 y 86 como enviados.
   Una prueba con historia resuelta y un comando nuevo aceptado dejó el diario en cero pendientes.
   La lista en memoria seguía marcada como pendiente.
   La corrección reconoce el estado resuelto y permite volver a leer la cuenta desde la API.

2. La caché de confirmación usaba sólo el ID y la versión del carrito.
   Una modificación local puede cambiar productos y total antes de recibir otra versión del servidor.
   Una prueba con total 6000 y después 10000, con la misma versión, devolvió 6000.
   La corrección incluye ID, versión, productos y totales en la clave de la caché.

El propietario pidió verificar de nuevo lo confirmado por la API y actualizar el estado local durante la sincronización.
La corrección conserva el diario y los estados pendientes, desconocidos y en conflicto.
No borra datos de UmiPOS ni aplica un pago por SQL.
La actualización de versión, productos y total debe proceder de la lectura de la API después de confirmar los comandos.

## Pruebas y flota

La base tenía 21 pruebas aprobadas.
Las dos pruebas iniciales fallaron antes del cambio y las 23 pruebas pasaron después.
Cinco pruebas adicionales reprodujeron fallos de ID oficial, respuesta tardía y conservación ante una lectura fallida.
Una sexta prueba detectó un alias incorrecto entre líneas del mismo producto con notas diferentes.
La corrección retiró ese alias. Otra prueba comprobó el reintento con el controlador real de recuperación.
Los grupos relacionados terminaron con 181 pruebas aprobadas.
El análisis de los cuatro archivos modificados terminó con código 0.

La revisión de flota confirmó API sana, ADB en las cuatro tablets y UmiPOS 333 sin depuración.
Caja conserva el endpoint dinámico `100.64.178.95:35049` y boot_count 8.
Después de esa verificación inicial se instaló el APK 334 en las cuatro tablets.

Evidencia en [el directorio del incidente](./evidence/2026-10-27-onca-incident-010/).
Los archivos conservan los pasos de la interfaz, los resultados rojo y verde y el análisis.
La foto del propietario se guarda como `owner-error-photo.jpg`.

## Entrega y límites

Rama de trabajo: `fix/onca-cash-checkout-recovery-20261027`.
Base de soporte: `bfab1c73e5a3233a41ab83f035d8983c6a090ae4`.
La base ya contiene la configuración de la build 333.
Se conserva el cambio ajeno de `pubspec.lock`.
SHA-256 de ese archivo: `056c516695e325543f007ad2eb608ada4f4a6d2806537714f5964048c1a85f8f`.

La recuperación operativa de la 020 está completa en UmiPOS 333.
La corrección preventiva del sync quedó entregada e instalada en la build 334.
El cobro de la 020 no se repetirá para validar esa build.

Herramientas: ADB con UIAutomator, SSH con huella verificada, Node.js con pg, Flutter test y Flutter analyze.
Se usaron los componentes existentes para conducir el POS nativo y consultar la API sin exponer credenciales.

## Recuperación operativa comprobada en Caja

El inventario completo del diario contiene 86 entradas: 53 enviadas y 33 resueltas.
Las ocho ventas en efectivo del diario tienen recibo oficial disponible.
No había una venta financiera pendiente que justificara reenviar dinero.
La consulta previa a la recuperación confirmó cero pagos y ventas de la 020.

Se cerró y reabrió el proceso de UmiPOS 333 sin borrar datos.
La cuenta se seleccionó desde la lista real y cargó el total de MXN 100.00 desde la API.
Se pulsó Cobrar desde la cuenta y una vez Cobrar por MXN 100.00.
La pantalla mostró Pagado por MXN 100.00.
La consulta posterior confirmó:

| Dato                     | Valor                                      |
| ------------------------ | ------------------------------------------ |
| Estado del carrito       | committed                                  |
| Venta                    | 4712e168-fd99-4d5d-b968-c14607af6661       |
| Pago                     | b21732b3-5f9d-48e0-ab90-4ce068632112       |
| Estado del pago          | captured                                   |
| Estado del intento       | succeeded                                  |
| Medio e importe          | cash, 10000 centavos                       |
| Recibo                   | 0019, c0fd6bb3-43ab-436d-9b52-b7e16b756a97 |
| Hora UTC                 | 2026-10-27T21:30:48.975Z                   |
| Saldo pendiente y cambio | MXN 0.00                                   |
| Número de pagos y ventas | 1 y 1                                      |

La pantalla posterior mostró No hay cuentas abiertas.
La recuperación usa el mismo pago físico que el propietario ya recibió.
El soporte no pidió otro pago al cliente ni ejecutó una reparación por SQL.

Evidencia: backend-final-payment.json, cash100-result-readonly.png y cash100-no-open-accounts.png.

## Relectura segura durante el sync

La revisión amplió la corrección para el requisito del propietario:

- Resuelve el ID oficial desde el diario antes de consultar la cuenta.
- Conserva los productos nuevos mientras llega la respuesta.
- Retira sólo comandos cuyos IDs ya tienen un estado final.
- Descarta respuestas de una selección anterior y evita retroceder una versión más nueva.
- Conserva la proyección y el diario cuando falla la lectura.
- El siguiente sync manual vuelve a leer la API sin repetir la escritura confirmada.

No se promete un reintento automático de lectura cuando la conexión sigue en línea y el diario ya está vacío.
El merge offline de líneas iguales conserva un riesgo anterior, que este parche no amplía.
La prueba con notas distintas impide crear un alias hacia otra línea sólo por compartir el producto.

Commits revisados: 082ea8e0 y 08a2ea004195d3c423d3ce74aa71e3430314f1e5.
PR: https://github.com/umiconsulting/umi/pull/228, base fix/onca-20261026.
Esa base corresponde al código instalado. Main contiene cambios distintos de POS y contrato.

## Límite de la captura de accesibilidad

Después de reabrir UmiPOS, UIAutomator devolvió código 0 y null root sin crear otro XML.
La primera lectura posterior reutilizó un archivo anterior y queda marcada como inválida.
Las capturas PNG posteriores se obtuvieron directamente del dispositivo y comprobaron el estado real.
Los siguientes intentos de lectura usan un nombre único y fallan si Android no crea un archivo nuevo.
Esta limitación pertenece a la herramienta de observación; no se atribuye al cobro.

## Entrega final de la build 334

El PR 228 quedó integrado en fix/onca-20261026 a las 21:48:12Z.
Commit de integración: 069a07fd2670c0225f98b42d6ba5551fd9accfb5.
Los checks lint, contrato, tokens, pruebas de API y gate de esquema terminaron correctamente.
La build de iOS queda fuera de esta entrega Android y no se esperó.

El APK se compiló desde 08a2ea004195d3c423d3ce74aa71e3430314f1e5.
Las correcciones posteriores de CI conservaron los archivos de POS, contrato y compilación.
La revisión comprobó que los doce archivos normalizados coinciden con la salida de Prettier.
Gitleaks 8.30.1 pasó con cero hallazgos y una excepción anclada para una etiqueta pública exacta.
Los valores de prueba distintos siguen detectados.

| Tablet | Build | ADB       | Verificación del APK               |
| ------ | ----- | --------- | ---------------------------------- |
| Caja   | 334   | Conectado | SHA-256 idéntico al APK de entrega |
| Barra  | 334   | Conectado | SHA-256 idéntico al APK de entrega |
| Cocina | 334   | Conectado | SHA-256 idéntico al APK de entrega |
| Mesero | 334   | Conectado | SHA-256 idéntico al APK de entrega |

SHA-256 del APK: c8b3b81335c742b6a6a696e8d32c5c92b93376b7ab47d8d66c908d57f9329e09.
Certificado: 14975f2c374e03b155ab363e17d4a79d4ab32b888ab381bedc3264934cb5c051.
Las cuatro apps conservan depuración desactivada.
El doctor con expected-build 334 terminó con código 0 y sin fallos por dispositivo.

Caja mostró la pantalla de PIN en la captura inicial de las 14:49.
El propietario confirmó que ya había entrado.
La captura actual de las 14:52 comprobó Cajero ONCA y nube en línea.
El aviso de soporte usó una captura anterior; no demuestra otra solicitud de PIN después de esa entrada.
Barra y Cocina mostraron KDS sin comandas y conservaron sus filtros.
Mesero mostró el catálogo con Mesero 1.
El indicador de Cocina reaparece durante el refresco de ocho segundos; otra captura confirmó el estado sin comandas.

## Flujo real después de instalar la 334

Se abrió Centro de recuperación y se pulsó Sincronizar ahora.
La API registró POST offline/replay/begin a las 21:53:50.400Z.
Correlación: 3727ae35-ed99-4001-9f75-322a9ee953a3.
Después se observaron servidor 86, aceptadas 53, conflictos 0 y cola 0.
La lista local mostró No hay cuentas abiertas.
La consulta posterior confirmó el mismo pago y la misma venta de MXN 100.00, con saldo cero.

Esta comprobación valida el sync real de entradas ya finalizadas y la lista de cuentas.
Los casos de nuevos productos durante una respuesta tardía se validaron con pruebas controladas.
La cuenta 020 no se volvió a cobrar para probar el APK.
No se crearon ventas ficticias ni nuevas comandas de preparación.

Evidencia: doctor-build334-final.json, build334-installed-verification.json,
build334-sync-api-trace.json, build334-sync-final.png,
build334-account-list-final.png y backend-after334-sync.json.

## Rollback

La reversión del código debe usar otro versionCode con los commits del hotfix revertidos.
Debe conservar la misma firma, los datos y el diario.
El recibo 0019 y su pago son hechos confirmados; no forman parte de una reversión del APK.
No se aplicó una migración ni otro despliegue de la API.
