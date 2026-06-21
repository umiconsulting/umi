/**
 * Cash cron job processors — ported from Vercel cron routes.
 *
 * Each processor receives a workflow_job payload and processes it
 * across all tenants, writing side effects (push notifications,
 * wallet updates, WhatsApp messages) via the outbox pattern.
 *
 * Processors:
 *   birthday_rewards       — Issue birthday rewards on 1st of birthday month
 *   expire_birthday_rewards — Expire unclaimed birthday rewards
 *   goal_proximity          — Apple push nudge for cards near reward goal
 *   reward_expiring         — WhatsApp lifecycle message for rewards expiring ≤3 days
 *   streak_recognition      — WhatsApp celebration for 3/6/12-week visit streaks
 *   welcome_no_visit        — WhatsApp nudge for 7-day-old cards with 0 visits
 *   winback_inactive        — WhatsApp win-back at 14/30/60 days of inactivity
 */

import { slog } from '../../_shared/logger.ts'
import { createClient } from '@supabase/supabase-js'

const cashClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { db: { schema: 'umi_cash' } },
)

// ── Constants (mirrors apps/umi-cash/src/lib/constants.ts) ───────────────────

const DEFAULT_VISITS_REQUIRED = 10
const DEFAULT_REWARD_NAME = 'Recompensa de temporada'
const DEFAULT_CUSTOMER_NAME = 'Cliente'
const DEFAULT_TZ = 'America/Mexico_City'

// ── Lifecycle copy defaults (mirrors apps/umi-cash/src/lib/lifecycle-copy.ts) ─

const DEFAULT_LIFECYCLE_COPY: Record<string, string> = {
  welcome_no_visit:
    '¡Hola {name}! Tu tarjeta de {tenant} te espera ☕ — visítanos para tu primer sello.',
  winback_14:
    'Te extrañamos en {tenant}. Tienes {visitsThisCycle}/{visitsRequired} sellos esperándote.',
  winback_30:
    'Han pasado 30 días, {name}. Vuelve y sigue acumulando sellos para tu {rewardName}.',
  winback_60:
    '{name}, queremos volver a verte en {tenant}. Tu tarjeta sigue activa.',
  reward_expiring:
    '⏰ Tu {rewardName} expira el {date} — pasa por {tenant} antes de que se acabe.',
  streak_3w:
    '🔥 ¡3 semanas seguidas visitando {tenant}! Sigue así, {name}.',
  streak_6w:
    '🔥 ¡6 semanas seguidas! {name}, eres parte de la familia de {tenant}.',
  streak_12w:
    '🏆 ¡12 semanas seguidas! Gracias por tu fidelidad, {name}.',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const v = vars[key]
    return v !== undefined ? String(v) : _match
  })
}

function resolveJourneyTemplate(
  lifecycleCopy: unknown,
  journey: string,
): string {
  if (lifecycleCopy && typeof lifecycleCopy === 'object') {
    const v = (lifecycleCopy as Record<string, unknown>)[journey]
    if (typeof v === 'string' && v.trim().length > 0) return v
  }
  return DEFAULT_LIFECYCLE_COPY[journey] || `{name}, mensaje de {tenant}`
}

async function getActiveRewardConfig(supabase: any, tenantId: string) {
  const { data, error } = await cashClient
    .from('RewardConfig')
    .select('*')
    .eq('tenantId', tenantId)
    .eq('isActive', true)
    .order('activatedAt', { ascending: false })
    .limit(1)

  if (error) {
    slog('warn', 'reward_config_fetch_error', { tenantId, error: error.message })
    return null
  }
  return data?.[0] ?? null
}

function rewardConfigDefaults(config: any) {
  return {
    visitsRequired: config?.visitsRequired ?? DEFAULT_VISITS_REQUIRED,
    rewardName: config?.rewardName ?? DEFAULT_REWARD_NAME,
  }
}

/** Format a date in a timezone as "d de MMMM" (Spanish). */
function formatDateLabel(dateStr: string, tz: string): string {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('es-MX', {
      day: 'numeric',
      month: 'long',
      timeZone: tz || DEFAULT_TZ,
    })
  } catch {
    return dateStr
  }
}

