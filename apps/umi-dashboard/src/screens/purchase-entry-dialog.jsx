import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { fetchPurchaseEntrySnapshot, sendPurchaseEntryAttempt } from '@/data.jsx';
import { localeTag } from '@/lib/i18n.js';
import { formatScaled } from './inventory-model.js';
import { buildPurchaseEntry, formatPurchaseMoney } from './purchase-entry-model.js';
import { preparePurchasePhoto } from './purchase-entry-photo.js';
import {
  preparePurchaseAttempt,
  readPurchaseAttempt,
  runPurchaseAttempt,
  clearPurchaseAttempt,
} from './purchase-entry-session.js';
import './purchase-entry.css';
const emptyRow = () => ({ inventoryItemId: '', quantityText: '', costText: '' });
export default function PurchaseEntryDialog({ invoice = null, onClose, onSaved }) {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const merchantId = merchant.selectedMerchantId;
  const locationId = merchant.selectedLocationId || merchant.selectedLocation?.id || null;
  const [scope] = useState({ merchantId, locationId });
  const active = useRef(true);
  useLayoutEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const dialog = useRef(null);
  const photoAbort = useRef(null);
  const fileRef = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  const [draft, setDraft] = useState({
    issuedOn: '',
    inventoryLocationId: '',
    supplierId: '',
    folio: '',
    note: '',
    lines: [emptyRow()],
  });
  const [photo, setPhoto] = useState(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [pending, setPending] = useState(false);
  const changed = scope.merchantId !== merchantId || scope.locationId !== locationId;
  useEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    node.showModal();
    return () => {
      node.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    active.current = true;
    let canceled = false;
    Promise.resolve().then(() => {
      if (canceled) return;
      try {
        const prior = readPurchaseAttempt({
          merchantId: scope.merchantId,
          storage: window.sessionStorage,
        });
        if (prior) setAttempt(prior);
      } catch {
        setError(t`No se pudo recuperar la compra. Conserva esta pestaña y pide ayuda.`);
        return;
      }
      return fetchPurchaseEntrySnapshot(scope.merchantId, scope.locationId).then(
        (s) => {
          if (canceled) return;
          setSnapshot(s);
          setDraft((d) => ({
            ...d,
            issuedOn: invoice?.issuedOn || s.context.businessDate,
            inventoryLocationId:
              s.context.inventoryLocations.length === 1 ? s.context.inventoryLocations[0].id : '',
          }));
        },
        () => {
          if (!canceled)
            setError(
              t`No se pudieron cargar los artículos, proveedores o destinos. Cierra y vuelve a intentar.`,
            );
        },
      );
    });
    return () => {
      canceled = true;
      active.current = false;
      photoAbort.current?.abort();
    };
  }, [invoice, t, scope]);
  useEffect(() => {
    if (changed) {
      photoAbort.current?.abort();
      onClose();
    }
  }, [changed, onClose]);
  const built = buildPurchaseEntry({ draft, snapshot });
  function patch(values) {
    setDraft((d) => ({ ...d, ...values }));
    setReview(null);
    setError('');
  }
  function rowPatch(index, values) {
    patch({ lines: draft.lines.map((row, i) => (i === index ? { ...row, ...values } : row)) });
  }
  function close() {
    photoAbort.current?.abort();
    onClose();
  }
  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    photoAbort.current?.abort();
    const controller = new AbortController();
    photoAbort.current = controller;
    setPhoto(null);
    patch({ artifactBase64: undefined });
    setPhotoBusy(true);
    setPhotoError('');
    try {
      const result = await preparePurchasePhoto(file, { signal: controller.signal });
      if (active.current && !controller.signal.aborted) {
        setPhoto(result);
        patch({ artifactBase64: result.artifactBase64 });
      }
    } catch (e) {
      if (e.name !== 'AbortError' && active.current) setPhotoError(e.message);
    } finally {
      if (active.current && !controller.signal.aborted) setPhotoBusy(false);
    }
  }
  function reviewPurchase() {
    if (!snapshot || changed || photoBusy || photoError) return;
    if (invoice) {
      if (!snapshot.context.inventoryLocations.some((d) => d.id === draft.inventoryLocationId)) {
        setError(t`Elige dónde entra el inventario.`);
        return;
      }
      if (
        !invoice.lines?.length ||
        invoice.lines.length > 1000 ||
        invoice.lines.some(
          (l) =>
            !snapshot.items.some(
              (i) =>
                i.id === l.matchedInventoryItemId &&
                i.active !== false &&
                !i.isArchived &&
                !i.archivedAt,
            ),
        ) ||
        new Set(invoice.lines.map((l) => l.matchedInventoryItemId)).size > 100
      ) {
        setError(t`Asigna un artículo activo a cada línea antes de registrar la compra.`);
        return;
      }
      setReview({
        locationId: scope.locationId,
        inventoryLocationId: draft.inventoryLocationId,
        note: draft.note.trim() || null,
      });
    } else if (built.errors.length) setError(built.errors.map((e) => i18n._(e)).join(' '));
    else setReview(structuredClone(built.parameters));
  }
  async function save(existing = null) {
    if (pending || changed) return;
    setError('');
    setPending(true);
    try {
      let a = existing;
      if (!a) {
        if (!review || !snapshot) return;
        a = preparePurchaseAttempt({
          merchantId: scope.merchantId,
          locationId: scope.locationId,
          operation: invoice ? 'inventory.invoice.receive_direct' : 'inventory.purchase.record',
          targetId: invoice?.id,
          parameters: review,
          summary: {
            branchName:
              merchant.selectedLocation?.displayName ||
              merchant.selectedLocation?.name ||
              t`Sucursal original`,
            destinationName: snapshot.context.inventoryLocations.find(
              (d) => d.id === review.inventoryLocationId,
            )?.displayName,
            date: invoice?.issuedOn || review.issuedOn,
            currency: snapshot.context.currency,
            totalMinor: invoice?.totalMinor ?? built.totalMinor,
            lines: invoice
              ? invoice.lines.map((l) => ({
                  name: l.matchedInventoryItemName || l.rawDescription,
                  quantity: l.quantity,
                  unitCostMinor: l.unitCostMinor,
                }))
              : review.lines.map((l) => ({
                  ...l,
                  name: snapshot.items.find((i) => i.id === l.inventoryItemId)?.displayName,
                })),
          },
          storage: window.sessionStorage,
        });
      }
      setAttempt(a);
      const result = await runPurchaseAttempt({
        attempt: a,
        storage: window.sessionStorage,
        send: sendPurchaseEntryAttempt,
      });
      if (active.current) {
        setAttempt(result);
        if (result.state === 'succeeded') {
          setPhoto(null);
          setDraft((d) => ({ ...d, artifactBase64: undefined }));
          setReview(null);
          onSaved(scope);
        } else
          setError(
            result.state === 'ambiguous'
              ? t`No se pudo confirmar el resultado. Reintenta esta misma compra.`
              : t`No se pudo guardar la compra. Revisa los datos y los permisos antes de corregirla.`,
          );
      }
    } catch {
      if (active.current)
        setError(
          t`No se pudo conservar o enviar la compra. Conserva esta pestaña y vuelve a intentar.`,
        );
    } finally {
      if (active.current) setPending(false);
    }
  }
  async function resolved() {
    try {
      clearPurchaseAttempt({ merchantId: scope.merchantId, storage: window.sessionStorage });
      const rejected = attempt?.state === 'rejected';
      setAttempt(null);
      setReview(null);
      if (!rejected) {
        setPhoto(null);
        patch({ artifactBase64: undefined });
      }
      setError('');
      if (rejected) {
        setSnapshot(null);
        try {
          const fresh = await fetchPurchaseEntrySnapshot(scope.merchantId, scope.locationId);
          if (active.current) setSnapshot(fresh);
        } catch {
          if (active.current)
            setError(
              t`No se pudieron cargar los artículos, proveedores o destinos. Cierra y vuelve a intentar.`,
            );
        }
      }
    } catch {
      setError(t`Reintenta la compra pendiente antes de continuar.`);
    }
  }
  const locked = Boolean(attempt);
  const money = (n) =>
    formatPurchaseMoney(
      n,
      snapshot?.context.currency || invoice?.currency || 'MXN',
      localeTag(i18n.locale),
    );
  const units = {
    unit: t`pza`,
    gram: t`g`,
    kilogram: t`kg`,
    milliliter: t`ml`,
    liter: t`L`,
    portion: t`porción`,
    package: t`paquete`,
    box: t`caja`,
  };
  return (
    <dialog
      ref={dialog}
      className="purchase-entry card"
      aria-labelledby="purchase-entry-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="purchase-entry-heading">
        <h2 id="purchase-entry-title">
          {invoice ? <Trans>Registrar compra del XML</Trans> : <Trans>Registrar compra</Trans>}
        </h2>
        <button className="btn btn-secondary" type="button" onClick={close}>
          <Trans>Cerrar</Trans>
        </button>
      </div>
      {attempt ? (
        <section className="purchase-entry-fields" aria-label={t`Compra pendiente`}>
          <p>
            {attempt.state === 'succeeded' ? (
              <Trans>La compra quedó registrada.</Trans>
            ) : attempt.state === 'rejected' ? (
              <Trans>La compra no se guardó. Puedes corregir los datos.</Trans>
            ) : (
              <Trans>
                Hay una compra pendiente en esta pestaña. Revisa sus datos antes de continuar.
              </Trans>
            )}
          </p>
          {attempt.envelope ? (
            <>
              <p>
                <Trans>Sucursal</Trans>: {attempt.summary?.branchName || t`Sucursal original`} ·{' '}
                <Trans>Destino</Trans>: {attempt.summary?.destinationName || t`Destino original`}
              </p>
              <p>
                {attempt.summary?.date || attempt.envelope.parameters.issuedOn} ·{' '}
                {attempt.summary?.lines?.length || attempt.envelope.parameters.lines?.length || ''}{' '}
                <Trans>filas</Trans>
              </p>
              {attempt.summary?.lines?.map((line, index) => (
                <p key={index}>
                  {line.name || t`Artículo de la compra original`} ·{' '}
                  {formatScaled(line.quantity.value, line.quantity.scale)}{' '}
                  {units[line.quantity.unit] || line.quantity.unit} ·{' '}
                  {formatPurchaseMoney(
                    line.unitCostMinor,
                    attempt.summary.currency,
                    localeTag(i18n.locale),
                  )}
                </p>
              ))}
              {attempt.summary?.totalMinor != null ? (
                <strong>
                  <Trans>Total</Trans>:{' '}
                  {formatPurchaseMoney(
                    attempt.summary.totalMinor,
                    attempt.summary.currency,
                    localeTag(i18n.locale),
                  )}
                </strong>
              ) : null}
              {attempt.envelope.parameters.artifactBase64 ? (
                <img
                  className="purchase-entry-photo"
                  alt={t`Comprobante de la compra pendiente`}
                  src={`data:${attempt.envelope.parameters.artifactBase64.startsWith('iVBOR') ? 'image/png' : attempt.envelope.parameters.artifactBase64.startsWith('UklG') ? 'image/webp' : 'image/jpeg'};base64,${attempt.envelope.parameters.artifactBase64}`}
                />
              ) : null}
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || changed}
                onClick={() => save(attempt)}
              >
                {pending ? <Trans>Guardando…</Trans> : <Trans>Reintentar la misma compra</Trans>}
              </button>
              {attempt.state === 'prepared' ? (
                <button type="button" className="btn btn-secondary" onClick={resolved}>
                  <Trans>Descartar compra sin enviar</Trans>
                </button>
              ) : null}
            </>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              onClick={
                attempt.state === 'succeeded'
                  ? () => {
                      resolved();
                      close();
                    }
                  : resolved
              }
            >
              {attempt.state === 'succeeded' ? (
                <Trans>Cerrar compra</Trans>
              ) : (
                <Trans>Corregir compra</Trans>
              )}
            </button>
          )}
        </section>
      ) : null}
      {!snapshot && !error ? (
        <p>
          <Trans>Cargando artículos, proveedores y destinos…</Trans>
        </p>
      ) : null}
      {snapshot && !locked ? (
        <>
          <fieldset disabled={pending || Boolean(review)} className="purchase-entry-fields">
            <div className="purchase-entry-grid">
              <label>
                <Trans>Fecha de compra</Trans>
                <input
                  className="input"
                  type="date"
                  aria-label={t`Fecha de compra`}
                  value={draft.issuedOn}
                  disabled={Boolean(invoice)}
                  onChange={(e) => patch({ issuedOn: e.target.value })}
                />
              </label>
              <label>
                <Trans>Dónde entra el inventario</Trans>
                <select
                  className="input"
                  aria-label={t`Dónde entra el inventario`}
                  value={draft.inventoryLocationId}
                  onChange={(e) => patch({ inventoryLocationId: e.target.value })}
                >
                  <option value="">{t`Elige un destino`}</option>
                  {snapshot.context.inventoryLocations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!invoice ? (
              <>
                {draft.lines.map((row, index) => {
                  const item = snapshot.items.find((i) => i.id === row.inventoryItemId);
                  const line = buildPurchaseEntry({ draft: { ...draft, lines: [row] }, snapshot });
                  return (
                    <section
                      key={index}
                      className="purchase-entry-row"
                      aria-label={t`Fila ${index + 1}`}
                    >
                      <label>
                        <Trans>Artículo</Trans>
                        <select
                          className="input"
                          aria-label={t`Artículo ${index + 1}`}
                          value={row.inventoryItemId}
                          onChange={(e) =>
                            rowPatch(index, { inventoryItemId: e.target.value, quantityText: '' })
                          }
                        >
                          <option value="">{t`Elige un artículo`}</option>
                          {snapshot.items
                            .filter((i) => i.active !== false && !i.isArchived && !i.archivedAt)
                            .map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        <Trans>Cantidad</Trans>
                        <input
                          className="input"
                          inputMode="decimal"
                          aria-label={t`Cantidad ${index + 1}`}
                          value={row.quantityText}
                          onChange={(e) => rowPatch(index, { quantityText: e.target.value })}
                        />
                        <span>
                          {units[item?.baseUnit] || item?.baseUnit || t`Unidad del artículo`}
                        </span>
                      </label>
                      <label>
                        <Trans>Costo por unidad</Trans>
                        <input
                          className="input"
                          inputMode="decimal"
                          aria-label={t`Costo por unidad ${index + 1}`}
                          value={row.costText}
                          onChange={(e) => rowPatch(index, { costText: e.target.value })}
                        />
                        <span>{line.parameters ? money(line.totalMinor) : '—'}</span>
                      </label>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        aria-label={t`Quitar fila ${index + 1}`}
                        disabled={draft.lines.length === 1}
                        onClick={() => patch({ lines: draft.lines.filter((_, i) => i !== index) })}
                      >
                        <Trans>Quitar</Trans>
                      </button>
                    </section>
                  );
                })}
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={draft.lines.length >= 100}
                  onClick={() => patch({ lines: [...draft.lines, emptyRow()] })}
                >
                  <Trans>Agregar fila</Trans>
                </button>
                <div className="purchase-entry-grid">
                  <label>
                    <Trans>Proveedor (opcional)</Trans>
                    <select
                      className="input"
                      aria-label={t`Proveedor (opcional)`}
                      value={draft.supplierId}
                      onChange={(e) => patch({ supplierId: e.target.value })}
                    >
                      <option value="">{t`Sin proveedor`}</option>
                      {snapshot.suppliers
                        .filter((s) => s.active !== false && !s.isArchived && !s.archivedAt)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.displayName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    <Trans>Referencia (opcional)</Trans>
                    <input
                      className="input"
                      maxLength={80}
                      value={draft.folio}
                      onChange={(e) => patch({ folio: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  <Trans>Foto del comprobante (opcional)</Trans>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={selectPhoto}
                  />
                </label>
                {photoBusy ? (
                  <p>
                    <Trans>Preparando la foto…</Trans>
                  </p>
                ) : null}
                {photo ? (
                  <>
                    <img
                      className="purchase-entry-photo"
                      src={photo.preview}
                      alt={t`Vista previa del comprobante`}
                    />
                    <p>
                      <Trans>Revisa que la foto se pueda leer antes de guardar.</Trans>
                    </p>
                  </>
                ) : null}
                {photo || photoError || photoBusy ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      photoAbort.current?.abort();
                      setPhotoBusy(false);
                      setPhoto(null);
                      setPhotoError('');
                      fileRef.current?.focus();
                      patch({ artifactBase64: undefined });
                    }}
                  >
                    <Trans>Quitar foto</Trans>
                  </button>
                ) : null}
              </>
            ) : (
              <div>
                {invoice.lines.map((line) => (
                  <p key={line.id}>
                    {line.matchedInventoryItemName || line.rawDescription} ·{' '}
                    {formatScaled(line.quantity.value, line.quantity.scale)}{' '}
                    {units[line.quantity.unit] || line.quantity.unit} · {money(line.unitCostMinor)}
                  </p>
                ))}
              </div>
            )}
            <label>
              <Trans>Nota (opcional)</Trans>
              <textarea
                className="input"
                maxLength={240}
                value={draft.note}
                onChange={(e) => patch({ note: e.target.value })}
              />
            </label>
          </fieldset>
          <strong>
            <Trans>Total</Trans>: {money(invoice ? invoice.totalMinor : built.totalMinor || 0)}
          </strong>
          {review ? (
            <p>
              <Trans>
                Revisa la fecha, el destino, los artículos y el total. Guarda para registrar la
                entrada.
              </Trans>
            </p>
          ) : null}
        </>
      ) : null}
      {photoError ? (
        <p role="alert" className="purchase-entry-error">
          {photoError}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="purchase-entry-error">
          {error}
        </p>
      ) : null}
      <div className="purchase-entry-actions">
        <div className="purchase-entry-secondary-actions">
          <button className="btn btn-secondary" type="button" onClick={close}>
            <Trans>Cancelar</Trans>
          </button>
          {review && !attempt ? (
            <button className="btn btn-secondary" type="button" onClick={() => setReview(null)}>
              <Trans>Editar compra</Trans>
            </button>
          ) : null}
        </div>
        {snapshot && !attempt ? (
          review ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={pending || changed}
              autoFocus
              onClick={() => save()}
            >
              <Trans>Guardar compra</Trans>
            </button>
          ) : (
            <button
              className="btn btn-primary"
              type="button"
              disabled={photoBusy || Boolean(photoError) || changed}
              onClick={reviewPurchase}
            >
              <Trans>Revisar compra</Trans>
            </button>
          )
        ) : null}
      </div>
    </dialog>
  );
}
