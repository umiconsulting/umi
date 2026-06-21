import { corsHeaders, BUSINESS_ID } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { slog, hashPhone, logEdgeFunction, logAiTurn, logSecurityEvent, logPipelineTrace } from '../_shared/logger.ts'
import { insertMessage } from '../_shared/memory.ts'
import { INTERACTIVE_JOB_PRIORITY, insertJob, triggerJobWorker } from '../_shared/workflow.ts'
import {
  SECURITY_CONFIG,
  checkRateLimit,
  detectPromptInjection,
  sanitizeInput,
  validateTwilioSignature,
} from './security.ts'
import { recordInboundEvent } from '../_shared/inbound.ts'
import { getOrCreateCustomer, getOrCreateConversation } from './context.ts'
import { createTwimlResponse, createEmptyTwimlResponse } from './twiml.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // OBS-02: Generate a request-scoped correlation ID for all log entries
  const requestId = crypto.randomUUID()
  const start = Date.now()

  try {
    const supabase = getSupabaseClient()

    // ── Parse body as URL-encoded text (required for Twilio sig validation) ──
    // Using req.text() instead of req.formData() so we can validate the
    // HMAC-SHA1 signature before touching formData.
    const bodyText = await req.text()
    const params = new URLSearchParams(bodyText)

    // ── SEC-01 / FT-02: Twilio webhook signature validation ─────────────────
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    if (authToken) {
      const twilioSignature = req.headers.get('X-Twilio-Signature') ?? ''

      // The URL used for HMAC validation must be the exact URL configured in the
      // Twilio console — set TWILIO_WEBHOOK_URL as a Supabase secret to make this
      // explicit and environment-portable.
      //
      // Why not req.url: Supabase edge runtime exposes an internal URL
      // (http://[ref].supabase.co/whatsapp-handler) that differs from the public
      // URL Twilio signed (https://[ref].supabase.co/functions/v1/whatsapp-handler).
      // Inferring the public URL from runtime internals couples us to undocumented
      // Supabase proxy behavior.
      const webhookUrl = Deno.env.get('TWILIO_WEBHOOK_URL')
      if (!webhookUrl) {
        slog('error', 'twilio_webhook_url_missing', {
          msg: 'TWILIO_WEBHOOK_URL secret is not set — cannot validate Twilio signature',
          request_id: requestId,
        })
        return new Response('Service misconfigured', { status: 500, headers: corsHeaders })
      }

      const isValid = await validateTwilioSignature(authToken, twilioSignature, webhookUrl, params)
      if (!isValid) {
        slog('warn', 'twilio_sig_invalid', { sig_present: twilioSignature.length > 0, request_id: requestId })
        return new Response('Forbidden', { status: 403, headers: corsHeaders })
      }
    } else {
      slog('warn', 'twilio_auth_token_missing', {
        msg: 'TWILIO_AUTH_TOKEN not set — skipping signature validation (dev only)',
        request_id: requestId,
      })
    }

    // ── Extract Twilio form fields ───────────────────────────────────────────
    const phone = (params.get('From') ?? '').replace('whatsapp:', '')
    const rawMessage = params.get('Body') ?? ''
    const profileName = params.get('ProfileName') ?? null
    // FT-01: MessageSid is the idempotency key — Twilio sends it on every attempt
    const messageSid = params.get('MessageSid') ?? undefined

    // SEC-04: Never log raw phone numbers — use a stable hash for correlation
    const phoneHash = await hashPhone(phone)
    slog('info', 'message_received', {
      phone_hash: phoneHash,
      message_length: rawMessage.length,
      message_sid: messageSid,
      request_id: requestId,
    })

    // ── Security checks ──────────────────────────────────────────────────────

    if (rawMessage.length > SECURITY_CONFIG.MAX_MESSAGE_LENGTH) {
      EdgeRuntime.waitUntil(
        logSecurityEvent(phone, 'message_too_long', rawMessage.substring(0, 100), undefined, requestId),
      )
      return createTwimlResponse('Lo siento, tu mensaje es demasiado largo. Por favor, envía un mensaje más corto.')
    }

    const rateLimitCheck = await checkRateLimit(supabase, phone)
    if (!rateLimitCheck.allowed) {
      EdgeRuntime.waitUntil(
        logSecurityEvent(phone, 'rate_limit_exceeded', `${rateLimitCheck.count} messages`, undefined, requestId),
      )
      return createTwimlResponse('Has enviado demasiados mensajes. Por favor, espera un momento antes de continuar.')
    }

    const injectionCheck = detectPromptInjection(rawMessage)
    if (injectionCheck.detected) {
      EdgeRuntime.waitUntil(
        logSecurityEvent(phone, 'prompt_injection_attempt', rawMessage, injectionCheck.pattern, requestId),
      )
      return createTwimlResponse('Lo siento, tu mensaje contiene caracteres no permitidos. Por favor, reformula tu pregunta.')
    }

    const message = sanitizeInput(rawMessage)

    // ── Audit inbound event (fire-and-forget) ─────────────────────────────
    EdgeRuntime.waitUntil(
      recordInboundEvent(supabase, {
        business_id: BUSINESS_ID,
        source: 'twilio',
        source_event_id: messageSid,
        event_type: 'whatsapp_message',
        payload: {
          phone_hash: phoneHash,
          message_length: message.length,
          profile_name: profileName,
          message_sid: messageSid,
        },
        request_id: requestId,
      }),
    )

    // ── Build context ────────────────────────────────────────────────────────

    const customer = await getOrCreateCustomer(supabase, phone, profileName)
    const { conversation } = await getOrCreateConversation(supabase, customer.id)
    const rawName = customer.name || profileName || null

    // ── FT-01: Idempotency check — insert user message with MessageSid ───────
    // If this SID was already processed (Twilio retry), insertMessage returns
    // the sentinel 'DUPLICATE' and we short-circuit the handler.
    const userMsgId = await insertMessage(conversation.id, 'user', message, supabase, messageSid)
    if (userMsgId === 'DUPLICATE') {
      slog('info', 'duplicate_webhook_ignored', { message_sid: messageSid, request_id: requestId })
      EdgeRuntime.waitUntil(
        logPipelineTrace({
          trace_id: requestId,
          conversation_id: conversation.id,
          business_id: BUSINESS_ID,
          stage: 'inbound',
          event: 'skipped',
          detail: { reason: 'duplicate_message_sid', message_sid: messageSid },
        }),
      )
      return createTwimlResponse('') // Twilio ignores empty TwiML responses gracefully
    }

    // ── Enqueue turn integrity processing as a durable job ─────────────────
    await insertJob(supabase, {
      business_id: BUSINESS_ID,
      job_type: 'turn.integrity',
      aggregate_type: 'conversation',
      aggregate_id: conversation.id,
      priority: INTERACTIVE_JOB_PRIORITY,
      payload: {
        conversation_id: conversation.id,
        customer_id: customer.id,
        business_id: BUSINESS_ID,
        phone_hash: phoneHash,
        user_message_id: userMsgId,
        request_id: requestId,
      },
    })

    slog('info', 'turn_integrity_enqueued', {
      phone_hash: phoneHash,
      conversation_id: conversation.id,
      request_id: requestId,
      duration_ms: Date.now() - start,
    })

    EdgeRuntime.waitUntil(
      logPipelineTrace({
        trace_id: requestId,
        conversation_id: conversation.id,
        business_id: BUSINESS_ID,
        stage: 'inbound',
        event: 'enqueued',
        detail: { user_message_id: userMsgId, message_sid: messageSid },
      }),
    )

    // Trigger job-worker immediately so it picks up the job without waiting for cron
    EdgeRuntime.waitUntil(triggerJobWorker())

    EdgeRuntime.waitUntil(
      logEdgeFunction({
        function_name: 'whatsapp-handler',
        status: 'success',
        duration_ms: Date.now() - start,
        request_id: requestId,
      }),
    )

    // Return empty TwiML — the real reply arrives via Twilio REST API
    // when the job-worker releases and processes the semantic turn.
    return createEmptyTwimlResponse()
  } catch (error: any) {
    slog('error', 'handler_unhandled_error', {
      error: error.message,
      request_id: requestId,
      duration_ms: Date.now() - start,
    })

    EdgeRuntime.waitUntil(
      Promise.all([
        logSecurityEvent('system', 'error', error.message || 'Unknown error', undefined, requestId),
        logEdgeFunction({
          function_name: 'whatsapp-handler',
          status: 'error',
          duration_ms: Date.now() - start,
          error_message: error.message,
          error_stack: error.stack,
          request_id: requestId,
        }),
        logPipelineTrace({
          trace_id: requestId,
          stage: 'inbound',
          event: 'failed',
          error: error.message,
        }),
      ]),
    )

    return createTwimlResponse('Lo siento, estoy teniendo problemas. Intenta de nuevo.')
  }
})