/** Current month (1-12) in a given timezone. */
function currentMonthInTz(tz: string): number {
  try {
    const parts = new Date().toLocaleDateString('en-US', {
      month: 'numeric',
      timeZone: tz || DEFAULT_TZ,
    }).split('/')
    return parseInt(parts[0], 10)
  } catch {
    return new Date().getMonth() + 1
  }
}

/** Current year in a given timezone. */
function currentYearInTz(tz: string): number {
  try {
    const parts = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      timeZone: tz || DEFAULT_TZ,
    }).split('/')
    return parseInt(parts[2] || parts[0], 10)
  } catch {
    return new Date().getFullYear()
  }
}

// ── Outbox helpers ───────────────────────────────────────────────────────────

/**
 * Enqueue a WhatsApp lifecycle message to the outbox for durable delivery.
 * Uses ON CONFLICT on idempotency_key for deduplication — if the same
 * (cardId, journey) pair was already enqueued, this is silently skipped.
 */
async function enqueueWhatsAppMessage(
  supabase: any,
  tenantId: string,
  cardId: string,
  journey: string,
  body: string,
): Promise<boolean> {
  const idempotencyKey = `lifecycle:${cardId}:${journey}`

  const { error } = await supabase
    .from('outbox')
    .upsert({
      business_id: 'ef9005a2-efe1-45bf-9da0-313b5902d9b4', // kalalacafe
      kind: 'whatsapp',
      aggregate_id: cardId,
      idempotency_key: idempotencyKey,
      payload: {
        card_id: cardId,
        tenant_id: tenantId,
        journey,
        body,
      },
      state: 'pending',
      max_attempts: 3,
    }, {
      onConflict: 'idempotency_key',
      ignoreDuplicates: true,
    })

  if (error) {
    slog('warn', 'outbox_upsert_error', {
      cardId,
      journey,
      error: error.message,
    })
    return false
  }

  // Also insert LifecycleEvent for audit trail (dedupe via unique constraint)
  const { error: leError } = await cashClient
    .from('LifecycleEvent')
    .upsert({
      cardId,
      journey,
      body,
      sentAt: new Date().toISOString(),
    }, {
      onConflict: 'cardId, journey',
      ignoreDuplicates: true,
    })

  if (leError) {
    slog('warn', 'lifecycle_event_upsert_error', {
      cardId,
      journey,
      error: leError.message,
    })
  }

  // Update card lifecycle message
  const { error: cardError } = await cashClient
    .from('LoyaltyCard')
    .update({
      lifecycleMessage: body,
      lifecycleMessageUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq('id', cardId)

  if (cardError) {
    slog('warn', 'card_lifecycle_update_error', {
      cardId,
      error: cardError.message,
    })
  }

  return true
}

// ── Apple Push Notification (Deno-compatible) ────────────────────────────────

/**
 * Send Apple push notification to all registered devices for a card.
 * Uses the APNs HTTP/2 API. In Deno we fall back to fetch (HTTP/1.1);
 * Apple accepts HTTP/1.1 for development but production requires HTTP/2.
 *
 * For production, consider using a dedicated push delivery service or
 * a Cloudflare Worker that speaks HTTP/2.
 */
async function sendApplePushUpdateDeno(
  supabase: any,
  cardId: string,
): Promise<{ sent: number; failed: number }> {
  const passTypeId = Deno.env.get('APPLE_PASS_TYPE_ID')
  const apnKeyId = Deno.env.get('APPLE_APN_KEY_ID')
  const teamId = Deno.env.get('APPLE_TEAM_ID')
  const apnKey = Deno.env.get('APPLE_APN_KEY')

  if (!passTypeId || !apnKeyId || !teamId || !apnKey) {
    return { sent: 0, failed: 0 }
  }

  // Fetch push tokens for this card
  const { data: registrations, error } = await cashClient
    .from('ApplePushToken')
    .select('pushToken')
    .eq('cardId', cardId)

  if (error || !registrations?.length) return { sent: 0, failed: 0 }

  // Generate JWT for APNs
  let apnToken: string
  try {
    apnToken = await generateApnJwt(apnKeyId, teamId, apnKey)
  } catch (err) {
    slog('warn', 'apn_jwt_error', { cardId, error: String(err) })
    return { sent: 0, failed: registrations.length }
  }

  let sent = 0
  let failed = 0

  for (const reg of registrations) {
    try {
      const res = await fetch(
        `https://api.push.apple.com/3/device/${reg.pushToken}`,
        {
          method: 'POST',
          headers: {
            'authorization': `bearer ${apnToken}`,
            'apns-topic': passTypeId,
            'apns-push-type': 'background',
            'apns-priority': '5',
          },
          body: '{}',
        },
      )

      if (res.ok) sent++
      else {
        failed++
        slog('warn', 'apn_push_failed', {
          cardId,
          status: res.status,
          pushToken: reg.pushToken.slice(0, 8) + '...',
        })
      }
    } catch (err) {
      failed++
      slog('warn', 'apn_push_error', { cardId, error: String(err) })
    }
  }

  return { sent, failed }
}

/**
 * Generate a JWT for Apple Push Notification service authentication.
 * Uses Web Crypto API (available in Deno).
 */
async function generateApnJwt(
  keyId: string,
  teamId: string,
  privateKeyBase64: string,
): Promise<string> {
  // Decode the base64-encoded .p8 private key
  const pem = atob(privateKeyBase64)
  const pemBody = pem
    .replace(/-----BEGIN (?:EC )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:EC )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  // Import the EC private key
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  // Build JWT header and payload
  const header = { alg: 'ES256', kid: keyId }
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: teamId, iat: now }

  const encoder = new TextEncoder()
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  )

  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  )
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  return `${signingInput}.${encodedSignature}`
}

