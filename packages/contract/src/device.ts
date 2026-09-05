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
/**
 * How a terminal is used on the floor, as the owner declares it. It is deliberately
 * NOT derived from `platform`: the same Android tablet is a fixed register on one
 * counter and a hand-held on the next, and the label exists for the person who has to
 * find the device, not for the runtime.
 */
export const DeviceMobility = z.enum(['static', 'mobile']);
export type DeviceMobility = z.infer<typeof DeviceMobility>;

export const DeviceSummary = z
  .object({
    id: Uuid,
    publicId: Uuid,
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    displayName: z.string().min(1).max(120),
    type: DeviceType,
    platform: DevicePlatform,
    mobility: DeviceMobility,
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
    locationId: Uuid.nullable(),
    displayName: z.string().trim().min(1).max(120),
    type: DeviceType,
    platform: DevicePlatform,
    mobility: DeviceMobility.default('static'),
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

export const DeviceEnrollmentRequestState = z.enum([
  'created',
  'awaiting_approval',
  'approved',
  'denied',
  'credential_ready',
  'credential_delivered',
  'completed',
  'expired',
  'cancelled',
]);
export type DeviceEnrollmentRequestState = z.infer<typeof DeviceEnrollmentRequestState>;

export const DeviceEnrollmentRequestCreated = z
  .object({
    enrollmentRequestId: Uuid,
    setupCode: z.string().regex(/^[A-Z0-9]{8}$/),
    qrPayload: z.string().min(1).max(512),
    state: z.literal('created'),
    expiresAt: IsoTimestamp,
    pollAfterSeconds: z.number().int().min(1).max(30),
  })
  .strict();
export type DeviceEnrollmentRequestCreated = z.infer<typeof DeviceEnrollmentRequestCreated>;

export const ClaimDevicePairingRequest = z
  .object({
    setupCode: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{8}$/),
    installationId: Uuid,
    platform: DevicePlatform,
    deviceType: DeviceType,
    ephemeralPublicKey: z.string().trim().min(32).max(2048).nullable().optional(),
  })
  .strict();
export type ClaimDevicePairingRequest = z.infer<typeof ClaimDevicePairingRequest>;

export const DevicePairingSession = z
  .object({
    pairingSessionId: Uuid,
    pollingCredential: z.string().min(43).max(128),
    state: z.literal('awaiting_approval'),
    expiresAt: IsoTimestamp,
    pollAfterSeconds: z.number().int().min(1).max(30),
  })
  .strict();
export type DevicePairingSession = z.infer<typeof DevicePairingSession>;

export const DeviceEnrollmentRequestView = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    locationId: Uuid.nullable(),
    displayName: z.string().min(1).max(120),
    type: DeviceType,
    platform: DevicePlatform,
    requestedPlatform: DevicePlatform.nullable(),
    mobility: DeviceMobility,
    state: DeviceEnrollmentRequestState,
    expiresAt: IsoTimestamp,
    claimedAt: IsoTimestamp.nullable(),
    installationReference: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .nullable(),
    createdAt: IsoTimestamp,
  })
  .strict();
export type DeviceEnrollmentRequestView = z.infer<typeof DeviceEnrollmentRequestView>;

export const DeviceEnrollmentRequestList = z
  .object({ requests: z.array(DeviceEnrollmentRequestView).max(200) })
  .strict();
export type DeviceEnrollmentRequestList = z.infer<typeof DeviceEnrollmentRequestList>;

/**
 * The devices an owner may see for one merchant: the enrolled terminals themselves,
 * not the requests that produced them. A revoked or replaced device is excluded — it
 * is history, and the screen that reads this lists what is in service.
 */
export const DeviceList = z.object({ devices: z.array(DeviceSummary).max(200) }).strict();
export type DeviceList = z.infer<typeof DeviceList>;

/** The two fields an owner may change on an enrolled device after the fact. */
export const UpdateDeviceRequest = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    mobility: DeviceMobility,
  })
  .strict();
export type UpdateDeviceRequest = z.infer<typeof UpdateDeviceRequest>;

export const DecideDeviceEnrollmentRequest = z.object({ idempotencyKey: Uuid }).strict();
export type DecideDeviceEnrollmentRequest = z.infer<typeof DecideDeviceEnrollmentRequest>;

export const DeviceEnrollmentDecision = z
  .object({
    enrollmentRequestId: Uuid,
    state: z.enum(['credential_ready', 'denied']),
    decidedAt: IsoTimestamp,
  })
  .strict();
export type DeviceEnrollmentDecision = z.infer<typeof DeviceEnrollmentDecision>;

export const PollDevicePairingRequest = z
  .object({
    pollingCredential: z.string().min(43).max(128),
    installationId: Uuid,
  })
  .strict();
export type PollDevicePairingRequest = z.infer<typeof PollDevicePairingRequest>;

export const DevicePairingPollResponse = z
  .object({
    pairingSessionId: Uuid,
    state: z.enum([
      'awaiting_approval',
      'credential_ready',
      'credential_delivered',
      'completed',
      'denied',
      'expired',
      'cancelled',
    ]),
    expiresAt: IsoTimestamp,
    pollAfterSeconds: z.number().int().min(1).max(30),
    device: DeviceSummary.nullable(),
    credential: z.string().min(43).max(128).nullable(),
  })
  .strict();
