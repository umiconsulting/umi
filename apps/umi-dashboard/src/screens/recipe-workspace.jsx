import { useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Select } from '@/components/select.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { useMerchant } from '@/lib/merchant-context.jsx';
import {
  useInventoryCostBasis,
  useInventoryItems,
  useInventoryRecipeExplosion,
  useInventoryRecipes,
  useRecipeTargets,
} from '@/data.jsx';
import { formatMoney, formatNumber } from '@/lib/format.js';
import { formatScaled } from './inventory-model.js';
import {
  recipeCostPreview,
  recipeToDraft,
  scaledQuantityText,
  subRecipeCostByItemId,
  subRecipeHint,
  yieldText,
} from './recipe-model.js';

/**
 * Recetas - the console's authoring surface for a recipe and a sub-recipe
 * (recipes module plan §7 and §11, Phase 2).
 *
 * THE LIVE COST IS THE POINT. An owner who changes an ingredient must see the
 * plate margin move BEFORE the save, so the editor prints the local arithmetic
 * while the owner types and the list prints the server's answer after each save.
 * Both come from `recipe-model.js`, which repeats the server's own formulas, so a
 * number that moves on the save is a defect and not a rounding detail.
 *
 * A SUB-RECIPE IS AN ITEM (plan D1). A component always points at an inventory
 * item, and an item that is itself produced is offered as a SUB-RECIPE with the
 * count of recipes that use it. The target of a recipe is a product, a variant or
 * an item, and exactly one of them (plan D2).
 *
 * THE TAB IS REACHABLE WITH `catalog.read` OR `inventory.read`, BUT EVERY READ
 * AND WRITE BEHIND IT IS GATED ON `merchant.manage`. The screen checks the
 * permission first and says what the operator cannot do, so the reads stay off
 * the wire instead of answering with 403s.
 */
const MANAGE_GATE = { permissions: ['merchant.manage'] };

const HEAD = {
  textAlign: 'left',
  padding: '8px 10px',
  fontWeight: 600,
  color: 'var(--ink-3)',
  fontSize: 11.5,
  letterSpacing: 0,
  whiteSpace: 'nowrap',
};
const CELL = { padding: '10px', verticalAlign: 'top' };

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
const UNIT_ORDER = ['portion', 'unit', 'gram', 'kilogram', 'milliliter', 'liter', 'package', 'box'];

const TARGET_KIND_LABEL = {
  product: msg`Producto`,
  item: msg`Sub-receta`,
};

const RECIPE_ERROR_COPY = {
  OPTIMISTIC_VERSION_CONFLICT: msg`Otra persona guardó una versión nueva de esta receta. Recarga para ver la versión nueva.`,
  INVENTORY_RECIPE_CYCLE: msg`La receta se usaría a sí misma. Quita el artículo que forma el ciclo.`,
  INVENTORY_RECIPE_TOO_DEEP: msg`La receta pasa de 12 niveles. Acorta la cadena de sub-recetas.`,
  INVENTORY_RECIPE_NOT_FOUND: msg`La receta ya no existe. Actualiza la lista.`,
  INVENTORY_ITEM_NOT_FOUND: msg`Un artículo ya no existe. Actualiza la lista.`,
  PERMISSION_DENIED: msg`No tienes permiso para administrar el inventario.`,
  VALIDATION_FAILED: msg`Revisa los datos. La API no aceptó la operación.`,
  SERVICE_UNAVAILABLE: msg`El servicio no está disponible. Intenta de nuevo después.`,
};

function errorText(i18n, copy, error) {
  if (!error) return null;
  const known = copy[error.code];
  return known ? i18n._(known) : error.message;
}

function CommandNotice({ command, onReload }) {
  const { i18n } = useLingui();
  if (!command.error) return null;
  const stale = command.error.code === 'OPTIMISTIC_VERSION_CONFLICT';
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12.5 }}>
        {errorText(i18n, RECIPE_ERROR_COPY, command.error)}
      </p>
      {stale && onReload ? (
        <div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onReload}>
            <Trans>Recargar</Trans>
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A number the server did not fully price: a named state, never a zero. */
function NoValue({ children }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 9px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--warning-soft)',
        color: 'var(--warning)',
        fontSize: 11,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

function SinCosto() {
  return (
    <NoValue>
      <Trans>Sin costo</Trans>
    </NoValue>
  );
}

/** The house `.switch` class with the ARIA role a toggle needs. */
function Toggle({ checked, label, onChange }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      />
      <span className="muted">{label}</span>
    </span>
  );
}

