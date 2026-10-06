import { useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatNumber } from '@/lib/format.js';
import { localeTag } from '@/lib/i18n.js';
import { useInventoryUsageVariance } from '@/data.jsx';
import { formatBusinessDate } from './costing-model.js';
import {
  basisLabel,
  decompositionBalances,
  quantityText,
  signedQuantityText,
  sortVarianceLines,
  unexplainedSeverity,
  varianceCounts,
} from './variance-model.js';

/**
 * Variacion de uso - recipes module plan 9.3, D6 and D7, phase 4.
 *
 * What the kitchen used against what the sales say it used. The report names the
 * parts, because a single total hides the reason:
 *
 *   actual = opening + received + produced − closing
 *   variance = actual − theoretical
 *   variance = waste + damage + count correction + yield loss + what nobody can explain
 *
 * THE UNEXPLAINED REMAINDER IS THE HEADLINE. Waste and damage are facts somebody
 * recorded, so a line they fully explain is a line that already has an answer. The
 * remainder is the one an owner acts on, so it is the largest number in the row and
 * it is colored when it is most of the variance.
 *
 * The period and the basis come from the RESPONSE, never from the browser: the
 * business date belongs to the cafe's timezone, and the read states what pool the
 * numbers measure.
 */

const UNIT_LABEL = {
  unit: msg`pza`,
  gram: msg`g`,
  kilogram: msg`kg`,
  milliliter: msg`ml`,
  liter: msg`L`,
  portion: msg`porción`,
  package: msg`paquete`,
  box: msg`caja`,
};

const HEAD = {
  padding: '0 10px 8px',
  textAlign: 'left',
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
};
const CELL = { padding: '9px 10px', verticalAlign: 'top' };
const NUM = { ...CELL, textAlign: 'right' };

function Chip({ tone = 'neutral', children }) {
  return (
    <span className={`badge badge-${tone}`} style={{ textTransform: 'none', letterSpacing: 0 }}>
      {children}
    </span>
  );
}

