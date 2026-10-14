# Estado conjunto del ciclo: cuentas, cocina y terminales

Fecha de auditoría: 2026-10-13. Corte documental: build **0.1.0+94**.

**Seguimiento visual, build 96:** instalado en iMin, A9 y A11 con el mismo APK.
Incluye KDS compacto, nombres KDS/Todos, filtros estables, categorías más gruesas y carrito sin resumen de preparación.
El [reporte y las capturas](2026-10-13-kds-encabezado-compacto.md) registran 938 pruebas aprobadas y análisis sin hallazgos.
Las secciones siguientes conservan la auditoría histórica del build 94.

Los cuatro frentes originales y las ampliaciones del selector y KDS tienen código, pruebas y evidencia de uso nativo.
Las tres terminales tienen el mismo APK 94. La cuenta 004 terminó en cocina y la cancelada 013 quedó descartada.
Los límites de verificación física y del entorno siguen explícitos al final de este reporte.

## Cierre de las tres prioridades

1. **Selector terminado.** Muestra mapa, estados y cuenta activa. Permite crear una mesa física y liberar mesas con protección y permisos.
2. **Excepciones resueltas de forma explícita.** Sin estación permitió aplicar las rutas actuales de 004 y descartar 013. A9 completó ambos productos de Barra.
3. **Entrega conjunta instalada.** Un APK 94, con el mismo SHA-256, quedó en iMin, A9 y A11. Los dos flujos tienen recorridos nativos.

Los detalles están en los reportes de [selector de mesas](2026-10-13-selector-mesas.md) y [KDS Sin estación](2026-10-13-kds-sin-estacion.md).
La auditoría conserva los reportes históricos para distinguir los límites anteriores del estado entregado.

## Qué prueba esta auditoría

Se leyeron los reportes, sus registros, el código propietario y las instrucciones del repositorio.
Una consulta `BEGIN READ ONLY` comprobó las rutas actuales de los cuatro productos históricos sin estación.
La consulta no modificó filas. El cierre incorpora los recorridos ADB, las filas y los logs del ciclo 94.

Las cifras de pruebas corresponden a los logs enlazados. El registro de instalación compara también el hash del APK instalado en cada terminal.

| Herramienta       | Versión | Uso y fuente                                                                                                                                                                 |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ripgrep           | 15.2.0  | Localizar implementaciones y evidencia. La regla de búsqueda está en `AGENTS.md`.                                                                                            |
| PostgreSQL / psql | 17.10   | Consulta de rutas en `umi_local`, dentro de una transacción de lectura. El [playbook](../development/LOCAL_VERIFICATION_PLAYBOOK.md) prescribe contrastar filas y pantallas. |
| Prettier          | 3.9.4   | Formato de este reporte y de las notas de seguimiento.                                                                                                                       |

Se reutilizaron las herramientas del monorepo. No se creó un verificador manual ni se agregó una dependencia.

## Versión efectiva y reportes históricos

| Etapa                                   | Evidencia                                                                                                         | Cómo leerla ahora                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Cuatro frentes, build 75                | [Reporte original](2026-10-13-cuentas-lista-mapa-cocina-sonidos.md)                                               | A11 rechazó aquella instalación. Es un límite histórico, superado por instalaciones posteriores.             |
| Sesiones vacías, build 82               | [Reporte](2026-10-13-sesion-sin-cuentas-vacias.md)                                                                | Mismo folio en dos reingresos. Se instaló en las tres terminales.                                            |
| Ajustes A11, hasta build 87             | [Reporte](2026-10-13-tab-a11-layout.md)                                                                           | Conserva pruebas anteriores de disposición, acceso y contador inicial.                                       |
| Simulación y correcciones, builds 87–90 | [Simulación](2026-10-13-jornada-operacion-tres-terminales.md), [correcciones](2026-10-13-jornada-correcciones.md) | Las propuestas de la simulación tienen seguimiento en la matriz de correcciones. No son todas pendientes.    |
| Aviso automático, build 91              | [Reporte](2026-10-13-aviso-cuenta-liberada.md)                                                                    | Aviso retirado sin tocar iMin después del logout de A11.                                                     |
| Folio, build 92                         | [Reporte](2026-10-13-cuenta-folio-mesa.md)                                                                        | Cuenta 152 como título; Cuenta 152 · Mesa 6 en Lista.                                                        |
| KDS, build 93                           | [Reporte](2026-10-13-kds-completar-descartar.md)                                                                  | Capuccino 004 terminado y cancelada 070 descartada desde A9. Su límite Sin estación se resolvió en 94.       |
| Selector y Sin estación, build 94       | [Selector](2026-10-13-selector-mesas.md), [KDS](2026-10-13-kds-sin-estacion.md)                                   | Entrega actual: mapa al asignar mesa, Mesa 16 creada, liberación protegida, 004 completada y 013 descartada. |

