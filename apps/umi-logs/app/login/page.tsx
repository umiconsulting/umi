'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createBrowserSupabase()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--background)' }}
    >
      <div
        className="w-full max-w-sm p-6"
        style={{
          background: 'var(--surface-1)',
          borderBottom: '2px solid var(--ruled-line)',
        }}
      >
        <div className="mb-6 text-center">
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--status-active)' }}
          >
            CONVERSAFLOW
          </span>
          <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
            Sign in to your dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-[10px] uppercase tracking-wider mb-1"
              style={{ color: 'var(--text-dim)' }}
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm"
              style={{
                background: 'var(--background)',
                border: '1px solid var(--ruled-line)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[10px] uppercase tracking-wider mb-1"
              style={{ color: 'var(--text-dim)' }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-sm"
              style={{
                background: 'var(--background)',
                border: '1px solid var(--ruled-line)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {error && (
            <p className="text-xs" style={{ color: 'var(--status-error)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 text-xs font-medium uppercase tracking-wider transition-opacity disabled:opacity-50"
            style={{
              background: 'var(--status-active)',
              color: '#FAFAF7',
            }}
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
