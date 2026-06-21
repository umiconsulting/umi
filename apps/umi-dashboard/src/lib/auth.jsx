import React, { createContext, useContext, useEffect, useState } from 'react'
import { CFG } from './config.js'
import { supabase } from './supabase.js'

const AuthContext = createContext(null)
const LOCAL_SESSION_KEY = 'umi-dashboard-local-session'

function getLocalSession() {
  const raw = window.localStorage.getItem(LOCAL_SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    window.localStorage.removeItem(LOCAL_SESSION_KEY)
    return null
  }
}

export function getStoredSession() {
  if (CFG.authMode === 'local') return getLocalSession()
  return null
}

export async function getAuthHeaders() {
  if (CFG.authMode === 'local') {
    const session = getLocalSession()
    return session?.user?.id ? { 'X-UMI-User-ID': session.user.id } : {}
  }

  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: 'Bearer ' + session.access_token } : {}
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false)

  useEffect(() => {
    if (CFG.authMode === 'local') {
      setSession(getLocalSession())
      return undefined
    }

    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPasswordReset(true)
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider value={{ session, loading: session === undefined, needsPasswordReset, setNeedsPasswordReset }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

export async function signIn(email, password) {
  if (CFG.authMode === 'local') {
    const res = await fetch('/api/auth/local/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(payload.error || 'Credenciales incorrectas')
    window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(payload.session))
    window.location.assign('/')
    return payload.session
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function signOut() {
  if (CFG.authMode === 'local') {
    window.localStorage.removeItem(LOCAL_SESSION_KEY)
    window.location.assign('/login')
    return
  }

  await supabase.auth.signOut()
}