[El registro de instalación 94](evidence/2026-10-13-kds-sin-estacion/installed-builds.json) confirma `versionCode=94` en iMin, A9 y A11.
Los tres APK instalados tienen el SHA-256 `d9ef49320ea8be3621fd74829c0296580ec557fab3c544143d33f5bcd7280763`.
El [registro 93](evidence/2026-10-13-kds-completar-descartar/installed-builds.json) conserva la evidencia de la etapa anterior.

La condición original de un único build 75 no se cumplió literalmente: hubo etapas posteriores y cambios adicionales pedidos por el usuario.
El estado entregado ahora es uniforme en las tres terminales. No corresponde bajar al 75 y perder correcciones.
El build 94 acredita la entrega conjunta de las últimas dos ampliaciones.

La conexión de desarrollo actual usa `127.0.0.1:4001` y `adb reverse tcp:4001 tcp:4001`.
Necesita el host y ADB activos. Este APK no prueba acceso directo a la dirección LAN del servidor.

## Frente 1: Cuentas, Lista y Mapa

| Criterio del usuario                                    | Estado al build 94                             | Evidencia y prueba                                                                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lista y Mapa; Lista incluye cuentas con y sin mesa      | Cumplido                                       | `AccountsWorkspace` y `OpenAccountsList`; [Lista nativa](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-04-accounts-all.png). `accounts_workspace_test.dart` y `open_accounts_list_test.dart`.                    |
| Eliminar cuadrícula y alternador interno                | Cumplido en Cuentas                            | `FloorPlanSurface` usa mapa; [captura](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-02-map-detail.png). El selector de asignación es otro acceso y recibió el pedido nuevo.                                     |
| Filtro Comer aquí / Para llevar                         | Cumplido                                       | Filtra `fulfillmentType` sólo en Lista; conserva Todas. [Para llevar](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-05-accounts-takeout.png).                                                                    |
| Seleccionar mesa, panel siempre y Abrir cuenta primaria | Cumplido                                       | El toque selecciona; panel ancho desde 720. [Panel](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-02-map-detail.png), [Comanda](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-03-open-account.png). |
| Gestión, Mover, Unir y Dividir                          | Cumplido; correcciones posteriores verificadas | Se conserva `_tableActions`. Build 89 movió Mesa 3 a 6 con la misma cuenta y dividió seis personas en cuatro/dos. [Reporte](2026-10-13-jornada-correcciones.md).                                                              |
| Pantalla angosta, hoja y Detalle                        | Cumplido                                       | `table_state_surface_test.dart` conserva selección al estrechar la pantalla. A11 tiene evidencia nativa de mapa y controles en ambas orientaciones.                                                                           |
| Respaldo accesible con texto grande                     | Conservado con medición                        | A 375×812 y texto 200%, una etiqueta nominal de 23.4 px terminó en 3.22 px por escala. Se mantiene lista textual sólo en la condición accesible. [Medición](2026-10-13-cuentas-lista-mapa-cocina-sonidos.md).                 |
| Permisos y uso sin `directAccounts`                     | Cumplido en pruebas                            | Gestión detrás de `sale.lifecycle`; [mesero sin gestión](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/a9-01-waiter-detail.png). Pruebas de plano y estados cubren ambos usos.                                        |

Premisas actualizadas: Mesas/Sin mesa cambió a Lista/Mapa; un toque dejó de abrir inmediatamente la Comanda.
El filtro conserva el mapa completo. No cambia la propiedad de la cuenta ni la reanudación de `/sales/current`.

