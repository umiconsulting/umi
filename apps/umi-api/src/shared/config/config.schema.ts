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

  // Feature flags.
  CASH_WRITE_ENABLED: booleanFromEnv.default(false), // D11 — inert cash writes
  // Transactional-outbox relay (§10.4). Built in Phase 1c but inert until
  // Phase 3 registers event_type→queue routes and flips this on.
  OUTBOX_RELAY_ENABLED: booleanFromEnv.default(false),

  // CORS.
  CORS_ORIGINS: z.string().optional(), // comma-separated origins

  // ── Added in later phases (optional until wired) ──
  JWT_SECRET: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  VOYAGE_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  ZETTLE_CLIENT_ID: z.string().optional(),
  ZETTLE_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
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