// ── Google Wallet Update (Deno-compatible) ───────────────────────────────────

/**
 * Update a Google Wallet loyalty object via the REST API.
 * Uses a service account for OAuth2 authentication.
 */
async function updateGoogleWalletObjectDeno(
  supabase: any,
  data: {
    cardId: string
    cardNumber: string
    customerName: string
    balanceCentavos: number
    visitsThisCycle: number
    visitsRequired: number
    pendingRewards: number
    rewardName: string
    totalVisits: number
    memberSince: string
    tenantName: string
    tenantSlug: string
    primaryColor?: string
    topupEnabled?: boolean
    birthdayRewardName?: string | null
    lifecycleMessage?: string | null
    // Clear the birthday reward field from pass
    clearBirthdayReward?: boolean
  },
): Promise<void> {
  const issuerId = Deno.env.get('GOOGLE_WALLET_ISSUER_ID')
  const saEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL')
  const saKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY')

  if (!issuerId || !saEmail || !saKey) return

  const objectId = `${issuerId}.card_${data.cardId}`
  const classId = `${issuerId}.${data.tenantSlug ? `${data.tenantSlug}_loyalty_v2` : 'loyalty_v2'}`

  // Build text modules
  const textModules: { header: string; body: string; id: string }[] = []

  if (data.lifecycleMessage && !data.clearBirthdayReward) {
    textModules.push({
      header: 'MENSAJE',
      body: data.lifecycleMessage,
      id: 'lifecycle_message',
    })
  }

  const remaining = data.visitsRequired - data.visitsThisCycle
  const filled = '\u25CF'.repeat(Math.max(0, data.visitsThisCycle))
  const empty = '\u25CB'.repeat(Math.max(0, remaining))
  const stampProgress = `${filled}${empty} (${data.visitsThisCycle}/${data.visitsRequired})`

  textModules.push(
    {
      header: 'MIEMBRO',
      body: data.customerName || 'Cliente',
      id: 'member_name',
    },
    {
      header: data.rewardName.toUpperCase(),
      body: stampProgress,
      id: 'stamp_progress',
    },
  )

  if (data.birthdayRewardName && !data.clearBirthdayReward) {
    textModules.push({
      header: 'REGALO DE CUMPLEANOS',
      body: `${data.birthdayRewardName} \u2014 canj\u00e9alo una sola vez durante este mes`,
      id: 'birthday_reward',
    })
  }

  if (data.pendingRewards > 0) {
    textModules.push({
      header: 'RECOMPENSAS DISPONIBLES',
      body: `${data.pendingRewards} recompensa${data.pendingRewards > 1 ? 's' : ''} \u2014 \u00a1canj\u00e9ala en tienda!`,
      id: 'pending_rewards',
    })
  } else {
    textModules.push({
      header: 'PR\u00d3XIMA RECOMPENSA',
      body: `${remaining} visita${remaining !== 1 ? 's' : ''} para ${data.rewardName}`,
      id: 'next_reward',
    })
  }

  const object: Record<string, unknown> = {
    id: objectId,
    classId,
    state: 'active',
    accountId: data.cardNumber,
    accountName: data.customerName || 'Cliente',
    loyaltyPoints: {
      balance: { string: String(data.visitsThisCycle) },
      label: `Visitas (meta: ${data.visitsRequired})`,
    },
    barcode: {
      type: 'qrCode',
      value: data.cardNumber,
      alternateText: data.cardNumber,
    },
    textModulesData: textModules,
  }

  if (data.topupEnabled !== false) {
    object.secondaryLoyaltyPoints = {
      balance: {
        money: {
          currencyCode: 'MXN',
          micros: String(data.balanceCentavos * 10_000),
        },
      },
      label: 'Saldo',
    }
  }

  try {
    const token = await getGoogleAuthToken(saEmail, saKey)

    const res = await fetch(
      `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(object),
      },
    )

    if (!res.ok && res.status !== 404) {
      slog('warn', 'google_wallet_update_failed', {
        cardId: data.cardId,
        status: res.status,
      })
    }

    // Send notification if there's a lifecycle message
    if (data.lifecycleMessage && !data.clearBirthdayReward) {
      await fetch(
        `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              id: `lifecycle_${data.cardId}_${Date.now()}`,
              header: data.tenantName || 'Mensaje',
              body: data.lifecycleMessage,
              messageType: 'TEXT_AND_NOTIFY',
            },
          }),
        },
      )
    }
  } catch (err) {
    slog('warn', 'google_wallet_update_error', {
      cardId: data.cardId,
      error: String(err),
    })
  }
}

