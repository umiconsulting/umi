import { useMemo, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { Select } from '@/components/select.jsx';
import { useAdministrativeCommand } from '@/lib/administrative-command.jsx';
import {
  ALLERGEN_ERROR_COPY,
  CONVERSION_ERROR_COPY,
  ITEM_ERROR_COPY,
  ITEM_TYPE_LABEL,
  ITEM_TYPE_ORDER,
  NEGATIVE_LABEL,
  NEGATIVE_ORDER,
  ROUNDING_LABEL,
  ROUNDING_ORDER,
  TRACKING_LABEL,
  TRACKING_ORDER,
  UNIT_LABEL,
  UNIT_ORDER,
  errorText,
} from './inventory-copy.js';
import {
  activeConversionFor,
  allergenCodeValid,
  conversionRatio,
  conversionSummary,
  mergeConversions,
} from './inventory-model.js';

/** The one-line command failure notice. A component, so it stays in this file. */
function CommandNotice({ command, copy, suppress = false }) {
  const { i18n } = useLingui();
  if (suppress || !command.error) return null;
  return (
    <p style={{ color: 'var(--danger)', margin: 0, fontSize: 12.5 }}>
      {errorText(i18n, copy, command.error)}
    </p>
  );
}

/**
 * The item authoring surfaces — the item dialog, its unit-conversion editor and
 * its allergen editor (recipes module plan §7, §11 Phase 1).
 *
 * This file was split out of `inventory-workspace.jsx` by the redesign plan §6,
 * Phase 1. The workspace became a workbench; the editor stayed exactly as it was,
 * so the split is mechanical and the command calls and the error copy are
 * unchanged. Phase 3 replaces the dialog below with a three-step wizard.
 *
 * Every read and write here is gated on `merchant.manage`. The workspace checks
 * the permission before it mounts this file.
 */

/** The house `.switch` class with the ARIA role a toggle needs. */
export function Toggle({ checked, label, onChange }) {
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

export function SinCosto() {
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
      <Trans>Sin costo</Trans>
    </span>
  );
}

export function NoPermissionNotice() {
  return (
    <div className="card" style={{ padding: 18 }}>
      <p style={{ margin: 0, color: 'var(--ink-2)' }}>
        <Trans>No puedes administrar el inventario.</Trans>
      </p>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: 12.5 }}>
        <Trans>
          Pide a la persona propietaria que te dé el permiso para administrar el negocio.
        </Trans>
      </p>
    </div>
  );
}

/**
 * The merchant's own allergen labels. This panel is separate from the item editor
 * because a label outlives any one item, and a rename here changes every item that
 * carries it.
 */
