import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from 'react-router-dom';
import { formatNumber, formatDateTime, formatDate } from '@/lib/format.js';
import { formatOperationMoney } from './operations-format.js';
import { dailySalesRows, salesReportLink } from './sales-report-model.js';
import './sales-widgets.css';

export function SalesReportState({ loading, error, code, onRetry }) {
  if (loading)
    return (
      <div className="sales-state surface" role="status">
        <Trans>Consultando ventas…</Trans>
      </div>
    );
  if (!error) return null;
  return (
    <div className="sales-state surface" role="alert">
      <p>
        {code === 'PERMISSION_DENIED' ? (
          <Trans>No tienes permiso para consultar estas ventas.</Trans>
        ) : code === 'REPORT_RANGE_TOO_LARGE' ? (
          <Trans>El periodo supera el límite de 20,000 tickets. Consulta menos días.</Trans>
        ) : (
          <Trans>No se pudieron cargar las ventas. Los importes no están disponibles.</Trans>
        )}
      </p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        <Trans>Reintentar</Trans>
      </button>
    </div>
  );
}

export function SalesBars({ rows, currency, metric = 'netMinorUnits', count = false }) {
  const max = Math.max(...rows.map((row) => Math.abs(row[metric] ?? 0)), 1);
  return (
    <div>
      {rows.length > 31 && (
        <p className="sales-data-note">
          <Trans>
            El gráfico muestra los primeros 31 de {rows.length} periodos. La tabla conserva todos
            los periodos.
          </Trans>
        </p>
      )}
      <ol className="sales-bars">
        {rows.slice(0, 31).map((row) => (
          <li key={row.key}>
            <span className="sales-bar-label">{row.label}</span>
            <span className="sales-bar-track" aria-hidden="true">
              <span
                style={{ width: `${(Math.abs(row[metric] ?? 0) / max) * 100}%` }}
                className={row[metric] < 0 ? 'negative' : undefined}
              />
            </span>
            <span className="figures">
              {count ? formatNumber(row[metric]) : formatOperationMoney(row[metric], currency)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SalesDataNote({ report }) {
  return (
    <p className="sales-data-note">
      <Trans>
        {report.from} a {report.to} · {report.timezone} · {report.currency}
      </Trans>
      <br />
      <Trans>Venta neta sin propina, después de descuentos y devoluciones.</Trans>
      <br />
      <Trans>
        Consulta:{' '}
        {formatDateTime(report.capturedAt, {
          timeZone: report.timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
        . El día actual puede estar incompleto.
      </Trans>
    </p>
  );
}

export function SalesMetric({ id, report, prior, query }) {
  const { t } = useLingui();
  const definitions = {
    net: {
      title: t`Venta neta`,
      value: formatOperationMoney(report.totals.netMinorUnits, report.currency),
      field: 'netMinorUnits',
    },
    tickets: {
      title: t`Tickets de venta`,
      value: formatNumber(report.totals.tickets),
      field: 'tickets',
    },
    average: {
      title: t`Ticket promedio`,
      value: formatOperationMoney(report.totals.averageTicketMinorUnits, report.currency),
      field: 'averageTicketMinorUnits',
    },
    units: {
      title: t`Piezas por ticket`,
      value: formatNumber(report.totals.unitsPerTicket, { maximumFractionDigits: 2 }),
      field: 'unitsPerTicket',
    },
  };
  const metric = definitions[id];
  const previous = prior?.totals[metric.field];
  const current = report.totals[metric.field];
  const delta = previous > 0 && current != null ? (current - previous) / previous : null;
  return (
    <Link
      className={`sales-widget sales-metric surface ${id === 'net' ? 'sales-primary' : ''}`}
      to={salesReportLink(
        {
          ...query,
          ...(id === 'average' || id === 'tickets'
            ? { dimension: 'byDay', metric: metric.field }
            : {}),
        },
        id === 'units'
          ? 'distribution'
          : id === 'average' || id === 'tickets'
            ? 'time'
            : 'overview',
      )}
    >
      <span className="sales-widget-title">
        {metric.title} <span aria-hidden="true">↗</span>
      </span>
      <strong className="figures">
        {metric.value}
        {(id === 'net' || id === 'average') && (
          <small className="sales-currency">{report.currency}</small>
        )}
      </strong>
      {delta != null ? (
        <span className="sales-comparison">
          <span className={delta < 0 ? 'sales-fall' : ''}>
            {delta > 0 ? '+' : ''}
            {formatNumber(delta, { style: 'percent', maximumFractionDigits: 1 })}
          </span>{' '}
          <Trans>vs. periodo anterior</Trans>
        </span>
      ) : (
        <span className="sales-comparison">
          {current == null ? (
            <Trans>Sin tickets para calcular</Trans>
          ) : previous === 0 ? (
            <Trans>Periodo anterior sin base de comparación</Trans>
          ) : (
            <Trans>Comparación no disponible</Trans>
          )}
        </span>
      )}
    </Link>
  );
}

export function SalesDetailWidget({ id, report, query }) {
  const { t } = useLingui();
  const titles = {
    trend: t`Venta por día`,
    hours: t`Horas con más venta`,
    pairs: t`Productos que se compran juntos`,
    distribution: t`Piezas en cada ticket`,
  };
  const section = id === 'trend' || id === 'hours' ? 'time' : id;
  const linkQuery = {
    ...query,
    ...(id === 'trend' ? { dimension: 'byDay' } : id === 'hours' ? { dimension: 'byHour' } : {}),
  };
  let rows;
  if (id === 'trend')
    rows = dailySalesRows(report).map((row) => ({
      ...row,
      label: formatDate(`${row.key}T12:00:00Z`, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }),
    }));
  if (id === 'hours')
    rows = [...report.byHour]
      .sort((a, b) => b.netMinorUnits - a.netMinorUnits)
      .slice(0, 4)
      .map((row) => ({ ...row, label: `${row.key}:00` }));
  if (id === 'distribution')
    rows = report.unitsDistribution
      .map((row) => ({ key: row.units, label: t`${row.units} piezas`, tickets: row.tickets }))
      .slice(0, 5);
  return (
    <section className="sales-widget sales-detail-widget surface">
      <h2>
        <Link to={salesReportLink(linkQuery, section)}>
          {titles[id]} <span aria-hidden="true">↗</span>
        </Link>
      </h2>
      {id === 'pairs' ? (
        report.pairs.length ? (
          <ol className="sales-pairs">
            {report.pairs.slice(0, 4).map((pair) => (
              <li key={`${pair.productAId}:${pair.productBId}`}>
                <span>
                  {pair.productAName} <span className="sales-pair-plus">+</span> {pair.productBName}
                </span>
                <strong className="figures">
                  {formatNumber(pair.support, { style: 'percent', maximumFractionDigits: 1 })}
                </strong>
                <small>
                  <Trans>
                    {pair.baskets} de {report.coverage.baskets} compras
                  </Trans>
                </small>
              </li>
            ))}
          </ol>
        ) : (
          <p>
            <Trans>No hay productos comprados juntos en este periodo.</Trans>
          </p>
        )
      ) : rows.length ? (
        <SalesBars
          rows={rows}
          currency={report.currency}
          count={id === 'distribution'}
          metric={id === 'distribution' ? 'tickets' : 'netMinorUnits'}
        />
      ) : (
        <p>
          <Trans>No hay movimientos en este periodo.</Trans>
        </p>
      )}
      {id === 'hours' && (
        <p className="sales-data-note">
          <Trans>
            Hora del pedido en {report.timezone}. Una hora sin movimientos no demuestra falta de
            demanda.
          </Trans>
        </p>
      )}
      <Link className="sales-detail-link" to={salesReportLink(linkQuery, section)}>
        <Trans>Ver desglose</Trans> →
      </Link>
    </section>
  );
}
