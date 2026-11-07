import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { initialAnalysisQuery } from './sales-report-model.js';
import { SalesBars, SalesDataNote, SalesDetailWidget } from './sales-widgets.jsx';
import { formatNumber } from '@/lib/format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { useSalesAnalysis, useSalesAnalysisOptions } from '@/data.jsx';
import { formatOperationMoney } from './operations-format.js';
import SalesAnalysisGroups from './sales-analysis-groups.jsx';
import './sales-purchase-analysis.css';

const percent = (value) =>
  value == null ? '—' : formatNumber(value, { style: 'percent', maximumFractionDigits: 1 });
const number = (value) => (value == null ? '—' : formatNumber(value, { maximumFractionDigits: 2 }));

function Panel({ title, children }) {
  return (
    <section className="analysis-panel surface">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function ReportError({ code, onRetry }) {
  return (
    <div className="analysis-panel surface" role="alert">
      <p>
        {code === 'REPORT_RANGE_TOO_LARGE' || code === 'VALIDATION_FAILED' ? (
          <Trans>
            No se pudo consultar este periodo. Elige un rango menor, de hasta 731 días y 20,000
            tickets.
          </Trans>
        ) : (
          <Trans>No se pudo cargar el análisis. Revisa los filtros y reintenta.</Trans>
        )}
      </p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        <Trans>Reintentar</Trans>
      </button>
    </div>
  );
}

function groupOptions(options) {
  const categories = new Map();
  for (const product of options.products) {
    if (product.categoryId) categories.set(`category:${product.categoryId}`, product.category);
  }
  return [...categories]
    .map(([id, name]) => ({ id, name }))
    .concat(options.groups.map((group) => ({ id: `group:${group.id}`, name: group.name })));
}

function availableGroupsQuery(query, options) {
  const keys = new Set(groupOptions(options).map((group) => group.id));
  return {
    ...query,
    groupA: keys.has(query.groupA) ? query.groupA : '',
    groupB: keys.has(query.groupB) ? query.groupB : '',
  };
}

function AnalysisFilters({ options, query, setQuery }) {
  const { t } = useLingui();
  const [draft, setDraft] = useState(query);
  const groups = groupOptions(options);
  function change(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  return (
    <form
      className="analysis-filters surface"
      onSubmit={(event) => {
        event.preventDefault();
        setQuery(availableGroupsQuery(draft, options));
      }}
    >
      <label>
        <Trans>Sucursal del análisis</Trans>
        <select
          aria-label={t`Sucursal del análisis`}
          value={draft.locationId}
          onChange={(event) => change('locationId', event.target.value)}
        >
          {options.canCompareLocations && (
            <option value="">
              <Trans>Todas las sucursales</Trans>
            </option>
          )}
          {options.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <Trans>Desde</Trans>
        <input
          type="date"
          required
          value={draft.from}
          max={draft.to}
          onChange={(event) => change('from', event.target.value)}
        />
      </label>
      <label>
        <Trans>Hasta</Trans>
        <input
          type="date"
          required
          value={draft.to}
          min={draft.from}
          max={options.today}
          onChange={(event) => change('to', event.target.value)}
        />
      </label>
      <label>
        <Trans>Devoluciones</Trans>
        <select
          aria-label={t`Devoluciones`}
          value={draft.refundView}
          onChange={(event) => change('refundView', event.target.value)}
        >
          <option value="sale_result">
            <Trans>Resultado de las ventas del periodo</Trans>
          </option>
          <option value="period_movements">
            <Trans>Movimientos del periodo</Trans>
          </option>
        </select>
      </label>
      <label>
        <Trans>Compras conjuntas por</Trans>
        <select
          aria-label={t`Compras conjuntas por`}
          value={draft.basketUnit}
          onChange={(event) => change('basketUnit', event.target.value)}
        >
          <option value="ticket">
            <Trans>Ticket</Trans>
          </option>
          <option value="table_visit">
            <Trans>Visita de mesa identificada</Trans>
          </option>
        </select>
      </label>
      {['groupA', 'groupB'].map((key, index) => (
        <label key={key}>
          {index === 0 ? <Trans>Grupo A</Trans> : <Trans>Grupo B</Trans>}
          <select
            aria-label={index === 0 ? t`Grupo A` : t`Grupo B`}
            value={groups.some((group) => group.id === draft[key]) ? draft[key] : ''}
            onChange={(event) => change(key, event.target.value)}
          >
            <option value="">
              <Trans>Seleccionar grupo</Trans>
            </option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="btn btn-primary">
        <Trans>Consultar</Trans>
      </button>
    </form>
  );
}

function Totals({ report }) {
  const { totals, currency } = report;
  const money = (value) => formatOperationMoney(value, currency);
  const facts = [
    [
      <Trans key="average">Ticket promedio sin propina</Trans>,
      money(totals.averageTicketMinorUnits),
    ],
    [<Trans key="tickets">Tickets de venta</Trans>, number(totals.tickets)],
    [<Trans key="units">Piezas netas por ticket</Trans>, number(totals.unitsPerTicket)],
    [<Trans key="refunds">Devoluciones sin propina</Trans>, money(totals.refundsMinorUnits)],
    [<Trans key="tips">Propinas netas</Trans>, money(totals.tipsMinorUnits)],
    [<Trans key="discounts">Descuentos de las ventas</Trans>, money(totals.discountsMinorUnits)],
  ];
  return (
    <Panel title={<Trans>Ventas y ticket promedio</Trans>}>
      <div className="analysis-lead figures">{money(totals.netMinorUnits)}</div>
      <p>
        <Trans>
          Venta neta de productos, después de descuentos y devoluciones. Excluye propinas.
        </Trans>
      </p>
      <dl className="analysis-facts">
        {facts.map(([label, value], index) => (
          <div key={index}>
            <dt>{label}</dt>
            <dd className="figures">{value}</dd>
          </div>
        ))}
      </dl>
      <details className="analysis-method">
        <summary>
          <Trans>Cómo se calcula</Trans>
        </summary>
        {report.refundView === 'sale_result' ? (
          <p>
            <Trans>
              Las devoluciones confirmadas hasta esta consulta ajustan la fecha del recibo y la hora
              del pedido original.
            </Trans>
          </p>
        ) : (
          <p>
            <Trans>
              Las ventas conservan la fecha del recibo. Las devoluciones se restan en su fecha de
              confirmación, aunque la venta sea anterior al periodo.
            </Trans>
          </p>
        )}
        <p>
          <Trans>
            El promedio divide la venta neta entre los tickets de venta. Sin tickets, el promedio no
            aplica. Un ticket devuelto permanece en el conteo.
          </Trans>
        </p>
      </details>
    </Panel>
  );
}

function JointPurchases({ report }) {
  const [showAll, setShowAll] = useState(false);
  const group = report.selectedGroups;
  return (
    <Panel title={<Trans>¿Qué se compra junto?</Trans>}>
      {group.a && group.b ? (
        <>
          <div className="analysis-lead figures">{percent(group.support)}</div>
          <p>
            <Trans>
              {group.basketsWithBoth} de {report.coverage.baskets} compras incluyen {group.a} y{' '}
              {group.b}.
            </Trans>
          </p>
          <p>
            <Trans>
              De {group.basketsWithA} compras con {group.a}, {group.basketsWithBoth} también
              incluyen {group.b} ({percent(group.confidenceAtoB)}).
            </Trans>
          </p>
          {group.overlappingProducts > 0 && (
            <p>
              <Trans>
                Los grupos comparten {group.overlappingProducts} productos. La compra conjunta exige
                dos productos distintos.
              </Trans>
            </p>
          )}
        </>
      ) : (
        <p>
          <Trans>
            Selecciona dos categorías o grupos y pulsa Consultar para ver su compra conjunta.
          </Trans>
        </p>
      )}
      <p>
        <Trans>
          La frecuencia cuenta cada compra una sola vez, aunque incluya varias piezas del mismo
          producto.
        </Trans>
      </p>
      {report.pairs.length ? (
        <div className="analysis-table" tabIndex={0}>
          <table>
            <caption>
              <Trans>
                Hasta 100 pares con mayor frecuencia, de {report.coverage.pairsAvailable} pares
                observados
              </Trans>
            </caption>
            <thead>
              <tr>
                <th>
                  <Trans>Producto A</Trans>
                </th>
                <th>
                  <Trans>Producto B</Trans>
                </th>
                <th>
                  <Trans>Compras juntas</Trans>
                </th>
                <th>
                  <Trans>Del total</Trans>
                </th>
                <th>
                  <Trans>Con B entre compras de A</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.pairs.slice(0, showAll ? 100 : 10).map((pair) => (
                <tr key={`${pair.productAId}:${pair.productBId}`}>
                  <td>{pair.productAName}</td>
                  <td>{pair.productBName}</td>
                  <td>{number(pair.baskets)}</td>
                  <td>{percent(pair.support)}</td>
                  <td>
                    {pair.baskets} / {pair.basketsWithA} · {percent(pair.confidenceAtoB)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>
          <Trans>No hay pares de productos en estas compras.</Trans>
        </p>
      )}
      {report.pairs.length > 10 && (
        <div className="analysis-pair-limit">
          <button type="button" className="btn btn-secondary" onClick={() => setShowAll(!showAll)}>
            {showAll ? <Trans>Mostrar los primeros 10</Trans> : <Trans>Ver todos los pares</Trans>}
          </button>
        </div>
      )}
      {report.basketUnit === 'table_visit' ? (
        <p>
          <Trans>
            Se usan {report.coverage.baskets} visitas identificadas. Se excluyen{' '}
            {report.coverage.ticketsWithoutVisit} tickets sin visita. Solo se agrupan tickets del
            periodo consultado.
          </Trans>
        </p>
      ) : (
        <p>
          <Trans>
            Se usan {report.coverage.baskets} tickets. Un ticket anónimo no permite identificar
            otras compras de la misma visita.
          </Trans>
        </p>
      )}
      <p>
        <Trans>
          {report.coverage.ticketsWithoutProducts} tickets carecen de productos identificados con
          piezas restantes. Permanecen en el total de tickets.
        </Trans>
      </p>
      {report.refundView === 'period_movements' && (
        <p>
          <Trans>
            Las compras conjuntas muestran los productos de los tickets originales del periodo. Las
            devoluciones afectan los importes y las piezas netas.
          </Trans>
        </p>
      )}
    </Panel>
  );
}

function MetricsTable({ rows, currency, label }) {
  return (
    <div className="analysis-table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>{label}</th>
            <th>
              <Trans>Venta neta</Trans>
            </th>
            <th>
              <Trans>Tickets</Trans>
            </th>
            <th>
              <Trans>Ticket promedio</Trans>
            </th>
            <th>
              <Trans>Piezas por ticket</Trans>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{formatOperationMoney(row.netMinorUnits, currency)}</td>
              <td>{number(row.tickets)}</td>
              <td>{formatOperationMoney(row.averageTicketMinorUnits, currency)}</td>
              <td>{number(row.unitsPerTicket)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p>
          <Trans>No hay movimientos en este periodo.</Trans>
        </p>
      )}
    </div>
  );
}

function TimeComparisons({ report }) {
  const { t } = useLingui();
  const [params, setParams] = useSearchParams();
  const dimension = ['byHour', 'byWeekday', 'byDay', 'byMonth'].includes(params.get('dimension'))
    ? params.get('dimension')
    : 'byHour';
  const metric = ['netMinorUnits', 'averageTicketMinorUnits', 'tickets'].includes(
    params.get('metric'),
  )
    ? params.get('metric')
    : 'netMinorUnits';
  function changeDimension(key, value) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    });
  }
  const days = [t`Lunes`, t`Martes`, t`Miércoles`, t`Jueves`, t`Viernes`, t`Sábado`, t`Domingo`];
  const rows = report[dimension].map((row) => ({
    ...row,
    label:
      dimension === 'byHour'
        ? `${row.label}:00`
        : dimension === 'byWeekday'
          ? days[Number(row.key) - 1]
          : row.label,
  }));
  return (
    <Panel title={<Trans>Horas, días y meses</Trans>}>
      <label className="analysis-dimension">
        <Trans>Comparar por</Trans>
        <select
          aria-label={t`Comparar por`}
          value={dimension}
          onChange={(event) => changeDimension('dimension', event.target.value)}
        >
          <option value="byHour">
            <Trans>Hora</Trans>
          </option>
          <option value="byWeekday">
            <Trans>Día de la semana</Trans>
          </option>
          <option value="byDay">
            <Trans>Fecha</Trans>
          </option>
          <option value="byMonth">
            <Trans>Mes</Trans>
          </option>
        </select>
      </label>
      <label className="analysis-dimension">
        <Trans>Indicador del gráfico</Trans>
        <select
          aria-label={t`Indicador del gráfico`}
          value={metric}
          onChange={(event) => changeDimension('metric', event.target.value)}
        >
          <option value="netMinorUnits">{t`Venta neta`}</option>
          <option value="averageTicketMinorUnits">{t`Ticket promedio`}</option>
          <option value="tickets">{t`Tickets de venta`}</option>
        </select>
      </label>
      <SalesBars
        rows={rows}
        currency={report.currency}
        metric={metric}
        count={metric === 'tickets'}
      />
      <details className="analysis-method">
        <summary>
          <Trans>Ver tabla del periodo</Trans>
        </summary>
        <MetricsTable rows={rows} currency={report.currency} label={<Trans>Periodo</Trans>} />
      </details>
      <p>
        <Trans>
          Las horas corresponden al pedido, en {report.timezone}. Las fechas conservan el día
          operativo de los recibos y las devoluciones.
        </Trans>
      </p>
      <p>
        <Trans>
          La tabla muestra periodos con movimientos. Una hora con pocas ventas requiere revisar el
          horario de apertura y la demanda.
        </Trans>
      </p>
      <p>
        <Trans>
          Los meses permiten comparar el historial disponible. Confirmar una temporada requiere
          observar ciclos completos y comparar periodos equivalentes.
        </Trans>
      </p>
    </Panel>
  );
}

function AnalysisResults({ report, query, section, setSection }) {
  const { t } = useLingui();
  const sections = [
    ['overview', t`Resumen de ventas`],
    ['pairs', t`Compras conjuntas`],
    ['time', t`Horas y tendencias`],
    ['distribution', t`Piezas por ticket`],
    ['locations', t`Sucursales`],
  ];
  const active = sections.some(([id]) => id === section) ? section : 'overview';
  return (
    <>
      <SalesDataNote report={report} />
      {report.totals.tickets === 0 && (
        <p role="status">
          <Trans>
            Este periodo no contiene tickets de venta. Puede incluir devoluciones de ventas
            anteriores.
          </Trans>
        </p>
      )}
      <nav className="analysis-section-nav" aria-label={t`Desglose de ventas`}>
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn btn-ghost"
            aria-pressed={id === active}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {active === 'overview' && (
        <>
          <Totals report={report} />
          <div className="analysis-summary-grid">
            {['trend', 'hours', 'pairs', 'distribution'].map((id) => (
              <SalesDetailWidget key={id} id={id} report={report} query={query} />
            ))}
          </div>
        </>
      )}
      {active === 'pairs' && <JointPurchases report={report} />}
      {active === 'time' && <TimeComparisons report={report} />}
      {active === 'locations' && (
        <Panel title={<Trans>Comparación entre sucursales</Trans>}>
          <MetricsTable
            rows={report.byLocation}
            currency={report.currency}
            label={<Trans>Sucursal</Trans>}
          />
          <p>
            <Trans>
              El promedio del negocio usa sus ventas y tickets totales. Para comparar sucursales,
              elige todas las sucursales en los filtros del análisis.
            </Trans>
          </p>
        </Panel>
      )}
      {active === 'distribution' && (
        <Panel title={<Trans>¿Cuántas piezas lleva cada ticket?</Trans>}>
          <SalesBars
            rows={report.unitsDistribution.map((row) => ({
              key: row.units,
              label: t`${row.units} piezas`,
              tickets: row.tickets,
            }))}
            currency={report.currency}
            metric="tickets"
            count
          />
          <details className="analysis-method">
            <summary>
              <Trans>Ver tabla de piezas</Trans>
            </summary>
            <div className="analysis-table" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>
                      <Trans>Piezas</Trans>
                    </th>
                    <th>
                      <Trans>Tickets</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.unitsDistribution.map((row) => (
                    <tr key={row.units}>
                      <td>{number(row.units)}</td>
                      <td>{number(row.tickets)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p>
            {report.refundView === 'sale_result' ? (
              <Trans>Piezas restantes después de las devoluciones de cada ticket.</Trans>
            ) : (
              <Trans>Piezas originales de los tickets de venta del periodo.</Trans>
            )}
          </p>
        </Panel>
      )}
      <p className="analysis-note">
        <Trans>
          Historial de ventas desde {report.firstSaleDate ?? '—'}. Las categorías usan el catálogo
          actual.
        </Trans>
      </p>
    </>
  );
}

function AnalysisWorkspace({ merchantId, locationId, options, reloadOptions }) {
  const [params, setParams] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  const query = availableGroupsQuery(initialAnalysisQuery(options, locationId, params), options);
  function setQuery(next) {
    setParams(
      new URLSearchParams(
        Object.entries({
          ...next,
          section: params.get('section') || 'overview',
          dimension: params.get('dimension'),
          metric: params.get('metric'),
        }).filter(([, value]) => value != null && value !== ''),
      ),
    );
  }
  function setSection(section) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('section', section);
      return next;
    });
  }
  const result = useSalesAnalysis(availableGroupsQuery(query, options), refresh);
  function reloadGroups() {
    reloadOptions();
    setRefresh((current) => current + 1);
  }
  return (
    <div className="sales-analysis">
      <p className="analysis-note">
        <Trans>
          Día operativo y zona horaria: {options.today} · {options.timezone}
        </Trans>
      </p>
      <AnalysisFilters
        key={JSON.stringify(query)}
        options={options}
        query={query}
        setQuery={setQuery}
      />

      {result.loading ? (
        <p role="status">
          <Trans>Consultando compras…</Trans>
        </p>
      ) : result.error ? (
        <ReportError code={result.errorCode} onRetry={() => setRefresh((current) => current + 1)} />
      ) : (
        result.data && (
          <AnalysisResults
            report={result.data}
            query={query}
            section={params.get('section')}
            setSection={setSection}
          />
        )
      )}
      <SalesAnalysisGroups
        merchantId={merchantId}
        options={options}
        onSaved={reloadGroups}
        onRefresh={reloadGroups}
      />
    </div>
  );
}

function ScopedAnalysis({ merchantId, locationId }) {
  const options = useSalesAnalysisOptions();
  const reload = () => options.refetch();
  if (options.loading && !options.data)
    return (
      <p role="status">
        <Trans>Cargando categorías y grupos…</Trans>
      </p>
    );
  if (!options.data)
    return options.error ? <ReportError code={options.errorCode} onRetry={reload} /> : null;
  return (
    <>
      {options.error && <ReportError code={options.errorCode} onRetry={reload} />}
      <AnalysisWorkspace
        merchantId={merchantId}
        locationId={locationId}
        options={options.data}
        reloadOptions={reload}
      />
    </>
  );
}

export default function SalesPurchaseAnalysis() {
  const context = useMerchant();
  const merchantId = context.selectedMerchantId || context.capabilities?.merchant?.id;
  const locationId = context.selectedLocationId || context.capabilities?.selectedLocation?.id || '';
  const [, setParams] = useSearchParams();
  const previousScope = useRef({ merchantId, locationId });
  useEffect(() => {
    if (
      previousScope.current.merchantId === merchantId &&
      previousScope.current.locationId === locationId
    )
      return;
    previousScope.current = { merchantId, locationId };
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (locationId) next.set('locationId', locationId);
        else next.delete('locationId');
        next.delete('groupA');
        next.delete('groupB');
        return next;
      },
      { replace: true },
    );
  }, [merchantId, locationId, setParams]);
  if (!merchantId)
    return (
      <p>
        <Trans>Selecciona un negocio para consultar sus compras.</Trans>
      </p>
    );
  return (
    <ScopedAnalysis
      key={`${merchantId}:${locationId}`}
      merchantId={merchantId}
      locationId={locationId}
    />
  );
}