/**
 * Get a Google OAuth2 access token for service account.
 */
async function getGoogleAuthToken(
  saEmail: string,
  privateKeyRaw: string,
): Promise<string> {
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n').trim()

  // Build JWT
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iss: saEmail,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const encoder = new TextEncoder()
  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const signingInput = `${encodedHeader}.${encodedPayload}`

  // Import RSA key
  const pemBody = privateKey
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    key,
    encoder.encode(signingInput),
  )

  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  )
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const jwt = `${signingInput}.${encodedSignature}`

  // Exchange JWT for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    throw new Error(`Google auth error: ${res.status}`)
  }

  const json = await res.json()
  return json.access_token
}

// ── Helper: fetch card with user + tenant ────────────────────────────────────

async function getCardWithTenant(supabase: any, cardId: string) {
  const { data: card, error } = await cashClient
    .from('LoyaltyCard')
    .select(`
      *,
      user:User(name, phone),
      tenant:Tenant(id, name, slug, primaryColor, timezone, lifecycleCopy,
        birthdayRewardName, subscriptionStatus, topupEnabled)
    `)
    .eq('id', cardId)
    .single()

  if (error) {
    slog('warn', 'card_fetch_error', { cardId, error: error.message })
    return null
  }
  return card
}

// =============================================================================
// PROCESSORS
// =============================================================================

/**
 * birthday_rewards — Issue birthday rewards on the 1st of each customer's
 * birthday month. Finds eligible cards (birthDate in current month, no
 * reward issued this year) and creates a BirthdayReward + pushes wallet update.
 */
