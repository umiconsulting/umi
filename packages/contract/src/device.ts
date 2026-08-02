import { z } from 'zod';
import { EffectiveEntitlement, Uuid, IsoTimestamp } from './platform';
import { LoginRequest, SessionEnvelope } from './schemas';

export const DeviceLifecycleState = z.enum([
  'enrollment_pending',
  'active',
  'rotation_required',
  'rotated',
  'revoked',
  'replaced',
]);
export type DeviceLifecycleState = z.infer<typeof DeviceLifecycleState>;
export const DeviceType = z.enum(['pos_terminal', 'kds']);
export const DevicePlatform = z.enum(['android', 'ios', 'linux', 'macos', 'windows', 'web']);

export const DeviceSummary = z
  .object({
    id: Uuid,
    publicId: Uuid,
    tenantId: Uuid,
    branchId: Uuid.nullable(),
    displayName: z.string().min(1).max(120),
    type: DeviceType,
    platform: DevicePlatform,
    state: DeviceLifecycleState,
    credentialVersion: z.number().int().positive(),
    lastSeenAt: IsoTimestamp.nullable(),
    rotationRequired: z.boolean(),
    revokedAt: IsoTimestamp.nullable(),
    replacementDeviceId: Uuid.nullable(),
  })
  .strict();
export type DeviceSummary = z.infer<typeof DeviceSummary>;

export const BeginDeviceEnrollmentRequest = z
  .object({
    branchId: Uuid.nullable(),
    displayName: z.string().trim().min(1).max(120),
    type: DeviceType,
    platform: DevicePlatform,
    idempotencyKey: Uuid,
  })
  .strict();
export type BeginDeviceEnrollmentRequest = z.infer<typeof BeginDeviceEnrollmentRequest>;

export const EnrollmentChallenge = z
  .object({
    challengeId: Uuid,
    enrollmentCode: z.string().regex(/^[A-Z0-9]{8}$/),
    expiresAt: IsoTimestamp,
  })
  .strict();
export type EnrollmentChallenge = z.infer<typeof EnrollmentChallenge>;

export const CompleteDeviceEnrollmentRequest = z
  .object({
    challengeId: Uuid,
    enrollmentCode: z.string().regex(/^[A-Z0-9]{8}$/),
    installationId: Uuid,
  })
  .strict();
export type CompleteDeviceEnrollmentRequest = z.infer<typeof CompleteDeviceEnrollmentRequest>;

export const DeviceCredentialEnvelope = z
  .object({ device: DeviceSummary, credential: z.string().min(43).max(128) })
  .strict();
export type DeviceCredentialEnvelope = z.infer<typeof DeviceCredentialEnvelope>;

export const RotateDeviceCredentialRequest = z
  .object({
    idempotencyKey: Uuid,
    currentCredentialVersion: z.number().int().positive(),
  })
  .strict();
export type RotateDeviceCredentialRequest = z.infer<typeof RotateDeviceCredentialRequest>;

export const RevokeDeviceRequest = z
  .object({ idempotencyKey: Uuid, reason: z.string().trim().min(1).max(160) })
  .strict();
export type RevokeDeviceRequest = z.infer<typeof RevokeDeviceRequest>;

export const ReplaceDeviceRequest = BeginDeviceEnrollmentRequest.extend({
  replacedDeviceId: Uuid,
}).strict();
export type ReplaceDeviceRequest = z.infer<typeof ReplaceDeviceRequest>;

export const PosLoginRequest = LoginRequest.extend({ installationId: Uuid }).strict();
export type PosLoginRequest = z.infer<typeof PosLoginRequest>;
export const PosRefreshRequest = z
  .object({ refreshToken: z.string().min(1).max(4096), installationId: Uuid })
  .strict();
export type PosRefreshRequest = z.infer<typeof PosRefreshRequest>;
export const PosSessionTokens = z
  .object({
    accessToken: z.string().min(1).max(4096),
    refreshToken: z.string().min(1).max(4096),
  })
  .strict();
