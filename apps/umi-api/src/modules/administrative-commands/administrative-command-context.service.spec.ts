import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdministrativeCommandContextService } from './administrative-command-context.service';

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  sessionId: '00000000-0000-4000-8000-000000000002',
  deviceId: null,
};
const access = {
  merchantId: '00000000-0000-4000-8000-000000000003',
  handle: null,
  name: 'Pilot',
  timezone: 'America/Mazatlan',
  membershipId: '00000000-0000-4000-8000-000000000004',
  role: 'owner',
  roles: ['owner'],
  permissions: ['inventory.adjust.increase'],
  locationId: '00000000-0000-4000-8000-000000000005',
};
const command = {
  operation: 'inventory.adjustment',
  locationId: access.locationId,
  targetAggregateId: '00000000-0000-4000-8000-000000000006',
  targetVersion: 4,
  commandId: '00000000-0000-4000-8000-000000000007',
  idempotencyKey: '00000000-0000-4000-8000-000000000008',
  parameters: { direction: 'increase', quantity: 2 },
  approvalId: null,
};

describe('AdministrativeCommandContextService', () => {
  const repository = {
    assertDashboardSession: vi.fn().mockResolvedValue(true),
    findCommand: vi.fn().mockResolvedValue(null),
  };

  it('derives actor and scope from the current server session', async () => {
    const service = new AdministrativeCommandContextService(repository as never);
    const result = await service.create(user, access, command);
    expect(result).toMatchObject({
      type: 'dashboard_administrative',
      actorUserId: user.id,
      membershipId: access.membershipId,
      merchantId: access.merchantId,
      locationId: access.locationId,
      sessionId: user.sessionId,
      origin: 'dashboard',
    });
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects POS identity, synthesized access, wrong scope, and missing permission', async () => {
    const service = new AdministrativeCommandContextService(repository as never);
    await expect(
      service.create({ ...user, deviceId: command.commandId }, access, command),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.create(user, { ...access, membershipId: null }, command),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(user, access, { ...command, locationId: command.commandId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(user, { ...access, permissions: [] }, command),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('produces stable fingerprints and changes them with command input', async () => {
    const service = new AdministrativeCommandContextService(repository as never);
    const one = await service.create(user, access, command);
    const same = await service.create(user, access, {
      ...command,
      parameters: { quantity: 2, direction: 'increase' },
    });
    const changed = await service.create(user, access, {
      ...command,
      parameters: { quantity: 3, direction: 'increase' },
    });
    expect(same.fingerprint).toBe(one.fingerprint);
    expect(changed.fingerprint).not.toBe(one.fingerprint);
  });
});
