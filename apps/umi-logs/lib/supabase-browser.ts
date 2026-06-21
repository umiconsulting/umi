import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser client for client components (login form, sign out).
 */
export function createBrowserSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: {
        schema:
          process.env.NEXT_PUBLIC_DB_SCHEMA ||
          process.env.NEXT_PUBLIC_SUPABASE_DB_SCHEMA ||
          'conversaflow',
      },
    },
  )
}
