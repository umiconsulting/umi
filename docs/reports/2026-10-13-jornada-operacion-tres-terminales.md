# Simulación de una jornada de operación

Estado: simulación terminada con límites documentados. Fecha: 13 de octubre de 2026. Negocio: ONCA.

La venta, la propina, la devolución y los cierres funcionan en los escenarios probados. Los principales bloqueos son mover una mesa y cancelar un producto preparado con autorización. Cocina requiere reintentos después de algunos avisos de conexión.

Los recibos muestran impuestos y hora distintos del cobro. El dashboard y el POS también muestran reglas de conteo distintas. Estas diferencias afectan la confianza del operador.

Se completaron cuatro cobros simulados por $456 y una devolución por $66. El libro de caja muestra ventas $176 en el primer turno y $280 en el turno adicional. Ambos turnos quedan cerrados. El primero registra un faltante simulado autorizado de $10; el segundo tiene diferencia cero.

## Método y entorno

Solo se usan las aplicaciones Android y el dashboard. No se ejecutan consultas SQL ni peticiones directas a la API.
Las capturas están en [evidence/2026-10-13-jornada-operacion](evidence/2026-10-13-jornada-operacion/).
ADB 37.0.0 (protocolo 1.0.41) permite tocar controles según las capturas. Playwright 1.62.1 controla Chromium 153.0.8010.52 mediante CDP. Node es 24.21.0.
La fuente del método es [LOCAL_VERIFICATION_PLAYBOOK.md](../development/LOCAL_VERIFICATION_PLAYBOOK.md).
Los pagos y los conteos son simulados. No representan efectivo contado ni cargos bancarios reales.

Se reutiliza el navegador de `./scripts/ux-browser.sh`, mediante clics reales con Playwright. No se construye un simulador de negocio. El método existente permite observar los mismos controles del operador.

Las terminales son iMin `192.168.1.10:5555`, A9 `192.168.1.14:35559` y A11 `192.168.1.13:38333`. Todas usan el build 87 al participar. A9 recibió el APK existente mediante instalación sobre los datos. A11 se desbloqueó con el dato facilitado por el usuario. El PIN de Android no se guarda en este reporte.

Comandos del instrumento, sin acciones comerciales directas:

```sh
adb -s 192.168.1.14:35559 install -r apps/umi-pos/build/app/outputs/flutter-apk/app-profile.apk
adb -s 192.168.1.14:35559 reverse tcp:4001 tcp:4001
adb -s 192.168.1.13:38333 reverse tcp:4001 tcp:4001
adb -s <serial> exec-out screencap -p > /tmp/captura.png
adb -s <serial> shell input tap <x> <y>
```

Los túneles ADB sirven al APK local, que usa `127.0.0.1:4001`. Una instalación con URL de red necesita su propia verificación. No se cambia la configuración del servidor.

## Preparación observada

- iMin: PIN de cajero entra como **Cajero 2**. La cuenta 118 del administrador ya tenía un Americano limón mineral. Se conserva al salir.
- Dashboard: Admin ONCA. Hay nueve personas y dos roles llamados Mesero. Uno tiene cero personas y tres permisos. Otro tiene dos personas y dieciocho permisos.
- A9: permanece varios minutos en «Comprobando tu terminal». Cerrar la tarjeta desde aplicaciones recientes y abrir Umi permite ingresar el PIN.
- A9 tenía el build 82. Se instaló el APK existente 87 con `adb install -r`, sin borrar datos. El APK usa localhost y necesitó `adb reverse tcp:4001 tcp:4001`. La falta inicial del túnel fue un error del instrumento de prueba.
- Con build 87, el PIN 4444 muestra una explicación clara: el usuario tiene una sesión en otro POS. No se fuerza su cierre.
- Los PIN anteriores no corresponden a los nombres actuales: 2222 entra como Cajero 1; 5555 entra como Mesero 2. Se solicitan los PIN actuales de barra y cocina.
- A11: Android está bloqueado. Se solicita al usuario desbloquearla porque la siguiente pantalla no se puede leer en la captura.
- Los controles de permisos del rol Mesero asignado están deshabilitados en el dashboard. No se modifican permisos.

