'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const UMI_NAVY = '#223979';
const UMI_BLUE = '#7692CB';
const UMI_SURFACE = '#F5F7FC';
const UMI_SURFACE_DARK = '#D4DFEF';
const UMI_INK = '#1A1F33';
const UMI_INK_LIGHT = '#5A6378';

function UmiMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 80" fill="none" aria-hidden>
      <path d="M30 22 L60 4 L90 22" stroke={UMI_NAVY} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="60" y="68" textAnchor="middle" fontFamily='"Domus", "Quicksand", system-ui, sans-serif' fontSize="38" fontWeight="600" fill={UMI_NAVY} letterSpacing="-1">umi</text>
    </svg>
  );
}

export default function UmiLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/umi/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push('/umi/admin');
    } else {
      const data = await res.json();
      setError(data.error || 'Error al iniciar sesión');
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4" style={{ background: UMI_SURFACE }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8 u-fade-up">
          <div className="mx-auto mb-4" style={{ width: 56 }}>
            <UmiMark size={56} />
          </div>
          <div className="u-eyebrow" style={{ color: UMI_BLUE }}>Panel interno</div>
          <h1 className="u-display" style={{ fontSize: 28, fontWeight: 600, color: UMI_NAVY, marginTop: 6, letterSpacing: '-0.02em' }}>
            Umi Cash
          </h1>
          <p style={{ fontSize: 13, color: UMI_INK_LIGHT, marginTop: 4 }}>
            UMI Consultoría · Master Admin
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="u-fade-up d1 rounded-2xl p-6 space-y-4"
          style={{ background: '#fff', border: `1px solid ${UMI_SURFACE_DARK}` }}
        >
          <div>
            <div className="u-eyebrow" style={{ color: UMI_INK_LIGHT, marginBottom: 6 }}>Contraseña</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="u-input"
              placeholder="••••••••"
              autoFocus
              required
              style={{ borderColor: UMI_SURFACE_DARK }}
            />
          </div>

          {error && (
            <p className="text-sm text-center" style={{ color: 'var(--color-danger)' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="u-btn"
            style={{ width: '100%', background: UMI_NAVY, color: '#fff' }}
          >
            {loading ? 'Entrando…' : 'Entrar →'}
          </button>
        </form>

        <p className="text-center mt-6" style={{ fontSize: 11, color: UMI_INK_LIGHT }}>
          Acceso restringido a personal autorizado.
        </p>
      </div>
    </main>
  );
}
