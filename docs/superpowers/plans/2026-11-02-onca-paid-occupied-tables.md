# Mesas pagadas y ocupadas

> Ejecución: `executing-plans`, en el worktree aislado `fix/onca-paid-occupied-tables-20261102`.

**Objetivo:** conservar la ocupación después del cobro y liberar la mesa sólo cuando sale el cliente.

**Arquitectura:** el pago cierra la cuenta comercial. La visita física conserva su identidad, personas, tiempo y grupo.
Un campo opcional `paidAt` identifica el pago de la visita. Los seis estados físicos existentes conservan su significado.

**Tecnologías:** PostgreSQL 17, API NestJS, contratos Zod, cliente Flutter y caché local.

**Especificación:** petición del propietario de ONCA del 2 de noviembre de 2026. La mesa debe mostrar «Pagada y ocupada».
La acción «Liberar mesa» pasa a «Por limpiar». La acción de limpieza pasa a «Libre».

## Límites

- Entrega mediante PR para revisión. El propietario aprueba antes de merge o instalación.
- Usa sólo datos locales aislados para los cobros de prueba.
- Conserva la protección por `table_visit_id` frente a confirmaciones tardías.
- Conserva los seis estados físicos. Una build anterior debe seguir viendo una mesa ocupada.
- Una cuenta nueva pendiente oculta la condición visual de pagada. Su cancelación conserva la visita ya pagada.
- Conserva el pago al mover la visita. Borra el pago al liberar la mesa o sentar una visita nueva.
- El historial de cuentas y pagos confirmados conserva sus datos.
- El diagnóstico KDS permanece separado. Los perfiles KDS ya tienen `kitchen.cancel_ack`.

## Tarea 1: pago y visita en API

Archivos: `pos-checkout.repository.ts`, `table-map.repository.ts`, `pos-cart.repository.ts`, `pos-sale.repository.ts` y migración aditiva en `supabase/migrations/`.

- [x] Prepara una mesa real en `checkout-order-kitchen.integration.ts` y ejecuta el cobro SQL.
- [x] Observa la prueba roja: se esperaba `seated`, dos personas y la misma visita; se recibió `dirty`, sin visita.
- [x] Añade `paid_at` nullable con limpieza automática cuando `seated_at` pasa a NULL.
- [x] Sustituye la liberación durante checkout por el registro del pago en la visita coincidente y su grupo.
- [x] Conserva el marcador en movimientos. Conserva la ocupación si se cancela o retira una segunda cuenta.
- [x] Prueba pago, consulta, cuenta nueva, cancelación, movimiento, liberación y nueva visita en PostgreSQL.

La expectativa central es:

```ts
expect(paidTable.rows[0]).toMatchObject({
  state: 'seated', party_size: 2, visit_id: visit.rows[0].visit_id,
});
```

Comando: desde `apps/umi-api`, configura `CANCEL_VERIFY_DATABASE_URL` con la copia local y ejecuta:

```sh
node_modules/.bin/vitest run --config vitest.integration.config.ts src/modules/pos-checkout/checkout-order-kitchen.integration.ts
```

## Tarea 2: contrato y cliente

Archivos: `packages/contract/src/table-state.ts`, contrato generado, `floor_plan_surface.dart`, `table_state_controller.dart`, caché y traducciones.

- [x] Ejecuta `node --test packages/contract/test/table-state.test.mjs` y observa el rechazo inicial de `paidAt`.
- [x] Añade el campo opcional y regenera el contrato con una versión menor nueva.
- [x] Prueba la mesa pagada en el mapa. Comprueba que conserva personas y tiempo.
- [x] Presenta «Liberar mesa» como acción principal y «Nuevo consumo» como acción explícita.
- [x] Oculta «Pedir la cuenta» mientras la visita figura pagada sin otra cuenta abierta.
- [x] Prueba la caché durante movimiento, servicio, liberación y ocupación posterior.
- [x] Ejecuta las pruebas Flutter de mesas y el análisis estático de los archivos modificados.

## Tarea 3: entrega y evidencia

- [x] Ejecuta contrato, API, pruebas SQL y comprobaciones de formato.
- [x] Solicita una revisión independiente del diff y corrige los hallazgos.
- [x] Registra diagnóstico KDS, causa de mesas, pruebas y límites en la bitácora de Juan-PC.
- [ ] Publica los PR correspondientes. Comprueba CI y entrega sus enlaces.
- [ ] Conserva el despliegue pendiente de aprobación y de una prueba operativa segura.
