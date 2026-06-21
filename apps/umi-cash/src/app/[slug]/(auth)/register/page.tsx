'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';

function WalletAddButtons({ token, slug }: { token: string; slug: string }) {
  const [appleLoading, setAppleLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [isApple, setIsApple] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [appleAdded, setAppleAdded] = useState(false);
  const [googleAdded, setGoogleAdded] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsApple(/iPhone|iPad|iPod/.test(ua));
    setIsAndroid(/Android/.test(ua));
  }, []);

  async function handleApple() {
    setAppleLoading(true);
    try {
      const res = await fetch(`/api/${slug}/passes/apple`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Error al guardar en Apple Wallet.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.pkpass`;
      a.click();
      URL.revokeObjectURL(url);
      setAppleAdded(true);
    } catch {
      alert('Error al guardar en Apple Wallet.');
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
        alert(err.error || 'Error al guardar en Google Wallet.');
        return;
      }
      const { saveUrl } = await res.json();
      if (!saveUrl || !saveUrl.startsWith('https://pay.google.com/')) {
        alert('URL de Google Wallet no válida.');
        return;
      }
      window.location.href = saveUrl;
      setGoogleAdded(true);
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      {(isApple || (!isApple && !isAndroid)) && (
        <button
          onClick={handleApple}
          disabled={appleLoading}
          className={`apple-wallet-btn w-full justify-center ${appleAdded ? 'opacity-70' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
          </svg>
          {appleLoading ? 'Guardando...' : appleAdded ? '✓ Guardado en Apple Wallet' : 'Guardar en Apple Wallet'}
        </button>
      )}
      {(isAndroid || (!isApple && !isAndroid)) && (
        <button
          onClick={handleGoogle}
          disabled={googleLoading}
          className={`google-wallet-btn w-full justify-center ${googleAdded ? 'opacity-70' : ''}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {googleLoading ? 'Guardando...' : googleAdded ? '✓ Guardado en Google Wallet' : 'Guardar en Google Wallet'}
        </button>
      )}
    </div>
  );
}

interface SuccessState {
  name: string;
  token: string;
}

const COUNTRY_CODES = [
  { dial: '52',  flag: '🇲🇽', name: 'México' },
  { dial: '1',   flag: '🇺🇸', name: 'EE. UU. / Canadá' },
  { dial: '34',  flag: '🇪🇸', name: 'España' },
  { dial: '54',  flag: '🇦🇷', name: 'Argentina' },
  { dial: '57',  flag: '🇨🇴', name: 'Colombia' },
  { dial: '56',  flag: '🇨🇱', name: 'Chile' },
  { dial: '51',  flag: '🇵🇪', name: 'Perú' },
  { dial: '58',  flag: '🇻🇪', name: 'Venezuela' },
  { dial: '593', flag: '🇪🇨', name: 'Ecuador' },
  { dial: '502', flag: '🇬🇹', name: 'Guatemala' },
  { dial: '503', flag: '🇸🇻', name: 'El Salvador' },
  { dial: '504', flag: '🇭🇳', name: 'Honduras' },
  { dial: '505', flag: '🇳🇮', name: 'Nicaragua' },
  { dial: '506', flag: '🇨🇷', name: 'Costa Rica' },
  { dial: '507', flag: '🇵🇦', name: 'Panamá' },
  { dial: '591', flag: '🇧🇴', name: 'Bolivia' },
  { dial: '595', flag: '🇵🇾', name: 'Paraguay' },
  { dial: '598', flag: '🇺🇾', name: 'Uruguay' },
  { dial: '1',   flag: '🇩🇴', name: 'Rep. Dominicana' },
];

export default function RegisterPage() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [dialCode, setDialCode] = useState('52');
  const [localPhone, setLocalPhone] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<SuccessState | null>(null);

  function getFullPhone() {
    const digits = localPhone.replace(/\D/g, '');
    return `+${dialCode}${digits}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const digits = localPhone.replace(/\D/g, '');
    if (digits.length < 6) {
      setError('Ingresa un número de teléfono válido');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/${slug}/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: getFullPhone(),
          birthDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && data.accessToken) {
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('userRole', data.user.role);
          setSuccess({ name: data.user.name?.split(' ')[0] || 'tú', token: data.accessToken });
        } else {
          setError(data.error || 'Error al registrarse');
        }
        return;
      }

      if (data.accessToken) {
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('userRole', data.user.role);
        setSuccess({ name: name.split(' ')[0], token: data.accessToken });
      } else {
        setError('Cuenta creada. Escanea tu QR en tienda o contacta al personal.');
      }
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <main className="min-h-screen flex flex-col" style={{ background: 'var(--color-surface)' }}>
        <div className="px-6 pt-10 pb-4 max-w-lg mx-auto w-full">
          <div className="u-eyebrow" style={{ color: 'var(--color-brand)' }}>Bienvenida</div>
          <h1 className="u-display mt-3" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05, color: 'var(--color-ink)' }}>
            Tu tarjeta está lista, {success.name}.
          </h1>
          <p className="mt-2" style={{ fontSize: 14, color: 'var(--color-ink-light)', maxWidth: 320 }}>
            Guárdala en tu Wallet para mostrarla en cada visita.
          </p>
        </div>

        <div className="flex-1 px-5 pb-10 max-w-lg mx-auto w-full space-y-4">
          <div className="u-surface p-5">
            <div className="u-eyebrow mb-3 text-center">Guarda tu tarjeta</div>
            <WalletAddButtons token={success.token} slug={slug} />
          </div>

          <div className="flex flex-col gap-4 pt-2">
            {[
              { n: '01', t: 'Pide tu café', s: 'Muestra el QR al pagar.' },
              { n: '02', t: 'Suma sellos', s: 'Cada visita cuenta.' },
              { n: '03', t: 'Canjea recompensas', s: 'Tu recompensa llega sola.' },
            ].map((r) => (
              <div key={r.n} className="flex gap-4 items-start">
                <div className="u-display" style={{ width: 32, fontSize: 20, color: 'var(--color-brand)', fontWeight: 600 }}>{r.n}</div>
                <div className="flex-1">
                  <div className="font-semibold" style={{ fontSize: 14, color: 'var(--color-ink)' }}>{r.t}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-ink-light)', marginTop: 2 }}>{r.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: 'var(--color-surface)' }}>
      <div className="px-6 pt-10 pb-2 max-w-lg mx-auto w-full">
        <Link href={`/${slug}`} className="u-eyebrow hover:opacity-80" style={{ color: 'var(--color-ink-light)' }}>
          ← {tenant.name}
        </Link>
        <div className="u-eyebrow mt-1" style={{ color: 'var(--color-ink-light)' }}>Paso 1 de 2</div>
        <h2 className="u-display mt-3" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1, maxWidth: 300, color: 'var(--color-ink)' }}>
          Vamos a crear tu tarjeta
        </h2>
        <p className="mt-2" style={{ fontSize: 14, color: 'var(--color-ink-light)' }}>
          Tomará menos de un minuto.
        </p>

        <div className="flex gap-1.5 mt-6">
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: i <= 1 ? 'var(--color-brand)' : 'var(--color-surface-dark)',
              }}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 px-6 pt-8 pb-32 max-w-lg mx-auto w-full">
        <form id="register-form" onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div>
            <label className="u-eyebrow" style={{ fontSize: 10 }}>Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="María García"
              className="u-input mt-1.5"
              required
              autoComplete="name"
            />
          </div>

          <div>
            <label className="u-eyebrow" style={{ fontSize: 10 }}>Cumpleaños</label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="u-input mt-1.5"
              max={new Date().toISOString().split('T')[0]}
              required
            />
            <div className="mt-2 flex items-center gap-2" style={{ fontSize: 12, color: 'var(--color-ink-light)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-brand)' }}>
                <polyline points="20 12 20 22 4 22 4 12" />
                <rect x="2" y="7" width="20" height="5" />
                <line x1="12" y1="22" x2="12" y2="7" />
                <path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z" />
                <path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z" />
              </svg>
              Te daremos un regalo en tu mes de cumpleaños.
            </div>
          </div>

          <div>
            <label className="u-eyebrow" style={{ fontSize: 10 }}>Teléfono</label>
            <div className="flex gap-2 mt-1.5">
              <div className="relative flex-shrink-0">
                <select
                  value={dialCode}
                  onChange={(e) => setDialCode(e.target.value)}
                  className="appearance-none h-[52px] pl-3 pr-7 rounded-[14px] text-sm cursor-pointer"
                  style={{
                    border: '1px solid var(--color-surface-dark)',
                    background: '#fff',
                    color: 'var(--color-ink)',
                    outline: 'none',
                  }}
                  aria-label="Código de país"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={`${c.dial}-${c.name}`} value={c.dial}>
                      {c.flag} +{c.dial}
                    </option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3" style={{ color: 'var(--color-ink-light)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <input
                type="tel"
                value={localPhone}
                onChange={(e) => setLocalPhone(e.target.value)}
                placeholder="55 1234 5678"
                className="u-input flex-1"
                autoComplete="tel-national"
                required
                inputMode="numeric"
              />
            </div>
          </div>

          <label className="flex items-start gap-3 cursor-pointer mt-1">
            <input
              type="checkbox"
              checked={privacyAccepted}
              onChange={(e) => setPrivacyAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 flex-shrink-0"
              required
            />
            <span style={{ fontSize: 12, color: 'var(--color-ink-light)', lineHeight: 1.5 }}>
              He leído y acepto el{' '}
              <Link href={`/${slug}/aviso-privacidad`} className="underline font-medium" style={{ color: 'var(--color-ink)' }} target="_blank">Aviso de Privacidad</Link>{' '}y los{' '}
              <Link href={`/${slug}/terminos`} className="underline font-medium" style={{ color: 'var(--color-ink)' }} target="_blank">Términos</Link>.
            </span>
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}
        </form>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 px-5 pb-7 pt-4"
        style={{ background: 'linear-gradient(180deg, transparent 0%, var(--color-surface) 28%)' }}
      >
        <div className="max-w-lg mx-auto">
          <button
            type="submit"
            form="register-form"
            disabled={loading || !name || !birthDate || !localPhone || !privacyAccepted}
            className="u-btn u-btn-primary w-full"
            style={{ width: '100%', height: 54 }}
          >
            {loading ? 'Creando tarjeta...' : 'Crear mi tarjeta →'}
          </button>
        </div>
      </div>
    </main>
  );
}
