import { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react/macro';
import {
  useCatalogCategories,
  createCatalogCategory,
  updateCatalogCategory,
} from '@/data.jsx';

// A category always owns a concrete colour (the server starts it on a curated
// palette entry, see the API). There is no "automatic" state to select — the owner
// simply recolours it here, and the POS paints it behind photo-less products.
const FALLBACK_COLOR = '#4363d8';

function colorOf(category) {
  return /^#[0-9a-fA-F]{6}$/.test(category?.color || '') ? category.color : FALLBACK_COLOR;
}

function CategoryRow({ category, onSaved }) {
  const { t } = useLingui();
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(colorOf(category));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const dirty = name.trim() !== category.name || color.toLowerCase() !== colorOf(category);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateCatalogCategory(category.id, { name: name.trim(), color });
      await onSaved();
    } catch (err) {
      setError(err.message || t`No se pudo guardar`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="card"
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 1fr auto',
        gap: 12,
        alignItems: 'center',
        padding: 12,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          background: color,
          border: '1px solid var(--line, rgba(0,0,0,.12))',
        }}
      />
      <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
        <input
          className="input"
          value={name}
          maxLength={160}
          aria-label={t`Nombre de la categoría`}
          onChange={(event) => setName(event.target.value)}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {category.productCount === 1 ? (
            <Trans>1 producto</Trans>
          ) : (
            <Trans>{category.productCount} productos</Trans>
          )}
        </span>
        {error ? (
          <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="color"
          value={color}
          aria-label={t`Color en el POS`}
          onChange={(event) => setColor(event.target.value)}
          style={{ width: 40, height: 34, padding: 0, border: 'none', background: 'none' }}
        />
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={busy || !dirty || name.trim().length === 0}
          onClick={save}
        >
          <Trans>Guardar</Trans>
        </button>
      </div>
    </div>
  );
}

function CreateCategory({ onCreated }) {
  const { t } = useLingui();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await createCatalogCategory({ name: name.trim() });
      setName('');
      await onCreated();
    } catch (err) {
      setError(
        err.code === 'CATEGORY_NAME_TAKEN'
          ? t`Ya existe una categoría con ese nombre`
          : err.message || t`No se pudo crear`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ display: 'grid', gap: 8, padding: 12 }}>
      <strong>
        <Trans>Nueva categoría</Trans>
      </strong>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: '1 1 220px' }}
          value={name}
          maxLength={160}
          placeholder={t`Nombre`}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim().length > 0 && !busy) create();
          }}
        />
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy || name.trim().length === 0}
          onClick={create}
        >
          <Trans>Crear</Trans>
        </button>
      </div>
      {error ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}

export default function CategoriesWorkspace() {
  const [refresh, setRefresh] = useState(0);
  const { data, loading, error } = useCatalogCategories(refresh);
  const reload = async () => setRefresh((value) => value + 1);
  const categories = (data && data.items) || [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="muted" style={{ margin: 0 }}>
        <Trans>
          Cada categoría empieza con un color al azar; cámbialo cuando quieras. Se ve en el
          punto de venta detrás de los productos sin foto, para ubicarlos por categoría.
        </Trans>
      </p>
      <CreateCategory onCreated={reload} />
      {loading ? (
        <p className="muted">
          <Trans>Cargando…</Trans>
        </p>
      ) : error ? (
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      ) : categories.length === 0 ? (
        <p className="muted">
          <Trans>Aún no hay categorías. Crea la primera arriba.</Trans>
        </p>
      ) : (
        categories.map((category) => (
          <CategoryRow
            key={`${category.id}:${category.name}:${category.color}`}
            category={category}
            onSaved={reload}
          />
        ))
      )}
    </div>
  );
}
