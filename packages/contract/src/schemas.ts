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

// ── Cash / loyalty product-write requests ─────────────────────────────────
// Mirror the live umi-api DTOs 1:1 (apps/umi-api/src/modules/cash/dto/*), so the
// server (class-validator) and both clients (dashboard, umi-cash frontend) share
// one shape. Both surfaces call these: slug-scoped `/api/:slug/...` (umi-cash) and
// tenant-scoped `/api/tenants/:tenantId/cash/...` (dashboard) — see routes.ts.

/** A real YYYY-MM-DD calendar date — rejects impossible days (e.g. 2026-02-30),
 *  matching the DTO's `@IsISO8601({ strict: true })`. */
const isCalendarDate = (s: string): boolean => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** Scan actions — mirrors cash/dto/scan.dto.ts `ACTIONS`. */
export const CASH_SCAN_ACTIONS = ['VISIT', 'REDEEM', 'BIRTHDAY_REDEEM'] as const;

/** POST /api/:slug/admin/scan — mirrors ScanDto. */
export const ScanRequest = z.object({
  qrPayload: z.string().min(1),
  action: z.enum(CASH_SCAN_ACTIONS).optional(),
  actions: z.array(z.enum(CASH_SCAN_ACTIONS)).min(1).max(3).optional(),
});
export type ScanRequest = z.infer<typeof ScanRequest>;

/** POST /api/:slug/admin/topup — mirrors TopupDto (min $1.00). */
export const TopupRequest = z.object({
  cardId: z.string().min(1),
  amountCentavos: z.number().int().min(100),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().max(80).optional(),
});
export type TopupRequest = z.infer<typeof TopupRequest>;

/** POST /api/:slug/admin/purchase — mirrors PurchaseDto (min $0.01). */
export const PurchaseRequest = z.object({
  cardId: z.string().min(1),
  amountCentavos: z.number().int().min(1),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().max(80).optional(),
});
export type PurchaseRequest = z.infer<typeof PurchaseRequest>;

/** POST /api/:slug/admin/gift-cards — mirrors GiftCardCreateDto. Requires at least
 *  one recipient channel (email or phone), matching the two `@ValidateIf` rules. */
export const GiftCardCreateRequest = z
  .object({
    amountCentavos: z.number().int().min(100),
    senderName: z.string().max(100).optional(),
    message: z.string().max(300).optional(),
    recipientEmail: z.string().email().optional(),
    recipientPhone: z.string().max(20).optional(),
    recipientName: z.string().max(100).optional(),
  })
  .refine((v) => Boolean(v.recipientEmail || v.recipientPhone), {
    message: 'Se requiere email o teléfono del destinatario',
    path: ['recipientEmail'],
  });
export type GiftCardCreateRequest = z.infer<typeof GiftCardCreateRequest>;

/** POST /api/:slug/customers — mirrors RegisterDto (member registration). */
export const RegisterMemberRequest = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
    .refine(isCalendarDate, 'birthDate must be a real calendar date'),
});
export type RegisterMemberRequest = z.infer<typeof RegisterMemberRequest>;

/** POST /api/:slug/gift/:code — mirrors GiftRedeemDto (public gift redemption). */
export const GiftRedeemRequest = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type GiftRedeemRequest = z.infer<typeof GiftRedeemRequest>;
