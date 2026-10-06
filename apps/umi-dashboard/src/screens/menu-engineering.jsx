import { useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatNumber } from '@/lib/format.js';
import { localeTag } from '@/lib/i18n.js';
import { useMenuEngineering } from '@/data.jsx';
import { basisPointsToPercent, formatBusinessDate } from './costing-model.js';
import { MENU_CLASS_ORDER, menuClassTone, menuCostText, sortMenuItems } from './variance-model.js';

/**
 * Ingenieria de menu - recipes module plan 9.5 and D16, phase 4.
 *
 * The four classes come from two honest numbers: how much an item sells and how
 * much money it leaves. Plan D16 makes the class margin times popularity, so:
 *
 *   star         sells a lot and leaves a good margin
 *   plow horse   sells a lot and leaves a thin margin
 *   puzzle       leaves a good margin and sells little
 *   dog          sells little and leaves little
 *
 * AN ITEM NOBODY CAN COST HAS NO CLASS. It is `unclassified`, and the row says its
 * recipe cannot be costed yet instead of showing a zero margin that would file it
 * as a dog. The screen never re-derives the class; it prints the one the server
 * sent and explains it in the operator's words.
 */

const CLASS_LABEL = {
  star: msg`Estrella`,
  plow_horse: msg`Caballo de arado`,
  puzzle: msg`Acertijo`,
  dog: msg`Perro`,
  unclassified: msg`Sin clasificar`,
};

const CLASS_MEANING = {
  star: msg`Se vende mucho y deja buen margen. Es el platillo que sostiene la venta.`,
  plow_horse: msg`Se vende mucho pero deja poco margen. Sube el precio o baja su costo.`,
  puzzle: msg`Deja buen margen pero se vende poco. Dale más visibilidad en el menú.`,
  dog: msg`Se vende poco y deja poco margen. Revisa si vale la pena mantenerlo.`,
  unclassified: msg`Su receta todavía no se puede costear, así que no tiene clase.`,
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

/** A cost the server did not price is a state, not a zero. */
function NotCosted({ title, children }) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 9px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--warning-soft)',
        color: 'var(--warning)',
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export default function MenuEngineeringTab({ period }) {
  const { t, i18n } = useLingui();
  const [refresh, setRefresh] = useState(0);
  const state = useMenuEngineering(period, refresh);
  const data = state.data;

  const rows = useMemo(() => sortMenuItems(data.items), [data.items]);

  const tag = localeTag(i18n.locale);
  const shortDate = (iso) =>
    formatBusinessDate(iso, tag, { day: 'numeric', month: 'short' }) ?? iso;
  const percentOf = (basisPoints) => {
    const percent = basisPointsToPercent(basisPoints);
    return percent == null ? null : `${formatNumber(percent, { maximumFractionDigits: 1 })} %`;
  };
  const hasPeriod = Boolean(data.from && data.to);

  if (state.loading && !state.loaded) {
    return (
      <div role="status" style={{ padding: 24, color: 'var(--ink-3)' }}>
        <Trans>Cargando las clases del menú…</Trans>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="card" style={{ padding: 18 }}>
        <p style={{ margin: 0, color: 'var(--ink-2)' }}>
          <Trans>No se pudieron leer las clases del menú.</Trans>
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
          {hasPeriod ? (
            <Trans>
              Del {shortDate(data.from)} al {shortDate(data.to)}
            </Trans>
          ) : (
            <Trans>Sin periodo</Trans>
          )}
        </div>
        <button
          className="btn-icon"
          type="button"
          aria-label={t`Recargar las clases del menú`}
          title={t`Recargar las clases del menú`}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <I.Refresh size={15} />
        </button>
      </div>

      {/* The four classes always show, in one order, with the numbers' own meaning. */}
      <div className="grid grid-4" style={{ gap: 12 }}>
        {MENU_CLASS_ORDER.map((id) => (
          <div key={id} className="card" style={{ padding: '13px 15px', display: 'grid', gap: 6 }}>
            <Chip tone={menuClassTone(id)}>{i18n._(CLASS_LABEL[id])}</Chip>
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{i18n._(CLASS_MEANING[id])}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card" style={{ padding: 18, color: 'var(--ink-2)' }}>
          <Trans>
            No hay ventas de platillos en este periodo. Sin ventas no hay clase que calcular.
          </Trans>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th scope="col" style={HEAD}>
                  <Trans>Platillo</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Vendidos</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Precio</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Costo del plato</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Margen</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Margen %</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Popularidad %</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Margen del menú %</Trans>
                </th>
                <th scope="col" style={HEAD}>
                  <Trans>Clase</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => {
                const cost = menuCostText(item.plateCostMinor);
                const margin = menuCostText(item.marginMinor);
                const marginPercent = percentOf(item.marginBasisPoints);
                return (
                  <tr key={item.productId} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={CELL}>
                      <div style={{ display: 'grid', gap: 3 }}>
                        <strong style={{ fontWeight: 600 }}>{item.productName}</strong>
                        {/* An unclassified item is unclassified for ONE reason: nobody
                            can cost its plate yet. The row says so instead of leaving the
                            operator to infer it from a missing number. */}
                        {item.plateCostMinor == null ? (
                          <span style={{ fontSize: 11, color: 'var(--warning)' }}>
                            <Trans>Su receta todavía no se puede costear</Trans>
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={NUM}>
                      <Figures>{formatNumber(item.soldQuantity)}</Figures>
                    </td>
                    <td style={NUM}>
                      <Figures>{menuCostText(item.priceMinor) ?? '·'}</Figures>
                    </td>
                    <td style={NUM}>
                      {cost == null ? (
                        <NotCosted title={i18n._(CLASS_MEANING.unclassified)}>
                          <Trans>Sin costo</Trans>
                        </NotCosted>
                      ) : (
                        <Figures>{cost}</Figures>
                      )}
                    </td>
                    <td style={NUM}>
                      {margin == null ? (
                        <span style={{ color: 'var(--ink-3)' }}>·</span>
                      ) : (
                        <Figures>{margin}</Figures>
                      )}
                    </td>
                    <td style={NUM}>
                      {marginPercent == null ? (
                        <span style={{ color: 'var(--ink-3)' }}>·</span>
                      ) : (
                        <Figures>{marginPercent}</Figures>
                      )}
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {percentOf(item.popularityShareBasisPoints) ?? '·'}
                      </Figures>
                    </td>
                    <td style={NUM}>
                      <Figures tone="var(--ink-2)">
                        {percentOf(item.marginShareBasisPoints) ?? '·'}
                      </Figures>
                    </td>
                    <td style={CELL}>
                      <Chip tone={menuClassTone(item.classification)}>
                        {CLASS_LABEL[item.classification]
                          ? i18n._(CLASS_LABEL[item.classification])
                          : i18n._(CLASS_LABEL.unclassified)}
                      </Chip>
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
            La popularidad es la parte de unidades vendidas del periodo. El margen del menú es la
            parte del margen del periodo que deja este platillo.
          </Trans>
        </div>
        <div>
          <Trans>
            La clase sale de esas dos cifras, no de una opinión. Si un platillo no se puede costear,
            no tiene clase: primero arregla su receta.
          </Trans>
        </div>
      </div>
    </div>
  );
}
