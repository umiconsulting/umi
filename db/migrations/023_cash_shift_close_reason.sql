\set ON_ERROR_STOP on
-- POR QUÉ SE CERRÓ EL TURNO DE CAJA.
--
-- El turno de caja guardaba *cuándo* se cerró (`closed_at`) y no *por qué*. Sin esa
-- columna, un cierre que hizo el reloj —el corte del día operativo, a las 04:00— se ve
-- igual que uno que hizo una persona contando el cajón, y esa diferencia es la que
-- explica una diferencia de efectivo tres días después: quien audita necesita saber si
-- alguien contó o si el sistema cerró solo. La decisión y sus tres reglas están en
-- `docs/architecture/2026-10-12-cierre-de-turno-de-caja-adr.md`.
--
-- Aditiva y sin reescribir nada: los turnos cerrados antes de esta migración quedan en
-- `operator` si los cerró alguien con un conteo, y en `NULL` si son anteriores a que el
-- concepto existiera. `NULL` significa «no se sabe», que es la verdad, y es mejor que
-- inventarla.
--
-- El libro sigue en `build-v3-79`, como todos los archivos de este directorio: el cambio
-- es aditivo y el ancla de compatibilidad es el ancla.

alter table merchant.cash_shift
  add column if not exists closed_reason text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'merchant.cash_shift'::regclass
       and conname = 'cash_shift_closed_reason_check'
  ) then
    alter table merchant.cash_shift
      add constraint cash_shift_closed_reason_check
      check (
        closed_reason is null
        or closed_reason in ('operator', 'carried_over', 'administrative')
      );
  end if;
end
$$;

comment on column merchant.cash_shift.closed_reason is
  'operator = una persona contó y cerró; carried_over = el corte del día operativo lo cerró por venir de un día anterior; administrative = lo cerró soporte con nota. NULL = anterior a esta columna.';
