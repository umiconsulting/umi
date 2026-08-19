import React, { useState } from 'react';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
import { useGiftCardsData } from '@/data.jsx';

const GiftCardsScreen = () => {
  const [page, setPage] = useState(1);
  const { data, loading } = useGiftCardsData({ page });
  const cards = data?.giftCards || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const openTotal = cards
    .filter((card) => !card.isRedeemed)
    .reduce((sum, card) => sum + (card.amountCentavos || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title="Tarjetas de regalo"
        note={loading ? 'Cargando…' : 'Emitidas desde Umi Cash.'}
        count={{ value: total.toLocaleString('es-MX'), label: 'emitidas' }}
      />

      <div className="grid grid-2" style={{ gap: 14 }}>
        <div className="strip-metric">
          <div>
            <div className="lbl">Abiertas</div>
            <div className="en">Saldo abierto en esta página</div>
          </div>
          <div className="val">$ {(openTotal / 100).toLocaleString('es-MX')}</div>
          <span className="delta-mini up">{cards.filter((c) => !c.isRedeemed).length}</span>
        </div>
        <div className="strip-metric">
          <div>
            <div className="lbl">Canjeadas</div>
            <div className="en">Canjeado en esta página</div>
          </div>
          <div className="val">{cards.filter((c) => c.isRedeemed).length}</div>
          <span className="delta-mini">{cards.length} shown</span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="matrix">
          <thead>
            <tr>
              <th>Code</th>
              <th>Recipient</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th>Estado</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 && !loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)' }}>
                  No hay tarjetas de regalo emitidas.
                </td>
              </tr>
            )}
            {cards.map((card) => (
              <tr key={card.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{card.code}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{card.recipientName || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {card.recipientEmail || card.recipientPhone || 'No contact'}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{card.amountMXN}</td>
                <td>
                  <span className={'badge ' + (card.isRedeemed ? 'badge-staff' : 'badge-admin')}>
                    {card.isRedeemed ? 'REDEEMED' : 'OPEN'}
                  </span>
                </td>
                <td style={{ color: 'var(--ink-2)' }}>
                  {card.createdAt
                    ? new Date(card.createdAt).toLocaleDateString('es-MX', {
                        day: 'numeric',
                        month: 'short',
                      })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <I.ChevronLeft size={14} /> Anterior
          </button>
          <span
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)', alignSelf: 'center' }}
          >
            {page} / {totalPages}
          </span>
          <button
            className="btn btn-ghost btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Siguiente <I.ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default GiftCardsScreen;
