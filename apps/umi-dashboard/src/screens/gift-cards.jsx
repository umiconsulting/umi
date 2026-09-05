import React, { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate, formatMoney, formatNumber } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
import { issueGiftCard, redeemGiftCardByCode, useGiftCardsData } from '@/data.jsx';

function RedeemGiftCardDialog({ onClose, onRedeemed }) {
  const { t } = useLingui();
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState('phone');
  const [contact, setContact] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const valid = code.trim().length >= 4 && contact.trim().length > 0;

  async function submit() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await redeemGiftCardByCode({
        code,
        phone: channel === 'phone' ? contact.trim() : '',
        email: channel === 'email' ? contact.trim() : '',
      });
      setResult(res);
      onRedeemed();
    } catch (err) {
      setError(err?.message || t`No se pudo canjear la tarjeta.`);
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Canjear tarjeta de regalo`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <Trans>Canjear tarjeta de regalo</Trans>
            </h3>
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>El saldo se abona al monedero del cliente.</Trans>
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>
        {result ? (
          <div style={{ marginTop: 16 }}>
            <p>
              <Trans>
                Canjeada por {result.amountMXN}. Nuevo saldo del cliente: {result.newBalanceMXN}.
              </Trans>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" type="button" onClick={onClose}>
                <Trans>Listo</Trans>
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>
                <Trans>Código</Trans>
              </span>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={pending}
                placeholder="XXXX-XXXX-…"
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={pending}
              >
                <option value="phone">{t`Teléfono`}</option>
                <option value="email">{t`Correo`}</option>
              </select>
              <input
                style={{ flex: 1 }}
                type={channel === 'email' ? 'email' : 'tel'}
                placeholder={channel === 'email' ? 'cliente@correo.com' : '+52...'}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={pending}
              />
            </div>
            {error && (
              <p className="danger-state" style={{ marginTop: 12 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={onClose}
                disabled={pending}
              >
                <Trans>Cancelar</Trans>
              </button>
              <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
                {pending ? <Trans>Canjeando…</Trans> : <Trans>Canjear</Trans>}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function IssueGiftCardDialog({ onClose, onIssued }) {
  const { t } = useLingui();
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
      setError(err?.message || t`No se pudo emitir la tarjeta.`);
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="card modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={t`Emitir tarjeta de regalo`}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0 }}>
              <Trans>Emitir tarjeta de regalo</Trans>
            </h3>
            <p style={{ color: 'var(--ink-3)' }}>
              <Trans>La API genera el código; se muestra una sola vez.</Trans>
            </p>
          </div>
          <button className="btn-icon" type="button" onClick={onClose} aria-label={t`Cerrar`}>
            ×
          </button>
        </div>

        {issued ? (
          <div style={{ marginTop: 16 }}>
            <p>
              <Trans>
                Tarjeta emitida por {issued.amountMXN || `$${pesos}`}. Entrega este código al
                cliente:
              </Trans>
            </p>
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
              <Trans>No se vuelve a mostrar. Cópialo ahora.</Trans>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn" type="button" onClick={onClose}>
                <Trans>Listo</Trans>
              </button>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>
                <Trans>Monto (MXN)</Trans>
              </span>
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
              <span>
                <Trans>Nombre del destinatario (opcional)</Trans>
              </span>
              <input
                type="text"
                maxLength={100}
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                disabled={pending}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={pending}
              >
                <option value="email">{t`Correo`}</option>
                <option value="phone">{t`Teléfono`}</option>
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
              <span>
                <Trans>De parte de (opcional)</Trans>
              </span>
              <input
                type="text"
                maxLength={100}
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                disabled={pending}
              />
            </label>
            <label style={{ display: 'block', marginTop: 12 }}>
              <span>
                <Trans>Mensaje (opcional)</Trans>
              </span>
              <input
                type="text"
                maxLength={300}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={pending}
              />
            </label>
            {error && (
              <p className="danger-state" style={{ marginTop: 12 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={onClose}
                disabled={pending}
              >
                <Trans>Cancelar</Trans>
              </button>
              <button className="btn" type="button" onClick={submit} disabled={!valid || pending}>
                {pending ? <Trans>Emitiendo…</Trans> : <Trans>Emitir</Trans>}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

const GiftCardsScreen = () => {
  const { t } = useLingui();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [showIssue, setShowIssue] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const { data, loading } = useGiftCardsData({ page, refresh });
  const cards = data?.giftCards || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const openTotal = cards
    .filter((card) => !card.isRedeemed)
    .reduce((sum, card) => sum + (card.amountCentavos || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
        }}
      >
        <RegionHead
          title={t`Tarjetas de regalo`}
          note={loading ? t`Cargando…` : t`Emitidas desde Umi Cash.`}
          count={{ value: formatNumber(total), label: t`emitidas` }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" type="button" onClick={() => setShowRedeem(true)}>
            <I.Check size={14} /> <Trans>Canjear</Trans>
          </button>
          <button className="btn" type="button" onClick={() => setShowIssue(true)}>
            <I.Plus size={14} /> <Trans>Emitir tarjeta</Trans>
          </button>
        </div>
      </div>

      {showIssue && (
        <IssueGiftCardDialog
          onClose={() => setShowIssue(false)}
          onIssued={() => setRefresh((n) => n + 1)}
        />
      )}

      {showRedeem && (
        <RedeemGiftCardDialog
          onClose={() => setShowRedeem(false)}
          onRedeemed={() => setRefresh((n) => n + 1)}
        />
      )}

      <div className="grid grid-2" style={{ gap: 14 }}>
        <div className="strip-metric">
          <div>
            <div className="lbl">
              <Trans>Abiertas</Trans>
            </div>
            <div className="en">
              <Trans>Saldo abierto en esta página</Trans>
            </div>
          </div>
          <div className="val">{formatMoney(openTotal)}</div>
          <span className="delta-mini up">{cards.filter((c) => !c.isRedeemed).length}</span>
        </div>
        <div className="strip-metric">
          <div>
            <div className="lbl">
              <Trans>Canjeadas</Trans>
            </div>
            <div className="en">
              <Trans>Canjeado en esta página</Trans>
            </div>
          </div>
          <div className="val">{cards.filter((c) => c.isRedeemed).length}</div>
          <span className="delta-mini">
            <Trans>{cards.length} en pantalla</Trans>
          </span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="matrix">
          <thead>
            <tr>
              <th>
                <Trans>Código</Trans>
              </th>
              <th>
                <Trans>Destinatario</Trans>
              </th>
              <th style={{ textAlign: 'right' }}>
                <Trans>Monto</Trans>
              </th>
              <th>
                <Trans>Estado</Trans>
              </th>
              <th>
                <Trans>Creada</Trans>
              </th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 && !loading && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--ink-3)' }}>
                  <Trans>No hay tarjetas de regalo emitidas.</Trans>
                </td>
              </tr>
            )}
            {cards.map((card) => (
              <tr key={card.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{card.code}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{card.recipientName || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {card.recipientEmail || card.recipientPhone || t`Sin contacto`}
                  </div>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{card.amountMXN}</td>
                <td>
                  <span className={'badge ' + (card.isRedeemed ? 'badge-staff' : 'badge-admin')}>
                    {card.isRedeemed ? <Trans>CANJEADA</Trans> : <Trans>ABIERTA</Trans>}
                  </span>
                </td>
                <td style={{ color: 'var(--ink-2)' }}>
                  {card.createdAt ? formatDate(card.createdAt) : '—'}
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
            <I.ChevronLeft size={14} /> <Trans>Anterior</Trans>
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
            <Trans>Siguiente</Trans> <I.ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default GiftCardsScreen;
