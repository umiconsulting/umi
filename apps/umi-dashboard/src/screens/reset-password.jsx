import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/auth.jsx'
import '../styles.css'

export default function ResetPasswordScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { setNeedsPasswordReset } = useAuth()

  const localToken = searchParams.get('token')
  const isLocal = !!localToken

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [done,     setDone]     = useState(false)
  // For Supabase flow: wait for PASSWORD_RECOVERY session
  const [ready,    setReady]    = useState(isLocal)

  useEffect(() => {
    if (isLocal) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [isLocal])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) { setError('Las contraseñas no coinciden'); return }
    if (password.length < 8)  { setError('Mínimo 8 caracteres'); return }
    setError(null)
    setLoading(true)
    try {
      if (isLocal) {
        const res = await fetch('/api/auth/local/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: localToken, password }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Error al reestablecer la contraseña')
        setDone(true)
      } else {
        const { error: err } = await supabase.auth.updateUser({ password })
        if (err) throw err
        setNeedsPasswordReset(false)
        navigate('/', { replace: true })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--canvas)' }}>
        <div style={{ width:400, background:'var(--surface)', border:'1px solid var(--line)', borderRadius:18, padding:'40px 36px', boxShadow:'0 8px 40px rgba(0,0,0,0.08)' }}>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6, letterSpacing:'-0.02em' }}>Contraseña actualizada</h2>
          <p style={{ fontSize:13.5, color:'var(--ink-2)', marginBottom:28 }}>
            Tu contraseña fue reestablecida correctamente. Ya puedes iniciar sesión.
          </p>
          <button
            className="btn btn-primary focusable"
            onClick={() => navigate('/login', { replace: true })}
            style={{ height:46, fontSize:15 }}
          >
            Ir al inicio de sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--canvas)' }}>
      <div style={{ width:400, background:'var(--surface)', border:'1px solid var(--line)', borderRadius:18, padding:'40px 36px', boxShadow:'0 8px 40px rgba(0,0,0,0.08)' }}>
        <h2 style={{ fontSize:22, fontWeight:700, marginBottom:6, letterSpacing:'-0.02em' }}>Nueva contraseña</h2>
        <p style={{ fontSize:13.5, color:'var(--ink-2)', marginBottom:28 }}>
          {ready ? 'Elige una nueva contraseña para tu cuenta.' : 'Verificando enlace de recuperación…'}
        </p>

        {ready && (
          <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:16 }}>
            <div className="field">
              <label>Nueva contraseña</label>
              <input className="input tall" type="password" placeholder="Mínimo 8 caracteres" value={password} onChange={e => setPassword(e.target.value)} required autoFocus/>
            </div>
            <div className="field">
              <label>Confirmar contraseña</label>
              <input className="input tall" type="password" placeholder="Repite la contraseña" value={confirm} onChange={e => setConfirm(e.target.value)} required/>
            </div>
            {error && (
              <div style={{ background:'var(--danger-soft,#fef2f2)', border:'1px solid var(--danger,#dc2626)', borderRadius:8, padding:'10px 14px', fontSize:13, color:'var(--danger,#dc2626)' }}>
                {error}
              </div>
            )}
            <button className="btn btn-primary focusable" type="submit" disabled={loading} style={{ height:46, fontSize:15, marginTop:4 }}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
