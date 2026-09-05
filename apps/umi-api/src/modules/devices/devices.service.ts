import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type {
  BeginDeviceEnrollmentRequest,
  DeviceList,
  UpdateDeviceRequest,
  ClaimDevicePairingRequest,
  DeviceEnrollmentDecision,
  DeviceEnrollmentRequestList,
  DeviceEnrollmentRequestCreated,
  DevicePairingAcknowledgement,
  DevicePairingPollResponse,
  DevicePairingSession,
  DeviceCredentialEnvelope,
  DeviceSummary,
  PollDevicePairingRequest,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { RateLimitService } from '../../shared/ratelimit/rate-limit.service';
import { IntegrityService } from '../integrity/integrity.service';
import { DevicePairingEvents } from '../realtime/device-pairing.events';
import { DevicesRepository } from './devices.repository';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class DevicesService {
  constructor(
    private readonly repo: DevicesRepository,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly integrity: IntegrityService,
    private readonly rateLimit: RateLimitService,
    private readonly pairingEvents: DevicePairingEvents,
  ) {}

  async begin(
    merchantId: string,
    actorUserId: string,
    dto: BeginDeviceEnrollmentRequest,
  ): Promise<DeviceEnrollmentRequestCreated> {
    return this.beginForReplacement(merchantId, actorUserId, dto, null);
  }

  async beginForReplacement(
    merchantId: string,
    actorUserId: string,
    dto: BeginDeviceEnrollmentRequest,
    replacesDeviceId: string | null,
  ): Promise<DeviceEnrollmentRequestCreated> {
    this.enforceRateLimit(`device-enrollment:tenant:${merchantId}`, 40, 60 * 60_000);
    this.enforceRateLimit(`device-enrollment:admin:${actorUserId}`, 20, 60 * 60_000);
    const id = randomUUID();
    const code = this.enrollmentCode(id);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const request = await this.repo.beginPairing({
      id,
      merchantId,
      locationId: dto.locationId,
      displayName: dto.displayName,
      type: dto.type,
      platform: dto.platform,
      mobility: dto.mobility,
      codeHash: this.pairingCodeHash(code),
      idempotencyKey: dto.idempotencyKey,
      expiresAt,
      actorUserId,
      replacesDeviceId,
    });
    return {
      enrollmentRequestId: request.id,
      setupCode: this.enrollmentCode(request.id),
      qrPayload: `umipos://pair?v=1&code=${this.enrollmentCode(request.id)}`,
      state: 'created',
      expiresAt: request.expiresAt.toISOString(),
      pollAfterSeconds: 2,
    };
  }

  async claim(dto: ClaimDevicePairingRequest, ipAddress: string): Promise<DevicePairingSession> {
    const normalizedCode = dto.setupCode.trim().toUpperCase();
    const installationHash = hash(dto.installationId);
    this.enforceRateLimit(`device-pairing:ip:${ipAddress}`, 20, 5 * 60_000);
    this.enforceRateLimit(`device-pairing:installation:${installationHash}`, 10, 5 * 60_000);
    const pairingSessionId = randomUUID();
    const pollingCredential = this.pollingCredential(pairingSessionId, dto.installationId);
    const result = await this.repo.claimPairing({
      setupCodeHash: this.pairingCodeHash(normalizedCode),
      installationHash,
      installationReference: installationHash.slice(0, 16),
      platform: dto.platform,
      deviceType: dto.deviceType,
      ephemeralPublicKey: dto.ephemeralPublicKey ?? null,
      pairingSessionId,
      pollingCredentialHash: hash(pollingCredential),
    });
    if (result.state !== 'claimed') this.rejectPairing();
    const credential = this.pollingCredential(result.pairingSessionId, dto.installationId);
    return {
      pairingSessionId: result.pairingSessionId,
      pollingCredential: credential,
      state: 'awaiting_approval',
      expiresAt: result.expiresAt.toISOString(),
      pollAfterSeconds: 2,
    };
  }

  async list(
    merchantId: string,
    locationIds: string[] | null,
  ): Promise<DeviceEnrollmentRequestList> {
    return { requests: await this.repo.listPairingRequests(merchantId, locationIds) };
  }

  async listDevices(merchantId: string, locationIds: string[] | null): Promise<DeviceList> {
    return { devices: await this.repo.listDevices(merchantId, locationIds) };
  }

  async update(
    merchantId: string,
    deviceId: string,
    dto: UpdateDeviceRequest,
    locationIds: string[] | null,
  ): Promise<DeviceSummary> {
    const device = await this.repo.updateDevice({
      merchantId,
      deviceId,
      displayName: dto.displayName,
      mobility: dto.mobility,
      allowedBranchIds: locationIds,
    });
    if (!device) throw new NotFoundException({ code: 'DEVICE_NOT_ALLOWED' });
    return device;
  }

  async approve(
    merchantId: string,
    actorUserId: string,
    requestId: string,
    idempotencyKey: string,
    locationIds: string[] | null,
  ): Promise<DeviceEnrollmentDecision> {
    this.enforceRateLimit(`device-pairing:decision:${actorUserId}`, 60, 60 * 60_000);
    const credential = this.deviceCredential(requestId);
    const result = await this.repo.decidePairing({
      merchantId,
      actorUserId,
      requestId,
      idempotencyKey,
      approve: true,
      credentialHash: hash(credential),
      allowedBranchIds: locationIds,
    });
    if (!result) throw new ConflictException({ code: 'ENROLLMENT_REJECTED' });
    this.announcePairingDecision(result);
    return result;
  }

  async deny(
    merchantId: string,
    actorUserId: string,
    requestId: string,
    idempotencyKey: string,
    locationIds: string[] | null,
  ): Promise<DeviceEnrollmentDecision> {
    this.enforceRateLimit(`device-pairing:decision:${actorUserId}`, 60, 60 * 60_000);
    const result = await this.repo.decidePairing({
      merchantId,
      actorUserId,
      requestId,
      idempotencyKey,
      approve: false,
      credentialHash: null,
      allowedBranchIds: locationIds,
    });
    if (!result) throw new ConflictException({ code: 'ENROLLMENT_REJECTED' });
    this.announcePairingDecision(result);
    return result;
  }

  /**
   * Nudges the waiting device that the pairing state moved. The repository has
   * already committed by the time it returns, so the device cannot poll ahead of
   * its own decision. The payload carries no credential and no device: the poll
   * route stays the single credential-delivery gate.
   */
  private announcePairingDecision(
    decision: DeviceEnrollmentDecision & { pairingSessionId: string },
  ): void {
    this.pairingEvents.emitPairingChanged({
      pairingSessionId: decision.pairingSessionId,
      state: decision.state,
      occurredAt: decision.decidedAt,
    });
  }

  /**
   * Validates a realtime handshake for a device that waits for approval. It is
   * read-only on purpose: it counts no poll attempt and moves no state, so a
   * reconnecting socket cannot consume the budget that protects the poll route.
   * Returns the pairing session id to join, or null for every failure — the
   * caller must not tell the device which value was wrong.
   */
  async authorizePairingSocket(input: {
    pairingSessionId: string;
    pollingCredential: string;
    installationId: string;
  }): Promise<{ pairingSessionId: string } | null> {
    const session = await this.repo.findPairingSessionForRealtime({
      pairingSessionId: input.pairingSessionId,
      pollingCredentialHash: hash(input.pollingCredential),
      installationHash: hash(input.installationId),
    });
    return session ? { pairingSessionId: session.pairingSessionId } : null;
  }

  async poll(
    pairingSessionId: string,
    dto: PollDevicePairingRequest,
    ipAddress: string,
  ): Promise<DevicePairingPollResponse> {
    this.enforceRateLimit(`device-pairing:poll-ip:${ipAddress}`, 180, 5 * 60_000);
    this.enforceRateLimit(`device-pairing:poll-session:${pairingSessionId}`, 150, 5 * 60_000);
    const result = await this.repo.pollPairing({
      pairingSessionId,
      pollingCredentialHash: hash(dto.pollingCredential),
      installationHash: hash(dto.installationId),
    });
    if (!result) this.rejectPairing();
    const credential =
      result.device && result.state === 'credential_delivered'
        ? this.deviceCredential(result.requestId)
        : null;
    return {
      pairingSessionId,
      state: result.state,
      expiresAt: result.expiresAt.toISOString(),
      pollAfterSeconds: 2,
      device: result.device,
      credential,
    };
  }

  async acknowledge(
    pairingSessionId: string,
    dto: PollDevicePairingRequest & { deviceCredential: string },
    ipAddress: string,
  ): Promise<DevicePairingAcknowledgement> {
    this.enforceRateLimit(`device-pairing:ack-ip:${ipAddress}`, 30, 5 * 60_000);
    const result = await this.repo.acknowledgePairing({
      pairingSessionId,
      pollingCredentialHash: hash(dto.pollingCredential),
      installationHash: hash(dto.installationId),
      credentialHash: hash(dto.deviceCredential),
    });
    if (!result) this.rejectPairing();
    return result;
  }

  async authenticate(
    publicId: string | undefined,
    installationId: string | undefined,
    credential: string | undefined,
    allowRotationRequired = false,
  ): Promise<DeviceSummary> {
    if (!publicId || !installationId || !credential) {
      throw new UnauthorizedException({ code: 'DEVICE_CREDENTIAL_INVALID' });
    }
    const device = await this.repo.authenticate(publicId, hash(installationId), hash(credential));
    if (!device) throw new UnauthorizedException({ code: 'DEVICE_CREDENTIAL_INVALID' });
    if (device.state === 'rotation_required' && !allowRotationRequired) {
      throw new ConflictException({ code: 'DEVICE_ROTATION_REQUIRED' });
    }
    return device;
  }

  async rotate(
    merchantId: string,
    deviceId: string,
    currentVersion: number,
    idempotencyKey: string,
  ): Promise<DeviceCredentialEnvelope> {
    const credential = this.rotationCredential(deviceId, currentVersion, idempotencyKey);
    const result = await this.integrity.execute<DeviceSummary>(
      {
        merchantId,
        locationId: null,
        commandId: idempotencyKey,
        idempotencyKey,
        commandType: 'device.credential.rotate',
        payload: { deviceId, currentVersion },
        expectedVersion: currentVersion,
      },
      async (context) => {
        const device = await this.repo.rotate(
          context.client,
          merchantId,
          deviceId,
          currentVersion,
          hash(credential),
        );
        if (!device) {
          return { ok: false, code: 'CONFLICT', failureClass: 'conflict', retryable: false };
        }
        await context.appendAudit({
          eventType: 'device.credential_rotated',
          entityType: 'device',
          entityId: deviceId,
          outcome: 'success',
          publicData: { credentialVersion: device.credentialVersion },
        });
        return { ok: true, value: device };
      },
    );
    if (result.status !== 'succeeded' || !result.result) {
      throw new ConflictException({ code: result.failureCode ?? 'CONFLICT' });
    }
    return { device: result.result, credential };
  }

  async revoke(
    merchantId: string,
    deviceId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<void> {
    const result = await this.integrity.execute<DeviceSummary>(
      {
        merchantId,
        locationId: null,
        commandId: idempotencyKey,
        idempotencyKey,
        commandType: 'device.revoke',
        payload: { deviceId, reason },
      },
      async (context) => {
        const device = await this.repo.revoke(context.client, merchantId, deviceId, reason);
        if (!device) {
          return {
            ok: false,
            code: 'DEVICE_NOT_ALLOWED',
            failureClass: 'conflict',
            retryable: false,
          };
        }
        await context.appendAudit({
          eventType: 'device.revoked',
          entityType: 'device',
          entityId: deviceId,
          outcome: 'success',
          reasonCode: reason,
        });
        return { ok: true, value: device };
      },
    );
    if (result.status !== 'succeeded') {
      throw new BadRequestException({ code: 'DEVICE_NOT_ALLOWED' });
    }
  }

  private enrollmentCode(challengeId: string): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new Error('JWT_SECRET is required for device enrollment');
    return createHmac('sha256', secret)
      .update(`umi-device-enrollment:${challengeId}`)
      .digest('base64url')
      .replace(/[^A-Z0-9]/gi, '')
      .toUpperCase()
      .slice(0, 8);
  }

  private rotationCredential(
    deviceId: string,
    currentVersion: number,
    idempotencyKey: string,
  ): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new Error('JWT_SECRET is required for device credential rotation');
    return createHmac('sha256', secret)
      .update(`umi-device-rotation:${deviceId}:${currentVersion}:${idempotencyKey}`)
      .digest('base64url');
  }

  private pollingCredential(pairingSessionId: string, installationId: string): string {
    return this.secretHmac(`umi-device-polling:${pairingSessionId}:${installationId}`);
  }

  private pairingCodeHash(code: string): string {
    return createHmac('sha256', this.pairingSecret())
      .update(`umi-device-setup-code:${code}`)
      .digest('hex');
  }

  private deviceCredential(enrollmentRequestId: string): string {
    return this.secretHmac(`umi-device-pairing-credential:${enrollmentRequestId}`);
  }

  private secretHmac(value: string): string {
    return createHmac('sha256', this.pairingSecret()).update(value).digest('base64url');
  }

  private pairingSecret(): string {
    const secret = this.config.get('JWT_SECRET', { infer: true });
    if (!secret) throw new Error('JWT_SECRET is required for device pairing');
    return secret;
  }

  private enforceRateLimit(key: string, max: number, windowMs: number): void {
    const result = this.rateLimit.hit(key, max, windowMs);
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Request rate limit exceeded.',
          retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000)),
        },
        429,
      );
    }
  }

  private rejectPairing(): never {
    throw new UnauthorizedException({
      code: 'ENROLLMENT_REJECTED',
      message: 'The device pairing request is not available.',
    });
  }
}