## Frente 2: Cocina, sonidos y tiempos

| Criterio del usuario                                          | Estado al build 94                  | Evidencia y límite                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonido de llegada a la estación                               | Implementado y ejecutado en Android | [Log iMin](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-audio.txt); en build 89 llegó cuenta 153 a A9 sin Actualizar.                                                                                                                                           |
| Sonido distinto al vencer                                     | Implementado y ejecutado            | A9 cruzó cinco minutos reales sin Actualizar. [Captura](evidence/2026-10-13-jornada-correcciones/a9-umbral-automatico153-build89.png), [log](evidence/2026-10-13-jornada-correcciones/a9-sonidos153.log).                                                                     |
| Sonido de listo en el móvil del mesero                        | Implementado y ejecutado            | A11 recibió el aviso de 153; [log](evidence/2026-10-13-jornada-correcciones/a11-sonido-listo153.log). Sondea su cuenta activa cada cinco segundos.                                                                                                                            |
| Cola gris, preparación azul, vencido distinto y señal textual | Cumplido                            | [Cola](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-07-arrival-queued.png), [azul](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-08-preparing-blue.png), [vencido](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-09-overdue-red.png). |
| Umbrales y sonidos configurables                              | Cumplido                            | `station.alert_settings`, migración 029; [filas](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/station-settings.txt), [clics](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-clicks.json).                                                           |
| Silencio visible, persistente y sin bucle                     | Cumplido                            | [Silencio tras reinicio](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-12-muted-restart.png). Preferencias y deduplicación cubiertas por pruebas.                                                                                                                |
| Reutilizar watch y acceso del mesero sin permiso KDS          | Cumplido en código y pruebas        | Watch existente y lectura propia con `order.fire`. La sesión nativa actual del mesero también tiene `kitchen.read`; el caso sin ese permiso tiene pruebas.                                                                                                                    |
| Pruebas de reglas, decisión y cruce del umbral                | Cumplido                            | `kitchen_alerts_test.dart` y `kitchen_board_test.dart`; [suite POS 94 de 933 casos aprobados](evidence/2026-10-13-kds-sin-estacion/pos-suite.log).                                                                                                                            |

Se eligió `audioplayers` **6.8.1 exacta** con tres WAV locales y degradación silenciosa fuera de Android.
[La investigación](../research/2026-10-13-kds-audio.md) compara `just_audio` y el canal nativo.

**Límite vigente:** los logs prueban inicio del reproductor. No prueban volumen físico ni identificación de los tonos en el ruido del local.
El umbral de Cocina de quince minutos tiene pruebas automatizadas; no consta una espera nativa completa de quince minutos.
El objetivo de ruta de treinta segundos y el umbral de Barra de cinco minutos sí tienen recorrido real.

## Frente 3: configuración de Cocina en dashboard

| Criterio del usuario                              | Estado al build 94              | Evidencia                                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta y edición de estaciones                      | Cumplido                        | [Estación creada y editada con clics](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-05-station-created-edited.png).                                                                           |
| Ruteo por categoría y predeterminada              | Conservado                      | Resolver existente; nueve pruebas del modelo y recorrido del módulo.                                                                                                                                            |
| Buscar producto, override, prioridad y desactivar | Cumplido                        | [Override](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-02-product-override.png), [desactivación](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-04-override-disabled.png). |
| Objetivo de ruta y umbral de estación             | Cumplido                        | Capuccino llegó a Cocina con treinta segundos. [Fila proyectada](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/kds-routed-item.txt).                                                                    |
| Sonidos on/off y selección                        | Cumplido                        | Se guardó, recargó y restauró el sonido; [persistencia](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-03-persisted.png).                                                                      |
| Previsualización ¿dónde cae este platillo?        | Cumplido                        | Usa producto > categoría > predeterminada y prioridad existente. Al desactivar el override volvió a Barra.                                                                                                      |
| Investigación de competencia y capturas           | Cumplido con límites declarados | [README](../research/2026-10-13-kds-ruteo-tiempos-sonidos/README.md) y quince capturas; siete proveedores. No se atribuyen prioridades numéricas sin fuente.                                                    |
| Servidor guarda lo que promete la UI              | Cumplido                        | Columna dedicada `alert_settings`; migración 029 aplicada y repetida. [Comando y filas](2026-10-13-cuentas-lista-mapa-cocina-sonidos.md).                                                                       |
| Navegador real y comprobación POS/base            | Cumplido                        | Playwright sobre Chromium CDP existente, clics reales, captura POS y filas. [Registro](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/dashboard-clicks.json).                                            |