function Figures({ children, size = 13, tone, weight = 600 }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontWeight: weight,
        fontSize: size,
        fontVariantNumeric: 'tabular-nums',
        color: tone,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export default function UsageVarianceTab({ period }) {
  const { t, i18n } = useLingui();
  const [refresh, setRefresh] = useState(0);
  const state = useInventoryUsageVariance(period, refresh);
  const data = state.data;

  const rows = useMemo(() => sortVarianceLines(data.lines), [data.lines]);
  const counts = useMemo(() => varianceCounts(data.lines), [data.lines]);

  const tag = localeTag(i18n.locale);
  const shortDate = (iso) =>
    formatBusinessDate(iso, tag, { day: 'numeric', month: 'short' }) ?? iso;
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const quantityOf = (quantity) => quantityText(quantity, unitOf);
  const signedOf = (quantity) => signedQuantityText(quantity, unitOf);
  const basis = basisLabel(data.basis);

  // The period and the basis are the response's own words. A screen that computed
  // its own window would answer a different question than the API did.
  const hasPeriod = Boolean(data.from && data.to);

  if (state.loading && !state.loaded) {
    return (
      <div role="status" style={{ padding: 24, color: 'var(--ink-3)' }}>
        <Trans>Cargando la variación de uso…</Trans>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          <Trans>No se pudo leer la variación de uso.</Trans>
        </p>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-3)', fontSize: 12.5 }}>{state.error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
          {!hasPeriod ? (
            <Trans>Sin periodo</Trans>
          ) : basis ? (
            <Trans>
              Del {shortDate(data.from)} al {shortDate(data.to)} · Base: {i18n._(basis)}
            </Trans>
          ) : (
            <Trans>
              Del {shortDate(data.from)} al {shortDate(data.to)}
            </Trans>
          )}
        </div>
        <button
          className="btn-icon"
          type="button"
          aria-label={t`Recargar la variación`}
          title={t`Recargar la variación`}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <I.Refresh size={15} />
        </button>
      </div>

      <div className="grid grid-4" style={{ gap: 12 }}>
        <div className="card" style={{ padding: '14px 16px', display: 'grid', gap: 6 }}>
          <div className="eyebrow">
            <Trans>Variación del periodo</Trans>
          </div>
          <div style={{ minHeight: 26, display: 'flex', alignItems: 'center' }}>
            <Figures size={22}>{quantityOf(data.totalVarianceQuantity) ?? '·'}</Figures>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Trans>Lo que salió menos lo que las ventas explican</Trans>
          </div>
        </div>
        <div className="card" style={{ padding: '14px 16px', display: 'grid', gap: 6 }}>
          <div className="eyebrow">
            <Trans>Sin explicar</Trans>
          </div>
          <div style={{ minHeight: 26, display: 'flex', alignItems: 'center' }}>
            <Figures size={22} tone={counts.high > 0 ? 'var(--danger)' : undefined}>
              {quantityOf(data.totalUnexplainedQuantity) ?? '·'}
            </Figures>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Trans>Lo que ninguna merma, daño ni ajuste explica</Trans>
          </div>
        </div>
        <div className="card" style={{ padding: '14px 16px', display: 'grid', gap: 6 }}>
          <div className="eyebrow">
            <Trans>Insumos</Trans>
          </div>
          <div style={{ minHeight: 26, display: 'flex', alignItems: 'center' }}>
            <Figures size={22}>{formatNumber(counts.all)}</Figures>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Trans>Con movimiento en el periodo</Trans>
          </div>
        </div>
        <div className="card" style={{ padding: '14px 16px', display: 'grid', gap: 6 }}>
          <div className="eyebrow">
            <Trans>Sin explicar a fondo</Trans>
          </div>
          <div style={{ minHeight: 26, display: 'flex', alignItems: 'center' }}>
            <Figures size={22} tone={counts.high > 0 ? 'var(--danger)' : undefined}>
              {formatNumber(counts.high)}
            </Figures>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
            <Trans>Insumos donde el resto es la mayor parte de la variación</Trans>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
          <Trans>
            No hay insumos con movimiento en este periodo. Registra una recepción o un conteo para
            empezar a medir la variación.
          </Trans>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th scope="col" style={HEAD}>
                  <Trans>Insumo</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Inicial</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Recibido</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Producido</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Final</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Uso real</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Uso teórico</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Variación</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Merma</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Daño</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Ajuste de conteo</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Pérdida de rendimiento</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Sin explicar</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => {
                const severity = unexplainedSeverity(line);
                const balances = decompositionBalances(line);
                return (
                  <tr key={line.inventoryItemId} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={CELL}>
                      <div style={{ display: 'grid', gap: 3 }}>
                        <strong style={{ fontWeight: 600 }}>{line.displayName}</strong>
                        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                          {line.publicReference}
                        </span>
                        {balances ? null : (
                          <Chip tone="susp">
                            <Trans>La respuesta no cuadra</Trans>
                          </Chip>
                        )}
                      </div>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.openingQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.receivedQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.productionProducedQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.closingQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures>{quantityOf(line.actualUsageQuantity) ?? '·'}</Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.theoreticalUsageQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures>{signedOf(line.varianceQuantity) ?? '·'}</Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">{quantityOf(line.wasteQuantity) ?? '·'}</Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.damageQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {signedOf(line.countCorrectionQuantity) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {quantityOf(line.yieldLossQuantity) ?? '·'}
                      </Figures>
                    </td>
                    {/* The headline. A remainder that explains nothing is the number an
                        owner acts on, so it is the biggest one in the row and it is the
                        only one that turns red. */}
                    <td style={{ ...NUM, whiteSpace: 'nowrap' }}>
                      <Figures
                        size={severity === 'high' ? 17 : 14}
                        weight={severity === 'high' ? 700 : 600}
                        tone={
                          severity === 'high'
                            ? 'var(--danger)'
                            : severity === 'none'
                              ? 'var(--ink-3)'
                              : undefined
                        }
                      >
                        {signedOf(line.unexplainedQuantity) ?? '·'}
                      </Figures>
                      {severity === 'high' ? (
                        <div style={{ marginTop: 3 }}>
                          <Chip tone="susp">
                            <Trans>Sin explicar</Trans>
                          </Chip>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', display: 'grid', gap: 4 }}>
        {/* Each sentence is its own element: two plain `<Trans>` outputs sit side by side
            in a grid, so the second one would open on the same line as the first. */}
        <div>
          <Trans>
            El uso real es la existencia inicial más lo recibido y lo producido, menos la existencia
            final. La variación es el uso real menos lo que la receta de las ventas dice.
          </Trans>
        </div>
        <div>
          <Trans>
            La merma, el daño, el ajuste de conteo y la pérdida de rendimiento tienen nombre. Lo
            demás no lo tiene, y esa es la cifra que hay que perseguir.
          </Trans>
        </div>
      </div>
    </div>
  );
}