export async function processBirthdayRewards(
  supabase: any,
  _payload: any,
): Promise<void> {
  // Find all active tenants with birthday rewards enabled
  const { data: tenants, error: tenantError } = await cashClient
    .from('Tenant')
    .select('id, name, slug, primaryColor, timezone, birthdayRewardName, birthdayRewardEnabled, topupEnabled')
    .eq('subscriptionStatus', 'ACTIVE')
    .eq('birthdayRewardEnabled', true)

  if (tenantError) {
    throw new Error(`Failed to fetch tenants: ${tenantError.message}`)
  }

  let issued = 0
  let errors = 0

  for (const tenant of tenants ?? []) {
    const tz = tenant.timezone || DEFAULT_TZ
    const month = currentMonthInTz(tz)
    const year = currentYearInTz(tz)

    // Find eligible cards: users whose birth month is current month
    // and haven't received this year's birthday reward
    const { data: eligibleCards, error: cardError } = await supabase.rpc(
      'get_birthday_eligible_cards',
      { p_tenant_id: tenant.id, p_month: month, p_year: year },
    )

    if (cardError) {
      slog('warn', 'birthday_eligible_cards_error', {
        tenantId: tenant.id,
        error: cardError.message,
      })
      continue
    }

    if (!eligibleCards?.length) continue

    const rewardConfig = await getActiveRewardConfig(supabase, tenant.id)
    const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig)

    // Last day of birthday month at 23:59:59 in tenant's timezone
    const lastDay = new Date(year, month, 0)
    const expiresAt = new Date(
      Date.UTC(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate(), 23, 59, 59, 999),
    ).toISOString()

    for (const row of eligibleCards) {
      const cardId = row.card_id || row.cardId
      try {
        // Create birthday reward
        const { error: brError } = await cashClient
          .from('BirthdayReward')
          .upsert({
            tenantId: tenant.id,
            loyaltyCardId: cardId,
            year,
            issuedAt: new Date().toISOString(),
            expiresAt,
            status: 'ACTIVE',
          }, {
            onConflict: 'loyaltyCardId, tenantId, year',
            ignoreDuplicates: true,
          })

        if (brError) {
          slog('warn', 'birthday_reward_create_error', {
            cardId,
            tenantId: tenant.id,
            error: brError.message,
          })
          errors++
          continue
        }

        // Fetch full card for push
        const card = await getCardWithTenant(supabase, cardId)
        if (!card) { errors++; continue }

        // Touch card update timestamp
        await cashClient
          .from('LoyaltyCard')
          .update({ updatedAt: new Date().toISOString() })
          .eq('id', cardId)

        // Send push notifications
        await Promise.allSettled([
          sendApplePushUpdateDeno(supabase, cardId),
          updateGoogleWalletObjectDeno(supabase, {
            cardId,
            cardNumber: card.cardNumber,
            customerName: card.user?.name || DEFAULT_CUSTOMER_NAME,
            balanceCentavos: card.balanceCentavos,
            visitsThisCycle: card.visitsThisCycle,
            visitsRequired,
            pendingRewards: card.pendingRewards,
            rewardName,
            totalVisits: card.totalVisits,
            memberSince: card.createdAt,
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            primaryColor: tenant.primaryColor,
            topupEnabled: tenant.topupEnabled,
            birthdayRewardName: tenant.birthdayRewardName,
          }),
        ])

        issued++
      } catch (err) {
        errors++
        slog('warn', 'birthday_reward_card_error', {
          cardId,
          error: String(err),
        })
      }
    }
  }

  slog('info', 'birthday_rewards_complete', { issued, errors })
  if (errors > 0 && issued === 0) {
    throw new Error(`birthday_rewards: all ${errors} attempts failed`)
  }
}

/**
 * expire_birthday_rewards — Find active birthday rewards whose expiresAt
 * has passed, mark them EXPIRED, and push wallet updates.
 */