## Acciones comprobadas

| Escenario                      | Resultado visible                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Cerrar el turno anterior       | Conteo simulado de $4,485, conciliación sin diferencia y cierre confirmado.                                  |
| Abrir jornada                  | Dos billetes de $500. Nuevo turno con fondo de $1,000 y ventas en cero.                                      |
| Venta sin mesa para llevar     | Cuenta 119: Americano caliente, nota «SIM dia sin azucar», total $50.                                        |
| Corregir efectivo insuficiente | $40 muestra «Falta por cobrar $10». El intento de cobrar no completa la venta.                               |
| Pago con cambio                | Recibido $100, consumo $50, cambio $50. Comprobante ticket 0002.                                             |
| Volver atrás desde cobro       | Se conserva la cuenta con el producto y la nota.                                                             |
| Sentar clientes                | Mesa 1, dos personas. Se abre la Comanda de la mesa.                                                         |
| Enviar bebidas y comida        | Cuenta 121: Capuccino $60 y Margarita $220. Ambos aparecen «Enviada». El dashboard muestra la orden en cola. |
| Seleccionar mesa ocupada       | Panel con dos personas, tiempo y acciones. «Abrir cuenta» es primaria.                                       |
| Preparar movimiento            | «Moviendo Mesa 1. Toca una mesa libre» sustituye la instrucción inicial.                                     |

## Hallazgos del primer bloque

1. El recibo muestra impuestos $0, aunque la Comanda y el cobro muestran $6.90 incluidos. El total permanece $50.
2. El recibo muestra 18:22 cuando Android y el dashboard muestran 11:22. La fecha coincide.
3. El aviso de sesión ocupada funciona en build 87. La pantalla sin explicación se observó en build 82 y no es evidencia contra la versión actual.
4. Los permisos aparecen en inglés y con códigos técnicos. Hay controles deshabilitados sin una explicación visible del motivo.
5. El intento de cobrar efectivo insuficiente conserva un botón azul habilitado, pero no muestra una explicación adicional al tocarlo.

## Límites de cobertura

No se verifican pagos con tarjeta o mixtos ni aviso sonoro al mesero. Se probaron acciones de preparación con dos operadores, pero no todos sus permisos.
No se afirma que una modificación propuesta sea segura hasta definir sus condiciones de regresión.

## Segundo bloque de la simulación

- Cuenta 121: se cancela Margarita ya enviada, con motivo «Error de captura». Queda Capuccino por $60. Cocina muestra Margarita tachada y «ANULADO».
- Se cobra Capuccino con propina del 10%. El ticket 0003 conserva consumo $60, propina $6 y total $66. El recibo vuelve a mostrar impuestos $0 y hora siete horas adelantada.
- Después del pago, Mesa 1 permanece «Por cobrar». «Liberar mesa» pide confirmar y cambia a «Por limpiar». «Mesa lista» devuelve el estado «Libre».
- Mover Mesa 1 a Mesa 2 falla tres veces. También falla después de actualizar y cambiar a «Pedido tomado». El mensaje pide actualizar el plano y muestra «Sin conexión»; la cuenta permanece en Mesa 1. No se afirma la causa del servidor.
- Combinar Mesa 1 y Mesa 2 funciona. Se confirman ocho personas y el plano muestra ambas dentro del grupo.
- Dividir funciona inmediatamente, sin diálogo. Mesa 2 queda «Por limpiar». Mesa 1 conserva ocho personas, aunque su capacidad es cuatro. Se libera el grupo y se limpian ambas mesas.
- Mesero 2 crea un pedido en Mesa 4. Puede agregar y enviar Capuccino. El cobro no aparece para este rol.
- En el dashboard se guarda una excepción temporal: Capuccino → Cocina, prioridad 50, objetivo 30 segundos. La cuenta 125 llega a Cocina. Primero aparece gris «En cola»; después de actualizar aparece roja «Tiempo vencido».
- El tablero muestra «Conexión inestable» durante la espera. El cambio automático de color y el sonido no quedan comprobados con esta acción.
- La nota «SIM dia sin azucar» aparece completa en Barra para la cuenta 119. Las cuentas anteriores no se completan ni se cancelan.

