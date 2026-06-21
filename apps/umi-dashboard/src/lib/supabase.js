import { createClient } from '@supabase/supabase-js'
import { CFG } from './config.js'

export const supabase = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})
