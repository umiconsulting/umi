import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordService } from '../../shared/auth/password.service';
import { PlatformBootstrapService } from './platform-bootstrap.service';

const request = {
  commandId: '90000000-0000-4000-8000-000000000001',
  idempotencyKey: 'gate6b-bootstrap-001',
  merchant: { name: 'Café Piloto', timezone: 'America/Mazatlan', currency: 'MXN', locale: 'es-MX' },
  location: { name: 'Centro' },
  owner: { email: 'owner@pilot.local', fullName: 'Owner Piloto', password: 'CorrectHorse!2026' },
};

describe('PlatformBootstrapService', () => {
  const repository = { execute: vi.fn() };
  let service: PlatformBootstrapService;

  beforeEach(() => {
    repository.execute.mockReset();
    service = new PlatformBootstrapService(
      new ConfigService({
        PILOT_BOOTSTRAP_TOKEN: 'a'.repeat(48),
        PILOT_BOOTSTRAP_EXPIRES_AT: '2099-01-01T00:00:00.000Z',
      }),
      new PasswordService(),
      repository as never,
    );
  });

  it('rechaza una solicitud sin autoridad de bootstrap', async () => {
    await expect(service.execute(undefined, request)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(repository.execute).not.toHaveBeenCalled();
  });

  it('rechaza una autoridad incorrecta', async () => {
    await expect(service.execute('b'.repeat(48), request)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rechaza una autoridad expirada', async () => {
    service = new PlatformBootstrapService(
      new ConfigService({
        PILOT_BOOTSTRAP_TOKEN: 'a'.repeat(48),
        PILOT_BOOTSTRAP_EXPIRES_AT: '2020-01-01T00:00:00.000Z',
      }),
      new PasswordService(),
      repository as never,
    );
    await expect(service.execute('a'.repeat(48), request)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('envía una huella y un hash, pero nunca la contraseña', async () => {
    repository.execute.mockResolvedValue({
      merchantId: 'm',
      ownerUserId: 'u',
      locationId: 'l',
      replayed: false,
    });
    await service.execute('a'.repeat(48), request);
    expect(repository.execute).toHaveBeenCalledOnce();
    const input = repository.execute.mock.calls[0][0];
    expect(input.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(input.passwordHash).toMatch(/^[a-f0-9]{128}$/);
    expect(JSON.stringify(input)).not.toContain(request.owner.password);
  });
});
