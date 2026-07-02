// zod schemas as the single source of truth for the api<->dashboard payload
// shapes. Each schema exports both the runtime validator and its inferred TS
// type (z.infer), so the server and client share one definition. Mirrors the
// live umi-api controllers/DTOs (verified against apps/umi-api/src/modules/**).
import { z } from 'zod';

// ── Request bodies ────────────────────────────────────────────────────────

/** POST /api/auth/local/login — mirrors umi-api LoginDto. */
export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

// ── Shared shapes ─────────────────────────────────────────────────────────

export const SessionUser = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string().nullable(),
});
export type SessionUser = z.infer<typeof SessionUser>;

/** Tenant membership as embedded in a session (login/refresh/me). Mirrors
 *  auth.repository TenantMembershipSummary. */
export const TenantMembership = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  roles: z.array(z.string()),
});
export type TenantMembership = z.infer<typeof TenantMembership>;

/** GET /api/me/tenants row — membership plus timezone. Mirrors tenants.repository
 *  TenantSummary. */
export const TenantSummary = TenantMembership.extend({
  timezone: z.string().nullable(),
});
export type TenantSummary = z.infer<typeof TenantSummary>;

export const SessionEnvelope = z.object({
  user: SessionUser,
  tenants: z.array(TenantMembership),
  provider: z.literal('local'),
  accessExpiresIn: z.number(),
});
export type SessionEnvelope = z.infer<typeof SessionEnvelope>;

// ── Responses ─────────────────────────────────────────────────────────────

/** POST /api/auth/local/login + /refresh, GET /api/auth/me. */
export const SessionResponse = z.object({ session: SessionEnvelope });
export type SessionResponse = z.infer<typeof SessionResponse>;

/** Back-compat alias — login response is a SessionResponse. */
export const LoginResponse = SessionResponse;
export type LoginResponse = SessionResponse;

/** GET /api/me/tenants. */
export const MeTenantsResponse = z.object({ tenants: z.array(TenantSummary) });
export type MeTenantsResponse = z.infer<typeof MeTenantsResponse>;

/** logout / forgot-password / reset-password. */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;