export async function processExpireBirthdayRewards(
  supabase: any,
  _payload: any,
): Promise<void> {
  const { data: expiredRewards, error } = await cashClient
    .from('BirthdayReward')
    .select(`
      *,
      loyaltyCard:LoyaltyCard(*, user:User(name)),
      tenant:Tenant(name, slug, primaryColor, timezone, topupEnabled)
    `)
    .eq('status', 'ACTIVE')
    .lt('expiresAt', new Date().toISOString())

  if (error) {
    throw new Error(`Failed to fetch expired rewards: ${error.message}`)
  }

  let expired = 0
  let errors = 0

  for (const reward of expiredRewards ?? []) {
    try {
      // Mark as EXPIRED
      await cashClient
        .from('BirthdayReward')
        .update({ status: 'EXPIRED' })
        .eq('id', reward.id)

      const card = reward.loyaltyCard
      if (!card) { errors++; continue }

      const rewardConfig = await getActiveRewardConfig(supabase, reward.tenantId)
      const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig)

      // Touch card
      await cashClient
        .from('LoyaltyCard')
        .update({ updatedAt: new Date().toISOString() })
        .eq('id', card.id)

      await Promise.allSettled([
        sendApplePushUpdateDeno(supabase, reward.loyaltyCardId),
        updateGoogleWalletObjectDeno(supabase, {
          cardId: card.id,
          cardNumber: card.cardNumber,
          customerName: card.user?.name || DEFAULT_CUSTOMER_NAME,
          balanceCentavos: card.balanceCentavos,
          visitsThisCycle: card.visitsThisCycle,
          visitsRequired,
          pendingRewards: card.pendingRewards,
          rewardName,
          totalVisits: card.totalVisits,
          memberSince: card.createdAt,
          tenantName: reward.tenant?.name || '',
          tenantSlug: reward.tenant?.slug || '',
          primaryColor: reward.tenant?.primaryColor,
          topupEnabled: reward.tenant?.topupEnabled,
          birthdayRewardName: null, // remove birthday field from pass
          clearBirthdayReward: true,
        }),
      ])

      expired++
    } catch (err) {
      errors++
      slog('warn', 'expire_birthday_reward_error', {
        rewardId: reward.id,
        error: String(err),
      })
    }
  }

  slog('info', 'expire_birthday_rewards_complete', { expired, errors })
}

/**
 * goal_proximity — Find cards 1-2 visits from a reward goal who haven't
 * visited in the last 3 days. Send Apple push notification as a nudge.
 */
export async function processGoalProximity(
  supabase: any,
  _payload: any,
): Promise<void> {
  const { data: tenants, error: tenantError } = await cashClient
    .from('Tenant')
    .select('id')
    .eq('subscriptionStatus', 'ACTIVE')

  if (tenantError) {
    throw new Error(`Failed to fetch tenants: ${tenantError.message}`)
  }

  let notified = 0
  let errors = 0

  for (const tenant of tenants ?? []) {
    const rewardConfig = await getActiveRewardConfig(supabase, tenant.id)
    const { visitsRequired } = rewardConfigDefaults(rewardConfig)

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()

    // Find cards near goal with no recent visit and with Apple pass
    const { data: nearGoalCards, error: cardError } = await cashClient
      .from('LoyaltyCard')
      .select('id')
      .eq('tenantId', tenant.id)
      .gte('visitsThisCycle', visitsRequired - 2)
      .not('applePassSerial', 'is', null)
      // We can't easily filter "no visits in last 3 days" via PostgREST,
      // so we use an RPC or filter in-memory
      .limit(1000)

    if (cardError || !nearGoalCards?.length) continue

    for (const card of nearGoalCards) {
      try {
        // Check last visit date
        const { data: recentVisits, error: visitError } = await cashClient
          .from('Visit')
          .select('scannedAt')
          .eq('cardId', card.id)
          .gte('scannedAt', threeDaysAgo)
          .limit(1)

        if (visitError) {
          errors++
          continue
        }

        // Skip cards with recent visits
        if (recentVisits?.length) continue

        // Touch card
        await cashClient
          .from('LoyaltyCard')
          .update({ updatedAt: new Date().toISOString() })
          .eq('id', card.id)

        await sendApplePushUpdateDeno(supabase, card.id)
        notified++
      } catch (err) {
        errors++
        slog('warn', 'goal_proximity_card_error', {
          cardId: card.id,
          error: String(err),
        })
      }
    }
  }

  slog('info', 'goal_proximity_complete', { notified, errors })
}

