import { z } from 'zod';

/**
 * Parse recognized boolean strings; leave anything else UNTOUCHED so `z.boolean()`
 * rejects it. This makes a typo'd rollout flag (`CASH_WRITE_ENABLED=enabld`,
 * `OUTBOX_RELAY_ENABLED=ture`) fail boot loudly instead of silently coercing to
 * `false` and shipping the feature disabled.
 */
const booleanFromEnv = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const s = v.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return v; // unrecognized → falls through to z.boolean() → boot fails
}, z.boolean());

/**
 * The full environment contract. Required values have no `.optional()` — boot
 * fails loudly if they're missing. Values added in later phases are optional
 * until their phase wires them in.
 */
export const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database — two roles (spec §11.2).
  DATABASE_URL_APP: z.string().url(), // umi_app (RLS request role)
  DATABASE_URL_WORKER: z.string().url(), // umi_worker (BYPASSRLS)
  DATABASE_URL_READONLY: z.string().url().optional(), // umi_readonly (analytics)
  // TLS: path to (or inline PEM of) the Postgres server's root CA. When set, both
  // pools use verify-full (CA + hostname + rejectUnauthorized). Unset = plaintext
  // (local dev against localhost). Do NOT put sslmode in the URLs — this governs TLS.
  PGSSLROOTCERT: z.string().optional(),

  // Redis / BullMQ.
  REDIS_URL: z.string().url(),

  // Observability schema that holds the runtime trace tables umi-logs reads
  // (ai_turn_logs, edge_function_logs, security_logs, pipeline_traces). Live
  // default is `conversaflow`; confirm against the platform DB. Validated as a
  // safe SQL identifier since it's interpolated into INSERT statements.
  OBSERVABILITY_SCHEMA: z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
    .default('conversaflow'),

  // Wallet-pass refresh (Apple PassKit + Google Wallet). Best-effort push fired
  // after cash money writes; when unset, the refresh is skipped (money write is
  // unaffected). Points at the pass-push service once cert infra is provisioned.
  WALLET_PASS_PUSH_URL: z.string().url().optional(),

  // Feature flags.
  CASH_WRITE_ENABLED: booleanFromEnv.default(false), // retained; cash writes are live
  // Transactional-outbox relay (§10.4). Phase 3d registered the event_type→queue
  // routes (twilio.reply etc.), so it's on by default now. Worker-only +
  // idempotent (deterministic jobIds); set false to pause delivery in an emergency.
  OUTBOX_RELAY_ENABLED: booleanFromEnv.default(true),
  // Lifecycle WhatsApp crons (reward_expiring / streak / welcome_no_visit /
  // winback). OFF by default: umi-cash still runs these journeys during the
  // dual-writer window, so enabling here before umi-cash stops would double-send.
  // Owner flips to true at the Phase 3 cutover (and disables the umi-cash crons).
  LIFECYCLE_CRONS_ENABLED: booleanFromEnv.default(false),
  // KDS customer status notifications (Phase 4). When a KDS transition/partial-
  // cancel runs, emit a `twilio.status_notification`/`twilio.cancel_notification`
  // outbox row. OFF by default: while the iPad still hits the Supabase edge
  // functions, the legacy `kds.transition_ticket` RPC already enqueues these —
  // enabling here before the iPad is repointed would double-send. Transitions
  // still execute when off; only the customer notify is gated. Owner flips it
  // true at the iPad repoint + edge-function decommission.
  KDS_STATUS_NOTIFY_ENABLED: booleanFromEnv.default(false),
  // Landing-page lead email sequences (Phase 5). Gates the repeatable
  // `email_sequence` job that drains due diagnostic-followup emails. OFF by
  // default: while the landing page still runs its own SQLite/Vercel cron, a
  // second sender here would double-mail prospects. Owner flips it true at the
  // landing cutover (and disables the landing cron). Public contact/diagnostic
  // routes stay live regardless — only the background sequence tick is gated.
  LEADS_SEQUENCE_ENABLED: booleanFromEnv.default(false),

  // CORS.
  CORS_ORIGINS: z.string().optional(), // comma-separated origins

  // ── Auth (Phase 2, D9) — JWT access+refresh in httpOnly cookies ──
  // JWT_SECRET stays optional in the schema (so non-auth phases/tests boot
  // without it); JwtService throws a clear error if it's actually used without
  // one. Set it in any environment that serves the dashboard API.
  JWT_SECRET: z.string().min(16).optional(),
  // Duration grammar must match parseDurationSeconds (jose-style: 30m, 1h, 1800).
  // Reject unsupported values at config load — otherwise they parse to 0 and
  // silently disable cookie maxAge / the SPA's proactive refresh.
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+\s*(?:s|m|h|d|w)?$/, 'must be a duration like 30m, 1h, or 1800')
    .default('30m'), // SPA refreshes silently before expiry
  JWT_REFRESH_TTL: z
    .string()
    .regex(/^\d+\s*(?:s|m|h|d|w)?$/, 'must be a duration like 30d, 720h, or 2592000')
    .default('30d'),
  COOKIE_SECURE: booleanFromEnv.default(true), // false for local http dev
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(), // e.g. .umiconsulting.co
  APP_URL: z.string().url().optional(), // password-reset link base

  // Cash QR + customer-auth secrets (ported from umi-cash; MUST be byte-identical
  // to umi-cash's values or already-issued wallet passes / customer tokens fail).
  // APP_QR_SECRET is used TWO ways: HS256 JWT key (UTF-8 bytes) for in-app QR, and
  // RAW string HMAC key for static wallet barcodes — never pre-transform it.
  APP_QR_SECRET: z.string().min(32).optional(),
  JWT_ACCESS_SECRET: z.string().min(32).optional(), // cash CUSTOMER access token (24h)
  JWT_REFRESH_SECRET: z.string().min(32).optional(), // cash CUSTOMER refresh token (30d)

  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  // The EXACT public URL Twilio signs (e.g. https://api.umiconsulting.co/conversations/whatsapp).
  // Used for HMAC-SHA1 signature validation — never inferred from req.url (Phase 3d, spec §8.2).
  TWILIO_WEBHOOK_URL: z.string().url().optional(),
  // The webhook FAILS CLOSED when TWILIO_AUTH_TOKEN is unset (drops the request
  // rather than processing unsigned input). Set this true ONLY for local dev to
  // bypass signature validation; it must never be true in production.
  ALLOW_INSECURE_TWILIO_WEBHOOK: booleanFromEnv.default(false),
  // Location-pin tool (geo). Optional; the tool degrades to text when unset.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Tenant-resolution fallback (Phase 3): when an inbound WhatsApp number has no
  // matching tenant.whatsapp_number row, messages resolve to this tenant. Lets the
  // single live tenant keep working before its number is seeded in channel_accounts.
  DEFAULT_TENANT_ID: z.string().uuid().optional(),
  ZETTLE_CLIENT_ID: z.string().optional(),
  ZETTLE_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Recipient for the landing-page contact-form internal notification (Phase 5).
  // Falls back to EMAIL_FROM then hola@umiconsulting.co when unset.
  CONTACT_TO_EMAIL: z.string().optional(),
  // HMAC-SHA256 secret for the /api/leads/webhook/email-response signature
  // (X-Webhook-Signature: sha256=…). When set, the webhook verifies it and fails
  // closed on mismatch. When unset, the webhook is rejected in production and
  // allowed only in non-production (local testing) — mirroring the ported stub.
  LEADS_WEBHOOK_SECRET: z.string().optional(),
}).superRefine((cfg, ctx) => {
  // The Twilio signature bypass is a local-dev escape hatch only. Reject it at
  // boot in production so it can never silently disable webhook verification.
  if (cfg.NODE_ENV === 'production' && cfg.ALLOW_INSECURE_TWILIO_WEBHOOK) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ALLOW_INSECURE_TWILIO_WEBHOOK'],
      message: 'must not be true when NODE_ENV=production (it disables Twilio signature validation)',
    });
  }
  // If the lead sequence runs in production, the email-response webhook MUST be
  // verifiable — otherwise reply-driven mark_responded/unsubscribe fails closed
  // (unset secret → rejected in prod) and we keep mailing people who replied or
  // unsubscribed. Require the secret whenever the sequence is enabled in prod.
  if (
    cfg.NODE_ENV === 'production' &&
    cfg.LEADS_SEQUENCE_ENABLED &&
    !cfg.LEADS_WEBHOOK_SECRET
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LEADS_WEBHOOK_SECRET'],
      message: 'must be set when LEADS_SEQUENCE_ENABLED=true in production',
    });
  }
});

export type AppConfig = z.infer<typeof configSchema>;

/** Used by @nestjs/config `validate`. Throws a readable error on bad config. */
export function validateConfig(raw: Record<string, unknown>): AppConfig {
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
