import { getSupabaseClient } from './supabase.ts'

export const KDS_DEVICE_TOKEN_HEADER = 'x-kds-device-token'

export type KdsDeviceSession = {
  deviceId: string
  tenantId: string
  businessId: string
  locationId: string | null
  stationId: string | null
  deviceName: string | null
}

export class KdsDeviceAuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(code: 'device_token_missing' | 'device_revoked', status: number) {
    super(code)
    this.name = 'KdsDeviceAuthError'
    this.code = code
    this.status = status
  }
}

export function kdsDeviceAuthJson(error: KdsDeviceAuthError): Record<string, string> {
  if (error.code === 'device_token_missing') {
    return {
      error: 'device_revoked',
      message: 'This KDS device has been removed. Pair it again from the dashboard.',
    }
  }

  return {
    error: 'device_revoked',
    message: 'This KDS device has been removed. Pair it again from the dashboard.',
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function normalize(row: Record<string, unknown>): KdsDeviceSession {
  const tenantId = String(row.tenant_id ?? row.business_id ?? '')
  return {
    deviceId: String(row.id ?? row.device_id ?? ''),
    tenantId,
    businessId: String(row.business_id ?? tenantId),
    locationId: row.location_id == null ? null : String(row.location_id),
    stationId: row.station_id == null ? null : String(row.station_id),
    deviceName: row.device_name == null ? null : String(row.device_name),
  }
}

async function touchDeviceSession(deviceId: string): Promise<void> {
  const supabase = getSupabaseClient()

  const seen = await supabase
    .schema('kds')
    .from('device_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', deviceId)

  if (!seen.error) return

  await supabase
    .schema('kds')
    .from('device_sessions')
    .update({ last_used_at: new Date().toISOString() })
    .eq('device_id', deviceId)
}

export async function verifyKdsDeviceRequest(req: Request): Promise<KdsDeviceSession> {
  const token = req.headers.get(KDS_DEVICE_TOKEN_HEADER)?.trim()
  if (!token) throw new KdsDeviceAuthError('device_token_missing', 401)

  const tokenHash = await sha256Hex(token)
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .schema('kds')
    .from('device_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data || data.is_active !== true) {
    throw new KdsDeviceAuthError('device_revoked', 403)
  }

  const session = normalize(data)
  await touchDeviceSession(session.deviceId)
  return session
}