/**
 * reward_expiring — Find birthday rewards expiring in ≤3 days and send
 * WhatsApp lifecycle nudge via the outbox.
 */
export async function processRewardExpiring(
  supabase: any,
  _payload: any,
): Promise<void> {
  const now = new Date()
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

  const { data: rewards, error } = await cashClient
    .from('BirthdayReward')
    .select(`
      *,
      loyaltyCard:LoyaltyCard(*, user:User(name, phone)),
      tenant:Tenant(name, birthdayRewardName, timezone, lifecycleCopy)
    `)
    .eq('status', 'ACTIVE')
    .is('redeemedAt', null)
    .gte('expiresAt', now.toISOString())
    .lte('expiresAt', threeDaysFromNow.toISOString())

  if (error) {
    throw new Error(`Failed to fetch expiring rewards: ${error.message}`)
  }

  let sent = 0
  let errors = 0

  for (const reward of rewards ?? []) {
    const tz = reward.tenant?.timezone || DEFAULT_TZ
    const dateLabel = formatDateLabel(reward.expiresAt, tz)
    const rewardName = reward.tenant?.birthdayRewardName || 'regalo de cumplea\u00f1os'

    const template = resolveJourneyTemplate(
      reward.tenant?.lifecycleCopy,
      'reward_expiring',
    )
    const message = renderTemplate(template, {
      name: reward.loyaltyCard?.user?.name || DEFAULT_CUSTOMER_NAME,
      tenant: reward.tenant?.name || '',
      rewardName,
      date: dateLabel,
    })

    try {
      const ok = await enqueueWhatsAppMessage(
        supabase,
        reward.tenantId,
        reward.loyaltyCardId,
        `reward_expiring_${reward.year}`,
        message,
      )
      if (ok) sent++
    } catch (err) {
      errors++
      slog('warn', 'reward_expiring_error', {
        rewardId: reward.id,
        error: String(err),
      })
    }
  }

  slog('info', 'reward_expiring_complete', { candidates: rewards?.length ?? 0, sent, errors })
}

// ── Streak tiers ─────────────────────────────────────────────────────────────

const STREAK_TIERS = [
  { weeks: 3, journey: 'streak_3w' },
  { weeks: 6, journey: 'streak_6w' },
  { weeks: 12, journey: 'streak_12w' },
]

const WINBACK_TIERS = [
  { days: 14, journey: 'winback_14' },
  { days: 30, journey: 'winback_30' },
  { days: 60, journey: 'winback_60' },
]

/**
 * streak_recognition — For 3/6/12-week tiers, find cards that have at least
 * one visit in each of the last N ISO weeks. Send WhatsApp celebration.
 */
export async function processStreakRecognition(
  supabase: any,
  _payload: any,
): Promise<void> {
  const perTier: Record<string, number> = {}
  let totalSent = 0
  let totalErrors = 0

  for (const tier of STREAK_TIERS) {
    const { data: rows, error } = await supabase.rpc(
      'get_streak_cards',
      { p_weeks: tier.weeks },
    )

    if (error) {
      slog('warn', 'streak_query_error', {
        weeks: tier.weeks,
        error: error.message,
      })
      continue
    }

    let sent = 0
    for (const row of rows ?? []) {
      const cardId = row.card_id || row.cardId
      try {
        const card = await getCardWithTenant(supabase, cardId)
        if (!card) continue

        const rewardConfig = await getActiveRewardConfig(supabase, card.tenantId)
        const { rewardName } = rewardConfigDefaults(rewardConfig)

        const template = resolveJourneyTemplate(
          card.tenant?.lifecycleCopy,
          tier.journey,
        )
        const message = renderTemplate(template, {
          name: card.user?.name || DEFAULT_CUSTOMER_NAME,
          tenant: card.tenant?.name || '',
          rewardName,
        })

        const ok = await enqueueWhatsAppMessage(
          supabase,
          card.tenantId,
          cardId,
          tier.journey,
          message,
        )
        if (ok) sent++
      } catch (err) {
        totalErrors++
        slog('warn', 'streak_card_error', {
          cardId,
          tier: tier.journey,
          error: String(err),
        })
      }
    }

    perTier[tier.journey] = sent
    totalSent += sent
  }

  slog('info', 'streak_recognition_complete', { totalSent, perTier, errors: totalErrors })
}

