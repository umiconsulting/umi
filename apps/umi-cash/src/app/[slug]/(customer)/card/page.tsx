'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { formatMXN } from '@/lib/currency';
import { useTenant } from '@/context/TenantContext';
import { formatDateTimeMX, formatDateShortMX } from '@/lib/intl';
import { isTokenValid } from '@/lib/token';
import type { CardState } from '@/types/api';
import { rewardExpiryLabel, rewardVisitCostLabel } from '@/lib/loyalty-operation';
import { profileFromWalletFields, progressLine } from '@/lib/reward-tiers';

function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const stored = localStorage.getItem('accessToken');
    setToken(isTokenValid(stored) ? stored : null);
  }, []);
  return token;
}

function UmiFishMark({
  width = 22,
  stroke = '#FFFDF8',
  eye = '#132642',
}: {
  width?: number;
  stroke?: string;
  eye?: string;
}) {
  const height = Math.round((width * 68) / 100);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 116 78"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M50 18 C47 8, 55 3, 66 7 C74 10, 79 16, 83 21 Z" fill={stroke} />
      <path d="M53 59 C50 68, 57 74, 67 70 C73 67, 77 62, 80 57 Z" fill={stroke} />
      <path
        d="M36 39 C28 27, 17 17, 10 20 C5 23, 8 33, 18 39 C8 46, 5 56, 10 59 C17 62, 28 51, 36 39 C45 24, 63 16, 80 19 C94 21, 105 30, 109 39 C105 49, 94 58, 79 60 C62 62, 45 54, 36 39 Z"
        stroke={stroke}
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="91.5" cy="37.5" r="5" fill={eye} />
    </svg>
  );
}

function UmiWordmark({ height = 11, color = '#132642' }: { height?: number; color?: string }) {
  const width = Math.round((height * 136) / 62);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 136 62"
      fill="none"
      aria-label="umi"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path
        d="M11 21 C10 34, 10 47, 17 53 C23 58, 34 57, 39 50 C40 53, 42 56, 46 56 C50 56, 52 52, 52 46 C52 38, 52 28, 51 21 C50 16, 42 16, 41 21 C40 28, 41 37, 37 42 C33 46, 26 46, 24 41 C22 36, 23 27, 22 21 C21 16, 12 16, 11 21 Z"
        fill={color}
      />
      <path
        d="M59 23 C58 32, 58 45, 59 52 C60 57, 68 57, 69 52 C70 46, 69 36, 72 32 C74 29, 78 30, 79 34 C80 39, 79 45, 81 49 C82 53, 89 53, 90 48 C91 42, 91 34, 94 31 C97 28, 101 30, 101 36 C102 42, 101 49, 103 53 C105 57, 113 56, 113 50 C113 41, 114 29, 109 22 C104 16, 95 17, 89 23 C85 18, 76 17, 70 22 C69 17, 60 17, 59 23 Z"
        fill={color}
      />
      <path
        d="M120 24 C119 33, 119 45, 120 52 C121 57, 130 57, 131 51 C132 43, 131 31, 130 24 C129 19, 121 19, 120 24 Z"
        fill={color}
      />
      <ellipse
        cx="125.5"
        cy="10.5"
        rx="6.8"
        ry="6.2"
        transform="rotate(-8 125.5 10.5)"
        fill={color}
      />
    </svg>
  );
}

function LoyaltyProgressDots({
  current,
  total,
  bonusFrom,
}: {
  current: number;
  total: number;
  bonusFrom?: number | null;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap justify-between">
      {Array.from({ length: total }).map((_, i) => {
        const bonus = bonusFrom != null && i >= bonusFrom;
        const filled = i < current;
        return (
          <div
            key={i}
            className={`naive-c-dot ${bonus ? 'bonus' : ''} ${filled ? 'filled' : ''}`}
            aria-label={bonus ? 'Sello extra' : 'Sello'}
          >
            {filled ? '✓' : ''}
          </div>
        );
      })}
    </div>
  );
}

