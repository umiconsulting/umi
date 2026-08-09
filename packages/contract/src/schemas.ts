// zod schemas as the single source of truth for the api<->dashboard payload
// shapes. Each schema exports both the runtime validator and its inferred TS
// type (z.infer), so the server and client share one definition. Mirrors the
// live umi-api controllers/DTOs (verified against apps/umi-api/src/modules/**).
import { z } from 'zod';
import { nationalDigitsAreValid, phoneLengthMessage } from './phone';

// ── Request bodies ────────────────────────────────────────────────────────

/** POST /api/auth/local/login — mirrors umi-api LoginDto. */
export const LoginRequest = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/** POST /api/auth/local/forgot-password — mirrors umi-api ForgotPasswordDto. */
export const ForgotPasswordRequest = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

/** POST /api/auth/local/reset-password — mirrors umi-api ResetPasswordDto. */
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

/** Merchant membership as embedded in a session (login/refresh/me). Mirrors
 *  auth.repository MerchantMembershipSummary.
 *
 *  BREAKING (v2): `slug` became `handle`, and it is NULLABLE. Route by `id`. The handle
 *  is the café's PUBLISHED address — the one baked into issued wallet passes, umi-cash
 *  URLs and /logos/{handle}-*.png — and a café created after cutover has none. Callers
 *  that used `slug` to build an API path must use `id`; callers that displayed it to a
 *  human, or built an asset URL from it, want `handle` and must handle null. */
export const MerchantMembership = z.object({
  id: z.string(),
  handle: z.string().nullable(),
  name: z.string(),
  roles: z.array(z.string()),
});
export type MerchantMembership = z.infer<typeof MerchantMembership>;

/** GET /api/me/merchants row — membership plus timezone. Mirrors merchants.repository
 *  MerchantSummary. */
export const MerchantSummary = MerchantMembership.extend({
  timezone: z.string().nullable(),
});
export type MerchantSummary = z.infer<typeof MerchantSummary>;

export const SessionEnvelope = z.object({
  user: SessionUser,
  merchants: z.array(MerchantMembership),
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

/** GET /api/me/merchants. */
export const MeMerchantsResponse = z.object({ merchants: z.array(MerchantSummary) });
export type MeMerchantsResponse = z.infer<typeof MeMerchantsResponse>;

/** logout / forgot-password / reset-password. */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

/** POST .../global-logout — revoke every session of the caller. `exceptCurrent`
 *  keeps the session that issued the request, so "sign out my other devices" does
 *  not sign the caller out of the device they are holding. */
export const GlobalLogoutRequest = z.object({
  exceptCurrent: z.boolean().default(false),
});
export type GlobalLogoutRequest = z.infer<typeof GlobalLogoutRequest>;

/** POST /api/:merchantRef/admin/staff — mirrors umi-api CreateStaffDto. */
export const CreateStaffRequest = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email(),
    role: z.string().min(1).max(100),
    locationId: z.string().uuid().nullable().optional(),
    position: z.string().trim().max(160).nullable().optional(),
    operatorPin: z
      .string()
      .regex(/^\d{4,8}$/)
      .optional(),
  })
  .strict();
export type CreateStaffRequest = z.infer<typeof CreateStaffRequest>;

