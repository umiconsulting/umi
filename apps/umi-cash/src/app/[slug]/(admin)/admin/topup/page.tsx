'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';
import { COMMON_TOPUP_AMOUNTS, centavosFromPesos, formatMXN } from '@/lib/currency';
import { authedFetch } from '@/lib/authed-fetch';

interface CustomerSearchResult {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  cardId: string;
  cardNumber: string;
  balanceMXN: string;
  totalVisits: number;
}

// Decode the card ID from the QR JWT payload (client-side, no signature verification needed)
function decodeQRCardId(jwt: string): string | null {
  try {
    const [, payload] = jwt.split('.');
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (decoded.type !== 'SCAN') return null;
    return decoded.sub ?? null;
  } catch {
    return null;
  }
}

export default function TopUpPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const tenant = useTenant();

  // Redirect if topup is disabled for this tenant
  useEffect(() => {
    if (!tenant.topupEnabled) router.replace(`/${slug}/admin`);
  }, [tenant.topupEnabled, slug, router]);

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<CustomerSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [cardId, setCardId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean; message: string; newBalanceMXN?: string; customer?: string;
  } | null>(null);

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastScannedRef = useRef<string>('');
  const [showCamera, setShowCamera] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [scanProcessing, setScanProcessing] = useState(false);

  function selectAmount(centavos: number) { setAmount(String(centavos / 100)); }

  // ── Camera ────────────────────────────────────────────────────────────────

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
      setCameraError('No se pudo acceder a la cámara.');
    }
  }

  function stopCamera() {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
    setShowCamera(false);
  }

  function startQRDetection() {
    if (!('BarcodeDetector' in window)) {
      setCameraError('Tu dispositivo no soporta escaneo automático. Ingresa el número manualmente.');
      return;
    }
    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    async function detect() {
      if (!videoRef.current || !streamRef.current) return;
      if (videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx?.drawImage(videoRef.current, 0, 0);
        try {
          const barcodes = await detector.detect(canvas);
          if (barcodes.length > 0) {
            const value = barcodes[0].rawValue;
            if (value && value !== lastScannedRef.current) {
              lastScannedRef.current = value;
              await handleQRScanned(value);
              setTimeout(() => { lastScannedRef.current = ''; }, 3000);
            }
          }
        } catch {}
      }
      if (streamRef.current) rafRef.current = requestAnimationFrame(detect);
    }
    rafRef.current = requestAnimationFrame(detect);
  }

  async function handleQRScanned(payload: string) {
    setScanProcessing(true);
    const scannedCardId = decodeQRCardId(payload);
    if (!scannedCardId) {
      setCameraError('Código QR no válido. Asegúrate de escanear la tarjeta del cliente.');
      setScanProcessing(false);
      return;
    }

    try {
      const res = await authedFetch(slug, `/api/${slug}/admin/customers?search=${encodeURIComponent(scannedCardId)}&limit=1`);
      if (res.ok) {
        const data = await res.json();
        const found = (data.customers ?? []).find((c: CustomerSearchResult) => c.cardId === scannedCardId);
        if (found) {
          selectCustomer(found);
        } else {
          // Fallback: set cardId directly, name will appear in success response
          setCardId(scannedCardId);
          setShowCamera(false);
          stopCamera();
        }
      }
    } catch {
      setCardId(scannedCardId);
    } finally {
      setScanProcessing(false);
      stopCamera();
    }
  }

  useEffect(() => { return () => stopCamera(); }, []);

  // ── Customer search ───────────────────────────────────────────────────────

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearchLoading(true);
    setSearchResults([]);
    try {
      const res = await authedFetch(slug, `/api/${slug}/admin/customers?search=${encodeURIComponent(search.trim())}&limit=5`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.customers ?? []);
      }
    } catch {}
    finally { setSearchLoading(false); }
  }

  function selectCustomer(c: CustomerSearchResult) {
    setSelectedCustomer(c);
    setCardId(c.cardId);
    setSearchResults([]);
    setSearch('');
    stopCamera();
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCardId('');
    setResult(null);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);

    try {
      let amountCentavos: number;
      try { amountCentavos = centavosFromPesos(amount); } catch {
        setResult({ success: false, message: 'Monto inválido' }); return;
      }

      if (amountCentavos < 100) { setResult({ success: false, message: 'El monto mínimo es $1.00 MXN' }); return; }

      const res = await authedFetch(slug, `/api/${slug}/admin/topup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: cardId.trim(), amountCentavos, note }),
      });

      const data = await res.json();
      if (res.ok) {
        setResult({ success: true, message: `Recarga exitosa: ${data.amountMXN}`, newBalanceMXN: data.newBalanceMXN, customer: data.customer });
        setCardId(''); setAmount(''); setNote(''); setSelectedCustomer(null);
      } else {
        setResult({ success: false, message: data.error || 'Error al recargar' });
      }
    } catch {
      setResult({ success: false, message: 'Error de conexión' });
    } finally {
      setLoading(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-5 py-6 max-w-lg mx-auto">
      <div className="u-fade-up mb-6">
        <div className="u-eyebrow mb-2">Movimiento de saldo</div>
        <h1 className="u-display" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--color-ink)', margin: 0 }}>
          Recargar saldo
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="u-surface p-5">
          <div className="u-eyebrow mb-3">Cliente</div>

          {selectedCustomer ? (
            <div className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: 'var(--color-surface-dark)' }}>
              <div>
                <p className="font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>{selectedCustomer.name ?? 'Sin nombre'}</p>
                <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{selectedCustomer.phone ?? selectedCustomer.email} · {selectedCustomer.cardNumber} · {selectedCustomer.balanceMXN}</p>
              </div>
              <button type="button" onClick={clearCustomer} className="ml-3 flex-shrink-0" style={{ color: 'var(--color-ink-light)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ) : (
            <>
              {/* QR Camera */}
              {showCamera ? (
                <div className="mb-3">
                  <div className="relative bg-black rounded-xl overflow-hidden aspect-[4/3] mb-2">
                    <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                    {scanning && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-44 h-44 border-2 rounded-xl opacity-80" style={{ borderColor: 'rgba(255,255,255,0.8)' }}>
                          <div className="absolute top-0 left-0 w-6 h-6 border-t-4 border-l-4 rounded-tl-lg" style={{ borderColor: 'rgba(255,255,255,0.9)' }} />
                          <div className="absolute top-0 right-0 w-6 h-6 border-t-4 border-r-4 rounded-tr-lg" style={{ borderColor: 'rgba(255,255,255,0.9)' }} />
                          <div className="absolute bottom-0 left-0 w-6 h-6 border-b-4 border-l-4 rounded-bl-lg" style={{ borderColor: 'rgba(255,255,255,0.9)' }} />
                          <div className="absolute bottom-0 right-0 w-6 h-6 border-b-4 border-r-4 rounded-br-lg" style={{ borderColor: 'rgba(255,255,255,0.9)' }} />
                        </div>
                      </div>
                    )}
                    {scanProcessing && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
                        <div className="text-white text-center">
                          <svg className="w-8 h-8 mx-auto mb-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                            <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
                          </svg>
                          <p className="text-sm">Buscando cliente...</p>
                        </div>
                      </div>
                    )}
                  </div>
                  {cameraError && (
                    <p className="text-sm text-center mb-2 rounded-lg px-3 py-2" style={{ color: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}>{cameraError}</p>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={scanning ? stopCamera : startCamera} className={`u-btn ${scanning ? 'u-btn-secondary' : 'u-btn-primary'}`} style={{ flex: 1 }}>
                      {scanning ? 'Detener cámara' : 'Activar cámara'}
                    </button>
                    <button type="button" onClick={stopCamera} className="u-btn u-btn-secondary px-4">Cancelar</button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setShowCamera(true); setTimeout(startCamera, 100); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed transition-colors mb-3 text-sm font-medium"
                  style={{ borderColor: 'var(--color-surface-dark)', color: 'var(--color-ink-light)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" /><path d="M14 14h.01M14 17h.01M17 14h.01M17 17h.01M20 14h.01M20 17h.01M20 20h.01M17 20h.01M14 20h.01" />
                  </svg>
                  Escanear QR del cliente
                </button>
              )}

              {/* Text search */}
              <form onSubmit={handleSearch} className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, teléfono o tarjeta..."
                  className="u-input flex-1"
                  autoFocus={!showCamera}
                />
                <button type="submit" disabled={!search.trim() || searchLoading} className="u-btn u-btn-secondary px-4 flex-shrink-0">
                  {searchLoading ? '...' : 'Buscar'}
                </button>
              </form>

              {searchResults.length > 0 && (
                <div className="rounded-xl overflow-hidden divide-y" style={{ border: '1px solid var(--color-surface-dark)', borderColor: 'var(--color-surface-dark)' }}>
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2.5 transition-colors"
                    >
                      <p className="font-medium text-sm" style={{ color: 'var(--color-ink)' }}>{c.name ?? 'Sin nombre'}</p>
                      <p className="text-xs" style={{ color: 'var(--color-ink-light)' }}>{c.phone ?? c.email} · {c.cardNumber} · {c.balanceMXN}</p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="u-surface p-5">
          <div className="u-eyebrow mb-3">Monto (MXN)</div>
          {amount && !isNaN(parseFloat(amount)) ? (
            <p className="u-display mb-3" style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--color-ink)', margin: 0 }}>
              {formatMXN(Math.round(parseFloat(amount) * 100))}
            </p>
          ) : (
            <p className="u-display mb-3" style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.03em', color: 'var(--color-ink-light)', margin: 0, opacity: 0.4 }}>
              $0.00
            </p>
          )}
          <div className="grid grid-cols-4 gap-2 mb-3">
            {COMMON_TOPUP_AMOUNTS.map(({ label, centavos }) => {
              const on = amount === String(centavos / 100);
              return (
                <button
                  key={centavos}
                  type="button"
                  onClick={() => selectAmount(centavos)}
                  className="py-2 rounded-xl text-sm font-medium transition-colors"
                  style={{
                    background: on ? 'var(--color-ink)' : 'var(--color-surface-dark)',
                    color: on ? '#fff' : 'var(--color-ink-light)',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Otro monto, ej: 350" className="u-input" min="1" max="10000" step="0.01" required />
        </div>

        <div className="u-surface p-5">
          <div className="u-eyebrow mb-2">Nota (opcional)</div>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Recarga en tienda" className="u-input" maxLength={200} />
        </div>

        {result && (
          <div className={`u-result-hero ${result.success ? 'ok' : 'err'}`}>
            <div className="u-eyebrow" style={{ color: 'rgba(255,255,255,0.85)' }}>{result.success ? 'Recarga exitosa' : 'No se pudo recargar'}</div>
            <p className="u-display mt-1" style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{result.message}</p>
            {result.success && result.newBalanceMXN && (
              <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.9)' }}>Nuevo saldo: <span className="font-semibold">{result.newBalanceMXN}</span></p>
            )}
            {result.customer && <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.8)' }}>Cliente: {result.customer}</p>}
          </div>
        )}

        <button type="submit" disabled={loading || !cardId || !amount} className="u-btn u-btn-primary w-full">
          {loading ? 'Procesando...' : 'Recargar saldo'}
        </button>
      </form>
    </div>
  );
}
