'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import jsQR from 'jsqr';
import { centavosFromPesos, formatMXN, COMMON_TOPUP_AMOUNTS } from '@/lib/currency';
import { useTenant } from '@/context/TenantContext';
import { authedFetch } from '@/lib/authed-fetch';

interface CardPreview {
  cardId: string;
  cardNumber: string;
  customer: { name: string | null };
  card: {
    visitsThisCycle: number;
    visitsRequired: number;
    pendingRewards: number;
    balanceMXN: string;
    balanceCentavos: number;
    rewardName: string;
    visitLimitReached: boolean;
    lastVisitAt: string | null;
  };
  birthdayReward: { id: string; rewardName: string } | null;
}

interface ActionResult {
  success: boolean;
  message: string;
  detail?: string;
  newBalanceMXN?: string;
}

export default function ScanPage() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScannedRef = useRef<string>('');
  const lastPayloadRef = useRef<string>('');

  const [manualInput, setManualInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [processing, setProcessing] = useState(false);

  // Step 2: preview loaded
  const [preview, setPreview] = useState<CardPreview | null>(null);

  // Selected loyalty actions to perform in one confirmation (visit / redeem / birthday redeem)
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());

  // Step 3: action result
  const [result, setResult] = useState<ActionResult | null>(null);

  // Cobrar saldo flow
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeNote, setChargeNote] = useState('');
  const [showCharge, setShowCharge] = useState(false);

  // Recargar saldo flow
  const [topupAmount, setTopupAmount] = useState('');
  const [topupNote, setTopupNote] = useState('');
  const [showTopup, setShowTopup] = useState(false);

  // Stable per-operation idempotency tokens: reused if the operator re-taps after a
  // lost response (server dedups instead of double-charging/crediting), reset on
  // success or whenever the target card / amount / note changes.
  const chargeKeyRef = useRef<string>('');
  const topupKeyRef = useRef<string>('');
  useEffect(() => { chargeKeyRef.current = ''; }, [preview, chargeAmount, chargeNote]);
  useEffect(() => { topupKeyRef.current = ''; }, [preview, topupAmount, topupNote]);

  // ── Camera ──────────────────────────────────────────────────────────────

  async function startCamera() {
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setScanning(true);
      startQRDetection();
    } catch {
      setCameraError('No se pudo acceder a la cámara. Usa el campo manual.');
    }
  }

  function stopCamera() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function startQRDetection() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const useBarcodeDetector = 'BarcodeDetector' in window;
    const detector = useBarcodeDetector
      ? new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      : null;

    async function detect() {
      if (!videoRef.current || !streamRef.current) return;
      if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx?.drawImage(videoRef.current, 0, 0);

        let value: string | null = null;
        try {
          if (detector) {
            const barcodes = await detector.detect(canvas);
            if (barcodes.length > 0) value = barcodes[0].rawValue;
          } else if (ctx) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, canvas.width, canvas.height);
            if (code) value = code.data;
          }
        } catch {}

        if (value && value !== lastScannedRef.current) {
          lastScannedRef.current = value;
          await loadPreview(value);
          setTimeout(() => { lastScannedRef.current = ''; }, 3000);
        }
      }
      if (streamRef.current) rafRef.current = requestAnimationFrame(detect);
    }
    rafRef.current = requestAnimationFrame(detect);
  }

  useEffect(() => { return () => stopCamera(); }, []);

  // ── Preview ──────────────────────────────────────────────────────────────

  async function loadPreview(payload: string) {
    if (processing) return;
    setProcessing(true);
    setResult(null);
    setShowCharge(false);
    setChargeAmount('');
    setShowTopup(false);
    setTopupAmount('');

    try {
      const res = await authedFetch(slug, `/api/${slug}/admin/scan/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload: payload }),
      });

      const data = await res.json();
      if (res.ok) {
        lastPayloadRef.current = payload;
        setPreview(data);
        // Default-check available loyalty actions so the common case (visit + redeem) is one tap
        const defaults = new Set<string>();
        if (!data.card.visitLimitReached) defaults.add('VISIT');
        if (data.card.pendingRewards > 0) defaults.add('REDEEM');
        if (data.birthdayReward) defaults.add('BIRTHDAY_REDEEM');
        setSelectedActions(defaults);
        stopCamera();
      } else {
        setResult({ success: false, message: data.error ?? 'Error al leer la tarjeta' });
      }
    } catch {
      setResult({ success: false, message: 'Error de conexión' });
    } finally {
      setProcessing(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!manualInput.trim()) return;
    await loadPreview(manualInput.trim());
    setManualInput('');
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  async function doActions() {
    if (!preview || selectedActions.size === 0) return;
    setProcessing(true);
    setResult(null);

    try {
      const res = await authedFetch(slug, `/api/${slug}/admin/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qrPayload: lastPayloadRef.current, actions: Array.from(selectedActions) }),
      });
      const data = await res.json();
      setResult({ success: res.ok, message: data.message ?? data.error });
      if (res.ok) setPreview(null);
    } catch {
      setResult({ success: false, message: 'Error de conexión' });
    } finally {
      setProcessing(false);
    }
  }

  function toggleAction(key: string) {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function doCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setProcessing(true);
    setResult(null);

    let amountCentavos: number;
    try { amountCentavos = centavosFromPesos(chargeAmount); } catch {
      setResult({ success: false, message: 'Monto inválido' });
      setProcessing(false);
      return;
    }

    try {
      if (!chargeKeyRef.current) chargeKeyRef.current = crypto.randomUUID();
      const res = await authedFetch(slug, `/api/${slug}/admin/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: preview.cardId, amountCentavos, note: chargeNote, idempotencyKey: chargeKeyRef.current }),
      });
      const data = await res.json();
      if (res.ok) {
        chargeKeyRef.current = '';
        setResult({ success: true, message: `Cobrado: ${data.amountMXN}`, detail: `Nuevo saldo: ${data.newBalanceMXN}` });
        setPreview(null);
        setShowCharge(false);
        setChargeAmount('');
        setChargeNote('');
      } else {
        setResult({ success: false, message: data.error ?? 'Error al cobrar' });
      }
    } catch {
      setResult({ success: false, message: 'Error de conexión' });
    } finally {
      setProcessing(false);
    }
  }

  async function doTopup(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setProcessing(true);
    setResult(null);

    let amountCentavos: number;
    try { amountCentavos = centavosFromPesos(topupAmount); } catch {
      setResult({ success: false, message: 'Monto inválido' });
      setProcessing(false);
      return;
    }

    try {
      if (!topupKeyRef.current) topupKeyRef.current = crypto.randomUUID();
      const res = await authedFetch(slug, `/api/${slug}/admin/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: preview.cardId, amountCentavos, note: topupNote, idempotencyKey: topupKeyRef.current }),
      });
      const data = await res.json();
      if (res.ok) {
        topupKeyRef.current = '';
        setResult({ success: true, message: `Recarga exitosa: ${data.amountMXN}`, detail: `Nuevo saldo: ${data.newBalanceMXN}` });
        setPreview(null);
        setShowTopup(false);
        setTopupAmount('');
        setTopupNote('');
      } else {
        setResult({ success: false, message: data.error ?? 'Error al recargar' });
      }
    } catch {
      setResult({ success: false, message: 'Error de conexión' });
    } finally {
      setProcessing(false);
    }
  }

  function reset() {
    setPreview(null);
    setResult(null);
    setShowCharge(false);
    setChargeAmount('');
    setChargeNote('');
    setShowTopup(false);
    setTopupAmount('');
    setTopupNote('');
    setManualInput('');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const progressPct = preview
    ? Math.round((preview.card.visitsThisCycle / preview.card.visitsRequired) * 100)
    : 0;

  return (
    <div className="px-5 py-5 max-w-lg mx-auto">
      <div className="u-fade-up mb-5">
        <div className="u-eyebrow mb-1.5">Escanear</div>
        <h1 className="u-display" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
          Apunta al QR del cliente
        </h1>
      </div>

      {/* ── Step 1: scan input (hidden once preview is loaded) ── */}
      {!preview && !result && (
        <>
          {/* Manual input */}
          <div className="u-surface p-5 mb-4">
            <div className="u-eyebrow mb-2">O ingresa manualmente</div>
            <form onSubmit={handleManualSubmit} className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Tarjeta o teléfono"
                className="u-input flex-1"
                autoFocus
                autoComplete="off"
                autoCapitalize="characters"
                disabled={processing}
              />
              <button type="submit" disabled={!manualInput || processing} className="u-btn u-btn-primary px-4">
                {processing ? '...' : 'Buscar'}
              </button>
            </form>
          </div>

          {/* Camera */}
          <div className="u-surface p-5 mb-4">
            <div className="relative bg-black rounded-xl overflow-hidden aspect-[4/3] mb-3">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              {!scanning && (
                <div className="absolute inset-0 flex items-center justify-center bg-coffee-dark/80">
                  <div className="text-center text-white">
                    <svg className="w-10 h-10 mx-auto mb-2 opacity-60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    <p className="text-sm">Cámara apagada</p>
                  </div>
                </div>
              )}
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-44 h-44 border-2 border-white/60 rounded-xl">
                    <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 border-white rounded-tl-lg" />
                    <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 border-white rounded-tr-lg" />
                    <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 border-white rounded-bl-lg" />
                    <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 border-white rounded-br-lg" />
                  </div>
                </div>
              )}
              {processing && (
                <div className="absolute inset-0 bg-coffee-dark/60 flex items-center justify-center">
                  <div className="text-white text-center">
                    <svg className="w-8 h-8 mx-auto mb-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                      <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
                    </svg>
                    <p className="text-sm">Leyendo tarjeta...</p>
                  </div>
                </div>
              )}
            </div>
            {cameraError && <p className="text-amber-700 text-sm text-center mb-3 bg-amber-50 rounded-lg px-3 py-2">{cameraError}</p>}
            <button onClick={scanning ? stopCamera : startCamera} className={`u-btn ${scanning ? 'u-btn-secondary' : 'u-btn-primary'}`} style={{ width: '100%' }}>
              {scanning ? 'Detener cámara' : 'Activar cámara'}
            </button>
          </div>
        </>
      )}

      {/* ── Step 2: customer card + actions ── */}
      {preview && !result && (
        <div className="space-y-4 animate-slide-up">
          {/* Customer info card */}
          <div className="u-surface p-5">
            <div className="flex items-start gap-3 mb-4">
              <div
                className="flex items-center justify-center"
                style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: 'color-mix(in oklab, var(--color-brand) 15%, white)',
                  color: 'var(--color-brand-dark)',
                  fontFamily: '"Domus", serif', fontWeight: 600, fontSize: 20,
                }}
              >
                {(preview.customer.name ?? 'C').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="u-display truncate" style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-ink)', margin: 0 }}>
                  {preview.customer.name ?? 'Cliente'}
                </p>
                <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--color-ink-light)', letterSpacing: '0.08em' }}>{preview.cardNumber}</p>
              </div>
              <button onClick={reset} className="p-1" style={{ color: 'var(--color-ink-light)' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { label: 'Visitas', value: <>{preview.card.visitsThisCycle}<span style={{ color: 'var(--color-ink-light)', fontSize: 14, fontWeight: 400 }}>/{preview.card.visitsRequired}</span></> },
                { label: 'Recompensas', value: preview.card.pendingRewards },
                { label: 'Saldo', value: preview.card.balanceMXN },
              ].map((s, i) => (
                <div key={i} className="rounded-xl p-3 text-center" style={{ background: 'var(--color-surface)' }}>
                  <p className="leading-none" style={{ fontFamily: '"Domus", serif', fontWeight: 600, fontSize: 20, color: 'var(--color-ink)' }}>{s.value}</p>
                  <p className="u-eyebrow mt-1.5" style={{ fontSize: 9 }}>{s.label}</p>
                </div>
              ))}
            </div>

            {/* Visit progress */}
            <div className="flex items-baseline justify-between mb-2">
              <span className="u-eyebrow" style={{ fontSize: 10 }}>Próxima recompensa</span>
              <span className="text-xs font-semibold" style={{ color: 'var(--color-brand)' }}>{preview.card.visitsThisCycle}/{preview.card.visitsRequired} · {preview.card.rewardName}</span>
            </div>
            <div className="u-progress-track">
              <div className="u-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Cobrar saldo form (inline) */}
          {showCharge ? (
            <div className="u-surface p-5 border-2 border-coffee-brand/20 bg-coffee-brand/5">
              <p className="text-sm font-semibold text-coffee-dark mb-3">Cobrar saldo</p>
              <form onSubmit={doCharge} className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {COMMON_TOPUP_AMOUNTS.map(({ label, centavos }) => (
                    <button
                      key={centavos}
                      type="button"
                      onClick={() => setChargeAmount(String(centavos / 100))}
                      disabled={centavos > preview.card.balanceCentavos}
                      className={`py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-30 ${
                        chargeAmount === String(centavos / 100) ? 'bg-coffee-dark text-white' : 'bg-white text-coffee-medium hover:bg-coffee-pale'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={chargeAmount}
                  onChange={(e) => setChargeAmount(e.target.value)}
                  placeholder="Otro monto"
                  className="u-input"
                  min="0.01"
                  max={preview.card.balanceCentavos / 100}
                  step="0.01"
                  autoFocus
                />
                {chargeAmount && !isNaN(parseFloat(chargeAmount)) && (
                  <p className="text-sm text-coffee-medium -mt-1">= {formatMXN(Math.round(parseFloat(chargeAmount) * 100))}</p>
                )}
                <input
                  type="text"
                  value={chargeNote}
                  onChange={(e) => setChargeNote(e.target.value)}
                  placeholder="Nota (opcional)"
                  className="u-input"
                  maxLength={200}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowCharge(false); setChargeAmount(''); }} className="u-btn u-btn-secondary flex-1">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!chargeAmount || processing || parseFloat(chargeAmount) <= 0}
                    className="u-btn u-btn-primary flex-1"
                  >
                    {processing ? 'Procesando...' : 'Confirmar cobro'}
                  </button>
                </div>
              </form>
            </div>

          /* Recargar saldo form (inline) */
          ) : showTopup ? (
            <div className="u-surface p-5 border-2 border-green-200 bg-green-50/50">
              <p className="text-sm font-semibold text-coffee-dark mb-3">Recargar saldo</p>
              <form onSubmit={doTopup} className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {COMMON_TOPUP_AMOUNTS.map(({ label, centavos }) => (
                    <button
                      key={centavos}
                      type="button"
                      onClick={() => setTopupAmount(String(centavos / 100))}
                      className={`py-2 rounded-xl text-sm font-medium transition-colors ${
                        topupAmount === String(centavos / 100) ? 'bg-coffee-dark text-white' : 'bg-white text-coffee-medium hover:bg-coffee-pale'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  value={topupAmount}
                  onChange={(e) => setTopupAmount(e.target.value)}
                  placeholder="Otro monto"
                  className="u-input"
                  min="1"
                  max="10000"
                  step="0.01"
                  autoFocus
                />
                {topupAmount && !isNaN(parseFloat(topupAmount)) && (
                  <p className="text-sm text-coffee-medium -mt-1">= {formatMXN(Math.round(parseFloat(topupAmount) * 100))}</p>
                )}
                <input
                  type="text"
                  value={topupNote}
                  onChange={(e) => setTopupNote(e.target.value)}
                  placeholder="Nota (opcional)"
                  className="u-input"
                  maxLength={200}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowTopup(false); setTopupAmount(''); }} className="u-btn u-btn-secondary flex-1">
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!topupAmount || processing || parseFloat(topupAmount) <= 0}
                    className="w-full flex-1 bg-green-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-green-700 transition-colors active:scale-95 transform disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processing ? 'Procesando...' : 'Confirmar recarga'}
                  </button>
                </div>
              </form>
            </div>

          ) : (
            /* Action checklist + Confirmar */
            <div className="space-y-3">
              {(() => {
                const visitDisabled = preview.card.visitLimitReached;
                const redeemDisabled = preview.card.pendingRewards === 0;
                const visitWaitLabel = preview.card.visitLimitReached
                  ? (() => {
                      if (!preview.card.lastVisitAt) return 'Visita ya registrada hoy';
                      const minsLeft = Math.ceil((new Date(preview.card.lastVisitAt).getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 60000);
                      const hrsLeft = Math.floor(minsLeft / 60);
                      const remaining = hrsLeft > 0 ? `${hrsLeft}h ${minsLeft % 60}m` : `${minsLeft}m`;
                      return `Disponible en ${remaining}`;
                    })()
                  : null;

                type Choice = { key: string; label: string; sublabel: string; disabled: boolean; disabledHint?: string; tint?: 'brand' | 'amber' };
                const choices: Choice[] = [
                  {
                    key: 'VISIT',
                    label: 'Registrar visita',
                    sublabel: `${preview.card.visitsThisCycle + 1}/${preview.card.visitsRequired} hacia ${preview.card.rewardName}`,
                    disabled: visitDisabled,
                    disabledHint: visitWaitLabel ?? undefined,
                  },
                  {
                    key: 'REDEEM',
                    label: 'Canjear recompensa',
                    sublabel: preview.card.rewardName,
                    disabled: redeemDisabled,
                    disabledHint: redeemDisabled ? 'Sin recompensas pendientes' : undefined,
                    tint: 'amber',
                  },
                ];
                if (preview.birthdayReward) {
                  choices.push({
                    key: 'BIRTHDAY_REDEEM',
                    label: 'Canjear regalo de cumpleaños',
                    sublabel: preview.birthdayReward.rewardName,
                    disabled: false,
                    tint: 'brand',
                  });
                }

                const confirmCount = selectedActions.size;
                const confirmLabel = confirmCount === 0
                  ? 'Selecciona una acción'
                  : confirmCount === 1
                    ? 'Confirmar'
                    : `Confirmar (${confirmCount})`;

                return (
                  <>
                    <div className="u-surface p-3 space-y-1.5">
                      {choices.map((c) => {
                        const checked = selectedActions.has(c.key);
                        return (
                          <label
                            key={c.key}
                            className={`flex items-center gap-3 px-2 py-2.5 rounded-lg ${c.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-coffee-pale/40'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked && !c.disabled}
                              disabled={c.disabled}
                              onChange={() => !c.disabled && toggleAction(c.key)}
                              className="w-5 h-5 rounded accent-coffee-dark flex-shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium" style={{
                                color: c.tint === 'amber' ? '#92400e' : c.tint === 'brand' ? 'var(--color-brand-dark)' : 'var(--color-ink)',
                              }}>
                                {c.label}
                              </div>
                              <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-ink-light)' }}>
                                {c.disabled && c.disabledHint ? c.disabledHint : c.sublabel}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <button
                      onClick={doActions}
                      disabled={processing || confirmCount === 0}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-coffee-dark text-white font-semibold text-sm disabled:opacity-40 hover:bg-coffee-medium transition-colors"
                    >
                      {processing ? 'Procesando...' : confirmLabel}
                    </button>
                  </>
                );
              })()}

              {/* Top up balance */}
              {tenant.topupEnabled && (
                <button
                  onClick={() => setShowTopup(true)}
                  disabled={processing}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-green-600 text-white font-semibold text-sm disabled:opacity-40 hover:bg-green-700 transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span className="flex-1 text-left">Recargar saldo</span>
                  <span className="text-white/70 text-xs">{preview.card.balanceMXN} actual</span>
                </button>
              )}

              {/* Charge balance */}
              {tenant.topupEnabled && (
                <button
                  onClick={() => setShowCharge(true)}
                  disabled={processing || preview.card.balanceCentavos === 0}
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-coffee-brand text-white font-semibold text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                  <span className="flex-1 text-left">
                    {preview.card.balanceCentavos === 0 ? 'Sin saldo disponible' : 'Cobrar saldo'}
                  </span>
                  {preview.card.balanceCentavos > 0 && (
                    <span className="text-white/70 text-xs">{preview.card.balanceMXN} disp.</span>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: result ── */}
      {result && (
        <div className="u-fade-up space-y-4">
          <div className={`u-result-hero ${result.success ? 'ok' : 'err'}`}>
            <div className="flex items-center gap-3">
              <div
                className="flex items-center justify-center"
                style={{ width: 52, height: 52, borderRadius: 16, background: 'rgba(255,255,255,0.18)' }}
              >
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {result.success
                    ? <polyline points="20 6 9 17 4 12" />
                    : <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>}
                </svg>
              </div>
              <div className="u-eyebrow" style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10 }}>
                {result.success ? 'Éxito' : 'Error'}
              </div>
            </div>
            <div className="u-display" style={{ fontSize: 28, fontWeight: 600, marginTop: 16, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
              {result.message}
            </div>
            {result.detail && (
              <div style={{ marginTop: 8, fontSize: 14, opacity: 0.9, lineHeight: 1.5 }}>{result.detail}</div>
            )}
          </div>
          <button onClick={reset} className="u-btn u-btn-primary" style={{ width: '100%' }}>
            Siguiente cliente
          </button>
        </div>
      )}
    </div>
  );
}