El ajuste de rutas sirve a nuevas proyecciones. Hasta build 93, no corregía productos históricos sin estación.
El build 94 añade una acción explícita para esos productos; editar una ruta no cambia automáticamente comandas anteriores.
La bandeja ofrece una previsualización y exige permiso de gestión. Las canceladas sólo permiten Descartar.

## Frente 4: símbolos de Ventas

| Criterio del usuario                         | Estado al build 94 | Evidencia                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pausa y equis sin círculo, tile conservado   | Cumplido           | `PosGlyphs.pause` y `PosGlyphs.close`; [antes](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/00-current.png), [después](evidence/2026-10-13-cuentas-lista-mapa-cocina-sonidos/imin-01-sales-after.png). |
| Más gruesos a 16 px sin cambiar otros glifos | Cumplido           | Trazo 3.0 en ambos; normal 1.65 en el resto. Prueba de `sale_lifecycle_test.dart` fija tamaño, glifo y grosor.                                                                                                  |
| Comparación real en iMin                     | Cumplido           | Las dos capturas anteriores muestran ventas pausadas y canceladas.                                                                                                                                              |

## Pedidos añadidos durante el ciclo

| Pedido                                          | Estado al build 94                   | Evidencia / siguiente acción                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Salir y entrar sin cuentas vacías nuevas        | Resuelto                             | Dos reingresos conservaron 112 en iMin. Después, dos ciclos A11 conservaron 86 cuentas y el folio 154. [Reporte de sesión](2026-10-13-sesion-sin-cuentas-vacias.md), [correcciones](2026-10-13-jornada-correcciones.md). |
| Ocultar descartes técnicos vacíos del historial | Resuelto                             | Se conserva la auditoría y se excluye sólo el borrador automático vacío. Pruebas y reporte de correcciones.                                                                                                              |
| Aviso de otra terminal sin necesidad de tocar   | Resuelto para el conflicto observado | Era `CART_ACCOUNT_BUSY`, no `OPERATOR_SESSION_BUSY`. [Medición 91](2026-10-13-aviso-cuenta-liberada.md): logout A11 y retiro automático iMin.                                                                            |
| Siempre Cuenta XXX; además Mesa X en Lista      | Resuelto                             | [Comparación nativa 92](2026-10-13-cuenta-folio-mesa.md). No cambia folios ni contrato.                                                                                                                                  |
| Capuccino de cuenta 004 no permitía Listo       | Resuelto                             | La excepción global de otros productos bloqueaba la transición. Listo y Terminar se ejecutaron en A9 como Cocinero 2. [Reporte 93](2026-10-13-kds-completar-descartar.md).                                               |
| Cancelada visible con sólo Descartar            | Resuelto, incluso Sin estación       | 070 se descartó en 93. En 94, A9 descartó los dos productos de 013 desde Sin estación. [Captura](evidence/2026-10-13-kds-sin-estacion/a9-013-descartada.png).                                                            |
| Comandas viejas y autocierre                    | Diagnóstico y manejo entregados      | ONCA conserva Manual. 004 quedó completada y 013 descartada. Los pendientes antiguos permanecen visibles hasta una acción explícita; el pago no confirma preparación.                                                    |
| A9 como KDS y A11 como POS móvil                | Aplicado                             | Build 94 instalado en ambas. A9 completó 004; A11 creó Mesa 16 y recibió cambios de estado sin Actualizar.                                                                                                               |
| Mapa al seleccionar mesa para una cuenta        | Resuelto                             | [Mapa en A11](evidence/2026-10-13-selector-mesas/a11-mapa.png). El selector muestra áreas, estados y cuenta activa.                                                                                                      |
| Crear mesa siempre disponible                   | Resuelto                             | [Mesa 16 creada en A11](evidence/2026-10-13-selector-mesas/a11-mesa16-creada.png), persistida con cuatro lugares. Se conservaron 89 cuentas guardadas y 11 abiertas.                                                     |
| Estados, cuenta ocupante y liberar rápido       | Resuelto con permisos                | iMin protegió Mesa 1 por Cuenta 141. Admin liberó y limpió Mesa 5 sin cuenta. A11 reflejó el cambio y ocultó acciones de gestión al mesero. [Reporte](2026-10-13-selector-mesas.md).                                     |
| Decidir mesa física o virtual                   | Implementado                         | [Comparación](../research/2026-10-13-seleccion-mesa-temporal/README.md): mesa física adicional persistente. Para un pedido sin lugar físico, se conserva cuenta sin mesa.                                                |

