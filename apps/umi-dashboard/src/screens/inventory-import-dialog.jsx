import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { hasRequiredPermission } from '@/lib/module-registry.js';
import { importErrorText, importStatusText } from '@/lib/inventory-import/display.js';
import { useInventoryImportController } from './inventory-import-controller.js';
import InventoryImportDownloads from './inventory-import-downloads.jsx';
import InventoryImportTable from './inventory-import-table.jsx';
import './inventory-import.css';

export default function InventoryImportDialog({ kind, onClose, onSaved }) {
  const { t, i18n } = useLingui();
  const merchant = useMerchant();
  const merchantId = merchant?.selectedMerchantId || merchant?.capabilities?.merchant?.id;
  const locationId =
    merchant?.selectedLocationId || merchant?.capabilities?.selectedLocation?.id || null;
  const canManage = hasRequiredPermission(
    { permissions: ['merchant.manage'] },
    merchant?.capabilities,
  );
  const flow = useInventoryImportController({
    merchantId,
    locationId,
    kind,
    canManage,
    onClose,
    onSaved,
  });
  const dialogRef = useRef(null);
  const title = kind === 'items' ? t`Importar artículos` : t`Importar recetas`;
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog.showModal();
    dialog.focus();
    const trap = (event) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...dialog.querySelectorAll(
          // eslint-disable-next-line lingui/no-unlocalized-strings -- Native focus selector.
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary',
        ),
      ];
      const first = controls[0];
      const last = controls.at(-1);
      if (
        document.activeElement === dialog ||
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    dialog.addEventListener('keydown', trap);
    return () => {
      dialog.removeEventListener('keydown', trap);
      dialog.close();
      previous?.focus();
    };
  }, []);
  const batch = flow.batch;
  const count = (flow.preview?.counts.new || 0) + (flow.preview?.counts.update || 0);
  const unresolved = batch?.entries.some((entry) =>
    ['sending', 'ambiguous'].includes(entry.executionStatus),
  );
  const retryable = batch?.entries.some((entry) =>
    ['pending', 'ambiguous', 'retryable'].includes(entry.executionStatus),
  );
  const successCount =
    batch?.entries.filter((entry) => entry.executionStatus === 'success').length || 0;
  return createPortal(
    <dialog
      ref={dialogRef}
      className="inventory-import-dialog"
      tabIndex={-1}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        flow.close();
      }}
    >
      <header>
        <h2>{title}</h2>
      </header>
      <div className="inventory-import-body">
        <p>
          <Trans>Revisa el archivo antes de confirmar.</Trans>
        </p>
        <p>
          {kind === 'items' ? (
            <Trans>Si el código ya existe, se actualizará ese artículo.</Trans>
          ) : (
            <Trans>Si el producto y la variante ya tienen receta, se actualizará esa receta.</Trans>
          )}
        </p>
        <p className="muted">
          <Trans>Registra las entradas en Compras o Ajustar existencia.</Trans>
        </p>
        {flow.loading && (
          <p role="status">
            <Trans>Cargando referencias…</Trans>
          </p>
        )}
        {flow.error && <p role="alert">{importErrorText(i18n, flow.error)}</p>}
        {!flow.loading && !flow.snapshot && (
          <p role="alert">
            <Trans>
              No se pudieron cargar las referencias. Cierra y vuelve a abrir la importación.
            </Trans>
          </p>
        )}
        <InventoryImportDownloads kind={kind} snapshot={flow.snapshot} batch={batch} />
        {batch ? (
          <>
            <p role="status">{t`${successCount} registros guardados de ${batch.entries.filter((entry) => entry.command).length}.`}</p>
            <p>
              <Trans>
                Hay un informe guardado en este navegador. Revisa sus resultados antes de elegir
                otro archivo.
              </Trans>
            </p>
            <p>
              <Trans>
                Detener pendientes conserva los registros guardados. Al cerrar, la operación actual
                puede terminar; las demás quedan pendientes.
              </Trans>
            </p>
            {unresolved && (
              <p>
                <Trans>
                  Falta confirmar una operación. Reintenta este mismo informe para consultar su
                  resultado sin duplicar registros.
                </Trans>
              </p>
            )}
            <InventoryImportTable entries={batch.entries} executed />
            <p>
              <Trans>
                Nueva importación descarta las filas pendientes y conserva los registros guardados.
              </Trans>
            </p>
          </>
        ) : (
          <>
            <details>
              <summary>
                <Trans>Cómo llenar el archivo</Trans>
              </summary>
              <p>
                <Trans>
                  Usa la hoja de datos vacía. Excel incluye la guía, los ejemplos y las referencias
                  en otras hojas. En CSV se descargan por separado.
                </Trans>
              </p>
              <p>
                <Trans>
                  Los campos de código distinguen mayúsculas y minúsculas. Conserva los ceros
                  iniciales. Copia los ID y códigos de las referencias.
                </Trans>
              </p>
              <p>
                <Trans>
                  Usa punto decimal y celdas de texto. No uses fórmulas ni notación científica.
                </Trans>
              </p>
              <p>
                <Trans>Límite: 2 MiB, 500 filas, 100 recetas y 200 ingredientes por receta.</Trans>
              </p>
            </details>
            <div className="inventory-import-file">
              <label className="inventory-import-picker btn btn-secondary">
                <Trans>Elegir archivo</Trans>
                <input
                  type="file"
                  aria-label={t`Elegir archivo`}
                  accept=".csv,.xlsx"
                  disabled={flow.loading || flow.working || !flow.snapshot || flow.recoveryFailed}
                  onChange={(event) => flow.chooseFile(event.target.files?.[0] || null)}
                />
              </label>
              <span className="inventory-import-filename" role="status">
                {flow.file?.name || t`Ningún archivo elegido`}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  !flow.file ||
                  flow.loading ||
                  flow.working ||
                  !flow.snapshot ||
                  flow.recoveryFailed
                }
                onClick={flow.review}
              >
                <Trans>Revisar archivo</Trans>
              </button>
            </div>
            {flow.working && (
              <p role="status">
                <Trans>Revisando archivo…</Trans>
              </p>
            )}
            {flow.preview && (
              <>
                <dl className="inventory-import-counts">
                  {Object.entries(flow.preview.counts).map(([status, value]) => (
                    <div key={status}>
                      <dt>{importStatusText(i18n, status)}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <InventoryImportTable key={flow.file?.name} entries={flow.preview.entries} />
                {kind === 'recipes' && (
                  <p>
                    <Trans>
                      Al actualizar una receta, todos sus ingredientes se reemplazan por los del
                      archivo. Una receta con errores no se importa.
                    </Trans>
                  </p>
                )}
                <p>
                  <Trans>
                    Solo se guardarán los registros nuevos o con cambios que no tengan errores.
                  </Trans>
                </p>
              </>
            )}
          </>
        )}
      </div>
      <footer className="inventory-import-actions">
        <button type="button" className="btn btn-secondary" onClick={flow.close}>
          {batch ? t`Cerrar` : t`Cancelar`}
        </button>
        {batch ? (
          <>
            {flow.running ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={flow.stop}
                disabled={flow.stopped}
              >
                <Trans>Detener pendientes</Trans>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={!retryable || flow.recoveryFailed || !flow.active}
                onClick={() => flow.run(batch)}
              >
                <Trans>Reintentar pendientes</Trans>
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={flow.running || unresolved || flow.recoveryFailed || !flow.active}
              onClick={flow.discard}
            >
              <Trans>Nueva importación</Trans>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              !count ||
              flow.loading ||
              flow.working ||
              !flow.snapshot ||
              flow.recoveryFailed ||
              !flow.active
            }
            onClick={flow.confirm}
          >
            {kind === 'items' ? (
              <Plural value={count} one="Importar # artículo" other="Importar # artículos" />
            ) : (
              <Plural value={count} one="Importar # receta" other="Importar # recetas" />
            )}
          </button>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