function QRDisplay({
  token,
  slug,
  cardNumber,
}: {
  token: string;
  slug: string;
  cardNumber: string;
}) {
  const [qrData, setQrData] = useState<{ dataUrl: string; expiresAt: string } | null>(null);
  const [timeLeft, setTimeLeft] = useState(300);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const acquireWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch {}
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  const loadQR = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/${slug}/card/qr`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setQrData(data);
      setTimeLeft(300);
      acquireWakeLock();
    } finally {
      setLoading(false);
    }
  }, [token, slug, acquireWakeLock]);

  useEffect(() => {
    if (token) loadQR();
    return () => releaseWakeLock();
  }, [token, loadQR, releaseWakeLock]);

  useEffect(() => {
    if (!qrData) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          loadQR();
          return 300;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [qrData, loadQR]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const urgency = timeLeft < 60;

  return (
    <div className="naive-card-surface text-center">
      <h3 className="u-display text-base font-bold text-[#132642]">Tu código QR</h3>
      <p className="text-xs text-[#586A84] mt-0.5 mb-3">
        Muéstralo al barista para sumar tu sello
      </p>

      <div className="my-1">
        {loading ? (
          <div className="w-40 h-40 mx-auto bg-[#EFE7D8] rounded-2xl animate-pulse" />
        ) : qrData ? (
          <div className="naive-qr-frame">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrData.dataUrl}
              alt="Código QR de tu tarjeta"
              className="w-36 h-36"
              draggable={false}
            />
          </div>
        ) : (
          <div className="w-40 h-40 mx-auto bg-[#EFE7D8] rounded-2xl flex items-center justify-center">
            <span className="text-[#586A84] text-xs text-center px-4">Error al cargar el QR</span>
          </div>
        )}
      </div>

      <div
        className="mt-2.5 u-mono text-[11px] font-semibold"
        style={{ color: urgency ? '#AC312A' : 'var(--t-brand-dark, #132642)' }}
      >
        ● Válido por {minutes}:{seconds.toString().padStart(2, '0')} · {cardNumber}
      </div>

      <button
        onClick={loadQR}
        className="mt-1.5 text-[11px] text-[#586A84] underline hover:text-[#132642]"
      >
        ↺ Actualizar código
      </button>
    </div>
  );
}

function WalletButtons({ token, slug }: { token: string; slug: string }) {
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleApple() {
    setAppleLoading(true);
    try {
      const res = await fetch(`/api/${slug}/passes/apple`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Error al guardar en Apple Wallet');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.pkpass`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setAppleLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    try {
      const res = await fetch(`/api/${slug}/passes/google`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Error al guardar en Google Wallet');
        return;
      }
      const { saveUrl } = await res.json();
      if (!saveUrl || !saveUrl.startsWith('https://pay.google.com/')) {
        alert('URL de Google Wallet no válida.');
        return;
      }
      window.location.href = saveUrl;
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2.5">
      <button
        onClick={handleApple}
        disabled={appleLoading}
        className="h-[42px] rounded-[11.9px] bg-[#132642] text-[#FFFDF8] border border-[#132642] text-xs font-bold inline-flex items-center justify-center gap-1.5"
        style={{ boxShadow: '1.2px 1.2px 0 #132642' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
        </svg>
        <span>{appleLoading ? 'Guardando…' : 'Apple Wallet'}</span>
      </button>
      <button
        onClick={handleGoogle}
        disabled={googleLoading}
        className="h-[42px] rounded-[11.9px] bg-white text-[#132642] border border-[#132642]/20 text-xs font-bold inline-flex items-center justify-center gap-1.5"
        style={{ boxShadow: '1.2px 1.2px 0 #132642' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        <span>{googleLoading ? 'Guardando…' : 'Google Wallet'}</span>
      </button>
    </div>
  );
}

export default function CardPage() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const token = useAuth();
  const [card, setCard] = useState<CardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      if (typeof window !== 'undefined') window.location.href = `/${slug}/register`;
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    fetch(`/api/${slug}/card`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = `/${slug}/register`;
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setCard(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError('No pudimos cargar tu tarjeta');
      })
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [token, slug]);

  if (loading) {
    return (
      <div className="umi-naive-customer min-h-screen">
        <div className="loyalty-card h-64 animate-pulse" />
        <div className="max-w-sm mx-auto px-4 mt-4 space-y-4">
          <div className="h-48 bg-[#EFE7D8] rounded-2xl animate-pulse" />
          <div className="h-24 bg-[#EFE7D8] rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (error || !card) {
    return (
      <div className="umi-naive-customer min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-[#586A84]">{error || 'No pudimos cargar tu tarjeta'}</p>
          <button onClick={() => window.location.reload()} className="mt-4 naive-cust-cta px-6">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const firstName = card.customerName?.split(' ')[0] ?? 'Hola';
  const progressCopy =
    card.rewardPolicy === 'single_cycle' && card.visitsThisCycle >= card.visitsRequired
      ? `${card.rewardName} listo. Canjea antes de otra visita.`
      : progressLine(profileFromWalletFields(card), card.visitsThisCycle);

  return (
    <main className="umi-naive-customer min-h-screen pb-8">
      {/* Card hero in merchant brand color */}
      <div className="loyalty-card text-[#FFFDF8]">
        <div className="max-w-sm mx-auto px-5 pt-7 pb-5 relative z-10">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-white/75 text-[10px] u-mono font-semibold tracking-[0.18em] uppercase">
                {card.tenantName}
              </p>
              <h1 className="u-display text-[26px] font-bold mt-1 leading-tight inline-flex items-center gap-2">
                <span>¡Buenas, {firstName}!</span>
                <UmiFishMark width={23} stroke="#FFFDF8" eye="#132642" />
              </h1>
            </div>
            {tenant.topupEnabled && (
              <div className="text-right">
                <p className="text-white/70 text-[10px] u-mono uppercase tracking-widest">Saldo</p>
                <p className="u-display text-[22px] font-bold nums leading-tight">
                  {card.balanceMXN}
                </p>
              </div>
            )}
          </div>

          {card.pendingRewards > 0 && (
            <div className="naive-reward-banner mb-4">
              <div>
                <p className="font-bold text-[13px] text-[#132642]">
                  {card.pendingRewards === 1
                    ? 'Tienes 1 recompensa lista'
                    : `Tienes ${card.pendingRewards} recompensas listas`}
                </p>
                <p className="text-[#132642]/75 text-[11px] mt-0.5">
                  Pide tu{' '}
                  {card.rewardPolicy === 'single_cycle' && card.availableRewards?.length
                    ? card.availableRewards
                        .map((item) => `${item.quantity} × ${item.rewardName}`)
                        .join(', ')
                    : card.pendingRewardName ?? card.rewardName}{' '}
                  al barista
                </p>
              </div>
              <span className="naive-ready-pill">¡LISTA!</span>
            </div>
          )}

          <div className="mb-2">
            <div className="flex justify-between items-center mb-2 text-xs">
              <span className="text-white/85">Progreso de sellos</span>
              <strong className="u-mono text-white">
                {card.visitsThisCycle}/{card.visitsRequired} visitas
              </strong>
            </div>
            <LoyaltyProgressDots
              current={card.visitsThisCycle}
              total={card.visitsRequired}
              bonusFrom={card.baseReward?.visitsRequired ?? null}
            />
          </div>

          <p className="text-white/75 text-xs text-center mt-2">{progressCopy}</p>
          {card.rewardPolicy === 'single_cycle' && (
            <div className="text-white/90 text-xs text-center mt-2 space-y-1">
              {!!card.legacyPendingRewards && (
                <p>Saldo anterior: {card.legacyPendingRewards} recompensas.</p>
              )}
              {card.nextRewardExpiresAt && (
                <p>
                  Vence: {rewardExpiryLabel(card.nextRewardExpiresAt, card.merchantTimezone)} (
                  {card.merchantTimezone}).
                </p>
              )}
              {card.availableRewards?.map((item, index) => (
                <p key={index}>
                  {item.quantity} × {item.rewardName} · Vence:{' '}
                  {rewardExpiryLabel(item.expiresAt, card.merchantTimezone)}
                </p>
              ))}
              {card.baseReward?.ready && (
                <p>
                  {card.baseReward.rewardName}:{' '}
                  {rewardVisitCostLabel(card.visitsThisCycle, card.baseReward.visitsRequired)}
                </p>
              )}
              {card.cycleRewardAvailable && card.visitsThisCycle >= card.visitsRequired && (
                <p>
                  {card.rewardName}:{' '}
                  {rewardVisitCostLabel(card.visitsThisCycle, card.visitsRequired)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hand-drawn Naive wave edge */}
      <svg
        className="block w-full h-4 -mt-[1px]"
        viewBox="0 0 350 16"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d="M0 0 H350 V6 Q320 14, 290 7 T230 7 T170 7 T110 7 T50 7 T0 7 Z"
          fill="var(--t-brand, var(--color-brand))"
        />
        <path
          d="M0 7 Q25 14, 50 7 T110 7 T170 7 T230 7 T290 7 T350 6"
          fill="none"
          stroke="#132642"
          strokeWidth="2"
        />
      </svg>

      {/* Body */}
      <div className="max-w-sm mx-auto px-4 mt-3 space-y-3">
        {token && slug && <QRDisplay token={token} slug={slug} cardNumber={card.cardNumber} />}

        <div className="grid grid-cols-2 gap-2.5">
          <div className="naive-card-surface text-center py-3">
            <p className="u-display text-2xl font-bold text-[#132642] nums">{card.totalVisits}</p>
            <p className="u-mono text-[10px] uppercase tracking-wider text-[#586A84] mt-0.5">
              Visitas totales
            </p>
          </div>
          <div
            className="naive-card-surface text-center py-3"
            style={{ background: 'var(--t-tint, #FFFDF9)' }}
          >
            <p
              className="u-display text-2xl font-bold nums"
              style={{ color: 'var(--t-brand, #132642)' }}
            >
              {card.pendingRewards}
            </p>
            <p className="u-mono text-[10px] uppercase tracking-wider text-[#586A84] mt-0.5">
              {card.pendingRewards === 1 ? 'Recompensa' : 'Recompensas'}
            </p>
          </div>
        </div>

        {token && slug && <WalletButtons token={token} slug={slug} />}

        {card.recentVisits.length > 0 && (
          <div className="naive-card-surface">
            <h3 className="u-display font-bold text-sm text-[#132642] mb-2.5">Últimas visitas</h3>
            <div className="space-y-2">
              {card.recentVisits.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                      style={{ background: 'var(--t-brand, #132642)' }}
                    >
                      ✓
                    </span>
                    <span className="text-[#132642] font-medium">Visita registrada</span>
                  </div>
                  <span className="text-[#586A84]">
                    {formatDateTimeMX(new Date(v.scannedAt))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tenant.topupEnabled && card.recentTransactions.length > 0 && (
          <div className="naive-card-surface">
            <h3 className="u-display font-bold text-sm text-[#132642] mb-2.5">
              Movimientos de saldo
            </h3>
            <div className="space-y-2">
              {card.recentTransactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <div>
                    <p className="text-[#132642] font-medium">{t.description || 'Movimiento'}</p>
                    <p className="text-[#586A84]">
                      {formatDateShortMX(new Date(t.createdAt))}
                    </p>
                  </div>
                  <span
                    className={`font-bold nums ${t.amountCentavos > 0 ? 'text-[#256F4B]' : 'text-[#AC312A]'}`}
                  >
                    {t.amountCentavos > 0 ? '+' : ''}
                    {formatMXN(t.amountCentavos)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 pt-2 text-[11px] text-[#586A84]">
          <span>{tenant.topupEnabled ? 'Tu saldo nunca vence ·' : 'Impulsado por'}</span>
          <UmiFishMark width={16} stroke="#E66025" eye="#132642" />
          <UmiWordmark height={11} color="#132642" />
          <span>·</span>
          <a href={`/${slug}/terminos`} className="underline">
            Términos
          </a>
        </div>
      </div>
    </main>
  );
}
