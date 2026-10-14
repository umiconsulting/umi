# Estado del puerto del cajón en la iMin

El Centro de hardware mostraba «Conectado» para el cajón sin que hubiera uno enchufado. El sondeo sólo comprobaba que la iMin tiene un puerto RJ12 accesible. La aplicación interpretaba ese resultado como conexión física. El sensor de la terminal devolvió `1` sin cajón, pero la documentación no fija la polaridad de esa lectura.

La pantalla ahora indica «Puerto de la terminal disponible; cajón físico sin verificar» y usa un signo de interrogación gris. La impresora conserva su estado independiente «Conectado». La prueba del cajón informa que la terminal aceptó el pulso y pide verificar la apertura. El diagnóstico guarda `health=unknown` y `connection_state=unknown` para este transporte aunque el puerto acepte la escritura. La apertura automática al cobrar permanece habilitada; el cambio afecta la interpretación del estado, no el envío del pulso.

La decisión sigue la [documentación oficial de iMin sobre CashBox RJ12](https://oss-sg.imin.sg/docs/en/GeneralFunctionModules.html): distingue la orden de apertura de la consulta de estado. En esta iMin, el canal usa el nodo del sistema que documenta [la guía de instalación del piloto](../pilot/UMIPOS_CASH_DRAWER_COMMISSIONING.md). La guía también registra que el cajón físico aún no estaba en sitio. **Inferencia de Umi:** un puerto accesible y una escritura aceptada no prueban que el cable esté puesto ni que el cajón haya abierto. La lectura `1` sólo sirve como base para comparar cuando llegue el cajón.

Herramientas: Flutter 3.47.5 y Dart 3.13.4, según `flutter --version`; Android Debug Bridge 1.0.41, paquete 37.0.0, según `adb version`. Usé el `MethodChannel` que ya existe en el POS; [Flutter lo recomienda para código específico de Android](https://docs.flutter.dev/platform-integration/platform-channels). No agregué una dependencia ni un detector manual de polaridad porque falta la lectura con el cajón conectado.

Evidencia local:

- [Pantalla anterior](evidence/2026-10-14-cajon-estado/imin-antes.png): el cajón figuraba «Conectado».
- [Pantalla final, versión 0.1.0+129](evidence/2026-10-14-cajon-estado/imin-final.png): puerto disponible, cajón sin verificar e impresora conectada.
- [Resultado de la prueba](evidence/2026-10-14-cajon-estado/imin-prueba-resultado.png): la terminal aceptó un pulso; el mensaje solicita verificar la apertura.
- [Filas de Postgres](evidence/2026-10-14-cajon-estado/base.txt): `merchant.hardware_device.connection_state=unknown`; el último `merchant.hardware_diagnostic` registra `drawer_test`, `health=unknown` y `connection_state=unknown`.
- [Peticiones de la API](evidence/2026-10-14-cajon-estado/api.log): las transiciones del comando y el diagnóstico respondieron `201`.

Verificación: `flutter analyze` sin hallazgos; 30 pruebas focalizadas de cajón y servicio; suite completa del POS, 996 pruebas aprobadas. Compilé la APK final `0.1.0+129` y la instalé en la iMin D3, la A9 y la A11. `dumpsys package` confirmó `versionCode=129` en las tres. En la iMin abrí el Centro de hardware y ejecuté la prueba mediante toques sobre capturas. La prueba registró un diagnóstico en la base. No cambié el esquema, la API, el contrato ni las migraciones.

No se verificó la apertura física: el cajón sigue sin conectarse. Tampoco se calibró la polaridad del sensor ni se comprobó el camino `iminservice` de Android 13. Cuando conecten el cajón, comparen la lectura del sensor con `1` y ejecuten una prueba visual de apertura antes de llamarlo «conectado».
