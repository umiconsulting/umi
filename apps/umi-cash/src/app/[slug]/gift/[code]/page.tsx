'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface GiftCardInfo {
  code: string;
  isRedeemed: boolean;
  tenantName: string;
  hasMessage: boolean;
}

export default function GiftRedeemPage() {
  const { slug, code } = useParams<{ slug: string; code: string }>();
  const [info, setInfo] = useState<GiftCardInfo | null>(null);
  const [loadError, setLoadError] = useState('');

  const [contact, setContact] = useState('');
  const [contactType, setContactType] = useState<'email' | 'phone'>('email');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    newBalanceMXN?: string;
    customerName?: string;
    needsRegistration?: boolean;
  } | null>(null);

  useEffect(() => {
    fetch(`/api/${slug}/gift/${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setLoadError(d.error); return; }
        setInfo(d);
      })
      .catch(() => setLoadError('Error al cargar la tarjeta de regalo'));
  }, [slug, code]);

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const body = contactType === 'email'
        ? { email: contact.trim() }
        : { phone: contact.trim() };

      const res = await fetch(`/api/${slug}/gift/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          success: true,
          message: `¡Regalo canjeado! Se agregaron ${data.amountMXN} a tu tarjeta.`,
          newBalanceMXN: data.newBalanceMXN,
          customerName: data.customerName,
        });
        setInfo((prev) => prev ? { ...prev, isRedeemed: true } : prev);
      } else {
        setResult({
          success: false,
          message: data.error || 'Error al canjear',
          needsRegistration: data.needsRegistration,
        });
      }
    } catch {
      setResult({ success: false, message: 'Error de conexión' });
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-coffee-cream flex items-center justify-center p-4">
        <div className="card-surface text-center max-w-sm w-full">
          <p className="text-4xl mb-3">❌</p>
          <p className="text-coffee-dark font-semibold">{loadError}</p>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="min-h-screen bg-coffee-cream flex items-center justify-center">
        <div className="text-coffee-medium">Cargando...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-coffee-cream flex flex-col">
      {/* Header card */}
      <div className="loyalty-card text-white px-6 py-10 text-center">
        <div className="max-w-sm mx-auto relative z-10">
          <p className="text-white/70 text-sm mb-1">{info.tenantName}</p>
          <p className="text-4xl mb-1">🎁</p>
          <p className="text-white/80 text-lg">Tarjeta de regalo</p>
          {info.hasMessage && (
            <p className="text-white/70 text-sm mt-3">Incluye un mensaje personal</p>
          )}
        </div>
      </div>

      <div className="flex-1 px-4 py-8 max-w-sm mx-auto w-full">
        {info.isRedeemed ? (
          <div className="card-surface text-center">
            <p className="text-3xl mb-3">✓</p>
            <p className="font-semibold text-coffee-dark">Esta tarjeta ya fue canjeada</p>
            <p className="text-sm text-coffee-medium mt-1">El saldo fue agregado a una tarjeta de lealtad.</p>
          </div>
        ) : result?.success ? (
          <div className="card-surface border-2 border-green-400 bg-green-50 text-center">
            <p className="text-3xl mb-3">🎉</p>
            <p className="font-semibold text-green-800 text-lg">{result.message}</p>
            {result.newBalanceMXN && (
              <p className="text-coffee-dark mt-3">
                Tu nuevo saldo: <span className="font-bold text-xl">{result.newBalanceMXN}</span>
              </p>
            )}
            <p className="text-sm text-coffee-medium mt-3">
              Tu pase de wallet se actualizará automáticamente.
            </p>
          </div>
        ) : (
          <form onSubmit={handleRedeem} className="space-y-4">
            <div className="card-surface">
              <p className="text-sm font-semibold text-coffee-dark mb-3">
                ¿Cómo te identificamos?
              </p>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setContactType('email')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    contactType === 'email' ? 'bg-coffee-dark text-white' : 'bg-coffee-pale text-coffee-medium'
                  }`}
                >
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setContactType('phone')}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-colors ${
                    contactType === 'phone' ? 'bg-coffee-dark text-white' : 'bg-coffee-pale text-coffee-medium'
                  }`}
                >
                  Teléfono
                </button>
              </div>
              <input
                type={contactType === 'email' ? 'email' : 'tel'}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={contactType === 'email' ? 'tu@email.com' : '55 1234 5678'}
                className="input-field"
                required
                autoFocus
              />
              <p className="text-xs text-coffee-light mt-2">
                Ingresa el {contactType === 'email' ? 'email' : 'teléfono'} con el que te registraste (con o sin código de país).
              </p>
            </div>

            {result && !result.success && (
              <div className="card-surface border-2 border-red-400 bg-red-50">
                <p className="text-red-800 font-medium text-sm">{result.message}</p>
                {result.needsRegistration && (
                  <p className="text-sm text-red-700 mt-2">
                    <a href={`/${slug}/register`} className="underline font-semibold">
                      Regístrate aquí
                    </a>{' '}
                    para obtener tu tarjeta de lealtad y luego vuelve a canjear este regalo.
                  </p>
                )}
              </div>
            )}

            <button type="submit" disabled={loading || !contact.trim()} className="btn-primary w-full">
              {loading ? 'Canjeando...' : 'Canjear regalo'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