Evidencia adicional: capturas 18 a 21. Se desactivó la excepción temporal desde el dashboard. La previsualización vuelve a mostrar Barra, categoría, prioridad 100 y objetivo 300 segundos; captura 31. La cuenta enviada conserva su destino Cocina.

## Caja, autorización y trabajo entre terminales

- Salir y volver a ingresar como Cajero 2 conserva la cuenta vacía 122. Este ciclo no crea una cuenta distinta; captura 22.
- La lista de cuentas abiertas omite los borradores vacíos. Sin embargo, Ventas muestra las cuentas 122 y 124 como canceladas por $0; captura 26. El problema observable es el ruido del historial. No se comprobó que queden órdenes vacías abiertas.
- Abrir desde el cajero una cuenta activa del mesero produce un aviso genérico: la cuenta ya se guardó o cerró. Al crear otra cuenta en el mesero, el cajero puede abrir la cuenta 125. La protección evita editarla simultáneamente; el mensaje no explica el conflicto entre terminales; captura 24.
- Entrada de $100 con motivo, salida de $50 con motivo y resguardo de $200 cambian el esperado de $1,116 a $966. Sin motivo, la confirmación está deshabilitada; captura 25.
- La devolución de la cuenta 121 permite revisar consumo $60, impuestos incluidos $8.28 y propina $6. Se mantiene «No reponer».
- El PIN del Cajero 2 produce «CONFLICT» y descarta el formulario. La devolución no se completa en ese intento; captura 28.
- Repetir la devolución con PIN del administrador permite aprobar, confirmar y obtener EX-0004 por $66; captura 29.
- Caja conserva temporalmente el esperado anterior. Después de actualizar, muestra $900 y salidas acumuladas $116; captura 30. La cuenta es $1,000 + $116 + $100 − $50 − $200 − $66 = $900.
- Dashboard indica «Conteo ciego». La pantalla de caja revela el esperado antes del conteo. Falta comprobar si existe una excepción por rol; captura 23.

## Preparación y errores del mesero

- Con Admin ONCA, Cocina permite empezar la cuenta 125. El aviso «Tiempo vencido» permanece rojo. No se comprobó el azul de una preparación dentro del tiempo.
- Marcar el ítem cambia a verde con texto «Listo», además del color; captura 32.
- «Recuperar» permite elegir «No quedó bien». El ítem vuelve a preparación y pierde la marca de listo; captura 33.
- Marcarlo listo otra vez y tocar «Terminar» retira la cuenta 125 del tablero de Cocina; captura 34. La cuenta comercial continúa abierta.
- El mesero puede pedir cancelar ese producto terminado. El diálogo exige autorización y explica el importe de $60; captura 35.
- El PIN del mesero se rechaza con una explicación clara y conserva el motivo; captura 36. El aviso aumenta la altura del diálogo y deja el botón de autorización casi fuera de pantalla.
- El intento posterior con PIN 1111 termina con «Cocina ya comenzó la preparación. Solicita ayuda para cancelar este producto». El producto permanece y la cuenta sigue en $60; captura 37. No se afirma la causa. La cancelación de un ítem preparado no quedó completada.
- La Comanda del mesero sigue indicando «Enviada» después de terminar en Cocina. No se observó un aviso visual de entrega allí. El sonido no se puede confirmar con capturas.

## Configuración y límites de pago

- El cobro nativo ofrece efectivo. No se observaron tarjeta manual ni pago mixto en esta configuración.
- Dashboard muestra Mercado Pago Point «Sin conectar». No se conectó un proveedor ni se ejecutó un cargo bancario.
- No se encontró en las pantallas recorridas un control para activar terminal manual o pago mixto. Esto limita la simulación. No se cambió la política mediante SQL.
- A11 estuvo bloqueada al inicio. El usuario facilitó el desbloqueo y la tablet participó en el bloque final.
- Las primeras pruebas de preparación usan al administrador. El bloque final usa los PIN 7777 y 9999 indicados por la secuencia del usuario. No se modifican los roles.
- No se modificó código, no se generó un APK nuevo y no se ejecutaron pruebas Flutter en esta simulación. Se usa el build 87 existente.

