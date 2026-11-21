import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Trans, useLingui } from '@lingui/react/macro';
import { I, UmiFish } from '@/icons.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';
import { canCashAction, canShowCashTab } from '@/lib/cash-tabs.js';
import PermissionUnavailable from '@/components/permission-unavailable.jsx';
import { LoyaltyOperation } from '@/lib/loyalty-operation.js';
import {
  creditLoyaltySeals,
  loyaltyScan,
  previewLoyaltyScan,
  purchaseWallet,
  topupWallet,
  useMembersData,
  useMerchantData,
} from '@/data.jsx';

const QUICK_TOPUPS = [50, 100, 200, 500];

export default function CashScanScreen() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const merchant = useMerchant();
  const capabilities = merchant?.capabilities;
  const { data: merchantData } = useMerchantData();
  const { data: membersResult } = useMembersData({ page: 1 });

  const canScan = canShowCashTab('scan', capabilities);
  const canBulkSeals = canCashAction('seals', capabilities);
  const canTopup = canCashAction('topup', capabilities);
  const canPurchase = canCashAction('purchase', capabilities);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const loyaltyOpRef = useRef(new LoyaltyOperation());
  const topupKeyRef = useRef('');
  const chargeKeyRef = useRef('');
  const sealsKeyRef = useRef('');

  const [manualInput, setManualInput] = useState(searchParams.get('card') || '');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [preview, setPreview] = useState(null);

  const [checkVisit, setCheckVisit] = useState(true);
  const [checkRedeem, setCheckRedeem] = useState(false);
  const [checkBirthday, setCheckBirthday] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState('');

  const [activeDrawer, setActiveDrawer] = useState(null); // 'charge' | 'topup' | 'seals' | null
  const [amountPesos, setAmountPesos] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [sealsCount, setSealsCount] = useState('1');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const recentMembers = (membersResult?.customers || []).slice(0, 5);
  const cardPrefix = merchantData?.cardPrefix || 'UMI';
  const totalSlots = Number(merchantData?.rewardConfig?.visitsRequired) || 10;

  async function lookupCard(rawPayload) {
    const token = String(rawPayload || '').trim();
    if (!token) return;
    setLoadingPreview(true);
    setPreviewError('');
    setFeedback(null);
    try {
      const data = await previewLoyaltyScan({ qrPayload: token });
      setPreview(data);
      const hasReady =
        Number(data?.card?.pendingRewards) > 0 || Boolean(data?.card?.baseReward?.ready);
      setCheckVisit(!data?.card?.visitLimitReached);
      setCheckRedeem(hasReady);
      setCheckBirthday(Boolean(data?.birthdayReward));
      topupKeyRef.current = '';
      chargeKeyRef.current = '';
      sealsKeyRef.current = '';
    } catch (err) {
      setPreviewError(err?.message || t`No se encontró una tarjeta con ese código.`);
    } finally {
      setLoadingPreview(false);
    }
  }

  const initialCard = searchParams.get('card');
  useEffect(() => {
    const token = String(initialCard || '').trim();
    if (!token) return undefined;
    let active = true;
    previewLoyaltyScan({ qrPayload: token })
      .then((data) => {
        if (!active) return;
        setPreview(data);
        const hasReady =
          Number(data?.card?.pendingRewards) > 0 || Boolean(data?.card?.baseReward?.ready);
        setCheckVisit(!data?.card?.visitLimitReached);
        setCheckRedeem(hasReady);
        setCheckBirthday(Boolean(data?.birthdayReward));
      })
      .catch((err) => {
        if (!active) return;
        setPreviewError(err?.message || t`No se encontró una tarjeta con ese código.`);
      });
    return () => {
      active = false;
    };
  }, [initialCard, t]);

  function stopCamera() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  useEffect(() => () => stopCamera(), []);

  async function startCamera() {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t`Tu navegador no permite acceso directo a cámara. Ingresa el código manual.`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      const Detector = typeof window !== 'undefined' ? window.BarcodeDetector : null;
      const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        if (detector && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes?.[0]?.rawValue) {
              const found = codes[0].rawValue;
              stopCamera();
              setManualInput(found);
              lookupCard(found);
              return;
            }
          } catch {
            // Continue scanning frames
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setCameraError(t`No se pudo abrir la cámara. Usa la búsqueda por código o nombre.`);
    }
  }

  if (!canScan) {
    return (
      <div className="cash-screen">
        <PermissionUnavailable
          title={t`Escanear`}
          permissions={['loyalty.reward.redeem']}
          backLabel={t`Inicio`}
          onBack={() => navigate('/loyalty-value/home')}
        />
      </div>
    );
  }

  const selectedCount = (checkVisit ? 1 : 0) + (checkRedeem ? 1 : 0) + (checkBirthday ? 1 : 0);

  async function handleConfirmLoyalty() {
    if (!preview || selectedCount === 0 || submitting) return;
    setSubmitting(true);
    setFeedback(null);
    const actions = [];
    if (checkVisit) actions.push('VISIT');
    if (checkRedeem) {
      if (Number(preview.card?.pendingRewards) > 0) actions.push('REDEEM');
      else if (preview.card?.baseReward?.ready) actions.push('REDEEM_BASE');
      else actions.push('REDEEM');
    }
    if (checkBirthday) actions.push('BIRTHDAY');

    const op = loyaltyOpRef.current.begin({
      cardNumber: preview.cardNumber,
      action: actions[0],
      actions,
      redeemQuantity: 1,
      externalReceiptNumber: receiptNumber.trim() || undefined,
    });

    try {
      const res = await loyaltyScan({
        cardNumber: preview.cardNumber,
        action: op.action,
        actions: op.actions,
        redeemQuantity: op.redeemQuantity,
        externalReceiptNumber: op.externalReceiptNumber,
        idempotencyKey: op.idempotencyKey,
      });
      loyaltyOpRef.current.finish(200);
      setFeedback({
        tone: 'ok',
        text: res?.message || t`Operación confirmada y pase actualizado.`,
      });
      await lookupCard(preview.cardNumber);
    } catch (err) {
      loyaltyOpRef.current.finish(err?.status || 500);
      setFeedback({
        tone: 'err',
        text: err?.message || t`No se pudo confirmar la operación.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWalletSubmit(kind) {
    if (!preview?.cardId || submitting) return;
    const num = Number(amountPesos);
    if (!Number.isFinite(num) || num <= 0) return;
    const amountCentavos = Math.round(num * 100);
    setSubmitting(true);
    setFeedback(null);
    try {
      if (kind === 'topup') {
        if (!topupKeyRef.current) topupKeyRef.current = crypto.randomUUID();
        const res = await topupWallet({
          cardId: preview.cardId,
          amountCentavos,
          note: actionNote.trim() || undefined,
          idempotencyKey: topupKeyRef.current,
        });
        topupKeyRef.current = '';
        setFeedback({
          tone: 'ok',
          text: res?.message || t`Saldo recargado correctamente.`,
        });
      } else {
        if (!chargeKeyRef.current) chargeKeyRef.current = crypto.randomUUID();
        const res = await purchaseWallet({
          cardId: preview.cardId,
          amountCentavos,
          note: actionNote.trim() || undefined,
          idempotencyKey: chargeKeyRef.current,
        });
        chargeKeyRef.current = '';
        setFeedback({
          tone: 'ok',
          text: res?.message || t`Cobro de saldo aplicado.`,
        });
      }
      setAmountPesos('');
      setActionNote('');
      setActiveDrawer(null);
      await lookupCard(preview.cardNumber);
    } catch (err) {
      setFeedback({
        tone: 'err',
        text: err?.message || t`No se pudo procesar el movimiento de saldo.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSealsSubmit() {
    if (!preview?.cardId || submitting) return;
    const count = Math.max(1, Math.min(50, Number(sealsCount) || 1));
    setSubmitting(true);
    setFeedback(null);
    try {
      if (!sealsKeyRef.current) sealsKeyRef.current = crypto.randomUUID();
      const res = await creditLoyaltySeals({
        cardId: preview.cardId,
        seals: count,
        note: actionNote.trim() || undefined,
        idempotencyKey: sealsKeyRef.current,
      });
      sealsKeyRef.current = '';
      setFeedback({
        tone: 'ok',
        text: res?.message || t`Sellos acreditados correctamente.`,
      });
      setActiveDrawer(null);
      await lookupCard(preview.cardNumber);
    } catch (err) {
      setFeedback({
        tone: 'err',
        text: err?.message || t`No se pudieron acreditar los sellos.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="naive-cash-scan" data-cash-scan>
      <header className="naive-iso-masthead">
        <div>
          <div className="naive-iso-eyebrow">
            <Trans>Escanear QR · Barra</Trans>
          </div>
          <h2 className="naive-iso-h1">
            <span>
              <Trans>Apunta al</Trans>
            </span>{' '}
            <span className="naive-pill-highlight">
              <Trans>QR del cliente</Trans>
            </span>
          </h2>
        </div>
        <button
          type="button"
          className="naive-btn naive-btn-secondary"
          onClick={() => navigate('/loyalty-value/home')}
        >
          <Trans>← Volver al panel</Trans>
        </button>
      </header>

      <div className="naive-scan-grid">
        {/* Left: Viewfinder + Manual Lookup */}
        <section className="naive-card naive-scan-left" aria-label={t`Lector QR`}>
          <div className="naive-viewfinder">
            <video
              ref={videoRef}
              playsInline
              muted
              className={'naive-vf-video' + (cameraActive ? ' active' : '')}
            />
            <div className="naive-vf-box">
              <span className="naive-vf-corner tl" />
              <span className="naive-vf-corner tr" />
              <span className="naive-vf-corner bl" />
              <span className="naive-vf-corner br" />
              {!cameraActive ? <UmiFish width={42} stroke="#E66025" eye="#FFFDF8" /> : null}
            </div>
          </div>

          {cameraError ? (
            <div className="naive-scan-alert" role="alert">
              {cameraError}
            </div>
          ) : null}

          <form
            className="naive-scan-lookup"
            onSubmit={(e) => {
              e.preventDefault();
              lookupCard(manualInput);
            }}
          >
            <div className="naive-search-box">
              <I.Search size={14} aria-hidden="true" />
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder={t`Tarjeta o código (${cardPrefix}-…)`}
                aria-label={t`Código de tarjeta`}
              />
            </div>
            <button
              type="submit"
              className="naive-btn naive-btn-secondary"
              disabled={loadingPreview || !manualInput.trim()}
            >
              {loadingPreview ? <Trans>Buscando…</Trans> : <Trans>Buscar</Trans>}
            </button>
          </form>

          <button
            type="button"
            className="naive-btn naive-btn-primary"
            style={{ width: '100%' }}
            onClick={cameraActive ? stopCamera : startCamera}
          >
            <I.QrScan size={16} />
            <span>
              {cameraActive ? <Trans>Detener cámara</Trans> : <Trans>Activar cámara</Trans>}
            </span>
          </button>

          {recentMembers.length > 0 ? (
            <div className="naive-recent-picks">
              <div className="naive-eyebrow-row">
                <Trans> Selección rápida en barra</Trans>
              </div>
              <div className="naive-recent-chips">
                {recentMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={
                      'naive-chip' + (preview?.cardNumber === m.cardNumber ? ' active' : '')
                    }
                    onClick={() => {
                      setManualInput(m.cardNumber || '');
                      lookupCard(m.cardNumber);
                    }}
                  >
                    <span>{m.name || m.cardNumber}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Right: Active Customer Card & Actions */}
        <section className="naive-card naive-scan-right" aria-label={t`Acciones del cliente`}>
          {previewError ? (
            <div className="naive-scan-alert" role="alert">
              {previewError}
            </div>
          ) : null}

          {feedback ? (
            <div
              className={'naive-scan-feedback ' + (feedback.tone === 'ok' ? 'ok' : 'err')}
              role="status"
            >
              {feedback.text}
            </div>
          ) : null}

          {!preview ? (
            <div className="naive-scan-empty">
              <UmiFish width={40} />
              <h3>
                <Trans>Escanea o selecciona un cliente</Trans>
              </h3>
              <p>
                <Trans>
                  Apunta la cámara al pase de Apple o Google Wallet del cliente, o escribe su número
                  de tarjeta para sumar visita, canjear recompensa o abonar saldo.
                </Trans>
              </p>
            </div>
          ) : (
            <>
              <div className="naive-scan-member-head">
                <div className="naive-member-cell">
                  <div className="naive-avatar lg" aria-hidden="true">
                    {(preview.customer?.name || 'CL')
                      .split(' ')
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div>
                    <div className="naive-scan-member-name">
                      {preview.customer?.name || t`Cliente`}
                    </div>
                    <div className="naive-m-code">
                      {preview.cardNumber} · <Trans>Wallet activo</Trans>
                    </div>
                  </div>
                </div>
                {Number(preview.card?.pendingRewards) > 0 ? (
                  <span className="naive-status-pill ready">
                    <Trans>{preview.card.pendingRewards} por canjear</Trans>
                  </span>
                ) : preview.card?.baseReward?.ready ? (
                  <span className="naive-status-pill base">
                    <Trans>Base listo</Trans>
                  </span>
                ) : null}
              </div>

              <div className="naive-kpi-trio">
                <div className="naive-kpi-box">
                  <span className="naive-kpi-lbl">
                    <Trans>Visitas ciclo</Trans>
                  </span>
                  <span className="naive-kpi-num">
                    {preview.card?.visitsThisCycle ?? 0}
                    <small>/{preview.card?.visitsRequired || totalSlots}</small>
                  </span>
                </div>
                <div className="naive-kpi-box">
                  <span className="naive-kpi-lbl">
                    <Trans>Recompensas</Trans>
                  </span>
                  <span className="naive-kpi-num accent">{preview.card?.pendingRewards ?? 0}</span>
                </div>
                <div className="naive-kpi-box">
                  <span className="naive-kpi-lbl">
                    <Trans>Saldo</Trans>
                  </span>
                  <span className="naive-kpi-num">{preview.card?.balanceMXN || '$0.00'}</span>
                </div>
              </div>

              <div className="naive-action-checks">
                <button
                  type="button"
                  className={'naive-action-check-item' + (checkVisit ? ' checked' : '')}
                  onClick={() => setCheckVisit((v) => !v)}
                >
                  <span className="naive-check-box" aria-hidden="true">
                    {checkVisit ? <I.Check size={14} /> : null}
                  </span>
                  <div className="naive-check-copy">
                    <div className="naive-check-title">
                      <Trans>Registrar visita</Trans>
                    </div>
                    <div className="naive-check-sub">
                      <Trans>+1 sello hacia {preview.card?.rewardName || t`su recompensa`}</Trans>
                    </div>
                  </div>
                  <span className="naive-eyebrow-tag">
                    <Trans>+1 sello</Trans>
                  </span>
                </button>

                <button
                  type="button"
                  className={'naive-action-check-item' + (checkRedeem ? ' checked' : '')}
                  disabled={
                    !(Number(preview.card?.pendingRewards) > 0 || preview.card?.baseReward?.ready)
                  }
                  onClick={() => setCheckRedeem((v) => !v)}
                >
                  <span className="naive-check-box" aria-hidden="true">
                    {checkRedeem ? <I.Check size={14} /> : null}
                  </span>
                  <div className="naive-check-copy">
                    <div className="naive-check-title">
                      <Trans>
                        Canjear{' '}
                        {preview.card?.pendingRewardName ||
                          preview.card?.baseReward?.rewardName ||
                          preview.card?.rewardName ||
                          t`recompensa`}
                      </Trans>
                    </div>
                    <div className="naive-check-sub">
                      {Number(preview.card?.pendingRewards) > 0 ||
                      preview.card?.baseReward?.ready ? (
                        <Trans>Recompensa disponible para entregar ahora</Trans>
                      ) : (
                        <Trans>Aún no junta las visitas necesarias</Trans>
                      )}
                    </div>
                  </div>
                  {Number(preview.card?.pendingRewards) > 0 || preview.card?.baseReward?.ready ? (
                    <span className="naive-status-pill base">
                      <Trans>Listo</Trans>
                    </span>
                  ) : null}
                </button>

                {preview.birthdayReward ? (
                  <button
                    type="button"
                    className={'naive-action-check-item' + (checkBirthday ? ' checked' : '')}
                    onClick={() => setCheckBirthday((v) => !v)}
                  >
                    <span className="naive-check-box" aria-hidden="true">
                      {checkBirthday ? <I.Check size={14} /> : null}
                    </span>
                    <div className="naive-check-copy">
                      <div className="naive-check-title">
                        <Trans>Cumpleaños: {preview.birthdayReward.rewardName}</Trans>
                      </div>
                      <div className="naive-check-sub">
                        <Trans>Regalo de cumpleaños activo</Trans>
                      </div>
                    </div>
                  </button>
                ) : null}
              </div>

              <div className="naive-scan-aux-row">
                <input
                  type="text"
                  className="naive-receipt-input"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  placeholder={t`Folio o ticket opcional…`}
                  aria-label={t`Folio o ticket opcional`}
                />
                {canPurchase ? (
                  <button
                    type="button"
                    className="naive-btn naive-btn-secondary"
                    onClick={() => setActiveDrawer((d) => (d === 'charge' ? null : 'charge'))}
                  >
                    <Trans>Cobrar saldo</Trans>
                  </button>
                ) : null}
                {canTopup ? (
                  <button
                    type="button"
                    className="naive-btn naive-btn-secondary"
                    onClick={() => setActiveDrawer((d) => (d === 'topup' ? null : 'topup'))}
                  >
                    <Trans>Recargar</Trans>
                  </button>
                ) : null}
                {canBulkSeals && merchantData?.multiSealEnabled ? (
                  <button
                    type="button"
                    className="naive-btn naive-btn-secondary"
                    onClick={() => setActiveDrawer((d) => (d === 'seals' ? null : 'seals'))}
                  >
                    <Trans>+ Sellos</Trans>
                  </button>
                ) : null}
              </div>

              {activeDrawer === 'topup' || activeDrawer === 'charge' ? (
                <div className="naive-inline-drawer">
                  <div className="naive-eyebrow-row">
                    {activeDrawer === 'topup' ? (
                      <Trans>Recargar monedero (MXN)</Trans>
                    ) : (
                      <Trans>Cobrar del monedero (MXN)</Trans>
                    )}
                  </div>
                  {activeDrawer === 'topup' ? (
                    <div className="naive-filter-chips">
                      {QUICK_TOPUPS.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          className={'naive-chip' + (Number(amountPesos) === amt ? ' active' : '')}
                          onClick={() => setAmountPesos(String(amt))}
                        >
                          ${amt}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="naive-drawer-inputs">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={amountPesos}
                      onChange={(e) => setAmountPesos(e.target.value)}
                      placeholder={t`Monto en pesos`}
                      aria-label={t`Monto en pesos`}
                    />
                    <input
                      type="text"
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      placeholder={t`Nota opcional`}
                      aria-label={t`Nota opcional`}
                    />
                    <button
                      type="button"
                      className="naive-btn naive-btn-primary"
                      disabled={submitting || !Number(amountPesos)}
                      onClick={() => handleWalletSubmit(activeDrawer)}
                    >
                      {activeDrawer === 'topup' ? (
                        <Trans>Abonar saldo</Trans>
                      ) : (
                        <Trans>Aplicar cobro</Trans>
                      )}
                    </button>
                  </div>
                </div>
              ) : null}

              {activeDrawer === 'seals' ? (
                <div className="naive-inline-drawer">
                  <div className="naive-eyebrow-row">
                    <Trans>Acreditar varios sellos</Trans>
                  </div>
                  <div className="naive-drawer-inputs">
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={sealsCount}
                      onChange={(e) => setSealsCount(e.target.value)}
                      aria-label={t`Cantidad de sellos`}
                    />
                    <input
                      type="text"
                      value={actionNote}
                      onChange={(e) => setActionNote(e.target.value)}
                      placeholder={t`Motivo o nota`}
                      aria-label={t`Motivo o nota`}
                    />
                    <button
                      type="button"
                      className="naive-btn naive-btn-primary"
                      disabled={submitting}
                      onClick={handleSealsSubmit}
                    >
                      <Trans>Acreditar sellos</Trans>
                    </button>
                  </div>
                </div>
              ) : null}

              <button
                type="button"
                className="naive-btn naive-btn-primary naive-scan-confirm-btn"
                disabled={submitting || selectedCount === 0}
                onClick={handleConfirmLoyalty}
              >
                {submitting ? (
                  <Trans>Confirmando…</Trans>
                ) : (
                  <Trans>Confirmar operación ({selectedCount}) →</Trans>
                )}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