export type DevicePairingPollResponse = z.infer<typeof DevicePairingPollResponse>;

export const AcknowledgeDeviceCredentialRequest = PollDevicePairingRequest.extend({
  deviceCredential: z.string().min(43).max(128),
}).strict();
export type AcknowledgeDeviceCredentialRequest = z.infer<typeof AcknowledgeDeviceCredentialRequest>;

export const DevicePairingAcknowledgement = z
  .object({
    pairingSessionId: Uuid,
    state: z.literal('completed'),
    completedAt: IsoTimestamp,
  })
  .strict();
export type DevicePairingAcknowledgement = z.infer<typeof DevicePairingAcknowledgement>;

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
export const PosPinLoginRequest = z
  .object({
    pin: z.string().regex(/^\d{4,8}$/),
    merchantId: Uuid,
    locationId: Uuid,
    installationId: Uuid,
  })
  .strict();
export type PosPinLoginRequest = z.infer<typeof PosPinLoginRequest>;
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

export const LocationAccess = z
  .object({
    id: Uuid,
    merchantId: Uuid,
    name: z.string().min(1).max(160),
    status: z.enum(['active', 'closed']),
    deviceAllowed: z.boolean(),
    operatorAllowed: z.boolean(),
  })
  .strict();
export type LocationAccess = z.infer<typeof LocationAccess>;

export const EntryMerchant = z
  .object({
    id: Uuid,
    name: z.string().min(1).max(160),
    roles: z.array(z.string().min(1).max(100)).max(50),
    permissions: z.array(z.string().min(1).max(100)).max(500),
    locations: z.array(LocationAccess).max(500),
    entitlements: z.array(EffectiveEntitlement).max(200),
  })
  .strict();
export const EntryContextResponse = z
  .object({ merchants: z.array(EntryMerchant).max(100) })
  .strict();

export const OperatorSessionState = z.enum(['active', 'locked', 'ended']);
export const OperatorSessionView = z
  .object({
    id: Uuid,
    userId: Uuid,
    staffId: Uuid,
    merchantId: Uuid,
    locationId: Uuid,
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
export const StartOperatorSessionRequest = z
  .object({ merchantId: Uuid, locationId: Uuid })
  .strict();
export type StartOperatorSessionRequest = z.infer<typeof StartOperatorSessionRequest>;

export const VerifyOperatorPinRequest = z
  .object({
    pin: z.string().regex(/^\d{4,8}$/),
    permission: z.string().min(1).max(100),
    merchantId: Uuid,
    locationId: Uuid,
  })
  .strict();
export type VerifyOperatorPinRequest = z.infer<typeof VerifyOperatorPinRequest>;
export const ManagerApprovalRequest = z
  .object({
    operatorSessionId: Uuid,
    /**
     * Exactly one of `managerPin` or `managerCard` must be sent. It is not
     * expressed as a zod refinement because a top-level refinement turns this
     * model into a `ZodEffects`, which the Dart emitter cannot describe; the
     * API rejects a request carrying both or neither.
     */
    managerPin: z
      .string()
      .regex(/^\d{4,8}$/)
      .nullable()
      .default(null),
    /** Opaque token read from a manager card or fob. */
    managerCard: z.string().min(8).max(256).nullable().default(null),
    permission: z.string().min(1).max(100),
    merchantId: Uuid,
    locationId: Uuid,
    commandFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .strict();
export type ManagerApprovalRequest = z.infer<typeof ManagerApprovalRequest>;
export const ElevationGrantView = z
  .object({
    elevationId: Uuid,
    permission: z.string().min(1).max(100),
    merchantId: Uuid,
    locationId: Uuid,
    method: z.enum(['manager_approval', 'manager_card', 'operator_pin']),
    expiresAt: IsoTimestamp,
    commandFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
  })
  .strict();

export const deviceModels = {
  DeviceLifecycleState,
  DeviceType,
  DevicePlatform,
  DeviceMobility,
  DeviceSummary,
  DeviceList,
  UpdateDeviceRequest,
  BeginDeviceEnrollmentRequest,
  EnrollmentChallenge,
  DeviceEnrollmentRequestState,
  DeviceEnrollmentRequestCreated,
  ClaimDevicePairingRequest,
  DevicePairingSession,
  DeviceEnrollmentRequestView,
  DeviceEnrollmentRequestList,
  DecideDeviceEnrollmentRequest,
  DeviceEnrollmentDecision,
  PollDevicePairingRequest,
  DevicePairingPollResponse,
  AcknowledgeDeviceCredentialRequest,
  DevicePairingAcknowledgement,
  CompleteDeviceEnrollmentRequest,
  DeviceCredentialEnvelope,
  RotateDeviceCredentialRequest,
  RevokeDeviceRequest,
  ReplaceDeviceRequest,
  PosLoginRequest,
  PosPinLoginRequest,
  PosRefreshRequest,
  PosSessionTokens,
  PosSessionEnvelope,
  PosSessionResponse,
  LocationAccess,
  EntryMerchant,
  EntryContextResponse,
  OperatorSessionState,
  OperatorSessionView,
  StartOperatorSessionRequest,
  VerifyOperatorPinRequest,
  ManagerApprovalRequest,
  ElevationGrantView,
} as const;