## Pruebas adicionales y llegada de la A11

- El usuario facilita el desbloqueo de Android. A11 entra en Umi después de reiniciar la aplicación desde Android. No se borran datos.
- Los PIN 7777 y 9999 permiten acceder al tablero de preparación. Su navegación presenta Cocina y Ajustes. El tablero no muestra el nombre del operador; no se certifica su nombre desde esta pantalla.
- Las tres terminales participan: A9 toma el pedido 128, A11 prepara y iMin cobra. La preparación alterna operadores en la A11.
- Cuenta 128: Capuccino $60 y Margarita $220 para llevar. Capuccino aparece en Barra y Margarita en Cocina. La excepción temporal anterior está desactivada.
- A11 muestra la llegada a Barra sin pulsar Actualizar; captura 49. «Empezar» cambia de gris «En cola» a azul «En preparación»; captura 50.
- Al marcar Capuccino listo, Barra conserva azul «Parcial» y no ofrece «Terminar», aunque su único ítem ya está listo; captura 51.
- Cocina muestra la Margarita pendiente como «Parcial» y no ofrece «Empezar»; captura 52. La pantalla no distingue el inicio de preparación de cada estación.
- Marcar Margarita listo falla una vez con «Conexión inestable». Actualizar y repetir funciona. Cocina queda verde «Listo» y permite terminar; captura 53. No se afirma la causa del primer fallo.
- Para cobrar el pedido 128 se abre otro turno con fondo $100. El mesero lo guarda y el cajero lo abre desde Lista.
- Se reciben $500 para consumo $280 y cambio $220. Dos toques seguidos en Cobrar producen un solo abono visible; captura 54. Caja muestra ventas $280 y esperado $380; captura 55. Esto comprueba ese intento, no todos los casos de duplicación.
- El turno adicional se cuenta con $380 y diferencia cero. No pide PIN del gerente. Se concilia y cierra. Dashboard muestra ambos turnos de la jornada cerrados; captura 57.
- Se termina la preparación pendiente de la cuenta 119, creada en esta simulación. Se conservan las cuentas 004, 070 y 071 anteriores.
- Silenciar en A11, cerrar el proceso de Umi y abrirlo de nuevo conserva el ícono de silencio; captura 56. Se restaura el sonido habilitado. No se certifica la audición de los tonos.
- La lista distingue la cuenta 130 para llevar de la cuenta 118 para comer aquí; capturas 46 y 47. «Todas» muestra ambas. Se elimina el producto no enviado de la cuenta 130 al terminar la prueba.
- «Comer aquí» exige elegir una mesa antes del cobro; captura 44. Cambiar a Para llevar conserva el producto y permite avanzar. El cobro sin turno se bloquea con explicación y botón «Abrir caja y continuar»; captura 45.
- El selector de clientes muestra una lista vacía con explicación; captura 43. No se probó asignar un cliente existente.
- En iMin, «Muy grande» permite seleccionar Mesa 1 y usar el panel sin recortes de acciones; captura 48. El nombre dentro del mapa conserva un tamaño menor que el panel. Se restaura «Seguir al sistema». Esta observación no certifica accesibilidad al 200% en una pantalla angosta.

## Cierre de la jornada simulada

- Cajero 2 abre la cuenta 125 después de que el mesero la guarda. Cobra $60 exactos, sin propina; captura 38. Dashboard registra el ticket 0005.
- Se libera Mesa 4 con confirmación y se marca «Mesa lista». Mesas 1, 2 y 4 quedan libres.
- Caja muestra ventas en efectivo $176, ingresos $100, retiros $116 y resguardo $200. El esperado es $960.
- Se envía un conteo simulado de $950. La pantalla muestra faltante $10, tolerancia $5 y necesidad de aprobación; captura 39.
- Se registra «Error de cambio» y PIN del administrador. La conciliación funciona. El cierre pide de nuevo el PIN del encargado y se completa; captura 41.
- La política nativa dice «Conteo visible», mientras el dashboard dice «Conteo ciego». Es una diferencia observable entre pantallas. No se comprobó su origen ni se cambió la política.
- Dashboard permite revisar apertura, ventas, movimientos, devolución, arqueo y aprobación; captura 40. La cuenta del turno separa retiro $50 y reembolso $66.
- Se conserva la cuenta 118 y los pendientes de cocina anteriores a esta simulación. No se termina trabajo ajeno.

