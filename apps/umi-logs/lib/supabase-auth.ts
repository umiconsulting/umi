import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server client for server components and route handlers.
 * Reads/writes auth cookies via @supabase/ssr.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: {
        schema:
          process.env.NEXT_PUBLIC_DB_SCHEMA ||
          process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA ||
          'conversaflow',
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // setAll can fail in Server Components (read-only cookies).
          }
        },
      },
    }
  )
}
