import { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { importErrorText, importStatusText } from '@/lib/inventory-import/display.js';

export default function InventoryImportTable({ entries, executed = false }) {
  const { t, i18n } = useLingui();
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(entries.length / 20));
  const index = Math.min(page, pages - 1);
  return (
    <div className="inventory-import-preview">
      <div className="inventory-import-table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <Trans>Filas</Trans>
              </th>
              <th>
                <Trans>Estado</Trans>
              </th>
              <th>
                <Trans>Nombre y código</Trans>
              </th>
              <th>
                <Trans>Revisión</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(index * 20, (index + 1) * 20).map((entry) => (
              <tr key={entry.key}>
                <td>{entry.rowNumbers.join(', ')}</td>
                <td>
                  {importStatusText(
                    i18n,
                    executed && entry.executionStatus !== 'skipped'
                      ? entry.executionStatus
                      : entry.status,
                  )}
                </td>
                <td>
                  <strong>{entry.label || entry.reference}</strong>
                  {entry.label && <div className="muted">{entry.reference}</div>}
                </td>
                <td>
                  {entry.result?.code
                    ? importErrorText(i18n, entry.result.code)
                    : entry.errors.map((error, i) => (
                        <div key={i}>
                          {t`Fila ${error.rowNumber}`}
                          {error.column ? ` · ${error.column}` : ''}:{' '}
                          {importErrorText(i18n, error.code)}
                        </div>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <nav className="inventory-import-actions" aria-label={t`Páginas de la revisión`}>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={index === 0}
            onClick={() => setPage(index - 1)}
          >
            <Trans>Anterior</Trans>
          </button>
          <span>{t`Página ${index + 1} de ${pages}`}</span>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={index + 1 === pages}
            onClick={() => setPage(index + 1)}
          >
            <Trans>Siguiente</Trans>
          </button>
        </nav>
      )}
    </div>
  );
}