/** PATCH /api/:merchantRef/admin/staff/:staffId — mirrors umi-api UpdateStaffDto. */
export const UpdateStaffRequest = z
  .object({
    role: z.string().min(1).max(100).optional(),
    locationId: z.string().uuid().nullable().optional(),
    position: z.string().trim().max(160).nullable().optional(),
    operatorPin: z
      .string()
      .regex(/^\d{4,8}$/)
      .nullable()
      .optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict();
export type UpdateStaffRequest = z.infer<typeof UpdateStaffRequest>;

// ── Cash / loyalty product-write requests ─────────────────────────────────
// Mirror the live umi-api DTOs 1:1 (apps/umi-api/src/modules/cash/dto/*), so the
// server (class-validator) and both clients (dashboard, umi-cash frontend) share
// one shape. Both surfaces call these: reference-addressed `/api/:merchantRef/...` (umi-cash) and
// merchant-scoped `/api/merchants/:merchantId/cash/...` (dashboard) — see routes.ts.

/** A real YYYY-MM-DD calendar date — rejects impossible days (e.g. 2026-02-30),
 *  matching the DTO's `@IsISO8601({ strict: true })`. */
const isCalendarDate = (s: string): boolean => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** Scan actions — mirrors cash/dto/scan.dto.ts `ACTIONS`. */
export const CASH_SCAN_ACTIONS = ['VISIT', 'REDEEM', 'BIRTHDAY_REDEEM'] as const;

/** POST /api/:merchantRef/admin/scan — mirrors ScanDto. */
export const ScanRequest = z.object({
  qrPayload: z.string(),
  action: z.enum(CASH_SCAN_ACTIONS).optional(),
  actions: z.array(z.enum(CASH_SCAN_ACTIONS)).min(1).max(3).optional(),
});
export type ScanRequest = z.infer<typeof ScanRequest>;

/** POST /api/:merchantRef/admin/topup — mirrors TopupDto (min $1.00). */
export const TopupRequest = z.object({
  cardId: z.string(),
  amountCentavos: z.number().int().min(100),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().max(80).optional(),
});
export type TopupRequest = z.infer<typeof TopupRequest>;

/** POST /api/:merchantRef/admin/purchase — mirrors PurchaseDto (min $0.01). */
export const PurchaseRequest = z.object({
  cardId: z.string(),
  amountCentavos: z.number().int().min(1),
  note: z.string().max(200).optional(),
  idempotencyKey: z.string().max(80).optional(),
});
export type PurchaseRequest = z.infer<typeof PurchaseRequest>;

/** POST /api/:merchantRef/admin/gift-cards — mirrors GiftCardCreateDto. The two
 *  `@ValidateIf` rules mean each recipient field is validated *only when it is the
 *  sole channel*: email must be a valid email when no phone is given, phone must be
 *  ≤20 chars when no email is given, and at least one is required. When both are
 *  present the DTO validates neither — reproduced here so the contract accepts
 *  exactly what the server accepts. */
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

/** POST /api/:merchantRef/customers — mirrors RegisterDto (member registration). */
export const RegisterMemberRequest = z.object({
  name: z.string().min(2).max(100),
  // The country picker supplies the code; the customer types ONLY the national digits,
  // and they must be the count that country actually uses. `min(7).max(20)` was a string
  // length, not a phone rule, and it let 8-, 11- and 12-digit Mexican numbers through.
  phone: z
    .string()
    .min(7)
    .max(20)
    .refine(nationalDigitsAreValid, (v) => ({ message: phoneLengthMessage(v) })),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthDate must be YYYY-MM-DD')
    .refine(isCalendarDate, 'birthDate must be a real calendar date'),
});
export type RegisterMemberRequest = z.infer<typeof RegisterMemberRequest>;

/** POST /api/:merchantRef/gift/:code — mirrors GiftRedeemDto (public gift redemption). */
export const GiftRedeemRequest = z.object({
  phone: z.string().optional(),
  email: z.string().optional(),
});
export type GiftRedeemRequest = z.infer<typeof GiftRedeemRequest>;

// ── Model catalogue ───────────────────────────────────────────────────────
// The browser-surface half of `modelCatalog`. Names here are what `routeCatalog`
// refers to, so a route can only name a model that exists.

export const httpModels = {
  LoginRequest,
  ForgotPasswordRequest,
  ResetPasswordRequest,
  SessionUser,
  MerchantMembership,
  MerchantSummary,
  SessionEnvelope,
  SessionResponse,
  MeMerchantsResponse,
  OkResponse,
  GlobalLogoutRequest,
  CreateStaffRequest,
  UpdateStaffRequest,
  ScanRequest,
  TopupRequest,
  PurchaseRequest,
  GiftCardCreateRequest,
  RegisterMemberRequest,
  GiftRedeemRequest,
} as const;
