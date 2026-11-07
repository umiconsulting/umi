import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useLingui } from '@lingui/react/macro';
import { formatNumber } from '@/lib/format.js';
import { formatOperationMoney } from './operations-format.js';
import { salesReportLink } from './sales-report-model.js';
import { allocateHexagons, categorySalesState } from './category-sales-model.js';
import './category-sales.css';

const RADIUS = 6.8;
const PITCH_X = Math.sqrt(3) * RADIUS + 1.4;
const PITCH_Y = RADIUS * 1.5 + 1.3;
const GRID = Array.from({ length: 23 * 13 }, (_, index) => {
  const row = Math.floor(index / 23);
  const column = index % 23;
  const x = 9 + column * PITCH_X + ((row % 2) * PITCH_X) / 2;
  const y = 9 + row * PITCH_Y;
  return { index, x, y, active: ((x - 157) / 133) ** 2 + ((y - 78) / 61) ** 2 <= 1 };
});
const POINTS = Array.from({ length: 6 }, (_, index) => {
  const angle = (Math.PI / 3) * index - Math.PI / 2;
  return `${Math.cos(angle) * RADIUS},${Math.sin(angle) * RADIUS}`;
}).join(' ');
const colorOf = (row) => (/^#[0-9a-fA-F]{6}$/.test(row.color || '') ? row.color : '#8994a6');

function mosaicCells(rows) {
  let available = GRID.filter((cell) => cell.active);
  const counts = allocateHexagons(rows, available.length);
  const filled = [];
  for (const [index, category] of rows.entries()) {
    if (!counts[index]) continue;
    const angle = index * 2.39996 + Math.PI;
    const anchor = { x: 157 + Math.cos(angle) * 85, y: 78 + Math.sin(angle) * 32 };
    const ranked = available.sort(
      (a, b) =>
        (a.x - anchor.x) ** 2 +
          (a.y - anchor.y) ** 2 -
          (b.x - anchor.x) ** 2 -
          (b.y - anchor.y) ** 2 || a.index - b.index,
    );
    const chosen = ranked.slice(0, counts[index]);
    filled.push(...chosen.map((cell) => ({ ...cell, category })));
    available = ranked.slice(counts[index]);
  }
  return filled;
}

function HexagonMosaic({ rows, selected, categoryName }) {
  const { t } = useLingui();
  const cells = mosaicCells(rows);
  return (
    <svg
      className="category-sales-mosaic"
      viewBox="0 0 322 158"
      role="img"
      aria-label={t`Participación de venta neta por categoría`}
    >
      <desc>{t`Las celdas de color aproximan la participación. Los valores exactos aparecen en la lista. El fondo gris es decorativo.`}</desc>
      <g aria-hidden="true" className="category-sales-backdrop">
        {GRID.map((cell) => (
          <polygon key={cell.index} points={POINTS} transform={`translate(${cell.x} ${cell.y})`} />
        ))}
      </g>
      <g aria-hidden="true">
        {cells.map(({ index, x, y, category }) => (
          <polygon
            key={index}
            points={POINTS}
            transform={`translate(${x} ${y})`}
            fill={colorOf(category)}
            className="category-sales-cell"
            data-muted={Boolean(selected && selected !== category.key)}
          >
            <title>{categoryName(category)}</title>
          </polygon>
        ))}
      </g>
    </svg>
  );
}

export default function CategorySalesCard({ report, query, detail = false }) {
  const { t } = useLingui();
  const [selected, setSelected] = useState(null);
  const [visible, setVisible] = useState(20);
  const total = report.totals.netMinorUnits;
  const state = categorySalesState(report.byCategory, total);
  const rows = [...(report.byCategory ?? [])].sort(
    (a, b) => b.netMinorUnits - a.netMinorUnits || a.key.localeCompare(b.key),
  );
  const categoryName = (row) =>
    row.key === 'unattributed'
      ? t`Sin asignación verificable`
      : row.key === 'uncategorized'
        ? t`Sin categoría`
        : row.label || t`Categoría sin nombre`;
  const percentage = (row) => {
    if (state !== 'ready') return '—';
    const share = row.netMinorUnits / total;
    return share > 0 && share < 0.001
      ? t`<0.1%`
      : formatNumber(share, { style: 'percent', maximumFractionDigits: 1 });
  };
  const legend = detail ? rows.slice(0, visible) : rows.slice(0, 6);
  return (
    <section
      className={`sales-widget sales-detail-widget surface category-sales-card${detail ? ' category-sales-full' : ''}`}
    >
      <header className="category-sales-heading">
        <h2>
          {detail ? (
            <Trans>Venta neta por categoría</Trans>
          ) : (
            <Link to={salesReportLink(query, 'categories')}>
              <Trans>Venta neta por categoría</Trans> ↗
            </Link>
          )}
        </h2>
        {!detail && (
          <Link className="category-sales-report" to={salesReportLink(query, 'categories')}>
            <Trans>Ver informe</Trans> →
          </Link>
        )}
      </header>
      <p className="category-sales-total figures">
        {formatOperationMoney(total, report.currency)} <small>{report.currency}</small>
      </p>
      {state === 'unavailable' ? (
        <p role="status">
          <Trans>
            El desglose por categoría no está disponible. Actualiza la consulta para reintentar.
          </Trans>
        </p>
      ) : (
        <>
          {state === 'ready' ? (
            <HexagonMosaic rows={rows} selected={selected} categoryName={categoryName} />
          ) : (
            <p className="category-sales-notice" role="status">
              {state === 'signed' ? (
                <Trans>
                  Las devoluciones generan importes negativos. Consulta los importes por categoría;
                  no se muestra una distribución porcentual.
                </Trans>
              ) : (
                <Trans>
                  La venta neta es cero. No hay una participación porcentual que mostrar.
                </Trans>
              )}
            </p>
          )}
          {!detail && (
            <ul className="category-sales-legend" aria-label={t`Categorías y venta neta`}>
              {legend.map((row) => (
                <li key={row.key}>
                  <button
                    type="button"
                    className="category-sales-legend-row"
                    aria-pressed={selected === row.key}
                    onClick={() => setSelected(selected === row.key ? null : row.key)}
                  >
                    <span
                      className="category-sales-dot"
                      aria-hidden="true"
                      style={{ backgroundColor: colorOf(row) }}
                    />
                    <span className="category-sales-name">{categoryName(row)}</span>
                    <span className="category-sales-share figures">{percentage(row)}</span>
                    <strong className="figures">
                      {formatOperationMoney(row.netMinorUnits, report.currency)}
                    </strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!detail && rows.length > 6 && (
            <Link className="category-sales-more" to={salesReportLink(query, 'categories')}>
              <Trans>Ver las {rows.length} categorías</Trans> →
            </Link>
          )}
          {detail && (
            <>
              <div className="analysis-table" tabIndex={0}>
                <table>
                  <caption>
                    <Trans>Importes exactos por categoría</Trans>
                  </caption>
                  <thead>
                    <tr>
                      <th>
                        <Trans>Categoría</Trans>
                      </th>
                      <th>
                        <Trans>Ventas antes de devoluciones</Trans>
                      </th>
                      <th>
                        <Trans>Devoluciones</Trans>
                      </th>
                      <th>
                        <Trans>Venta neta</Trans>
                      </th>
                      <th>
                        <Trans>Participación</Trans>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {legend.map((row) => (
                      <tr key={row.key}>
                        <th scope="row">
                          <button
                            type="button"
                            className="category-sales-category"
                            aria-pressed={selected === row.key}
                            onClick={() => setSelected(selected === row.key ? null : row.key)}
                          >
                            <span
                              className="category-sales-dot"
                              aria-hidden="true"
                              style={{ backgroundColor: colorOf(row) }}
                            />
                            {categoryName(row)}
                          </button>
                        </th>
                        <td>{formatOperationMoney(row.merchandiseMinorUnits, report.currency)}</td>
                        <td>{formatOperationMoney(row.refundsMinorUnits, report.currency)}</td>
                        <td>{formatOperationMoney(row.netMinorUnits, report.currency)}</td>
                        <td>{percentage(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">
                        <Trans>Total</Trans>
                      </th>
                      <td>
                        {formatOperationMoney(report.totals.merchandiseMinorUnits, report.currency)}
                      </td>
                      <td>
                        {formatOperationMoney(report.totals.refundsMinorUnits, report.currency)}
                      </td>
                      <td>{formatOperationMoney(total, report.currency)}</td>
                      <td>{state === 'ready' ? formatNumber(1, { style: 'percent' }) : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {rows.length > visible && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setVisible((value) => value + 20)}
                >
                  <Trans>Mostrar más categorías</Trans>
                </button>
              )}
            </>
          )}
          {state === 'ready' && (
            <p className="sales-data-note">
              <Trans>
                Las celdas aproximan la participación; los porcentajes usan los importes exactos.
              </Trans>
            </p>
          )}
          {rows.some((row) => row.key === 'unattributed') && (
            <p className="category-sales-notice">
              <Trans>
                Algunos recibos no permiten verificar la asignación por categoría. Ese importe se
                conserva por separado.
              </Trans>
            </p>
          )}
          <p className="sales-data-note">
            <Trans>
              Categorías y colores del catálogo actual. Venta neta sin propinas, después de
              descuentos y devoluciones.
            </Trans>
          </p>
        </>
      )}
    </section>
  );
}
