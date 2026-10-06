# Manual del POS Flutter

[Índice](README.md) | [Ventas](VENTAS_RECIBOS_Y_REEMBOLSOS.md) | [Problemas](SOLUCION_DE_PROBLEMAS.md)

## Alcance

Flutter POS es el cliente operativo para dispositivos inscritos. Linux es el artefacto v1 certificado.

El cliente prepara comandos y muestra resultados. UMI API conserva la autoridad financiera y operativa.

## Inicio

1. La aplicación valida ambiente y versión.
2. El dispositivo se inscribe o recupera su identidad segura.
3. El operador usa su PIN.
4. La aplicación muestra comercio, ubicación, caja y turno.
5. El catálogo se carga desde UMI API.

No continúes si el contexto visible no coincide con el lugar de trabajo.

## Venta normal

1. Busca por categoría, texto o código de barras.
2. Selecciona variantes y modificadores requeridos.
3. Revisa cantidad, precio y total de cada línea.
4. Adjunta un cliente solo cuando corresponde.
5. Aplica descuento o recompensa con la autorización necesaria.
6. Abre checkout y revisa el importe restante.
7. Selecciona los pagos soportados.
8. Confirma el commit, o escritura final, una vez.
9. Espera el resultado final o consulta recuperación.
10. Inicia la siguiente venta después del resultado terminal.

## Pagos

- Cash registra efectivo y calcula cambio.
- Manual terminal registra una afirmación del operador.
- Wallet usa valor autorizado del cliente.
- Gift card usa identidad enmascarada y valor autorizado.
- Mixed tender combina asignaciones sin redistribución silenciosa.

El pago manual no afirma autorización de un proveedor integrado.

## Suspender y cancelar

Suspender conserva una venta editable para reanudarla. Cancelar termina una venta editable según la política.

Una venta ya comprometida no se cancela mediante edición. Requiere un reembolso o compensación autorizada.

## Recibos y turnos

El resultado de venta muestra la referencia y el recibo. Una falla de impresión no cambia la venta.

Las operaciones de caja usan el turno activo. El estado del turno permanece visible antes de una acción de efectivo.

## Conectividad

El modo offline nativo permite solo la lista autorizada. La política actual permite efectivo bajo condiciones controladas.

Wallet, gift card y recompensa requieren autoridad online. La interfaz explica el bloqueo.

El journal cifrado conserva comandos permitidos. El replay es ordenado y puede producir un caso de recuperación.

## Regla de duplicados

**Nunca repitas a ciegas una venta incierta. Consulta primero el estado autoritativo del comando.**

### La red cae después de Pay

1. No pulses Pay otra vez.
2. Espera la reconexión.
3. Usa `Query Original Command` o Recovery Center.
4. Confirma venta, pago, recibo e inventario.
5. Crea otro comando solo cuando el original sea terminal y no exista.

## Qué hacer si

| Síntoma                     | Acción segura                                                    |
| --------------------------- | ---------------------------------------------------------------- |
| La venta parece congelada   | Revisa el estado `Processing` y consulta el comando original     |
| Falta un producto           | Revisa búsqueda, categoría, ubicación, archivo y disponibilidad  |
| El dispositivo fue revocado | Detén la operación y solicita una reinscripción autorizada       |
| La caja no está disponible  | Verifica asignación, estado y turno                              |
| El total cambió             | Recarga la vista previa y vuelve a revisar                       |
| La impresión falló          | Confirma la venta y después usa COPY o recuperación de impresión |

## Fuentes

- Rutas: `apps/umi-pos/lib/app/umi_pos_app.dart`
- Funciones: `apps/umi-pos/lib/features/`
- Pruebas: `apps/umi-pos/test/`
- Política offline: `docs/product/UMIPOS_OFFLINE_COMMAND_POLICY.md`
