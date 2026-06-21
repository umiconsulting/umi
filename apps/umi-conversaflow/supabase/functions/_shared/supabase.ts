import { createClient } from '@supabase/supabase-js'

/** PostgREST schema for operational tables. Edge secrets cannot use the SUPABASE_ prefix (platform-reserved). */
function resolvedDbSchema(): string {
  return Deno.env.get('DB_SCHEMA') ?? Deno.env.get('SUPABASE_DB_SCHEMA') ?? 'conversaflow'
}

export function getSupabaseClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      db: {
        schema: resolvedDbSchema(),
      },
    },
  )
}
