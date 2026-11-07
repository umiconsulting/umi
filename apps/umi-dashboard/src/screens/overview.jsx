import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link, useSearchParams } from 'react-router-dom';
import { useSalesAnalysis, useSalesAnalysisOptions, useOverviewData } from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { getStoredSession } from '@/lib/auth.jsx';
import { formatNumber } from '@/lib/format.js';
import {
  SalesDataNote,
  SalesDetailWidget,
  SalesMetric,
  SalesReportState,
} from './sales-widgets.jsx';
import {
  AVAILABLE_WIDGETS,
  DEFAULT_WIDGETS,
  loadWidgetPreferences,
  previousReportPeriod,
  reportPeriod,
  salesReportLink,
} from './sales-report-model.js';

function WidgetSettings({ widgets, onChange, onClose }) {
  const { t } = useLingui();
  const labels = {
    net: t`Venta neta`,
    tickets: t`Tickets de venta`,
    average: t`Ticket promedio`,
    units: t`Piezas por ticket`,
    trend: t`Venta por día`,
    hours: t`Horas con más venta`,
    pairs: t`Productos que se compran juntos`,
    distribution: t`Piezas en cada ticket`,
  };
  return (
    <section className="surface widget-settings" aria-label={t`Personalizar inicio`}>
      <div className="sales-toolbar">
        <h2>
          <Trans>Tus indicadores, en tu orden</Trans>
        </h2>
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          <Trans>Listo</Trans>
        </button>
      </div>
      <p>
        <Trans>Esta selección se guarda en este navegador para tu usuario y este negocio.</Trans>
      </p>
      <ol>
        {[...widgets, ...AVAILABLE_WIDGETS.filter((id) => !widgets.includes(id))].map((id) => {
          const position = widgets.indexOf(id);
          function move(offset) {
            const next = [...widgets];
            [next[position], next[position + offset]] = [next[position + offset], next[position]];
            onChange(next);
          }
          return (
            <li key={id}>
              <label>
                <input
                  type="checkbox"
                  checked={position >= 0}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...widgets, id]
                        : widgets.filter((value) => value !== id),
                    )
                  }
                />
                {labels[id]}
              </label>
              <div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={t`Subir ${labels[id]}`}
                  disabled={position <= 0}
                  onClick={() => move(-1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={t`Bajar ${labels[id]}`}
                  disabled={position < 0 || position === widgets.length - 1}
                  onClick={() => move(1)}
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn-ghost" onClick={() => onChange(DEFAULT_WIDGETS)}>
        <Trans>Restaurar indicadores</Trans>
      </button>
    </section>
  );
}

function BusinessWidgets({ options, context }) {
  const { t } = useLingui();
  const [params, setParams] = useSearchParams();
  const requestedDays = Number(params.get('days'));
  const days = [1, 7, 30].includes(requestedDays) ? requestedDays : 7;
  function setDays(value) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('home', '1');
      next.set('days', String(value));
      return next;
    });
  }
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const preferenceKey = `umi-dashboard-widgets:v1:${getStoredSession()?.user?.id ?? 'session'}:${context.selectedMerchantId}`;
  const [widgets, setWidgets] = useState(() =>
    loadWidgetPreferences(window.localStorage, preferenceKey),
  );
  const query = {
    ...reportPeriod(options.today, days),
    locationId:
      context.selectedLocationId ||
      context.capabilities?.selectedLocation?.id ||
      (options.canCompareLocations ? '' : options.locations[0]?.id || ''),
    refundView: 'sale_result',
    basketUnit: 'ticket',
  };
  const report = useSalesAnalysis(query, refresh);
  const prior = useSalesAnalysis({ ...query, ...previousReportPeriod(query) }, refresh);
  const scope =
    options.locations.find((location) => location.id === query.locationId)?.name ??
    t`Todas las sucursales`;
  function updateWidgets(next) {
    setWidgets(next);
    try {
      window.localStorage.setItem(preferenceKey, JSON.stringify(next));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }
  return (
    <>
      <div className="sales-toolbar">
        <div>
          <h1>
            <Trans>Tu negocio en números</Trans>
          </h1>
          <p>
            {scope} · {query.from} — {query.to} · {options.timezone}
          </p>
        </div>
        <div className="sales-toolbar-actions">
          <label className="sales-period">
            <Trans>Periodo</Trans>
            <select
              aria-label={t`Periodo`}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={1}>{t`Hoy`}</option>
              <option value={7}>{t`Últimos 7 días`}</option>
              <option value={30}>{t`Últimos 30 días`}</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
          >
            <Trans>Personalizar inicio</Trans>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <Trans>Actualizar</Trans>
          </button>
        </div>
      </div>
      {editing && (
        <WidgetSettings
          widgets={widgets}
          onChange={updateWidgets}
          onClose={() => setEditing(false)}
        />
      )}
      {saveError && (
        <p role="alert">
          <Trans>
            La selección funciona en esta visita, pero el navegador no permitió guardarla.
          </Trans>
        </p>
      )}
      {report.loading || report.error ? (
        <SalesReportState
          {...report}
          code={report.errorCode}
          onRetry={() => setRefresh((value) => value + 1)}
        />
      ) : report.data ? (
        <>
          {report.data.totals.tickets === 0 && (
            <p role="status">
              <Trans>No hay tickets de venta en este periodo.</Trans>{' '}
              <Link to={salesReportLink({ ...query, ...reportPeriod(options.today, 30) })}>
                <Trans>Consultar 30 días</Trans>
              </Link>
              {report.data.firstSaleDate && (
                <span>
                  {' '}
                  · <Trans>Historial desde {report.data.firstSaleDate}</Trans>
                </span>
              )}
            </p>
          )}
          {prior.error && (
            <p role="status">
              <Trans>
                No se pudo cargar el periodo anterior. La comparación no está disponible.
              </Trans>
            </p>
          )}
          {widgets.length ? (
            <div className="sales-widget-grid">
              {widgets.map((id) =>
                ['net', 'tickets', 'average', 'units'].includes(id) ? (
                  <SalesMetric
                    key={id}
                    id={id}
                    report={report.data}
                    prior={!prior.loading && !prior.error ? prior.data : null}
                    query={query}
                  />
                ) : (
                  <SalesDetailWidget key={id} id={id} report={report.data} query={query} />
                ),
              )}
            </div>
          ) : (
            <div className="sales-state surface">
              <Trans>Elige tus indicadores en Personalizar inicio.</Trans>
            </div>
          )}
          <div className="sales-toolbar">
            <SalesDataNote report={report.data} />
            <Link className="btn btn-secondary" to={salesReportLink(query)}>
              <Trans>Explorar ventas</Trans> →
            </Link>
          </div>
          {prior.data && !prior.error && !prior.loading && (
            <p className="sales-data-note">
              <Trans>
                Comparación: {prior.data.from} a {prior.data.to}. El periodo actual incluye el día
                en curso.
              </Trans>
            </p>
          )}
        </>
      ) : null}
    </>
  );
}

function BusinessOverview({ context }) {
  const options = useSalesAnalysisOptions();
  if (!options.data || options.error)
    return (
      <SalesReportState {...options} code={options.errorCode} onRetry={() => options.refetch()} />
    );
  return (
    <BusinessWidgets
      key={`${context.selectedMerchantId}:${context.selectedLocationId || ''}`}
      options={options.data}
      context={context}
    />
  );
}

function OperationalOverview({ context, ordersPaused, setOrdersPaused }) {
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error } = useOverviewData(refresh);
  const kitchenActive = context.isProductActive?.('kds') && context.canShowModule?.('orders');
  const loyaltyActive = context.isProductActive?.('cash') && context.canShowModule?.('loyalty');
  return (
    <section className="overview-operations">
      <div className="sales-toolbar">
        <h2>
          <Trans>Operación y clientes</Trans>
        </h2>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          <Trans>Actualizar operación</Trans>
        </button>
      </div>
      {ordersPaused && (
        <div className="sales-state surface" role="status">
          <Trans>Pedidos WhatsApp pausados</Trans>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setOrdersPaused(false)}
          >
            <Trans>Reanudar</Trans>
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">
          <Trans>Consultando operación…</Trans>
        </p>
      ) : error || data?.sourceErrors?.length ? (
        <div role="alert">
          <Trans>Parte de la operación no está disponible. Reintenta la consulta.</Trans>
        </div>
      ) : null}
      {kitchenActive && !loading && (
        <div className="surface operational-summary">
          <h3>
            <Link to="/orders">
              <Trans>Cocina</Trans> ↗
            </Link>
          </h3>
          {data?.kitchenAvailable ? (
            data.stations.length ? (
              <ul>
                {data.stations.map((station) => (
                  <li key={station.station_id}>
                    <span>{station.station_name}</span>
                    <strong>
                      {formatNumber(station.open)} <Trans>abiertos</Trans>
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                <Trans>No hay pedidos abiertos en cocina.</Trans>
              </p>
            )
          ) : (
            <p>
              <Trans>Estado de cocina no disponible.</Trans>
            </p>
          )}
        </div>
      )}
      {loyaltyActive && !loading && (
        <div className="surface operational-summary">
          <h3>
            <Link to="/loyalty">
              <Trans>Lealtad y monedero</Trans> ↗
            </Link>
          </h3>
          <p className="sales-data-note">
            <Trans>MXN · Todo el negocio</Trans>
          </p>
          <p>
            <Trans>Miembros registrados</Trans>: {formatNumber(data?.overview?.activeMembers)}
          </p>
          <p>
            <Trans>Recargas del mes</Trans>: {data?.overview?.walletTopupsThisMonth ?? '—'}
          </p>
        </div>
      )}
      <nav className="overview-shortcuts" aria-label={context.selectedMerchant?.name}>
        {[
          ['orders', <Trans key="orders">Revisar pedidos</Trans>],
          ['cash-shifts', <Trans key="cash">Revisar turnos de caja</Trans>],
          ['inventory', <Trans key="inventory">Revisar inventario</Trans>],
        ]
          .filter(([id]) => context.canShowModule?.(id))
          .map(([id, label]) => (
            <Link key={id} className="btn btn-secondary" to={`/${id}`}>
              {label} →
            </Link>
          ))}
      </nav>
    </section>
  );
}

export default function OverviewScreen({ ordersPaused, setOrdersPaused }) {
  const context = useMerchant();
  const permissions = context.capabilities?.membership?.permissions ?? [];
  const canReadSales = permissions.includes('*') || permissions.includes('sale.lifecycle');
  return (
    <div className="overview-screen sales-analysis">
      <div>
        {canReadSales ? (
          <BusinessOverview context={context} />
        ) : (
          <p>
            <Trans>Consulta los módulos disponibles para tu función.</Trans>
          </p>
        )}
      </div>
      <OperationalOverview
        key={`${context.selectedMerchantId}:${context.selectedLocationId}:${permissions.join(',')}`}
        context={context}
        ordersPaused={ordersPaused}
        setOrdersPaused={setOrdersPaused}
      />
    </div>
  );
}