## Propuestas que requieren conservar la operación actual

| Prioridad | Mejora                                                                       | Condición para evitar una regresión                                                                                                 |
| --------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Alta      | Mostrar impuestos y hora del recibo coherentes con el cobro.                 | Mantener total, propina, cambio y folio. Verificar las zonas horarias de las sucursales.                                            |
| Alta      | Recuperar el movimiento de mesas con un error que indique la acción posible. | Conservar la cuenta, sus productos y la mesa original cuando falle. Evitar duplicados al reintentar.                                |
| Alta      | Completar la cancelación de un ítem preparado con autorización válida.       | Mantener motivo, importe y cuenta. El rechazo de PIN debe conservar el formulario. Cocina debe recibir la cancelación una sola vez. |
| Alta      | Distinguir estado de cada estación y estado global del pedido.               | Barra puede terminar su bebida sin marcar lista la pizza. El pedido completo solo queda listo cuando corresponda.                   |
| Alta      | Recuperar acciones de cocina después de una conexión inestable.              | Conservar las marcas confirmadas y evitar repetir producción. Mostrar qué acción requiere reintento.                                |
| Media     | Explicar quién tiene abierta una cuenta en otra terminal.                    | Mantener la protección contra edición simultánea. Ofrecer guardar y traspasar mediante acciones autorizadas.                        |
| Media     | Excluir borradores vacíos del historial normal de ventas.                    | Conservar la auditoría de cancelaciones comerciales reales. Salir e ingresar no debe emitir una venta nueva.                        |
| Media     | Mostrar la misma regla de conteo en dashboard y POS.                         | Aplicar la política efectiva del turno. Conservar sus conteos y aprobaciones históricos.                                            |
| Media     | Configurar pagos permitidos desde una pantalla de administración.            | Separar tarjeta manual de cargos del proveedor. Conservar permisos, conciliación y prevención de cobros duplicados.                 |
| Media     | Permitir consumo aquí sin mesa cuando el negocio lo admita.                  | Mantener Comer aquí y Para llevar como tipos distintos. Nunca asignar una mesa ficticia.                                            |
| Media     | Confirmar la división y redistribuir las personas.                           | Mantener la cuenta del grupo y explicar qué mesa queda libre o por limpiar.                                                         |
| Media     | Impedir el botón de cobro cuando falta efectivo.                             | Mantener pagos parciales cuando la política permita pagos mixtos.                                                                   |
| Media     | Separar pedidos actuales de pendientes antiguos en cocina.                   | Los pendientes anteriores siguen visibles mediante un filtro y un aviso.                                                            |
| Media     | Explicar los permisos deshabilitados y usar nombres del negocio.             | Conservar los permisos efectivos y el control por rol.                                                                              |

## Cobertura pendiente y alcance de las conclusiones

La captura 58 muestra la lista final: solo permanece la cuenta 118 anterior a la simulación. Los borradores vacíos no aparecen allí. Caja queda sin turnos abiertos. A11 vuelve a Expo con sonido habilitado; iMin vuelve al tamaño de texto del sistema. La ruta temporal de Capuccino queda desactivada.

No se verificaron cargos bancarios, pagos mixtos, impresión física ni apertura física del cajón. Tampoco se verificaron devoluciones parciales completadas, inventario repuesto, descuentos, asignación de clientes, operación sin red ni una jornada de ocho horas.

No se escucharon los dispositivos a distancia. Las capturas prueban controles de sonido, colores y estados, pero no los tres tonos ni el aviso acústico al mesero. El cambio automático al umbral quedó sin verificar cuando la iMin mostró conexión inestable.

No se leyó el log de la API ni se consultó la base durante esta simulación. Los importes se contrastaron entre POS, recibos y libro de caja del dashboard. Las causas internas de los fallos quedan sin diagnosticar.

Las propuestas son cambios de comportamiento por validar. No son correcciones implementadas ni garantías de ausencia de regresiones. Cada propuesta incluye la operación que debe conservar.
