import React, { useState } from 'react';
import { Select } from '@/components/select.jsx';
import { Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate, formatMoney, formatNumber } from '@/lib/format.js';
import { RegionHead } from '@/shell.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { canCashAction } from '@/lib/cash-tabs.js';
import PermissionUnavailable from '@/components/permission-unavailable.jsx';
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
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={pending}
              >
                <option value="phone">{t`Teléfono`}</option>
                <option value="email">{t`Correo`}</option>
              </Select>
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
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                disabled={pending}
              >
                <option value="email">{t`Correo`}</option>
                <option value="phone">{t`Teléfono`}</option>
              </Select>
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
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities;
  const canIssue = canCashAction('issue', capabilities);
  const canRedeem = canCashAction('redeem', capabilities);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [showIssue, setShowIssue] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const { data, loading, error, errorStatus } = useGiftCardsData({ page, refresh });
  const cards = data?.giftCards || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const openCards = cards.filter((card) => !card.isRedeemed);
  const redeemedCards = cards.filter((card) => card.isRedeemed);
  const openTotal = openCards.reduce((sum, card) => sum + (card.amountCentavos || 0), 0);

  if (errorStatus === 403) {
    return <PermissionUnavailable title={t`Tarjetas de regalo`} permissions={['gift_card.read']} />;
  }

  return (
    <div className="cash-screen">
      <RegionHead
        title={t`Tarjetas de regalo`}
        note={loading ? t`Cargando…` : t`Emitidas desde Umi Cash.`}
        count={{ value: formatNumber(total), label: t`emitidas` }}
        actions={
          <>
            {canRedeem ? (
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => setShowRedeem(true)}
              >
                <I.Check size={14} /> <Trans>Canjear</Trans>
              </button>
            ) : null}
            {canIssue ? (
              <button className="btn" type="button" onClick={() => setShowIssue(true)}>
                <I.Plus size={14} /> <Trans>Emitir tarjeta</Trans>
              </button>
            ) : null}
            {!canIssue && !canRedeem ? (
              <span className="cash-readonly" data-read-only="gift-cards">
                <I.Eye size={13} aria-hidden="true" />
                <Trans>Solo consulta</Trans>
              </span>
            ) : null}
          </>
        }
      />

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

      {error ? (
        <div className="alert danger" role="alert">
          <span className="strip" />
          <div className="body">
            <div className="ttl">
              <Trans>No se pudieron cargar las tarjetas</Trans>
            </div>
            <div className="sub">{error}</div>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              style={{ marginTop: 8 }}
              onClick={() => setRefresh((n) => n + 1)}
            >
              <Trans>Reintentar</Trans>
            </button>
          </div>
        </div>
      ) : null}

      <div className="cash-metrics">
        <div className="cash-metric">
          <span className="cash-kicker">
            <Trans>Abiertas</Trans>
          </span>
          <span className="cash-metric-value">{formatNumber(openCards.length)}</span>
          <span className="cash-muted">
            <Trans>con saldo en esta página</Trans>
          </span>
        </div>
        <div className="cash-metric">
          <span className="cash-kicker">
            <Trans>Saldo abierto</Trans>
          </span>
          <span className="cash-metric-value">{formatMoney(openTotal)}</span>
          <span className="cash-muted">
            <Trans>en esta página</Trans>
          </span>
        </div>
        <div className="cash-metric">
          <span className="cash-kicker">
            <Trans>Canjeadas</Trans>
          </span>
          <span className="cash-metric-value">{formatNumber(redeemedCards.length)}</span>
          <span className="cash-muted">
            <Trans>{cards.length} en pantalla</Trans>
          </span>
        </div>
      </div>

      <section className="cash-panel" aria-label={t`Tarjetas de regalo emitidas`}>
        <table className="cash-table">
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
                <td colSpan={5} className="cash-empty-cell">
                  <Trans>No hay tarjetas de regalo emitidas.</Trans>
                </td>
              </tr>
            )}
            {cards.map((card) => (
              <tr key={card.id} className="cash-row">
                <td>
                  <span className="cash-mono cash-card-number">{card.code}</span>
                </td>
                <td>
                  <div className="cash-member-name">{card.recipientName || '—'}</div>
                  <div className="cash-muted">
                    {card.recipientEmail || card.recipientPhone || t`Sin contacto`}
                  </div>
                </td>
                <td className="cash-num">
                  <span className="cash-money">
                    {card.amountMXN || formatMoney(card.amountCentavos)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      'cash-badge' + (card.isRedeemed ? ' cash-badge--muted' : ' cash-badge--open')
                    }
                  >
                    {card.isRedeemed ? <Trans>Canjeada</Trans> : <Trans>Abierta</Trans>}
                  </span>
                </td>
                <td className="cash-muted">
                  {card.createdAt ? formatDate(card.createdAt) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {totalPages > 1 && (
        <div className="cash-pagination">
          <button
            className="btn btn-ghost btn-sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <I.ChevronLeft size={14} /> <Trans>Anterior</Trans>
          </button>
          <span className="cash-pagination-count">
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
