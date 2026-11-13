import './inventory-planning.css';
import { useCallback, useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { inventoryPlanningData } from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { formatMoney, formatNumber } from '@/lib/format.js';

export default function InventoryPlanning() {
  const merchant = useMerchant();
  const merchantId = merchant?.selectedMerchantId;
  const locationId = merchant?.selectedLocationId || null;
  return (
    <Planning
      key={`${merchantId}:${locationId}`}
      merchantId={merchantId}
      locationId={locationId}
      name={merchant?.selectedMerchant?.name}
      location={merchant?.selectedLocation?.name}
    />
  );
}
function Planning({ merchantId, locationId, name, location }) {
  const { t } = useLingui();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState(
    () => window.localStorage.getItem(`umi-inventory-alerts:${merchantId}`) !== 'off',
  );
  useEffect(() => {
    let active = true;
    inventoryPlanningData
      .loadInventoryPlan(merchantId, locationId)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [merchantId, locationId, refresh]);
  const refreshPlan = useCallback(() => {
    setLoading(true);
    setError(null);
    setRefresh((value) => value + 1);
  }, []);
  useEffect(() => {
    const refreshOnFocus = refreshPlan;
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [refreshPlan]);
  const quantity = (value, scale = 0) =>
    value === null
      ? t`Sin estimación`
      : formatNumber(value / 10 ** scale, { maximumFractionDigits: scale });
  const shortage = data?.items.filter((item) => item.suggestedQuantity > 0) ?? [];
  return (
    <section
      className="surface inventory-planning"
      style={{ padding: 24 }}
      aria-label={t`Plan de compra`}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h2>
          <Trans>Plan de compra</Trans>
        </h2>
        <button className="btn btn-secondary" disabled={loading} onClick={refreshPlan}>
          <Trans>Actualizar</Trans>
        </button>
      </div>
      <p>
        {name} · {location || t`Todas las sucursales`}
      </p>
      {loading && (
        <p role="status">
          <Trans>Calculando el plan…</Trans>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {data && !error && (
        <>
          {data.nextPurchaseDate ? (
            <p>
              <Trans>Cubre del</Trans> {data.from} <Trans>al</Trans> {data.to}.{' '}
              <Trans>Próxima compra:</Trans> {data.nextPurchaseDate}.
            </p>
          ) : (
            <p>
              <a href="/settings">
                <Trans>Configura los días de compra en Ajustes.</Trans>
              </a>
            </p>
          )}
          {!data.complete && (
            <p role="status">
              <Trans>
                Faltan días de compra, historial suficiente o recetas completas. Revisa los
                productos; las cantidades de compra se ocultan para evitar una estimación
                incompleta.
              </Trans>
            </p>
          )}
          <h3 id="inventory-purchase-suggestions">
            <Trans>Compras sugeridas</Trans>
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <Trans>Artículo</Trans>
                  </th>
                  <th>
                    <Trans>Disponible</Trans>
                  </th>
                  <th>
                    <Trans>Consumo previsto</Trans>
                  </th>
                  <th>
                    <Trans>Mínimo</Trans>
                  </th>
                  <th>
                    <Trans>Acción</Trans>
                  </th>
                  <th>
                    <Trans>Cantidad sugerida</Trans>
                  </th>
                  <th>
                    <Trans>Costo estimado</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.inventoryItemId}>
                    <td>
                      {item.name} ·{' '}
                      {{
                        unit: t`pza`,
                        gram: 'g',
                        kilogram: 'kg',
                        milliliter: 'ml',
                        liter: 'L',
                        portion: t`porción`,
                        package: t`paquete`,
                        box: t`caja`,
                      }[item.unit] || item.unit}
                    </td>
                    <td>{quantity(item.available, item.scale)}</td>
                    <td>{quantity(item.expectedConsumption, item.scale)}</td>
                    <td>
                      {item.minimum === null
                        ? t`Sin configurar`
                        : quantity(item.minimum, item.scale)}
                    </td>
                    <td>{item.replenishment === 'prepare' ? t`Preparar` : t`Comprar`}</td>
                    <td>{quantity(item.suggestedQuantity, item.scale)}</td>
                    <td>
                      {item.estimatedCostMinor === null
                        ? t`Sin costo`
                        : formatMoney(item.estimatedCostMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>
            <Trans>Ventas estimadas</Trans>
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <Trans>Producto</Trans>
                  </th>
                  <th>
                    <Trans>Unidades estimadas</Trans>
                  </th>
                  <th>
                    <Trans>Receta</Trans>
                  </th>
                  <th>
                    <Trans>Precisión de la estimación</Trans>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => (
                  <tr key={`${product.productId}:${product.variantId}`}>
                    <td>{product.name}</td>
                    <td>{quantity(product.expectedUnits)}</td>
                    <td>{product.mapped ? t`Completa` : t`Revisar`}</td>
                    <td>
                      {product.validation.mae === null ? (
                        t`Sin historial suficiente`
                      ) : (
                        <details className="planning-validation">
                          <summary><Trans>Ver detalle</Trans></summary>
                          <Trans>Error medio de validación:</Trans>{' '}
                          {formatNumber(product.validation.mae, { maximumFractionDigits: 2 })} ·{' '}
                          <Trans>Base semanal:</Trans>{' '}
                          {formatNumber(product.validation.baselineMae, {
                            maximumFractionDigits: 2,
                          })}
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.products.length && (
            <p>
              <Trans>Sin historial suficiente</Trans>
            </p>
          )}
          <details className="planning-method">
            <summary><Trans>Cómo se calcula el plan</Trans></summary>
          <p>
            <Trans>Historial:</Trans> {data.historyFrom} — {data.historyTo}.{' '}
            <Trans>Zona horaria:</Trans> {data.timezone}.
          </p>
          <p>
            <Trans>Calculado:</Trans> {new Date(data.asOf).toLocaleString()}
          </p>
          <p>
            <Trans>
              Promedio del mismo día de la semana durante ocho semanas. Hoy se cuenta completo. Las
              compras pendientes no aumentan la disponibilidad. Los días sin ventas registradas se
              consideran cero; los cierres o fallas de captura pueden reducir la estimación.
            </Trans>
          </p>
          <p>
            <Trans>
              Cantidad sugerida = consumo previsto + mínimo − disponible. Primero se descuenta lo
              que ya está preparado; solo lo que falta genera demanda de ingredientes. Se redondea a
              la unidad mínima del artículo; no se crean compras ni movimientos.
            </Trans>
          </p>
          </details>
          <label style={{ display: 'flex', gap: 8, minHeight: 44, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={alerts}
              onChange={(event) => {
                const checked = event.target.checked;
                setAlerts(checked);
                window.localStorage.setItem(
                  `umi-inventory-alerts:${merchantId}`,
                  checked ? 'on' : 'off',
                );
              }}
            />
            <Trans>Mostrar avisos en este navegador</Trans>
          </label>
          {alerts && shortage.length > 0 && (
            <p role="status">
              <a href="#inventory-purchase-suggestions">
                {shortage.length === 1 ? t`Hay 1 artículo por reponer. Ver sugerencias.` : t`Hay ${shortage.length} artículos por reponer. Ver sugerencias.`}
              </a>
            </p>
          )}
          <p>
            <Trans>Correo al dueño:</Trans>{' '}
            {data.notifications?.emailOptIn ? t`Activado` : t`Desactivado`}.{' '}
            {data.notifications?.configured
              ? t`Canal configurado`
              : t`Canal pendiente de configuración`}
          </p>
          {data.notifications?.deliveries.some((delivery) => delivery.state !== 'sent') && (
            <p role="status">
              <Trans>
                Hay un envío pendiente o con resultado incierto. Revisa el registro antes de
                intentar otro envío.
              </Trans>
            </p>
          )}
        </>
      )}
    </section>
  );
}