El aviso de acceso `OPERATOR_SESSION_BUSY` es una pantalla distinta. No se afirma que el sondeo de Cuentas actualice también ese acceso.
La corrección 91 documenta el conflicto que se reprodujo y midió.

## Excepciones históricas: diagnóstico y cierre

[Las filas posteriores al build 93](evidence/2026-10-13-kds-completar-descartar/db-after.txt) conservan el diagnóstico anterior.
Las [filas del cierre 94](evidence/2026-10-13-kds-sin-estacion/db-after94.txt) acreditan el resultado de 004 y 013:

| Cuenta       | Hecho comercial                   | Estado al cierre 94                                           | Acción y evidencia                                                                                        |
| ------------ | --------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 004 · Mesa 1 | Cobrada; una venta comprometida   | Comanda `completed`, versión 11; Capuccino previo conservado. | Admin aplicó rutas actuales a Barra. Barista 2 preparó, marcó Listo y terminó Aeropress y Amanecer en A9. |
| 013 · Mesa 2 | Cancelada, sin venta comprometida | Dos productos cancelados con `station_completed_at`.          | Cocinero 2 pulsó Descartar en A9. No hubo nuevo ruteo ni preparación.                                     |
| 070          | Cancelada, sin venta              | Ya descartada en Barra                                        | Completado; no es pendiente.                                                                              |
| 071          | Cancelada, sin venta              | Aviso pendiente de reconocimiento en Barra                    | La UI 93 ya permite Descartar. Que el operador aún no lo pulse no es un bloqueo técnico.                  |
| 002          | Cancelada                         | Visible en Sin estación, pendiente de reconocimiento.         | Descartar disponible. Se conserva para decisión del operador, sin borrar el historial.                    |

La consulta inicial confirmó una ruta actual a **Barra**, prioridad 100, para los cuatro productos sin estación.
Entonces conservaban `station_id=NULL` y `status='exception'`. Esa evidencia explica por qué editar la configuración no bastaba.

La causa del bloqueo histórico se confirmó en el código anterior:

- `projectKitchenOrder` devuelve el ticket existente sin volver a calcular sus filas.
- `insertKitchenItems` usa `ON CONFLICT DO NOTHING` para un producto ya proyectado.
- `boardSnapshot` parte de `kds.station_order` y une estaciones reales; excluye productos sin estación.
- `commandForPos` rechaza un alcance vacío. `executeKitchenCommand` exige ítems de una estación autorizada.
- La lectura antigua del dashboard incluye productos sin estación, pero limita las órdenes a veinticuatro horas.

**Decisión implementada:** lectura explícita Sin estación y resolución limitada a esas filas.
Reutiliza el resolver, los permisos, la versión, la idempotencia, la auditoría y el despertar del tablero.
La previsualización comprueba que las rutas no cambiaron antes de aplicar. Las canceladas sólo admiten reconocimiento.
A9 reflejó la resolución de 004 sin Actualizar; iMin reflejó el descarte remoto de 013.
Las canceladas 019, 033, 060 y 071 también conservan Descartar disponible. Su reconocimiento pendiente no equivale a un bloqueo técnico.

## Cierre diario: qué está comprobado

ONCA tiene `pos_day_close_policy='manual'`, zona `America/Mazatlan` y corte operativo a las 04:00.
La [captura del dashboard](evidence/2026-10-13-aviso-cuenta-liberada/dashboard-politica-manual.png) coincide con las filas.
No había cuentas comerciales abiertas de días anteriores en esa medición.

