// zod schemas as the single source of truth for the api<->dashboard payload
// shapes. Each schema exports both the runtime validator and its inferred TS
// type (z.infer), so the server and client share one definition. Mirrors the
// live umi-api controllers/DTOs (verified against apps/umi-api/src/modules/**).
import { z } from 'zod';

// ── Request bodies ────────────────────────────────────────────────────────

/** POST /api/auth/local/login. */
export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const ForgotPasswordRequest = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const ResetPasswordRequest = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

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

/** POST /api/:slug/admin/scan. */
export const ScanRequest = z.object({
  qrPayload: z.string(),
  action: z.enum(CASH_SCAN_ACTIONS).optional(),
  actions: z.array(z.enum(CASH_SCAN_ACTIONS)).min(1).max(3).optional(),
});
export type ScanRequest = z.infer<typeof ScanRequest>;

/** POST /api/:slug/admin/topup (min $1.00). */
export const TopupRequest = z.object({
  cardId: z.string(),
  amountCentavos: z.number().int().min(100),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().max(80).optional(),
});
export type TopupRequest = z.infer<typeof TopupRequest>;

/** POST /api/:slug/admin/purchase (min $0.01). */
export const PurchaseRequest = z.object({
  cardId: z.string(),
  amountCentavos: z.number().int().min(1),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().max(80).optional(),
});
export type PurchaseRequest = z.infer<typeof PurchaseRequest>;

/** POST /api/:slug/admin/gift-cards. Each recipient field is validated only
 *  when it is the sole channel. This preserves the existing v1 behavior. */
export const GiftCardCreateRequest = z
  .object({
    amountCentavos: z.number().int().min(100),
    senderName: z.string().max(100).optional(),
    message: z.string().max(300).optional(),
    recipientEmail: z.string().optional(),
    recipientPhone: z.string().optional(),
    recipientName: z.string().max(100).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.recipientEmail && !v.recipientPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientEmail'],
        message: 'Se requiere email o teléfono del destinatario',
      });
      return;
    }
    // @ValidateIf(o => !o.recipientPhone) @IsEmail
    if (
      !v.recipientPhone &&
      v.recipientEmail &&
      !z.string().email().safeParse(v.recipientEmail).success
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientEmail'],
        message: 'Se requiere email o teléfono del destinatario',
      });
    }
    // @ValidateIf(o => !o.recipientEmail) @MaxLength(20)
    if (!v.recipientEmail && v.recipientPhone && v.recipientPhone.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recipientPhone'],
        message: 'recipientPhone must be at most 20 characters',
      });
    }
  });
export type GiftCardCreateRequest = z.infer<typeof GiftCardCreateRequest>;

/** POST /api/:slug/customers (member registration). */
export const RegisterMemberRequest = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
    .refine(isCalendarDate, 'birthDate must be a real calendar date'),
});
export type RegisterMemberRequest = z.infer<typeof RegisterMemberRequest>;

/** POST /api/:slug/gift/:code (public gift redemption). */
export const GiftRedeemRequest = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type GiftRedeemRequest = z.infer<typeof GiftRedeemRequest>;

export const httpModels = {
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  SessionUser,
  TenantMembership,
  TenantSummary,
  SessionEnvelope,
  SessionResponse,
  MeTenantsResponse,
  OkResponse,
  ScanRequest,
  TopupRequest,
  PurchaseRequest,
  GiftCardCreateRequest,
  RegisterMemberRequest,
  GiftRedeemRequest,
} as const;
