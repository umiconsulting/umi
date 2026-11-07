import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { saveSalesAnalysisGroup, deleteSalesAnalysisGroup } from '@/data.jsx';

function GroupForm({ merchantId, group, products, onSaved, onCancel }) {
  const { t } = useLingui();
  const [name, setName] = useState(group?.name ?? '');
  const [selected, setSelected] = useState(group?.productIds ?? []);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [id] = useState(() => group?.id ?? crypto.randomUUID());

  async function submitChange(write) {
    setPending(true);
    setError(null);
    try {
      await write();
      onSaved();
    } catch (failure) {
      setError(
        failure.code === 'REPORT_GROUP_CHANGED'
          ? t`El grupo cambió en otra sesión. Cierra el editor y actualiza los grupos.`
          : failure.code === 'REPORT_GROUP_NAME_EXISTS'
            ? t`Ya existe un grupo con ese nombre.`
            : t`No se pudo guardar el cambio. Reintenta o actualiza los grupos.`,
      );
    } finally {
      setPending(false);
    }
  }

  function saveGroup() {
    return submitChange(() =>
      saveSalesAnalysisGroup(merchantId, {
        id,
        name: name.trim(),
        productIds: selected,
        expectedVersion: group?.version ?? 0,
      }),
    );
  }

  function removeGroup() {
    return submitChange(() => deleteSalesAnalysisGroup(merchantId, group));
  }

  function toggle(id) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <form
      className="analysis-group-form"
      onSubmit={(event) => {
        event.preventDefault();
        saveGroup();
      }}
    >
      <fieldset disabled={pending}>
        <legend>{group ? <Trans>Editar grupo</Trans> : <Trans>Nuevo grupo</Trans>}</legend>
        <label>
          <Trans>Nombre del grupo</Trans>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={80}
          />
        </label>
        <label>
          <Trans>Buscar productos</Trans>
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <p>
          <Trans>{selected.length} de 500 productos seleccionados</Trans>
        </p>
        <div className="analysis-products">
          {products
            .filter((product) =>
              product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
            )
            .map((product) => (
              <label key={product.id} className="analysis-checkbox">
                <input
                  type="checkbox"
                  checked={selected.includes(product.id)}
                  disabled={!selected.includes(product.id) && selected.length >= 500}
                  onChange={() => toggle(product.id)}
                />
                {product.name}
              </label>
            ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="analysis-actions">
          <button
            className="btn btn-primary"
            disabled={!name.trim() || !selected.length}
            type="submit"
          >
            {pending ? <Trans>Guardando…</Trans> : <Trans>Guardar grupo</Trans>}
          </button>
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            <Trans>Cancelar</Trans>
          </button>
          {group && (
            <button className="btn btn-secondary" type="button" onClick={removeGroup}>
              <Trans>Eliminar grupo</Trans>
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

export default function SalesAnalysisGroups({ merchantId, options, onSaved, onRefresh }) {
  const [editing, setEditing] = useState(undefined);
  return (
    <details className="analysis-panel surface">
      <summary>
        <Trans>Grupos de productos</Trans>
      </summary>
      <p>
        <Trans>
          Las categorías vienen del catálogo. Crea grupos para combinar productos de distintas
          categorías.
        </Trans>
      </p>
      <p>
        <Trans>
          Los grupos y las categorías actuales se aplican a todo el historial consultado.
        </Trans>
      </p>
      <div className="analysis-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setEditing(undefined);
            onRefresh();
          }}
        >
          <Trans>Actualizar grupos</Trans>
        </button>
        {options.groups.map((group) => (
          <button
            key={group.id}
            type="button"
            className="btn btn-secondary"
            disabled={!options.canManageGroups}
            onClick={() => setEditing(group)}
          >
            {group.name}
          </button>
        ))}
        {options.canManageGroups && (
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
            <Trans>Crear grupo</Trans>
          </button>
        )}
      </div>
      {!options.canManageGroups && (
        <p>
          <Trans>Un administrador del negocio puede modificar los grupos.</Trans>
        </p>
      )}
      {editing !== undefined && (
        <GroupForm
          key={editing?.id ?? 'new'}
          merchantId={merchantId}
          group={editing}
          products={options.products}
          onCancel={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            onSaved();
          }}
        />
      )}
    </details>
  );
}
