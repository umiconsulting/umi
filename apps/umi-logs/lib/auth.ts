import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createServerSupabase } from './supabase-auth'
import { supabase } from './supabase'

interface DashboardUser {
  id: string
  authUserId: string
  businessId: string
  role: string
}

/**
 * Get the authenticated user's dashboard memberships.
 * Redirects to /login if unauthenticated.
 */
export async function getSessionUser(): Promise<{
  authUserId: string
  email: string
  businesses: DashboardUser[]
}> {
  const serverSupabase = await createServerSupabase()
  const { data: { user }, error } = await serverSupabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  const { data: memberships } = await supabase
    .from('dashboard_users')
    .select('id, auth_user_id, business_id, role')
    .eq('auth_user_id', user.id)

  return {
    authUserId: user.id,
    email: user.email ?? '',
    businesses: (memberships ?? []).map((m) => ({
      id: m.id,
      authUserId: m.auth_user_id,
      businessId: m.business_id,
      role: m.role,
    })),
  }
}

const ACTIVE_BUSINESS_COOKIE = 'cf_active_business'

/**
 * Resolve which business the user is currently viewing.
 * Reads from cookie, validates against allowed list, falls back to first.
 */
export async function getActiveBusinessId(): Promise<string> {
  const { businesses } = await getSessionUser()

  if (businesses.length === 0) {
    redirect('/login')
  }

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_BUSINESS_COOKIE)?.value

  if (preferred && businesses.some((b) => b.businessId === preferred)) {
    return preferred
  }

  return businesses[0].businessId
}