/**
 * The session envelope a POS device receives. It EXTENDS the shared browser
 * envelope rather than changing it.
 *
 * The POS needs two facts the dashboard has no use for: which durable session this
 * is (so an operator session can be bound to it and revoked with it) and which
 * device it was issued to. Adding them to the shared `SessionEnvelope` as required
 * fields would have been a breaking change to every dashboard consumer, in service
 * of a client that does not read them. Extending keeps one definition, one author,
 * and puts each field where it is meaningful.
 */
export const PosSessionEnvelope = SessionEnvelope.extend({
  sessionId: Uuid,
  deviceId: Uuid.nullable(),
});
export type PosSessionEnvelope = z.infer<typeof PosSessionEnvelope>;

export const PosSessionResponse = z
  .object({
    session: PosSessionEnvelope,
    tokens: PosSessionTokens,
  })
  .strict();
export type PosSessionResponse = z.infer<typeof PosSessionResponse>;

export const BranchAccess = z
  .object({
    id: Uuid,
    tenantId: Uuid,
    name: z.string().min(1).max(160),
    status: z.enum(['active', 'closed']),
    deviceAllowed: z.boolean(),
    operatorAllowed: z.boolean(),
  })
  .strict();
export type BranchAccess = z.infer<typeof BranchAccess>;

export const EntryTenant = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    roles: z.array(z.string().min(1).max(100)).max(50),
    permissions: z.array(z.string().min(1).max(100)).max(500),
    branches: z.array(BranchAccess).max(500),
    entitlements: z.array(EffectiveEntitlement).max(200),
  })
  .strict();
export const EntryContextResponse = z.object({ tenants: z.array(EntryTenant).max(100) }).strict();

export const OperatorSessionState = z.enum(['active', 'locked', 'ended']);
export const OperatorSessionView = z
  .object({
    id: Uuid,
    userId: Uuid,
    staffId: Uuid,
    tenantId: Uuid,
    branchId: Uuid,
    deviceId: Uuid,
    state: OperatorSessionState,
    permissions: z.array(z.string().min(1).max(100)).max(500),
    entitlements: z.array(EffectiveEntitlement).max(200),
    startedAt: IsoTimestamp,
    lastActivityAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
  })
  .strict();
export type OperatorSessionView = z.infer<typeof OperatorSessionView>;
export const StartOperatorSessionRequest = z.object({ tenantId: Uuid, branchId: Uuid }).strict();
export type StartOperatorSessionRequest = z.infer<typeof StartOperatorSessionRequest>;

export const VerifyOperatorPinRequest = z
  .object({
    pin: z.string().regex(/^\d{4,8}$/),
    permission: z.string().min(1).max(100),
    tenantId: Uuid,
    branchId: Uuid,
  })
  .strict();
export type VerifyOperatorPinRequest = z.infer<typeof VerifyOperatorPinRequest>;
export const ManagerApprovalRequest = z
  .object({
    operatorSessionId: Uuid,
    managerPin: z.string().regex(/^\d{4,8}$/),
    permission: z.string().min(1).max(100),
    tenantId: Uuid,
    branchId: Uuid,
  })
  .strict();
export type ManagerApprovalRequest = z.infer<typeof ManagerApprovalRequest>;
export const ElevationGrantView = z
  .object({
    elevationId: Uuid,
    permission: z.string().min(1).max(100),
    tenantId: Uuid,
    branchId: Uuid,
    method: z.enum(['manager_approval', 'operator_pin']),
    expiresAt: IsoTimestamp,
  })
  .strict();

export const deviceModels = {
  DeviceLifecycleState,
  DeviceType,
  DevicePlatform,
  DeviceSummary,
  BeginDeviceEnrollmentRequest,
  EnrollmentChallenge,
  CompleteDeviceEnrollmentRequest,
  DeviceCredentialEnvelope,
  RotateDeviceCredentialRequest,
  RevokeDeviceRequest,
  ReplaceDeviceRequest,
  PosLoginRequest,
  PosRefreshRequest,
  PosSessionTokens,
  PosSessionEnvelope,
  PosSessionResponse,
  BranchAccess,
  EntryTenant,
  EntryContextResponse,
  OperatorSessionState,
  OperatorSessionView,
  StartOperatorSessionRequest,
  VerifyOperatorPinRequest,
  ManagerApprovalRequest,
  ElevationGrantView,
} as const;
