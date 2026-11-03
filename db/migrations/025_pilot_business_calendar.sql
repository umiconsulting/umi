\set ON_ERROR_STOP on
-- DÓNDE Y CUÁNDO EMPIEZA EL DÍA DEL CAFÉ PILOTO.
--
-- `002_onca_onboarding.sql` creó el comercio con los valores por defecto del esquema
-- (`America/Mexico_City`, corte a las `00:00`) y lo dijo a propósito: «timezone/currency/
-- locale are the schema defaults for a Mexican café, stated rather than inherited». Lo
-- que faltaba es el paso siguiente: el comercio no está en la Ciudad de México, está en
-- **Culiacán, Sinaloa**, y su propia ficha revisada lo dice —
-- `config/umipos-pilot-business-profile.json` declara `America/Mazatlan` desde antes de
-- que este archivo existiera. La fila de la base se quedó en el valor de arranque.
--
-- Importa porque la zona del comercio es la que decide qué día es: `merchant.
-- tg_business_date` deriva CADA fecha operativa —venta, cuenta, recibo, arqueo, reporte—
-- restando `business_day_start` a la hora *local del comercio*. Con la zona equivocada el
-- error no es cosmético: `America/Mazatlan` va una hora por detrás de `America/Mexico_City`
-- (UTC−7 contra UTC−6 desde 2022), así que un movimiento de las 04:30 de la Ciudad de
-- México —las 03:30 en Culiacán— caía del lado equivocado del corte de las 04:00 y se
-- contaba en el día siguiente. Comprobado sobre esta misma base: con la zona vieja ese
-- instante daba fecha operativa del 13; con la zona correcta, del 12, que es la verdad
-- del negocio.
--
-- El corte de las 04:00 viene del mismo trato: `2026-10-12-cierre-de-turno-de-caja-adr.md`
-- decidió que el día operativo empieza a las 4 de la mañana, locales del comercio, y
-- `business_day_start` es dónde vive esa decisión (no una constante del till ni del API).
--
-- POR QUÉ NO SE EDITA `002`. Una migración aplicada es un registro de lo que se aplicó, y
-- `002` ya corrió donde tenía que correr: editarla cambiaría lo que recibe una base nueva
-- y dejaría intacta la que tiene los clientes. Este archivo llega a las dos, que es el
-- motivo de que exista el directorio.
--
-- POR QUÉ POR `handle` Y NO POR ID. El id del comercio lo genera la base al crearlo; el
-- `handle` es con lo que `002` y el resto del onboarding lo vuelven a encontrar. La
-- condición deja el archivo inofensivo en una base donde ese comercio no exista (CI
-- aplica este directorio a una base limpia y a una con filas).
--
-- NO ES UNA POLÍTICA VIVA. Este archivo dice cuál es el calendario del piloto, y se aplica
-- una vez. Si el comercio cambia su hora de corte más adelante, ese cambio es
-- configuración (Ajustes del panel) y re-aplicar este archivo la devolvería a 04:00: es el
-- valor de arranque, no un candado.

update merchant.merchant
   set timezone = 'America/Mazatlan',
       business_day_start = '04:00',
       updated_at = now()
 where handle = 'onca'
   and (timezone is distinct from 'America/Mazatlan'
        or business_day_start is distinct from '04:00'::time);

comment on column merchant.merchant.business_day_start is
  'Hora local del comercio en que empieza el día operativo. 04:00 en el piloto de Culiacán (migration 025): un movimiento de la 01:00 pertenece a la noche anterior. Toda fecha operativa del esquema se deriva de esta columna más timezone.';
