import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CFG } from '../lib/config.js'
import { signIn } from '../lib/auth.jsx'
import '../styles.css'

export default function LoginScreen() {
  const navigate = useNavigate()
  const [view,     setView]     = useState('login') // 'login' | 'forgot' | 'sent'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [forgot,   setForgot]   = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await signIn(email.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Credenciales incorrectas')
    } finally {
      setLoading(false)
    }
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/local/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgot.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Error al enviar el correo')
      }
      setView('sent')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const logo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
        <rect width="32" height="32" rx="8" fill="var(--tenant-brand,#7692CB)" opacity=".15"/>
        <line x1="8" y1="8" x2="24" y2="24" stroke="var(--tenant-brand,#7692CB)" strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="24" y1="8" x2="8" y2="24" stroke="var(--tenant-brand,#7692CB)" strokeWidth="2.5" strokeLinecap="round"/>
      </svg>
      <div>
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>umi<em style={{ fontStyle: 'italic', color: 'var(--ink-3)' }}> · dash</em></div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Owner Console</div>
      </div>
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--canvas)',
    }}>
      <div style={{
        width: 400,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 18,
        padding: '40px 36px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
      }}>
        {logo}

        {view === 'login' && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>
              Bienvenido de vuelta
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 28 }}>
              {CFG.authMode === 'local'
                ? 'Inicia sesión con tu cuenta local del proyecto Umi.'
                : 'Inicia sesión con tu cuenta Supabase del proyecto Umi.'}
            </p>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label>Correo electrónico</label>
                <input
                  className="input tall"
                  type="email"
                  placeholder="admin@tunegocio.mx"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="field">
                <label>Contraseña</label>
                <input
                  className="input tall"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div style={{
                  background: 'var(--danger-soft, #fef2f2)',
                  border: '1px solid var(--danger, #dc2626)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: 'var(--danger, #dc2626)',
                }}>
                  {error}
                </div>
              )}

              <button
                className="btn btn-primary focusable"
                type="submit"
                disabled={loading}
                style={{ height: 46, fontSize: 15, marginTop: 4 }}
              >
                {loading ? 'Iniciando sesión…' : 'Iniciar sesión'}
              </button>

              {CFG.authMode === 'local' && (
                <button
                  type="button"
                  onClick={() => { setView('forgot'); setError(null) }}
                  style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'center', marginTop: 4 }}
                >
                  ¿Olvidaste tu contraseña?
                </button>
              )}
            </form>
          </>
        )}

        {view === 'forgot' && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>
              Reestablecer contraseña
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 28 }}>
              Ingresa tu correo y te enviamos un enlace de recuperación.
            </p>

            <form onSubmit={handleForgot} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="field">
                <label>Correo electrónico</label>
                <input
                  className="input tall"
                  type="email"
                  placeholder="admin@tunegocio.mx"
                  value={forgot}
                  onChange={e => setForgot(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div style={{
                  background: 'var(--danger-soft, #fef2f2)',
                  border: '1px solid var(--danger, #dc2626)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: 'var(--danger, #dc2626)',
                }}>
                  {error}
                </div>
              )}

              <button
                className="btn btn-primary focusable"
                type="submit"
                disabled={loading}
                style={{ height: 46, fontSize: 15, marginTop: 4 }}
              >
                {loading ? 'Enviando…' : 'Enviar enlace'}
              </button>

              <button
                type="button"
                onClick={() => { setView('login'); setError(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'center' }}
              >
                ← Volver al inicio de sesión
              </button>
            </form>
          </>
        )}

        {view === 'sent' && (
          <>
            <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>
              Revisa tu correo
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 28 }}>
              Si existe una cuenta con ese correo, te enviamos un enlace para reestablecer tu contraseña. El enlace expira en 15 minutos.
            </p>
            <button
              type="button"
              onClick={() => { setView('login'); setError(null) }}
              style={{ background: 'none', border: 'none', color: 'var(--ink-3)', fontSize: 13, cursor: 'pointer', padding: 0 }}
            >
              ← Volver al inicio de sesión
            </button>
          </>
        )}
      </div>
    </div>
  )
}
