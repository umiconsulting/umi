import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../shared/config/config.schema';
import { PasswordService } from '../../shared/auth/password.service';
import { PlatformBootstrapRepository } from './platform-bootstrap.repository';
import {
  PlatformBootstrapRequestSchema,
  type PlatformBootstrapRequest,
  type PlatformBootstrapResult,
} from './platform-bootstrap.types';

@Injectable()
export class PlatformBootstrapService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly passwords: PasswordService,
    private readonly repository: PlatformBootstrapRepository,
  ) {}

  async execute(
    token: string | undefined,
    raw: PlatformBootstrapRequest,
  ): Promise<PlatformBootstrapResult> {
    this.assertAuthority(token);
    const request = PlatformBootstrapRequestSchema.parse(raw);
    const canonical = JSON.stringify({
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      merchant: request.merchant,
      location: request.location,
      owner: {
        id: request.owner.id ?? null,
        staffId: request.owner.staffId ?? null,
        email: request.owner.email.toLowerCase(),
        fullName: request.owner.fullName,
      },
    });
    const fingerprint = createHash('sha256').update(canonical).digest('hex');
    const password = this.passwords.hash(request.owner.password);
    return this.repository.execute({
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      fingerprint,
      merchantName: request.merchant.name,
      merchantId: request.merchant.id ?? null,
      timezone: request.merchant.timezone,
      currency: request.merchant.currency,
      locale: request.merchant.locale,
      locationName: request.location.name,
      locationId: request.location.id ?? null,
      ownerEmail: request.owner.email.toLowerCase(),
      ownerUserId: request.owner.id ?? null,
      ownerStaffId: request.owner.staffId ?? null,
      ownerFullName: request.owner.fullName,
      passwordSalt: password.salt,
      passwordHash: password.hash,
    });
  }

  private assertAuthority(candidate: string | undefined): void {
    const expected = this.config.get('PILOT_BOOTSTRAP_TOKEN', { infer: true });
    if (!candidate || !expected || !sameSecret(candidate, expected))
      throw new UnauthorizedException('bootstrap_authority_required');
    const expiresAt = this.config.get('PILOT_BOOTSTRAP_EXPIRES_AT', { infer: true });
    if (!expiresAt || Date.parse(expiresAt) <= Date.now())
      throw new ForbiddenException('bootstrap_authority_expired');
  }
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
