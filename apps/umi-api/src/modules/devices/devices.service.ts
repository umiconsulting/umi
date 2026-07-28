import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type {
  BeginDeviceEnrollmentRequest,
  CompleteDeviceEnrollmentRequest,
  DeviceCredentialEnvelope,
  DeviceSummary,
} from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { IntegrityService } from '../integrity/integrity.service';
import { DevicesRepository } from './devices.repository';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class DevicesService {
  constructor(
    private readonly repo: DevicesRepository,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly integrity: IntegrityService,
  ) {}

  async begin(tenantId: string, actorUserId: string, dto: BeginDeviceEnrollmentRequest) {
    return this.beginForReplacement(tenantId, actorUserId, dto, null);
  }

  async beginForReplacement(
    tenantId: string,
    actorUserId: string,
    dto: BeginDeviceEnrollmentRequest,
    replacesDeviceId: string | null,
  ) {
    const id = randomUUID();
    const code = this.enrollmentCode(id);
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const challenge = await this.repo.beginEnrollment({
      id,
      tenantId,
      branchId: dto.branchId,
      displayName: dto.displayName,
      type: dto.type,
      platform: dto.platform,
      codeHash: hash(code),
      idempotencyKey: dto.idempotencyKey,
      expiresAt,
      actorUserId,
      replacesDeviceId,
    });
    return {
      challengeId: challenge.id,
      enrollmentCode: this.enrollmentCode(challenge.id),
      expiresAt: challenge.expiresAt.toISOString(),
    };
  }

  async complete(dto: CompleteDeviceEnrollmentRequest): Promise<DeviceCredentialEnvelope> {
    const credential = randomBytes(32).toString('base64url');
    const result = await this.repo.completeEnrollment({
      challengeId: dto.challengeId,
      codeHash: hash(dto.enrollmentCode.toUpperCase()),
      installationHash: hash(dto.installationId),
      credentialHash: hash(credential),
    });
    if (result === 'expired') throw new BadRequestException({ code: 'ENROLLMENT_EXPIRED' });
    if (result === 'attempts_exceeded') {
      throw new UnauthorizedException({ code: 'ENROLLMENT_ATTEMPTS_EXCEEDED' });
    }
    if (result === 'rejected') {
      throw new UnauthorizedException({ code: 'ENROLLMENT_REJECTED' });
    }
    return { device: result, credential };
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
    tenantId: string,
    deviceId: string,
    currentVersion: number,
    idempotencyKey: string,
  ): Promise<DeviceCredentialEnvelope> {
    const credential = this.rotationCredential(deviceId, currentVersion, idempotencyKey);
    const result = await this.integrity.execute<DeviceSummary>(
      {
        tenantId,
        branchId: null,
        commandId: idempotencyKey,
        idempotencyKey,
        commandType: 'device.credential.rotate',
        payload: { deviceId, currentVersion },
        expectedVersion: currentVersion,
      },
      async (context) => {
        const device = await this.repo.rotate(
          context.client,
          tenantId,
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
    tenantId: string,
    deviceId: string,
    reason: string,
    idempotencyKey: string,
  ): Promise<void> {
    const result = await this.integrity.execute<DeviceSummary>(
      {
        tenantId,
        branchId: null,
        commandId: idempotencyKey,
        idempotencyKey,
        commandType: 'device.revoke',
        payload: { deviceId, reason },
      },
      async (context) => {
        const device = await this.repo.revoke(context.client, tenantId, deviceId, reason);
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
}
