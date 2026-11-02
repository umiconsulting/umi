import { useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { COLUMN_DEFINITIONS, GUIDE_COPY } from '@/lib/inventory-import/copy.js';
import { runImportFileTask } from '@/lib/inventory-import/file-client.js';
import { importBatchResultRows } from '@/lib/inventory-import/runner.js';
import { importErrorText, localizeImportResultRows } from '@/lib/inventory-import/display.js';

export default function InventoryImportDownloads({ kind, snapshot, batch }) {
  const { t, i18n } = useLingui();
  const [format, setFormat] = useState('xlsx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const task = useRef(null);
  useEffect(() => () => task.current?.abort(), []);
  async function download(purpose) {
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setError(null);
    const labels = {
      columns: Object.fromEntries(
        Object.entries(COLUMN_DEFINITIONS).map(([key, value]) => [key, i18n._(value)]),
      ),
      headings: Object.fromEntries(
        ['field', 'required', 'description', 'example'].map((key) => [
          key,
          i18n._(GUIDE_COPY[key]),
        ]),
      ),
      required: i18n._(GUIDE_COPY.requiredValue),
      optional: i18n._(GUIDE_COPY.optional),
      instructions: i18n._(GUIDE_COPY.instructions),
    };
    try {
      const result = await runImportFileTask(
        'build',
        {
          kind,
          format,
          purpose,
          labels,
          references: {
            items: snapshot?.items.filter(
              (item) => !item.archived && !item.archivedAt && item.active !== false,
            ),
            targets: snapshot?.targets,
          },
          results: batch ? localizeImportResultRows(i18n, importBatchResultRows(batch)) : [],
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.code || 'WORKER_FAILED');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div>
      <div className="inventory-import-actions">
        <label className="inventory-import-format">
          <Trans>Formato de descarga</Trans>
          <select
            className="input"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
            disabled={busy}
          >
            <option value="xlsx">
              <Trans>Excel (.xlsx)</Trans>
            </option>
            <option value="csv">CSV</option>
          </select>
        </label>
        {batch ? (
          <button
            className="btn btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => download('results')}
          >
            <Trans>Descargar resultado</Trans>
          </button>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => download('template')}
            >
              <Trans>Descargar plantilla</Trans>
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => download('guide')}
            >
              <Trans>Descargar guía</Trans>
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy}
              onClick={() => download('examples')}
            >
              <Trans>Descargar ejemplos</Trans>
            </button>
            <button
              className="btn btn-secondary"
              type="button"
              disabled={busy || !snapshot}
              onClick={() => download('references')}
            >
              <Trans>Descargar códigos</Trans>
            </button>
          </>
        )}
      </div>
      {busy && <p role="status">{t`Preparando descarga…`}</p>}
      {error && <p role="alert">{importErrorText(i18n, error)}</p>}
    </div>
  );
}
