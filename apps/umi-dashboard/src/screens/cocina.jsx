import { useCallback, useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMerchant } from '@/lib/merchant-context.jsx';
import {
  createKitchenRoute,
  fetchKitchenRoutes,
  fetchKitchenStations,
  updateKitchenRoute,
  saveKitchenStation,
  searchKitchenProducts,
  useCatalogCategories,
} from '@/data.jsx';
import { defaultRoute, categoryRoute, productRoute, routeFor } from './kitchen-routing-model.js';
import { DomainWorkspace } from './operations-workspace.jsx';

const section = { padding: 16, display: 'grid', gap: 12 };
const fields = { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' };
const defaults = {
  overdueSeconds: 900,
  soundsEnabled: true,
  arrivalSound: 'arrival',
  overdueSound: 'overdue',
  readySound: 'ready',
};

function SoundSelect({ label, value, onChange }) {
  return (
    <label>
      {label}
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="arrival">
          <Trans>Llegada · agudo breve</Trans>
        </option>
        <option value="overdue">
          <Trans>Vencimiento · grave largo</Trans>
        </option>
        <option value="ready">
          <Trans>Listo · agudo alto</Trans>
        </option>
      </select>
    </label>
  );
}

function StationEditor({ station, busy, onSave }) {
  const { t } = useLingui();
  const [name, setName] = useState(station.name);
  const [settings, setSettings] = useState({ ...defaults, ...station.alertSettings });
  const change = (key, value) => setSettings((previous) => ({ ...previous, [key]: value }));
  return (
    <form
      style={{ ...section, border: '1px solid var(--line)', borderRadius: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name, alertSettings: settings });
      }}
    >
      <div style={fields}>
        <label>
          <Trans>Nombre</Trans>
          <input
            className="input"
            aria-label={t`Nombre ${station.name}`}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <Trans>Vencido a los (minutos)</Trans>
          <input
            className="input"
            aria-label={t`Umbral ${station.name}`}
            type="number"
            min="0.5"
            max="1440"
            step="0.5"
            value={settings.overdueSeconds / 60}
            onChange={(e) => change('overdueSeconds', Math.round(Number(e.target.value) * 60))}
            required
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.soundsEnabled}
            onChange={(e) => change('soundsEnabled', e.target.checked)}
          />{' '}
          <Trans>Sonidos activados</Trans>
        </label>
      </div>
      <div style={fields}>
        <SoundSelect
          label={t`Al llegar`}
          value={settings.arrivalSound}
          onChange={(v) => change('arrivalSound', v)}
        />
        <SoundSelect
          label={t`Al vencer`}
          value={settings.overdueSound}
          onChange={(v) => change('overdueSound', v)}
        />
        <SoundSelect
          label={t`Ítem listo para el mesero`}
          value={settings.readySound}
          onChange={(v) => change('readySound', v)}
        />
        <button className="btn btn-primary" disabled={busy} type="submit">
          <Trans>Guardar estación</Trans>
        </button>
      </div>
    </form>
  );
}

function RoutingRow({ label, hint, stations, route, busy, onSave }) {
  const { t } = useLingui();
  const [stationId, setStationId] = useState(route?.active !== false ? route?.stationId || '' : '');
  const [priority, setPriority] = useState(route?.routePriority ?? 100);
  const [seconds, setSeconds] = useState(route?.targetSeconds ?? '');
  return (
    <form
      style={{ ...section, borderBottom: '1px solid var(--line)' }}
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          stationId: stationId || null,
          routePriority: Number(priority),
          targetSeconds: seconds === '' ? null : Number(seconds),
        });
      }}
    >
      <strong>{label}</strong>
      {hint && <span className="muted">{hint}</span>}
      <div style={fields}>
        <label>
          <Trans>Estación</Trans>
          <select
            className="input"
            aria-label={label}
            value={stationId}
            disabled={busy}
            onChange={(e) => setStationId(e.target.value)}
          >
            <option value="">
              <Trans>Sin ruta propia</Trans>
            </option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <Trans>Prioridad (menor gana)</Trans>
          <input
            className="input"
            aria-label={t`Prioridad ${label}`}
            type="number"
            min="0"
            max="10000"
            required
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </label>
        <label>
          <Trans>Objetivo (segundos)</Trans>
          <input
            className="input"
            aria-label={t`Objetivo ${label}`}
            type="number"
            min="30"
            max="86400"
            placeholder={t`Umbral de estación`}
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Trans>Guardar ruta</Trans>
        </button>
      </div>
      {route?.active !== false && route && (
        <button
          className="btn"
          style={{ justifySelf: 'start' }}
          type="button"
          disabled={busy}
          onClick={() =>
            onSave({
              stationId: null,
              routePriority: route.routePriority,
              targetSeconds: route.targetSeconds,
            })
          }
        >
          <Trans>Desactivar ruta</Trans>
        </button>
      )}
    </form>
  );
}