export function AllergenLabelsPanel({ allergens, onSaved }) {
  const { t } = useLingui();
  const command = useAdministrativeCommand();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const valid = allergenCodeValid(code);

  async function create() {
    const wanted = code.trim();
    // THE MERCHANT'S OWN CODE IS THE KEY, so setting a code that already exists is an
    // AMEND and not a create. The server refuses a null version on a row that exists,
    // and that refusal is correct: send the version this list is showing. Without the
    // lookup, retyping a known code to fix its label always answered
    // OPTIMISTIC_VERSION_CONFLICT.
    const existing = allergens.find((entry) => entry.code === wanted) || null;
    await command.execute('inventory.allergen.set', existing ? existing.id : crypto.randomUUID(), {
      targetVersion: existing ? existing.version : null,
      parameters: { code: wanted, label: label.trim(), active: true },
    });
    setCode('');
    setLabel('');
    await onSaved();
  }

  return (
    <section className="card" style={{ display: 'grid', gap: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>
          <Trans>Etiquetas de alérgenos</Trans>
        </h3>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
          <Trans>
            Cada artículo toma etiquetas de esta lista. Usa minúsculas y guion bajo en el código.
          </Trans>
        </p>
      </div>
      {allergens.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          <Trans>Aún no hay etiquetas.</Trans>
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {allergens.map((allergen) => (
            <AllergenLabelRow key={allergen.id} allergen={allergen} onSaved={onSaved} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ flex: '0 1 160px' }}
          value={code}
          maxLength={40}
          placeholder={t`Código`}
          aria-label={t`Código de la etiqueta`}
          onChange={(event) => setCode(event.target.value)}
        />
        <input
          className="input"
          style={{ flex: '1 1 200px' }}
          value={label}
          maxLength={80}
          placeholder={t`Etiqueta`}
          aria-label={t`Nombre de la etiqueta`}
          onChange={(event) => setLabel(event.target.value)}
        />
        <button
          /* Secondary on purpose. The allergen vocabulary is a utility that sits at
             the foot of the inventory screen; the screen's one primary action is
             "Nuevo artículo". Two primaries on one screen is a rule the audit
             checks (R8), and the browser run caught this one. */
          className="btn btn-secondary"
          type="button"
          disabled={command.pending || !valid || label.trim().length === 0}
          onClick={create}
        >
          <Trans>Crear etiqueta</Trans>
        </button>
      </div>
      {code.length > 0 && !valid ? (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          <Trans>El código empieza con una letra y sigue con letras, números o guion bajo.</Trans>
        </p>
      ) : null}
      <CommandNotice command={command} copy={ALLERGEN_ERROR_COPY} />
    </section>
  );
}

function AllergenLabelRow({ allergen, onSaved }) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const [label, setLabel] = useState(allergen.label);
  const [active, setActive] = useState(allergen.active !== false);
  const dirty = label.trim() !== allergen.label || active !== (allergen.active !== false);

  async function save() {
    await command.execute('inventory.allergen.set', allergen.id, {
      targetVersion: allergen.version,
      parameters: { code: allergen.code, label: label.trim(), active },
    });
    await onSaved();
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <code style={{ fontSize: 12, minWidth: 90 }}>{allergen.code}</code>
      <input
        className="input"
        style={{ flex: '1 1 200px' }}
        value={label}
        maxLength={80}
        aria-label={t`Etiqueta de ${allergen.code}`}
        onChange={(event) => setLabel(event.target.value)}
      />
      <Toggle checked={active} label={t`Activa`} onChange={setActive} />
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        disabled={command.pending || !dirty || label.trim().length === 0}
        onClick={save}
      >
        <Trans>Guardar</Trans>
      </button>
      {command.error ? (
        <span style={{ color: 'var(--danger)', fontSize: 12 }}>
          {errorText(i18n, ALLERGEN_ERROR_COPY, command.error)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Unit conversions for one item. The write is an upsert on `fromUnit -> toUnit`,
 * so the form edits the existing active conversion for the pair and its version
 * becomes `targetVersion`. The first set for a pair carries null.
 */
function ConversionsEditor({ item, flatConversions, onSaved }) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const conversions = useMemo(
    () => mergeConversions(item, flatConversions),
    [item, flatConversions],
  );
  const [fromUnit, setFromUnit] = useState(
    () => UNIT_ORDER.find((unit) => unit !== item.baseUnit) || 'unit',
  );
  const [toUnit, setToUnit] = useState(item.baseUnit);
  const [numerator, setNumerator] = useState('1');
  const [denominator, setDenominator] = useState('1');
  const [roundingPolicy, setRoundingPolicy] = useState('exact');

  const draft = {
    fromUnit,
    toUnit,
    numerator,
    denominator,
    targetScale: item.quantityScale,
    roundingPolicy,
  };
  const ratio = conversionRatio(draft);
  const preview = conversionSummary(draft, unitOf);
  const blocked = !ratio || (!ratio.divides && roundingPolicy === 'exact');

  function edit(conversion) {
    setFromUnit(conversion.fromUnit);
    setToUnit(conversion.toUnit);
    setNumerator(String(conversion.numerator));
    setDenominator(String(conversion.denominator));
    setRoundingPolicy(conversion.roundingPolicy || 'exact');
  }

  async function save() {
    const existing = activeConversionFor(conversions, fromUnit, toUnit);
    await command.execute('inventory.conversion.set', item.id, {
      targetVersion: existing?.version ?? null,
      parameters: {
        fromUnit,
        toUnit,
        numerator: Number(numerator),
        denominator: Number(denominator),
        targetScale: item.quantityScale,
        roundingPolicy,
      },
    });
    await onSaved();
  }

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <h4 style={{ margin: 0 }}>
        <Trans>Conversiones de unidad</Trans>
      </h4>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        <Trans>
          Convierte la unidad de compra a la unidad base del artículo. Un gramo a kilogramo se
          escribe 1 y 1000, con escala 3.
        </Trans>
      </p>
      {conversions.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          <Trans>Sin conversiones.</Trans>
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {conversions.map((conversion) => (
            <div
              key={conversion.id}
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {conversionSummary(conversion, unitOf) || conversion.id}
              </span>
              <span className="sub-pill">{i18n._(ROUNDING_LABEL[conversion.roundingPolicy])}</span>
              <button
                className="btn-icon"
                type="button"
                aria-label={t`Editar la conversión de ${unitOf(conversion.fromUnit)} a ${unitOf(conversion.toUnit)}`}
                onClick={() => edit(conversion)}
              >
                <I.Edit size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <Trans>Unidad origen</Trans>
          <Select value={fromUnit} onChange={(event) => setFromUnit(event.target.value)}>
            {UNIT_ORDER.map((unit) => (
              <option key={unit} value={unit}>
                {unitOf(unit)}
              </option>
            ))}
          </Select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <Trans>Unidad destino</Trans>
          <Select value={toUnit} onChange={(event) => setToUnit(event.target.value)}>
            {UNIT_ORDER.map((unit) => (
              <option key={unit} value={unit}>
                {unitOf(unit)}
              </option>
            ))}
          </Select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, width: 110 }}>
          <Trans>Numerador</Trans>
          <input
            className="input"
            inputMode="numeric"
            value={numerator}
            onChange={(event) => setNumerator(event.target.value)}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, width: 110 }}>
          <Trans>Denominador</Trans>
          <input
            className="input"
            inputMode="numeric"
            value={denominator}
            onChange={(event) => setDenominator(event.target.value)}
          />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <Trans>Redondeo</Trans>
          <Select
            value={roundingPolicy}
            onChange={(event) => setRoundingPolicy(event.target.value)}
          >
            {ROUNDING_ORDER.map((policy) => (
              <option key={policy} value={policy}>
                {i18n._(ROUNDING_LABEL[policy])}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        <Trans>Escala del artículo: {item.quantityScale} decimales.</Trans>
      </p>
      {preview ? (
        <p style={{ margin: 0, fontSize: 12.5 }}>{preview}</p>
      ) : (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--danger)' }}>
          <Trans>Escribe el numerador y el denominador como enteros positivos.</Trans>
        </p>
      )}
      {ratio ? (
        <p
          style={{
            margin: 0,
            fontSize: 12.5,
            color: ratio.divides ? 'var(--ink-2)' : 'var(--warning)',
          }}
        >
          {ratio.divides ? (
            <Trans>La conversión da unidades completas a esta escala.</Trans>
          ) : (
            <Trans>
              Las unidades no se dividen exactamente a esta escala. Elige redondear hacia abajo,
              hacia arriba o al más cercano.
            </Trans>
          )}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={command.pending || blocked}
          onClick={save}
        >
          <Trans>Guardar conversión</Trans>
        </button>
        {blocked && ratio ? (
          <span className="muted" style={{ fontSize: 12 }}>
            <Trans>Elige una política de redondeo para guardar.</Trans>
          </span>
        ) : null}
      </div>
      <CommandNotice command={command} copy={CONVERSION_ERROR_COPY} />
    </section>
  );
}

/** The labels on one item, written as a whole set: an empty set clears it. */
function ItemAllergensEditor({ item, allergens, onSaved }) {
  const command = useAdministrativeCommand();
  const known = new Map();
  for (const allergen of allergens) known.set(allergen.id, allergen);
  for (const allergen of item.allergens || []) {
    if (!known.has(allergen.id)) known.set(allergen.id, allergen);
  }
  const options = [...known.values()].filter(
    (allergen) =>
      allergen.active !== false || (item.allergens || []).some((a) => a.id === allergen.id),
  );
  const [selected, setSelected] = useState(() => new Set((item.allergens || []).map((a) => a.id)));
  const [touched, setTouched] = useState(false);

  function toggle(allergenId) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(allergenId)) next.delete(allergenId);
      else next.add(allergenId);
      return next;
    });
    setTouched(true);
  }

  async function save() {
    await command.execute('inventory.item_allergen.set', item.id, {
      targetVersion: item.version,
      parameters: { allergenIds: [...selected] },
    });
    await onSaved();
  }

  return (
    <section style={{ display: 'grid', gap: 10 }}>
      <h4 style={{ margin: 0 }}>
        <Trans>Alérgenos</Trans>
      </h4>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        <Trans>El set completo se guarda. Si quitas todas, el artículo queda sin alérgenos.</Trans>
      </p>
      {options.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          <Trans>Crea primero una etiqueta de alérgeno en la lista.</Trans>
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {options.map((allergen) => (
            <label key={allergen.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={selected.has(allergen.id)}
                onChange={() => toggle(allergen.id)}
              />
              <span>{allergen.label}</span>
            </label>
          ))}
        </div>
      )}
      <div>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={
            command.pending || (!touched && selected.size === (item.allergens || []).length)
          }
          onClick={save}
        >
          <Trans>Guardar alérgenos</Trans>
        </button>
      </div>
      <CommandNotice command={command} copy={ALLERGEN_ERROR_COPY} />
    </section>
  );
}

/**
 * The item editor, following the product editor in operations-workspace.jsx: one
 * modal, the id decided once at open, and `command.execute` for every write.
 */
export function ItemEditor({ item, itemId, flatConversions, allergens, onClose, onSaved }) {
  const { t, i18n } = useLingui();
  const command = useAdministrativeCommand();
  const editing = Boolean(item);
  const [publicReference, setPublicReference] = useState(item?.publicReference || '');
  const [displayName, setDisplayName] = useState(item?.displayName || '');
  const [itemType, setItemType] = useState(item?.itemType || 'ingredient');
  const [baseUnit, setBaseUnit] = useState(item?.baseUnit || 'unit');
  const [quantityScale, setQuantityScale] = useState(String(item?.quantityScale ?? 0));
  const [trackingPolicy, setTrackingPolicy] = useState(item?.trackingPolicy || 'tracked');
  const [negativeStockPolicy, setNegativeStockPolicy] = useState(
    item?.negativeStockPolicy || 'block',
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(
    item?.lowStockThreshold == null ? '' : String(item.lowStockThreshold),
  );
  const [shelfLifeDays, setShelfLifeDays] = useState(
    item?.shelfLifeDays == null ? '' : String(item.shelfLifeDays),
  );
  // PAR is what the kitchen wants on hand. It is not the low-stock threshold: that one
  // is a purchase alarm, this one is what the prep list subtracts from (§8.4).
  const [parQuantity, setParQuantity] = useState(
    item?.parQuantity == null ? '' : String(item.parQuantity),
  );
  const [referenceError, setReferenceError] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const unitOf = (unit) => (UNIT_LABEL[unit] ? i18n._(UNIT_LABEL[unit]) : unit);
  const referenceValid = /^[A-Za-z0-9._:-]{1,80}$/.test(publicReference.trim());

  async function save() {
    setReferenceError(null);
    const optionalThreshold = lowStockThreshold === '' ? null : Number(lowStockThreshold);
    const optionalShelfLife = shelfLifeDays === '' ? null : Number(shelfLifeDays);
    const optionalPar = parQuantity === '' ? null : Number(parQuantity);
    const parameters = editing
      ? {
          displayName: displayName.trim(),
          lowStockThreshold: optionalThreshold,
          shelfLifeDays: optionalShelfLife,
          parQuantity: optionalPar,
          trackingPolicy,
          negativeStockPolicy,
        }
      : {
          publicReference: publicReference.trim(),
          displayName: displayName.trim(),
          itemType,
          baseUnit,
          quantityScale: Number(quantityScale),
          trackingPolicy,
          negativeStockPolicy,
          lowStockThreshold: optionalThreshold,
          shelfLifeDays: optionalShelfLife,
          parQuantity: optionalPar,
        };
    try {
      await command.execute(editing ? 'inventory.item.update' : 'inventory.item.create', itemId, {
        targetVersion: editing ? item.version : null,
        parameters,
      });
      await onSaved();
    } catch (error) {
      if (error?.code === 'INVENTORY_ITEM_REFERENCE_TAKEN') {
        setReferenceError(i18n._(ITEM_ERROR_COPY.INVENTORY_ITEM_REFERENCE_TAKEN));
      }
    }
  }

  async function archive() {
    await command.execute('inventory.item.archive', itemId, {
      targetVersion: item.version,
      parameters: {},
    });
    await onSaved();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={editing ? t`Editar artículo` : t`Nuevo artículo`}
        style={{
          width: 'min(720px, 94vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            {editing ? <Trans>Editar artículo</Trans> : <Trans>Nuevo artículo</Trans>}
          </h3>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 12,
          }}
        >
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Referencia</Trans>
            <input
              className="input"
              value={publicReference}
              maxLength={80}
              disabled={editing}
              onChange={(event) => {
                setPublicReference(event.target.value);
                if (referenceError) setReferenceError(null);
              }}
            />
            {!editing ? (
              <span className="muted" style={{ fontSize: 11.5 }}>
                <Trans>La API rechaza una referencia repetida.</Trans>
              </span>
            ) : null}
            {referenceError ? (
              <span style={{ color: 'var(--danger)', fontSize: 11.5 }}>{referenceError}</span>
            ) : null}
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Nombre</Trans>
            <input
              className="input"
              value={displayName}
              maxLength={160}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Tipo</Trans>
            <Select
              value={itemType}
              disabled={editing}
              onChange={(event) => setItemType(event.target.value)}
            >
              {ITEM_TYPE_ORDER.map((type) => (
                <option key={type} value={type}>
                  {i18n._(ITEM_TYPE_LABEL[type])}
                </option>
              ))}
            </Select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Unidad base</Trans>
            <Select
              value={baseUnit}
              disabled={editing}
              onChange={(event) => setBaseUnit(event.target.value)}
            >
              {UNIT_ORDER.map((unit) => (
                <option key={unit} value={unit}>
                  {unitOf(unit)}
                </option>
              ))}
            </Select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Decimales de cantidad</Trans>
            <Select
              value={quantityScale}
              disabled={editing}
              onChange={(event) => setQuantityScale(event.target.value)}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={String(value)}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Política de inventario</Trans>
            <Select
              value={trackingPolicy}
              onChange={(event) => setTrackingPolicy(event.target.value)}
            >
              {TRACKING_ORDER.map((policy) => (
                <option key={policy} value={policy}>
                  {i18n._(TRACKING_LABEL[policy])}
                </option>
              ))}
            </Select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Existencia negativa</Trans>
            <Select
              value={negativeStockPolicy}
              onChange={(event) => setNegativeStockPolicy(event.target.value)}
            >
              {NEGATIVE_ORDER.map((policy) => (
                <option key={policy} value={policy}>
                  {i18n._(NEGATIVE_LABEL[policy])}
                </option>
              ))}
            </Select>
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Umbral de stock bajo</Trans>
            <input
              className="input"
              inputMode="numeric"
              value={lowStockThreshold}
              placeholder={t`Sin umbral`}
              onChange={(event) => setLowStockThreshold(event.target.value)}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              <Trans>En la escala del artículo. 0 se guarda como un umbral real.</Trans>
            </span>
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
          <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
            <Trans>Par de preparación</Trans>
            <input
              className="input"
              inputMode="numeric"
              value={parQuantity}
              placeholder={t`Sin par`}
              onChange={(event) => setParQuantity(event.target.value)}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              <Trans>En la escala del artículo. La lista de preparación lo resta.</Trans>
            </span>
          </label>
        </div>

        {editing ? (
          <>
            <ConversionsEditor item={item} flatConversions={flatConversions} onSaved={onSaved} />
            <ItemAllergensEditor item={item} allergens={allergens} onSaved={onSaved} />
          </>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            <Trans>Guarda el artículo para agregar conversiones y alérgenos.</Trans>
          </p>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              command.pending || displayName.trim().length === 0 || (!editing && !referenceValid)
            }
            onClick={save}
          >
            <Trans>Guardar</Trans>
          </button>
          {editing && item.active !== false ? (
            confirmArchive ? (
              <>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={command.pending}
                  onClick={archive}
                >
                  <Trans>Confirmar archivo</Trans>
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                >
                  <Trans>Cancelar</Trans>
                </button>
              </>
            ) : (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={command.pending}
                onClick={() => setConfirmArchive(true)}
              >
                <Trans>Archivar</Trans>
              </button>
            )
          ) : null}
          <span className="muted" style={{ fontSize: 11.5 }}>
            <Trans>La vida útil y el umbral se guardan en la escala del artículo.</Trans>
          </span>
        </div>

        <CommandNotice
          command={command}
          copy={ITEM_ERROR_COPY}
          suppress={Boolean(referenceError)}
        />
      </section>
    </div>
  );
}