/**
 * welcome_no_visit — Find cards created exactly ~7 days ago with 0 visits
 * and send a WhatsApp welcome nudge.
 */
export async function processWelcomeNoVisit(
  supabase: any,
  _payload: any,
): Promise<void> {
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: cards, error } = await cashClient
    .from('LoyaltyCard')
    .select(`
      *,
      user:User(name, phone),
      tenant:Tenant!inner(name, lifecycleCopy, subscriptionStatus)
    `)
    .eq('totalVisits', 0)
    .gte('createdAt', eightDaysAgo)
    .lt('createdAt', sevenDaysAgo)
    .eq('tenant.subscriptionStatus', 'ACTIVE')

  if (error) {
    throw new Error(`Failed to fetch welcome-no-visit cards: ${error.message}`)
  }

  let sent = 0
  let errors = 0

  for (const card of cards ?? []) {
    try {
      const template = resolveJourneyTemplate(
        card.tenant?.lifecycleCopy,
        'welcome_no_visit',
      )
      const message = renderTemplate(template, {
        name: card.user?.name || DEFAULT_CUSTOMER_NAME,
        tenant: card.tenant?.name || '',
      })

      const ok = await enqueueWhatsAppMessage(
        supabase,
        card.tenantId,
        card.id,
        'welcome_no_visit',
        message,
      )
      if (ok) sent++
    } catch (err) {
      errors++
      slog('warn', 'welcome_no_visit_error', {
        cardId: card.id,
        error: String(err),
      })
    }
  }

  slog('info', 'welcome_no_visit_complete', { candidates: cards?.length ?? 0, sent, errors })
}

/**
 * winback_inactive — For 14/30/60-day tiers, find cards whose most recent
 * visit fell in the tier's window with no later visits. Send WhatsApp win-back.
 */
export async function processWinbackInactive(
  supabase: any,
  _payload: any,
): Promise<void> {
  const now = Date.now()
  const perTier: Record<string, number> = {}
  let totalSent = 0
  let totalErrors = 0

  for (const tier of WINBACK_TIERS) {
    const { data: rows, error } = await supabase.rpc(
      'get_winback_cards',
      { p_days: tier.days },
    )

    if (error) {
      slog('warn', 'winback_query_error', {
        days: tier.days,
        error: error.message,
      })
      continue
    }

    let sent = 0
    for (const row of rows ?? []) {
      const cardId = row.card_id || row.cardId
      try {
        const card = await getCardWithTenant(supabase, cardId)
        if (!card) continue

        const rewardConfig = await getActiveRewardConfig(supabase, card.tenantId)
        const { visitsRequired, rewardName } = rewardConfigDefaults(rewardConfig)

        const template = resolveJourneyTemplate(
          card.tenant?.lifecycleCopy,
          tier.journey,
        )
        const message = renderTemplate(template, {
          name: card.user?.name || DEFAULT_CUSTOMER_NAME,
          tenant: card.tenant?.name || '',
          rewardName,
          visitsThisCycle: card.visitsThisCycle,
          visitsRequired,
        })

        const ok = await enqueueWhatsAppMessage(
          supabase,
          card.tenantId,
          cardId,
          tier.journey,
          message,
        )
        if (ok) sent++
      } catch (err) {
        totalErrors++
        slog('warn', 'winback_card_error', {
          cardId,
          tier: tier.journey,
          error: String(err),
        })
      }
    }

    perTier[tier.journey] = sent
    totalSent += sent
  }

  slog('info', 'winback_inactive_complete', { totalSent, perTier, errors: totalErrors })
}