export default function CocinaScreen() {
  const { t } = useLingui();
  const context = useMerchant();
  const merchantId = context?.selectedMerchantId || context?.capabilities?.merchant?.id;
  const locationId = context?.selectedLocationId || context?.capabilities?.selectedLocation?.id;
  const [refresh, setRefresh] = useState(0);
  const categories = useCatalogCategories(refresh);
  const [stations, setStations] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [newName, setNewName] = useState('');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const reload = useCallback(async () => {
    if (!merchantId || !locationId) return;
    const [stationRead, routeRead] = await Promise.all([
      fetchKitchenStations(merchantId, locationId),
      fetchKitchenRoutes(merchantId, locationId),
    ]);
    setStations(stationRead.stations);
    setRoutes(routeRead.routes);
  }, [merchantId, locationId]);
  useEffect(() => {
    void (async () => {
      await reload();
    })().catch((e) => setError(e.message));
  }, [reload]);
  useEffect(() => {
    if (!merchantId) return;
    let alive = true;
    const timer = setTimeout(() => {
      void searchKitchenProducts(merchantId, search)
        .then((res) => {
          if (alive) setProducts(res.products);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [merchantId, search]);
  async function write(operation) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      await reload();
      setRefresh((v) => v + 1);
      setNotice(t`Configuración guardada`);
    } catch (err) {
      setError(err.message || t`No se pudo guardar`);
    } finally {
      setBusy(false);
    }
  }
  function assign(existing, target, draft) {
    return write(async () => {
      if (!existing && !draft.stationId) return;
      if (existing)
        await updateKitchenRoute(merchantId, existing.id, {
          ...draft,
          stationId: draft.stationId || existing.stationId,
          expectedVersion: existing.version,
          active: Boolean(draft.stationId),
        });
      else await createKitchenRoute(merchantId, locationId, { ...target, ...draft });
    });
  }
  const general = defaultRoute(routes);
  const resolved = selected
    ? routeFor({ productId: selected.id, categoryId: selected.categoryId }, routes)
    : null;
  const destination = stations.find((s) => s.id === resolved?.stationId);
  if (!merchantId || !locationId)
    return (
      <div className="card" style={section}>
        <Trans>Selecciona una sucursal para configurar la cocina.</Trans>
      </div>
    );
  return (
    <div className="fade-up" style={{ display: 'grid', gap: 16 }}>
      <section className="card" style={section}>
        <h2>
          <Trans>Cocina: estaciones, rutas y avisos</Trans>
        </h2>
        <p>
          <Trans>
            La excepción por producto gana a la categoría, y la categoría a la predeterminada. Sin
            ninguna ruta, el platillo queda como excepción y no llega a una estación.
          </Trans>
        </p>
        <p>
          <Trans>
            El objetivo de la ruta reemplaza el umbral de la estación para ese platillo. Los avisos
            suenan una sola vez; cada terminal puede silenciarlos.
          </Trans>
        </p>
      </section>
      {error && (
        <div role="alert" className="card" style={{ ...section, color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {notice && <div role="status">{notice}</div>}
      <section className="card" style={section}>
        <h3>
          <Trans>Estaciones y sonidos</Trans>
        </h3>
        {stations.map((s) => (
          <StationEditor
            key={`${s.id}:${JSON.stringify(s.alertSettings)}:${s.name}`}
            station={s}
            busy={busy}
            onSave={(value) => write(() => saveKitchenStation(merchantId, locationId, s.id, value))}
          />
        ))}
        <form
          style={fields}
          onSubmit={(e) => {
            e.preventDefault();
            void write(async () => {
              await saveKitchenStation(merchantId, locationId, null, { name: newName });
              setNewName('');
            });
          }}
        >
          <label>
            <Trans>Nueva estación</Trans>
            <input
              className="input"
              aria-label={t`Nueva estación`}
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <button className="btn btn-primary" disabled={busy}>
            <Trans>Crear estación</Trans>
          </button>
        </form>
      </section>
      <section className="card" style={section}>
        <h3>
          <Trans>Ruteo por categoría</Trans>
        </h3>
        <RoutingRow
          key={`default:${general?.version}`}
          label={t`Predeterminada (todo lo demás)`}
          hint={
            general
              ? t`Recibe lo que ninguna categoría reclame.`
              : t`Sin predeterminada: un platillo sin ruta no llega a ninguna estación.`
          }
          stations={stations}
          route={general}
          busy={busy}
          onSave={(draft) => assign(general, {}, draft)}
        />
        {(categories.data?.items || []).map((category) => {
          const route = categoryRoute(category.id, routes);
          return (
            <RoutingRow
              key={`${category.id}:${route?.version}`}
              label={category.name}
              hint={route ? null : general ? t`Hereda la predeterminada` : t`Sin destino`}
              stations={stations}
              route={route}
              busy={busy}
              onSave={(draft) => assign(route, { categoryId: category.id }, draft)}
            />
          );
        })}
      </section>
      <section className="card" style={section}>
        <h3>
          <Trans>Excepción por producto · ¿dónde cae este platillo?</Trans>
        </h3>
        <label>
          <Trans>Buscar producto</Trans>
          <input
            className="input"
            aria-label={t`Buscar producto`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="input"
          aria-label={t`Producto a configurar`}
          value={selected?.id || ''}
          onChange={(e) => setSelected(products.find((p) => p.id === e.target.value) || null)}
        >
          <option value="">
            <Trans>Elige un producto (hasta 50 resultados)</Trans>
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {selected && (
          <>
            <div role="status">
              <strong>
                {selected.name}: {destination?.name || t`Sin destino`}
              </strong>
              <p>
                {resolved
                  ? t`${resolved.productId ? t`Excepción por producto` : resolved.categoryId ? t`Categoría` : t`Predeterminada`} · Prioridad ${resolved.routePriority} · Objetivo ${resolved.targetSeconds ?? destination?.alertSettings?.overdueSeconds ?? 900} s`
                  : t`Agrega una ruta para que llegue a cocina.`}
              </p>
            </div>
            <RoutingRow
              key={`${selected.id}:${productRoute(selected.id, routes)?.version}`}
              label={selected.name}
              hint={t`Dejar sin ruta propia restaura la categoría o la predeterminada.`}
              stations={stations}
              route={productRoute(selected.id, routes)}
              busy={busy}
              onSave={(draft) =>
                assign(productRoute(selected.id, routes), { productId: selected.id }, draft)
              }
            />
          </>
        )}
      </section>
      <DomainWorkspace domain="kitchen" />
    </div>
  );
}
