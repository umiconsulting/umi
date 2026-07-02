import React, { createContext, useContext, useEffect, useState } from 'react'
import { CFG, COOKIE_AUTH, LOCAL_SESSION, apiUrl, withCreds, errMessage } from './config.js'
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
  if (LOCAL_SESSION) return getLocalSession()
  return null
}

export async function getAuthHeaders() {
  // umi-api: auth rides in the httpOnly cookie (sent via credentials:'include'), no header.
  if (COOKIE_AUTH) return {}

  if (CFG.authMode === 'local') {
    const session = getLocalSession()
    return session?.user?.id ? { 'X-UMI-User-ID': session.user.id } : {}
  }

  const { data: { session } } = await supabase.auth.getSession()
  return session ? { Authorization: 'Bearer ' + session.access_token } : {}
}

// ---------------------------------------------------------------------------
// Cookie-mode session auto-refresh
//
// The umi-api access cookie is short-lived. Rather than let it expire silently
// — which 401s API calls while the SPA still thinks it's logged in — we refresh
// it just before expiry (proactive) and also on the first 401 (reactive, wired
// in data.jsx). A single-flight guard collapses concurrent refreshes into one
// /refresh call. If refresh fails, the refresh cookie is dead too → clear the
// session and bounce to /login.
// ---------------------------------------------------------------------------
const REFRESH_SKEW_MS = 60_000 // refresh 60s before the access token expires
const MIN_REFRESH_MS = 30_000  // never schedule sooner than this
let refreshTimer = null
let refreshInFlight = null
let accessExpiresAt = 0        // ms epoch; 0 = unknown

function setLocalSession(session) {
  window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session))
}

function scheduleProactiveRefresh(session) {
  if (!COOKIE_AUTH) return
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
  const secs = session && Number(session.accessExpiresIn)
  if (!secs || !isFinite(secs)) { accessExpiresAt = 0; return }
  accessExpiresAt = Date.now() + secs * 1000
  const delay = Math.max(secs * 1000 - REFRESH_SKEW_MS, MIN_REFRESH_MS)
  refreshTimer = setTimeout(function () { refreshSession() }, delay)
}

// Single-flight refresh. Resolves true on success, false otherwise.
export function refreshSession() {
  if (!COOKIE_AUTH) return Promise.resolve(false)
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async function () {
    try {
      const res = await fetch(apiUrl('/api/auth/local/refresh'), withCreds({ method: 'POST' }))
      if (!res.ok) return false
      const payload = await res.json().catch(() => ({}))
      if (payload && payload.session) {
        setLocalSession(payload.session)
        scheduleProactiveRefresh(payload.session)
      }
      return true
    } catch (err) {
      console.warn('session refresh failed', err)
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

// Session is truly dead (refresh failed): drop local state and go to login.
export function handleSessionExpired() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
  accessExpiresAt = 0
  window.localStorage.removeItem(LOCAL_SESSION_KEY)
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login')
  }
}

// Start proactive refresh + resume-refresh listeners. Returns a cleanup fn.
export function startSessionAutoRefresh() {
  if (!COOKIE_AUTH) return function () {}
  const session = getLocalSession()
  if (session) scheduleProactiveRefresh(session)
  function onResume() {
    if (!getLocalSession()) return
    if (typeof document !== 'undefined' && document.visibilityState && document.visibilityState !== 'visible') return
    // Refresh only when at/near expiry — avoids a refresh storm on every focus.
    if (!accessExpiresAt || Date.now() >= accessExpiresAt - REFRESH_SKEW_MS) refreshSession()
  }
  document.addEventListener('visibilitychange', onResume)
  window.addEventListener('online', onResume)
  return function () {
    document.removeEventListener('visibilitychange', onResume)
    window.removeEventListener('online', onResume)
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = loading
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false)

  useEffect(() => {
    if (LOCAL_SESSION) {
      setSession(getLocalSession())
      return startSessionAutoRefresh()
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
  // 'local' (server.js) and 'cookie' (umi-api) both POST the same login route; the difference
  // is umi-api sets an httpOnly cookie (withCreds sends/stores it) while server.js relies on the
  // localStorage session id echoed as X-UMI-User-ID. Either way we cache session.* for the UI.
  if (LOCAL_SESSION) {
    const res = await fetch(apiUrl('/api/auth/local/login'), withCreds({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password }),
    }))
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(errMessage(payload, 'Credenciales incorrectas'))
    window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(payload.session))
    window.location.assign('/')
    return payload.session
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data.session
}

export async function signOut() {
  if (LOCAL_SESSION) {
    // umi-api: clear the httpOnly cookie server-side (best-effort) before dropping local state.
    if (COOKIE_AUTH) {
      // fetch only rejects on network errors and a non-OK status is not thrown,
      // so check both — a failed server logout can leave the httpOnly cookie
      // valid. We still clear local state + redirect, but never silently.
      try {
        const res = await fetch(apiUrl('/api/auth/local/logout'), withCreds({ method: 'POST' }))
        if (!res.ok) console.warn(`logout failed (${res.status}); auth cookie may persist server-side`)
      } catch (err) {
        console.warn('logout request failed; auth cookie may persist server-side', err)
      }
    }
    window.localStorage.removeItem(LOCAL_SESSION_KEY)
    window.location.assign('/login')
    return
  }

  await supabase.auth.signOut()
}
