'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTenant } from '@/context/TenantContext';

export default function AdminLoginPage() {
  const { slug } = useParams<{ slug: string }>();
  const tenant = useTenant();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/${slug}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email, password }),
      });

      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('userRole', data.user.role);
        window.location.href = `/${slug}/admin`;
        return;
      }

      setError('Credenciales inválidas');
    } catch {
      setError('Error de conexión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen" style={{ background: 'var(--color-surface)' }}>
      <div className="px-6 pt-4 pb-[140px] max-w-lg mx-auto">
        {/* Wordmark header */}
        <div className="flex items-center justify-between pt-2 pb-1">
          <div
            className="uppercase"
            style={{
              fontFamily: '"Domus", serif',
              fontWeight: 400,
              fontSize: 15,
              letterSpacing: '0.04em',
              color: 'var(--color-brand-dark)',
            }}
          >
            {tenant.name}
          </div>
          <Link href={`/${slug}`} className="text-xs" style={{ color: 'var(--color-ink-light)' }}>
            ← Inicio
          </Link>
        </div>

        <div className="u-fade-up" style={{ marginTop: 36 }}>
          <h1
            className="u-display"
            style={{
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: '-0.025em',
              lineHeight: 1.05,
              margin: 0,
              color: 'var(--color-ink)',
              whiteSpace: 'pre-line',
            }}
          >
            {'Panel de\ngestión.'}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--color-ink)', opacity: 0.65, margin: '12px 0 0', lineHeight: 1.5, maxWidth: 320 }}>
            Accede para registrar visitas, consultar clientes y administrar tu programa de lealtad.
          </p>
        </div>

        <form onSubmit={handleLogin} id="admin-login-form" className="u-fade-up d2" style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="u-eyebrow" style={{ marginBottom: 6 }}>Correo electrónico</div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={`hola@${slug}.mx`}
              className="u-input"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <div className="u-eyebrow" style={{ marginBottom: 6 }}>Contraseña</div>
            <div style={{ position: 'relative' }}>
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="u-input"
                required
                autoComplete="current-password"
                style={{ paddingRight: 46 }}
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--color-ink-light)', padding: 4,
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          {error && (
            <div
              className="rounded-xl p-3 text-sm"
              style={{ background: 'color-mix(in oklab, var(--color-danger) 12%, white)', color: 'var(--color-danger)' }}
            >
              {error}
            </div>
          )}

          <div style={{ textAlign: 'right', marginTop: -6 }}>
            <span style={{ fontSize: 13, color: 'var(--color-brand)', fontWeight: 500 }}>¿Olvidaste tu contraseña?</span>
          </div>
        </form>
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 px-5 pb-7 pt-5"
        style={{ background: 'linear-gradient(180deg, transparent 0%, var(--color-surface) 28%)' }}
      >
        <div className="max-w-lg mx-auto">
          <button
            type="submit"
            form="admin-login-form"
            disabled={loading}
            className="u-btn u-btn-primary"
            style={{ width: '100%', height: 54 }}
          >
            {loading ? 'Entrando…' : 'Entrar →'}
          </button>
        </div>
      </div>
    </main>
  );
}