El barrido `auto_void` ocurre al consultar Cuentas. No es un trabajo programado que corra automáticamente a las 04:00.
Sólo toma ciertos carritos abiertos anteriores; deja fuera `suspended`, cobrados y cancelados.
Cerrar la cuenta comercial no acredita la preparación ni la entrega de productos de cocina.

Se conserva Manual. No se fuerza una nueva política para ocultar las comandas antiguas.
No se verificó un cambio real de día ni la política `auto_void` en este ciclo.
Esta limitación no cambia el cierre explícito de toda la comanda 004, acreditado en el build 94.

## Estado de los controles y límites restantes

| Control            | Última evidencia aplicable hasta 94                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Análisis POS       | Sin hallazgos en [log 94](evidence/2026-10-13-kds-sin-estacion/pos-analyze.log).                                                                                              |
| Suite completa POS | [933 pruebas aprobadas](evidence/2026-10-13-kds-sin-estacion/pos-suite.log). El total inicial 851 quedó superado por pruebas posteriores.                                     |
| Selector dirigido  | [35 pruebas POS](evidence/2026-10-13-selector-mesas/pos-focused.log) y [nueve integraciones API](evidence/2026-10-13-selector-mesas/api-integration.log), con `ROLLBACK`.     |
| KDS dirigido       | [96 pruebas POS](evidence/2026-10-13-kds-sin-estacion/pos-focused.log), con once nuevas; [155 unitarias API](evidence/2026-10-13-kds-sin-estacion/api-unit.log).              |
| KDS integrado      | [18 integraciones](evidence/2026-10-13-kds-sin-estacion/api-integration.log): doce Sin estación y seis por estación, con permisos del rol `api` y RLS.                        |
| Contrato           | [86 pruebas aprobadas](evidence/2026-10-13-kds-sin-estacion/contract-tests.log); typecheck del contrato sin hallazgos.                                                        |
| Dashboard          | 365 pruebas en las correcciones de jornada; nueve específicas del resolver original. Los recorridos reales tienen capturas.                                                   |
| Migraciones        | 029 para alertas; 030–032 para correcciones posteriores. 033 añade permisos de Sin estación y se aplicó en `umi_local`; [comando y decisión](2026-10-13-kds-sin-estacion.md). |
| API build y ESLint | Aprobados en 94. Typecheck global mantiene dos errores previos de hardware; no se modificó la spec protegida de caja.                                                         |
| Formato            | Se formatearon los Markdown propios. El formato global tenía archivos ajenos fuera del alcance.                                                                               |

El selector y Sin estación pasaron sus pruebas, el análisis y la suite POS completa antes del build 94.
Las 29 pruebas KDS Gate4A antiguas quedaron omitidas por su fixture; son distintas de las 18 integraciones ejecutadas en `umi_local`.
No se certifica verde toda la API, readiness global, impresión física, pagos bancarios ni una jornada de ocho horas.
El endpoint [health](evidence/2026-10-13-kds-sin-estacion/api-health.json) mantiene el 503 previo por `schema.current=null`; DB y Redis responden.

La instalación pendiente del 75, el ciclo de sesión A11 y la hoja móvil desactualizada son límites históricos ya superados.
La audición física, quince minutos nativos en Cocina, acceso LAN directo y cambio real de fecha siguen sin comprobarse.
Estos límites no justifican borrar datos ni repetir escenarios ya acreditados sin un cambio relacionado.

## Otras notas históricas

El reporte temprano de cuenta vacía propuso unificar Nueva cuenta y Vaciar cuenta, sujeto a decisión del dueño.
La protección contra cuentas vacías sí está implementada. La propuesta de unificar controles no forma parte de los criterios originales de este ciclo.
No se la presenta como funcionalidad entregada ni como requisito nuevo implícito.

El reporte A11 conserva etapas que usaron una copia desechable de la base. Esa historia no cumple literalmente la regla de una única base.
Las verificaciones posteriores citadas para 90, 91, 93 y 94 usaron `umi_local`; el cierre 94 conservó una sola API y esa base.
No se modificó ese historial ni se lo sustituyó por una afirmación de cumplimiento retroactivo.
