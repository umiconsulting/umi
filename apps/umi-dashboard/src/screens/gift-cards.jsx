import React, { useState } from 'react';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
import { issueGiftCard, useGiftCardsData } from '@/data.jsx';

function IssueGiftCardDialog({ onClose, onIssued }) {
  const [amount, setAmount] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [channel, setChannel] = useState('email');
  const [contact, setContact] = useState('');
  const [senderName, setSenderName] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [issued, setIssued] = useState(null);

  const pesos = Number(amount);
  const valid = Number.isFinite(pesos) && pesos >= 1 && contact.trim().length > 0;

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await issueGiftCard({
        amountCentavos: Math.round(pesos * 100),
        recipientName,
        recipientEmail: channel === 'email' ? contact.trim() : '',
        recipientPhone: channel === 'phone' ? contact.trim() : '',
        senderName,
        message,
      });
      setIssued(res.giftCard || res);
      onIssued();
    } catch (err) {
      setError(err?.message || 'No se pudo emitir la tarjeta.');
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="card modal-card" role="dialog" aria-modal="true" aria-label="Emitir tarjeta de regalo">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>Emitir tarjeta de regalo</h3>
            <p style={{ color: 'var(--ink-3)' }}>La API genera el código; se muestra una sola vez.</p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {issued ? (
          <div style={{ marginTop: 16 }}>
            <p>Tarjeta emitida por {issued.amountMXN || `$${pesos}`}. Entrega este código al cliente:</p>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: 4,
                padding: '16px 0',
                fontFamily: 'monospace',
              }}
            >
              {issued.code}
            </div>
            <p style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              No se vuelve a mostrar. Cópialo ahora.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" type="button" onClick={onClose}>
                Listo
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>Monto (MXN)</span>
              <input
                type="number"
                min={1}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={pending}
              />
            </label>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>Nombre del destinatario (opcional)</span>
              <input type="text" maxLength={100} value={recipientName} onChange={(e) => setRecipientName(e.target.value)} disabled={pending} />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={pending}>
                <option value="email">Email</option>
                <option value="phone">Teléfono</option>
              </select>
              <input
                style={{ flex: 1 }}
                type={channel === 'email' ? 'email' : 'tel'}
                placeholder={channel === 'email' ? 'destinatario@correo.com' : '+52...'}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={pending}
              />
            </div>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>De parte de (opcional)</span>
              <input type="text" maxLength={100} value={senderName} onChange={(e) => setSenderName(e.target.value)} disabled={pending} />
            </label>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>Mensaje (opcional)</span>
              <input type="text" maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} disabled={pending} />
            </label>
            {error && (
              <p className="danger-state" style={{ marginTop: 12 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary" type="button" onClick={onClose} disabled={pending}>
                Cancelar
              </button>
              <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
                {pending ? 'Emitiendo…' : 'Emitir'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const GiftCardsScreen = () => {
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [showIssue, setShowIssue] = useState(false);
  const { data, loading } = useGiftCardsData({ page, refresh });
  const cards = data?.giftCards || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const openTotal = cards
    .filter((card) => !card.isRedeemed)
    .reduce((sum, card) => sum + (card.amountCentavos || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <RegionHead
          title="Tarjetas de regalo"
          note={loading ? 'Cargando…' : 'Emitidas desde Umi Cash.'}
          count={{ value: total.toLocaleString('es-MX'), label: 'emitidas' }}
        />
        <button className="btn" type="button" onClick={() => setShowIssue(true)}>
          <I.Plus size={14} /> Emitir tarjeta
        </button>
      </div>

      {showIssue && (
        <IssueGiftCardDialog
          onClose={() => setShowIssue(false)}
          onIssued={() => setRefresh((n) => n + 1)}
        />
      )}

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