function NoPermissionNotice() {
  return (
    <div className="card" style={{ padding: 18 }}>
      <p style={{ margin: 0, color: 'var(--ink-2)' }}>
        <Trans>No puedes administrar las recetas.</Trans>
      </p>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
        <Trans>
          Pide a la persona propietaria que te dé el permiso para administrar el negocio.
        </Trans>
      </p>
    </div>
  );
}

function filterRecipes(recipes, query) {
  const wanted = String(query || '')
    .trim()
    .toLowerCase();
  const rows = Array.isArray(recipes) ? recipes : [];
  if (!wanted) return rows;
  return rows.filter((recipe) =>
    `${recipe.targetName || ''} ${recipe.id || ''}`.toLowerCase().includes(wanted),
  );
}

export default function RecipeWorkspace() {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities || null;
  const canManage = hasRequiredPermission(MANAGE_GATE, capabilities);
  const [refresh, setRefresh] = useState(0);
  const [showRetired, setShowRetired] = useState(false);
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState(null);

  const recipesState = useInventoryRecipes({ includeRetired: showRetired }, refresh);
  const itemsState = useInventoryItems({ includeArchived: false }, refresh);
  const targetsState = useRecipeTargets(refresh);
  const basisState = useInventoryCostBasis(refresh);

  const recipes = useMemo(
    () => filterRecipes(recipesState.data.recipes, query),
    [recipesState.data.recipes, query],
  );
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const costBasisById = useMemo(() => {
    const byItemId = new Map();
    for (const entry of basisState.data.items) {
      byItemId.set(entry.inventoryItemId, entry.unitCostMinor);
    }
    return byItemId;
  }, [basisState.data.items]);

  // A save answers with the NEW version, so the editor reopens on the server's own
  // numbers: the local arithmetic is checked against the answer that was stored.
  async function reload(savedRecipe) {
    setRefresh((value) => value + 1);
    if (savedRecipe && savedRecipe.id) setEditor({ recipe: savedRecipe, id: savedRecipe.id });
    else setEditor(null);
  }

  if (merchant?.loading && !capabilities) {
    return (
      <p className="muted">
        <Trans>Cargando las recetas…</Trans>
      </p>
    );
  }
  if (!canManage) return <NoPermissionNotice />;

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
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: '0 1 220px' }}
            value={query}
            placeholder={t`Buscar receta`}
            aria-label={t`Buscar receta`}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Toggle checked={showRetired} label={t`Mostrar retiradas`} onChange={setShowRetired} />
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => setEditor({ recipe: null, id: crypto.randomUUID() })}
        >
          <I.Plus size={16} />
          <Trans>Nueva receta</Trans>
        </button>
      </div>

      {recipesState.loading && !recipesState.loaded ? (
        <p className="muted">
          <Trans>Cargando las recetas…</Trans>
        </p>
      ) : recipesState.error ? (
        <p style={{ color: 'var(--danger)' }}>
          {errorText(i18n, RECIPE_ERROR_COPY, {
            code: recipesState.errorCode,
            message: recipesState.error,
          })}
        </p>
      ) : recipes.length === 0 ? (
        <p className="muted">
          <Trans>Aún no hay recetas. Crea la primera.</Trans>
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                <th scope="col" style={HEAD}>
                  <Trans>Receta</Trans>
                </th>
                <th scope="col" style={HEAD}>
                  <Trans>Tipo</Trans>
                </th>
                <th scope="col" style={HEAD}>
                  <Trans>Rendimiento</Trans>
                </th>
                <th scope="col" style={HEAD}>
                  <Trans>Versión</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Costo por unidad</Trans>
                </th>
                <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                  <Trans>Margen</Trans>
                </th>
                <th scope="col" style={HEAD}>
                  <Trans>Acciones</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {recipes.map((recipe) => (
                <tr key={recipe.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={CELL}>
                    <div style={{ display: 'grid', gap: 3 }}>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontWeight: 600 }}>{recipe.targetName}</strong>
                        {recipe.active === false ? (
                          <span className="sub-pill">
                            <Trans>Retirada</Trans>
                          </span>
                        ) : null}
                        {recipe.costMinor == null ? <SinCosto /> : null}
                      </span>
                      {recipe.targetItemId ? (
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          <Plural
                            value={Number(recipe.usedInRecipeCount) || 0}
                            one="Se usa en # receta"
                            other="Se usa en # recetas"
                          />
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td style={CELL}>
                    {TARGET_KIND_LABEL[recipe.targetKind]
                      ? i18n._(TARGET_KIND_LABEL[recipe.targetKind])
                      : recipe.targetKind}
                  </td>
                  <td style={CELL}>{yieldText(recipe.yieldQuantity, unitOf) || '·'}</td>
                  <td style={CELL}>{formatNumber(recipe.version)}</td>
                  <td style={{ ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {recipe.costMinor == null ? (
                      <span className="muted">·</span>
                    ) : (
                      formatMoney(recipe.costMinor)
                    )}
                  </td>
                  <td style={{ ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {recipe.marginMinor == null ? (
                      <span className="muted">·</span>
                    ) : (
                      formatMoney(recipe.marginMinor)
                    )}
                  </td>
                  <td style={CELL}>
                    <button
                      className="btn-icon"
                      type="button"
                      aria-label={t`Editar ${recipe.targetName}`}
                      onClick={() => setEditor({ recipe, id: recipe.id })}
                    >
                      <I.Edit size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ margin: '8px 0 0', fontSize: 11.5 }}>
            <Trans>
              El costo es el de una unidad de rendimiento, calculado con el precio de compra de cada
              insumo.
            </Trans>
          </p>
        </div>
      )}

      {editor ? (
        <RecipeEditor
          key={editor.id}
          recipe={editor.recipe}
          recipeId={editor.id}
          items={itemsState.data.items}
          recipes={recipesState.data.recipes}
          targets={targetsState.data.targets}
          costBasisById={costBasisById}
          onClose={() => setEditor(null)}
          onSaved={reload}
        />
      ) : null}
    </div>
  );
}

/** One money figure. `absent` is the state where the number is not known. */
function Figure({ label, value, absent, note }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span className="eyebrow">{label}</span>
      {absent ? (
        <NoValue>{absent}</NoValue>
      ) : (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 600,
            fontSize: 15,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
      )}
      {note ? (
        <span className="muted" style={{ fontSize: 11.5 }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** A scaled quantity as a decimal string, for a table cell. */
function scaledText(quantity) {
  if (!quantity || quantity.value == null) return null;
  return formatScaled(quantity.value, quantity.scale);
}

/**
 * The server's explosion: the recipe at its raw items. This is the answer the
 * editor consults for the `exact` question, because exactness is the server's
 * statement about its own numbers.
 */
function ExplosionPanel({ state, unitOf }) {
  const { i18n } = useLingui();
  const items = state.data.items || [];
  const notExact = items.filter((item) => item.exact === false);

  if (state.loading && !state.loaded) {
    return (
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        <Trans>Leyendo el costeo del servidor…</Trans>
      </p>
    );
  }
  if (!state.loaded || items.length === 0) return null;

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <h4 style={{ margin: 0 }}>
        <Trans>Costeo del servidor</Trans>
      </h4>
      {notExact.length > 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--warning)' }}>
          <Trans>
            Una línea no da unidades completas del insumo. El servidor no publica un costo para esta
            receta.
          </Trans>
        </p>
      ) : null}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--line)' }}>
              <th scope="col" style={HEAD}>
                <Trans>Insumo</Trans>
              </th>
              <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                <Trans>Cantidad</Trans>
              </th>
              <th scope="col" style={HEAD}>
                <Trans>Exacto</Trans>
              </th>
              <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                <Trans>Costo unitario</Trans>
              </th>
              <th scope="col" style={{ ...HEAD, textAlign: 'right' }}>
                <Trans>Costo de la línea</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={`${item.inventoryItemId}:${item.depth}`}
                style={{ borderBottom: '1px solid var(--line)' }}
              >
                <td style={CELL}>
                  <div>{item.displayName}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {item.publicReference}
                  </div>
                </td>
                <td style={{ ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {scaledText(item.quantity)} {unitOf(item.quantity?.unit)}
                </td>
                <td style={CELL}>
                  {item.exact === false ? (
                    <NoValue>
                      <Trans>No exacto</Trans>
                    </NoValue>
                  ) : (
                    <span className="muted">
                      <Trans>Sí</Trans>
                    </span>
                  )}
                </td>
                <td style={{ ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {item.unitCostMinor == null ? (
                    <span className="muted">
                      <Trans>Sin precio</Trans>
                    </span>
                  ) : (
                    <>
                      {formatMoney(item.unitCostMinor)}
                      <span className="muted"> / {unitOf(item.quantity?.unit)}</span>
                    </>
                  )}
                </td>
                <td style={{ ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {item.lineCostMinor == null ? (
                    <span className="muted">·</span>
                  ) : (
                    formatMoney(item.lineCostMinor)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
        {i18n._(
          msg`La explosión baja cada sub-receta hasta el insumo. Un insumo sin recepción no tiene precio, y por eso no se muestra un cero.`,
        )}
      </p>
    </section>
  );
}

/**
 * The recipe editor. The target is chosen once: an update writes a NEW VERSION of
 * the same target (plan D3), so the fields that name it are read-only after the
 * first save.
 */
function RecipeEditor({
  recipe,
  recipeId,
  items,
  recipes,
  targets,
  costBasisById,
  onClose,
  onSaved,
}) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const editing = Boolean(recipe);
  const draft = useMemo(() => recipeToDraft(recipe), [recipe]);

  const [targetKind, setTargetKind] = useState(() => recipe?.targetKind || 'product');
  const [productId, setProductId] = useState(() => recipe?.productId || '');
  const [variantId, setVariantId] = useState(() => recipe?.variantId || '');
  const [targetItemId, setTargetItemId] = useState(() => recipe?.targetItemId || '');
  const [yieldValueText, setYieldValueText] = useState(() =>
    draft.yieldQuantity ? formatScaled(draft.yieldQuantity.value, draft.yieldQuantity.scale) : '1',
  );
  const [yieldScale, setYieldScale] = useState(() => String(draft.yieldQuantity?.scale ?? 0));
  const [yieldUnit, setYieldUnit] = useState(() => draft.yieldQuantity?.unit || 'portion');
  const [shelfLifeDays, setShelfLifeDays] = useState(() =>
    draft.shelfLifeDays == null ? '' : String(draft.shelfLifeDays),
  );
  const [lines, setLines] = useState(() =>
    draft.components.map((component, index) => ({
      key: component.key || `line-${index}`,
      inventoryItemId: component.inventoryItemId,
      quantityText: component.quantity
        ? formatScaled(component.quantity.value, component.quantity.scale)
        : '',
    })),
  );
  const [confirmRetire, setConfirmRetire] = useState(false);

  const explosion = useInventoryRecipeExplosion(editing ? recipeId : null, 0);
  const itemsById = useMemo(() => new Map((items || []).map((item) => [item.id, item])), [items]);
  const itemOptions = useMemo(() => {
    const list = (items || []).filter((item) => item.active !== false);
    return [...list].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [items]);
  const subRecipeCosts = useMemo(
    () => subRecipeCostByItemId(recipes, itemsById),
    [recipes, itemsById],
  );

  const productOptions = useMemo(() => {
    const byId = new Map();
    for (const row of targets || []) {
      const known = byId.get(row.productId);
      if (!known) {
        byId.set(row.productId, {
          id: row.productId,
          name: row.productName,
          isActive: row.productActive !== false,
        });
      }
    }
    return [...byId.values()]
      .filter((product) => product.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [targets]);
  const variantOptions = useMemo(
    () => (targets || []).filter((row) => row.productId === productId && row.variantId),
    [targets, productId],
  );

  const target = useMemo(() => {
    if (targetKind !== 'product' || !productId) return null;
    const rows = (targets || []).filter((row) => row.productId === productId);
    return (
      rows.find((row) => (row.variantId || '') === (variantId || '')) ||
      (variantId ? null : rows.find((row) => !row.variantId)) ||
      null
    );
  }, [targets, targetKind, productId, variantId]);

  // A saved recipe carries its own price in the pair the server published: the
  // margin is the price minus the cost. It is the fallback when the menu read does
  // not name this exact target.
  const savedPriceMinor =
    recipe && recipe.costMinor != null && recipe.marginMinor != null
      ? recipe.costMinor + recipe.marginMinor
      : null;
  const priceMinor =
    targetKind === 'product' ? (target ? target.priceMinor : savedPriceMinor) : null;

  const yieldScaled = scaledQuantityText(yieldValueText, yieldScale);
  const draftYield =
    yieldScaled === null
      ? null
      : { value: Number(yieldScaled), scale: Number(yieldScale), unit: yieldUnit };

  const previewLines = lines.map((line) => {
    const item = itemsById.get(line.inventoryItemId) || null;
    const scaled = item ? scaledQuantityText(line.quantityText, item.quantityScale) : null;
    return {
      inventoryItemId: line.inventoryItemId,
      item,
      quantity:
        item && scaled !== null
          ? { value: Number(scaled), scale: item.quantityScale, unit: item.baseUnit }
          : null,
    };
  });

  const preview = recipeCostPreview({
    yieldQuantity: draftYield,
    priceMinor,
    components: previewLines,
    itemsById,
    unitCostMinorByItemId: costBasisById,
    subRecipeByItemId: subRecipeCosts,
  });

  const linesComplete =
    lines.length > 0 && previewLines.every((line) => Boolean(line.item) && line.quantity !== null);
  const targetComplete = editing
    ? true
    : targetKind === 'product'
      ? Boolean(productId)
      : Boolean(targetItemId);
  const shelfLifeValid = shelfLifeDays === '' || /^\d+$/.test(shelfLifeDays.trim());
  const retired = editing && recipe.active === false;
  const savable =
    !retired && draftYield !== null && linesComplete && targetComplete && shelfLifeValid;

  const nameOf = (inventoryItemId) =>
    itemsById.get(inventoryItemId)?.displayName || inventoryItemId;
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const targetSubRecipe = targetKind === 'item' ? subRecipeHint(targetItemId, recipes) : null;

  function addLine() {
    setLines((previous) => [
      ...previous,
      { key: crypto.randomUUID(), inventoryItemId: '', quantityText: '1' },
    ]);
  }

  function updateLine(key, patch) {
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(key) {
    setLines((previous) => previous.filter((line) => line.key !== key));
  }

  function chooseTargetItem(itemId) {
    setTargetItemId(itemId);
    const item = itemsById.get(itemId);
    if (item && !editing) {
      setYieldUnit(item.baseUnit);
      setYieldScale(String(item.quantityScale));
      if (!yieldValueText) setYieldValueText('1');
    }
  }

  async function save() {
    const components = previewLines
      .filter((line) => line.quantity !== null)
      .map((line) => ({
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        conversionNumerator: 1,
        conversionDenominator: 1,
        roundingPolicy: 'exact',
        required: true,
      }));
    const parameters = {
      yieldQuantity: draftYield,
      ...(shelfLifeDays === '' ? {} : { shelfLifeDays: Number(shelfLifeDays.trim()) }),
      components,
    };
    if (editing) {
      const response = await command.execute('inventory.recipe.update', recipeId, {
        targetVersion: recipe.version,
        parameters,
      });
      await onSaved(response?.result?.recipe || null);
    } else if (targetKind === 'item') {
      const response = await command.execute('inventory.recipe.create', recipeId, {
        targetVersion: null,
        parameters: { ...parameters, targetKind: 'item', targetItemId },
      });
      await onSaved(response?.result?.recipe || null);
    } else {
      const response = await command.execute('inventory.recipe.create', recipeId, {
        targetVersion: null,
        parameters: {
          ...parameters,
          targetKind: 'product',
          productId,
          ...(variantId ? { variantId } : {}),
        },
      });
      await onSaved(response?.result?.recipe || null);
    }
  }

  async function retire() {
    await command.execute('inventory.recipe.retire', recipeId, {
      targetVersion: recipe.version,
      parameters: {},
    });
    await onSaved(null);
  }

  const costAbsent =
    preview.state === 'not_exact' ? t`No exacto` : preview.state === 'costed' ? null : t`Sin costo`;
  const marginAbsent = preview.marginMinor == null ? t`Sin margen` : null;
  const marginPercent =
    preview.marginBasisPoints == null
      ? null
      : `${formatNumber(preview.marginBasisPoints / 100, { maximumFractionDigits: 1 })} %`;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? t`Editar receta` : t`Nueva receta`}
        style={{
          width: 'min(880px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            {editing ? <Trans>Editar receta</Trans> : <Trans>Nueva receta</Trans>}
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>

        {/* ── The target ─────────────────────────────────────────────────────── */}
        <section style={{ display: 'grid', gap: 10 }}>
          <h4 style={{ margin: 0 }}>
            <Trans>Objetivo</Trans>
          </h4>
          {editing ? (
            <p style={{ margin: 0, fontSize: 12.5 }}>
              <strong>{recipe.targetName}</strong>{' '}
              <span className="muted">
                {TARGET_KIND_LABEL[recipe.targetKind]
                  ? i18n._(TARGET_KIND_LABEL[recipe.targetKind])
                  : recipe.targetKind}
              </span>
            </p>
          ) : (
            <div
              role="group"
              aria-label={t`Tipo de objetivo`}
              style={{ display: 'inline-flex', gap: 8 }}
            >
              {['product', 'item'].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className={`btn ${targetKind === kind ? 'btn-primary' : 'btn-secondary'}`}
                  aria-pressed={targetKind === kind}
                  onClick={() => setTargetKind(kind)}
                >
                  {kind === 'product' ? <Trans>Producto</Trans> : <Trans>Artículo</Trans>}
                </button>
              ))}
            </div>
          )}

          {!editing && targetKind === 'product' ? (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                <Trans>Producto</Trans>
                <Select
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    setVariantId('');
                  }}
                >
                  <option value="">{t`Elige un producto`}</option>
                  {productOptions.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              </label>
              {variantOptions.length > 0 ? (
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  <Trans>Variante</Trans>
                  <Select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                    <option value="">{t`Sin variante`}</option>
                    {variantOptions.map((variant) => (
                      <option key={variant.variantId} value={variant.variantId}>
                        {variant.variantName || variant.variantId}
                      </option>
                    ))}
                  </Select>
                </label>
              ) : null}
            </div>
          ) : null}

          {!editing && targetKind === 'item' ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                <Trans>Artículo</Trans>
                <Select
                  value={targetItemId}
                  onChange={(event) => chooseTargetItem(event.target.value)}
                >
                  <option value="">{t`Elige un artículo`}</option>
                  {itemOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.displayName} · {item.publicReference}
                      {subRecipeHint(item.id, recipes)
                        ? ` · ${i18n._(TARGET_KIND_LABEL.item)}`
                        : ''}
                    </option>
                  ))}
                </Select>
              </label>
              {targetItemId ? (
                targetSubRecipe ? (
                  <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                    <Plural
                      value={targetSubRecipe.usedInRecipeCount}
                      one="Sub-receta. Se usa en # receta."
                      other="Sub-receta. Se usa en # recetas."
                    />
                  </p>
                ) : (
                  <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                    <Trans>Este artículo no tiene receta propia.</Trans>
                  </p>
                )
              ) : null}
            </div>
          ) : null}
        </section>

        {/* ── The yield ──────────────────────────────────────────────────────── */}
        <section style={{ display: 'grid', gap: 10 }}>
          <h4 style={{ margin: 0 }}>
            <Trans>Rendimiento</Trans>
          </h4>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 12,
            }}
          >
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <Trans>Cantidad</Trans>
              <input
                className="input"
                inputMode="decimal"
                value={yieldValueText}
                onChange={(event) => setYieldValueText(event.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <Trans>Decimales</Trans>
              <Select value={yieldScale} onChange={(event) => setYieldScale(event.target.value)}>
                {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </Select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <Trans>Unidad</Trans>
              <Select value={yieldUnit} onChange={(event) => setYieldUnit(event.target.value)}>
                {UNIT_ORDER.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitOf(unit)}
                  </option>
                ))}
              </Select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
              <Trans>Vida útil en días</Trans>
              <input
                className="input"
                inputMode="numeric"
                value={shelfLifeDays}
                placeholder={t`Sin vida útil`}
                onChange={(event) => setShelfLifeDays(event.target.value)}
              />
            </label>
          </div>
          {draftYield === null ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
              <Trans>Escribe la cantidad de rendimiento como un número mayor que cero.</Trans>
            </p>
          ) : null}
          {shelfLifeValid ? null : (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
              <Trans>Escribe la vida útil como días completos.</Trans>
            </p>
          )}
        </section>

        {/* ── The components ─────────────────────────────────────────────────── */}
        <section style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <h4 style={{ margin: 0 }}>
              <Trans>Componentes</Trans>
            </h4>
            <button className="btn btn-secondary btn-sm" type="button" onClick={addLine}>
              <I.Plus size={14} />
              <Trans>Agregar componente</Trans>
            </button>
          </div>

          {lines.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              <Trans>Agrega el primer componente para calcular el costo.</Trans>
            </p>
          ) : (
            <div style={{ display: 'grid' }}>
              {lines.map((line, index) => {
                const item = itemsById.get(line.inventoryItemId) || null;
                const scaled = item
                  ? scaledQuantityText(line.quantityText, item.quantityScale)
                  : null;
                const basis = item ? costBasisById.get(item.id) : null;
                const hint = item ? subRecipeHint(item.id, recipes) : null;
                return (
                  <div
                    key={line.key}
                    style={{
                      display: 'grid',
                      gap: 6,
                      padding: '10px 0',
                      borderTop: '1px solid var(--line)',
                    }}
                  >
                    <div
                      style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
                    >
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, flex: '1 1 240px' }}>
                        <Trans>Artículo</Trans>
                        <Select
                          value={line.inventoryItemId}
                          onChange={(event) =>
                            updateLine(line.key, { inventoryItemId: event.target.value })
                          }
                        >
                          <option value="">{t`Elige un artículo`}</option>
                          {itemOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.displayName} · {option.publicReference}
                              {subRecipeHint(option.id, recipes)
                                ? ` · ${i18n._(TARGET_KIND_LABEL.item)}`
                                : ''}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label style={{ display: 'grid', gap: 4, fontSize: 12, width: 130 }}>
                        <Trans>Cantidad</Trans>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={line.quantityText}
                          aria-label={t`Cantidad del componente ${index + 1}`}
                          onChange={(event) =>
                            updateLine(line.key, { quantityText: event.target.value })
                          }
                        />
                      </label>
                      <span className="muted" style={{ fontSize: 12, paddingBottom: 10 }}>
                        {item ? unitOf(item.baseUnit) : '·'}
                      </span>
                      <button
                        className="btn-icon"
                        type="button"
                        aria-label={t`Quitar el componente ${index + 1}`}
                        onClick={() => removeLine(line.key)}
                      >
                        <I.Trash size={15} />
                      </button>
                    </div>
                    {!item ? (
                      <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                        <Trans>Elige un artículo de tu inventario.</Trans>
                      </p>
                    ) : (
                      <>
                        {scaled === null ? (
                          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--danger)' }}>
                            <Trans>
                              La cantidad no cabe en la escala del artículo
                              {item.quantityScale > 0
                                ? ` (${item.quantityScale} decimales).`
                                : ' (sin decimales).'}
                            </Trans>
                          </p>
                        ) : null}
                        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                          {hint ? (
                            <Plural
                              value={hint.usedInRecipeCount}
                              one="Sub-receta. Se usa en # receta."
                              other="Sub-receta. Se usa en # recetas."
                            />
                          ) : (
                            <Trans>Insumo comprado.</Trans>
                          )}
                        </p>
                        <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
                          {hint && subRecipeCosts.get(item.id)?.costMinor == null ? (
                            <Trans>
                              El costo de esta sub-receta aún no se calcula. Revisa los precios de
                              sus insumos.
                            </Trans>
                          ) : basis == null ? (
                            <Trans>Sin costo base. Registra una recepción de compra.</Trans>
                          ) : (
                            <Trans>
                              Costo base: {formatMoney(basis)} por {unitOf(item.baseUnit)}.
                            </Trans>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── The live cost ──────────────────────────────────────────────────── */}
        <section className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
          <h4 style={{ margin: 0 }}>
            <Trans>Costo y margen</Trans>
          </h4>
          <div className="grid grid-4" style={{ gap: 12 }}>
            <Figure
              label={<Trans>Costo por unidad de rendimiento</Trans>}
              value={preview.costMinor == null ? null : formatMoney(preview.costMinor)}
              absent={costAbsent}
              note={yieldText(draftYield, unitOf)}
            />
            <Figure
              label={<Trans>Precio</Trans>}
              value={priceMinor == null ? null : formatMoney(priceMinor)}
              absent={priceMinor == null ? t`Sin precio` : null}
            />
            <Figure
              label={<Trans>Margen</Trans>}
              value={preview.marginMinor == null ? null : formatMoney(preview.marginMinor)}
              absent={marginAbsent}
            />
            <Figure
              label={<Trans>Margen %</Trans>}
              value={marginPercent}
              absent={marginPercent == null ? t`Sin margen` : null}
            />
          </div>

          {preview.state === 'not_exact' ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--warning)' }}>
                <Trans>
                  Una cantidad no da unidades completas del artículo. Ajusta el rendimiento o la
                  cantidad. El costo es desconocido, no cero.
                </Trans>
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {preview.notExact.map((inventoryItemId) => (
                  <li key={inventoryItemId}>{nameOf(inventoryItemId)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.state === 'no_cost' ? (
            <div style={{ display: 'grid', gap: 4 }}>
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
                <Trans>Falta el costo de estos artículos. El costo es desconocido, no cero.</Trans>
              </p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {preview.missingCost.map((inventoryItemId) => (
                  <li key={inventoryItemId}>{nameOf(inventoryItemId)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.state === 'empty' ? (
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
              <Trans>Agrega un componente para calcular el costo.</Trans>
            </p>
          ) : null}

          {priceMinor == null ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {targetKind === 'item' ? (
                <Trans>Una sub-receta no tiene precio de venta, así que no hay margen.</Trans>
              ) : (
                <Trans>Sin precio no hay margen. Elige el producto para ver su precio.</Trans>
              )}
            </p>
          ) : null}

          {retired ? (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
              <Trans>Esta versión está retirada. No se puede editar.</Trans>
            </p>
          ) : null}

          {editing && recipe.costMinor != null ? (
            <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
              <Trans>
                Costo guardado: {formatMoney(recipe.costMinor)}. El número de arriba es el cálculo
                en pantalla.
              </Trans>
            </p>
          ) : null}

          <p className="muted" style={{ margin: 0, fontSize: 11.5 }}>
            <Trans>
              El costo por unidad usa el precio de compra de cada insumo y se redondea una sola vez.
              Al guardar, la lista muestra el costo que calculó el servidor.
            </Trans>
          </p>
        </section>

        {editing ? <ExplosionPanel state={explosion} unitOf={unitOf} /> : null}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={command.pending || !savable}
            onClick={save}
          >
            <Trans>Guardar</Trans>
          </button>
          {editing && recipe.active !== false ? (
            confirmRetire ? (
              <>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={command.pending}
                  onClick={retire}
                >
                  <Trans>Confirmar retirada</Trans>
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setConfirmRetire(false)}
                >
                  <Trans>Cancelar</Trans>
                </button>
              </>
            ) : (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={command.pending}
                onClick={() => setConfirmRetire(true)}
              >
                <Trans>Retirar</Trans>
              </button>
            )
          ) : null}
          <span className="muted" style={{ fontSize: 11.5 }}>
            <Trans>Guardar escribe una versión nueva y retira la anterior.</Trans>
          </span>
        </div>

        <CommandNotice command={command} onReload={onSaved} />
      </section>
    </div>
  );
}
