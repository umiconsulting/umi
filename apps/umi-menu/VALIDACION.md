# Validación del MVP local

Fecha: 5 de noviembre de 2026. Entorno: Linux local restringido, Node v22.23.4, Python 3.10.
Revisión: hashes SHA-256 por archivo en `revision.json`. Esta carpeta no es un checkout Git.

| Comando / comprobación                                                | Resultado                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `node mvp-local/state.test.cjs`                                       | 9 pruebas aprobadas; 0 fallos.                                                                         |
| `node --check mvp-local/base.js`                                      | Aprobado.                                                                                              |
| `node --check mvp-local/state.js`                                     | Aprobado.                                                                                              |
| `node --check mvp-local/app.js`                                       | Aprobado.                                                                                              |
| `node --check mvp-local/visual.js`                                    | Aprobado.                                                                                              |
| `python3 mvp-local/generar-qr.py`                                     | Generados los SVG de mesas 1, 2 y 12 para `http://127.0.0.1:56455`. Lectura con cámara pendiente.      |
| Inspección de referencias estáticas locales                           | Recursos presentes. No acredita su renderizado.                                                        |
| `python3 -m http.server 56455 --bind 127.0.0.1 --directory mvp-local` | Bloqueado: `PermissionError: Operation not permitted` al crear el socket. No quedó un servidor activo. |
| Chrome mediante Playwright                                            | No completó el arranque; proceso interrumpido.                                                         |
| Chromium headless instalado, apertura directa del HTML                | Bloqueado por sandbox: `shutdown: Operation not permitted`.                                            |

Las pruebas de reglas cubren aceptación, finalización de varias estaciones, rechazo con motivo, vencimiento, cancelación pendiente, autorización posterior, programación y cobro único simulado.

La sintaxis y las reglas simuladas están verificadas. La revisión visual, el recorrido de interfaz, el escaneo de QR y la persistencia en navegador quedan pendientes. El README incluye el recorrido manual. No se generaron capturas ni se afirma validación en navegador.

No se probaron API, POS, KDS, PostgreSQL, SMTP ni staging. No se crearon issues, PRs o despliegues.

## Ajuste de navegación

Personal, Recoger, Mesa e Información se agrupan en un menú hamburguesa. Se añadió cierre por Escape, selección, clic exterior y salida del foco. El contexto de QR se conserva.

`node --check` aprobó `navigation.js`, `app.js` y `base.js`. La revisión de navegador sigue pendiente. Se repitió el arranque HTTP en el puerto 56455: el entorno volvió a bloquear la creación del socket con `PermissionError: Operation not permitted`. No hay servidor activo.

## Carrusel automático

Autoavance circular cada cinco segundos. Control de pausa y reproducción. Pausa por interacción, pestaña oculta y diálogo abierto. Inicio detenido con movimiento reducido. `node --check mvp-local/visual.js`: aprobado. La comprobación visual continúa pendiente por las restricciones del entorno.

## Foco del buscador

Se identificaron dos indicadores superpuestos: `input:focus-visible` y `.search:focus-within`. Se eliminó solo el marco interior del input. El contenedor conserva su indicador de foco azul para ratón y teclado. Inspección de cascada CSS realizada; comprobación visual pendiente.

## Retirada del botón de pausa

Se retiraron el botón y sus referencias JavaScript por solicitud del usuario. Se conserva el autoavance y las pausas por interacción y movimiento reducido. `node --check mvp-local/visual.js`: aprobado.
