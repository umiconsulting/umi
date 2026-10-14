# Folio visible de cuenta por día operativo

Fecha: 14 de octubre de 2026. Estado: aplicado en desarrollo local.

## Decisión

El número que ve el operador en una cuenta nueva inicia en `001` para cada comercio, sucursal y día operativo. El día se determina con la política existente de `business_date`, no con la medianoche del dispositivo; en la configuración ONCA usada para la prueba, el corte es a las 04:00. El folio crece a `1000` si hay más de 999 cuentas en un mismo día, sin truncarlo ni reciclarlo durante esa jornada.

`pos_cart.account_number` sigue siendo el identificador global histórico. La nueva columna `daily_account_number` es el folio visible para cuentas creadas desde la migración. Las lecturas usan `coalesce(daily_account_number, account_number)`, por lo que las cuentas anteriores conservan su número y las referencias internas no cambian. La fecha acompaña a las cuentas de días anteriores en las vistas de cuentas y KDS, donde un folio diario solo sería ambiguo.

Un contador por `(merchant_id, location_id, business_date)` asigna el número dentro de la transacción que crea la cuenta. El `INSERT ... ON CONFLICT DO UPDATE` serializa la asignación concurrente; un índice único parcial impide duplicados en las cuentas nuevas. La migración siembra cada contador con el máximo folio histórico de su ámbito para no mostrar hoy un `001` que pueda confundirse con una cuenta existente del mismo día. Por eso ONCA sigue hoy después de `208`; la jornada siguiente inicia en `001`.

## Alternativas consideradas

- Mantener el entero global: era técnicamente seguro, pero crecía con todos los comercios de esta base y no cumplía la preferencia expresa de reinicio diario.
- Reiniciar la secuencia de `account_number`: chocaba con su unicidad global y con cuentas de jornadas anteriores que aún pueden coexistir; también alteraría el significado de referencias históricas.
- Reciclar al llegar a `999`: podría dar dos cuentas `001` en la misma jornada. Se prefiere `1000` antes que una referencia ambigua.

El folio visible identifica una cuenta **sólo junto con comercio, sucursal y fecha operativa**. El UUID continúa siendo la identidad para API, relaciones y auditoría. El número de ticket de cobro mantiene su serie independiente. No hay cambio de contrato público: `accountFolio` sigue siendo texto.

Aplicar [`038_daily_pos_account_number.sql`](../migration/build-v3/migrations/038_daily_pos_account_number.sql) con `psql --single-transaction`; la siembra y la activación del trigger deben hacerse atómicamente. La investigación de productos que precedió la decisión está en [numeración de cuentas POS](../research/2026-10-14-numeracion-de-cuentas-pos/README.md).
