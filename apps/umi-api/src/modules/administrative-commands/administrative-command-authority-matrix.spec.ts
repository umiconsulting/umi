import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CsrfGuard } from '../auth/csrf.guard';
import { PosCatalogRepository } from '../pos-catalog/pos-catalog.repository';
import { PosCustomerValueRepository } from '../pos-customer-value/pos-customer-value.repository';
import { PosEntryRepository } from '../pos-entry/pos-entry.repository';
import { PosHardwareService } from '../pos-hardware/pos-hardware.service';
import { commandFingerprint } from '../integrity/canonical-json';
import { AdministrativeCommandContextService } from './administrative-command-context.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const user = {
  id: id(1),
  email: 'owner@example.test',
  sessionId: id(2),
  deviceId: null,
  commandContextType: 'dashboard_administrative' as const,
};
const access = {
  merchantId: id(3),
  handle: null,
  name: 'Pilot',
  timezone: 'America/Mazatlan',
  membershipId: id(4),
  role: 'owner',
  roles: ['owner'],
  permissions: ['inventory.adjust.increase'],
  locationId: id(5),
};
const command = {
  operation: 'inventory.adjustment',
  locationId: id(5),
  targetAggregateId: id(6),
  targetVersion: 1,
  commandId: id(7),
  idempotencyKey: id(8),
  parameters: { quantity: 1 },
  approvalId: null,
};

const repository = (overrides: Record<string, unknown> = {}) => ({
  assertDashboardSession: vi.fn().mockResolvedValue(true),
  findCommand: vi.fn().mockResolvedValue(null),
  claimCommand: vi.fn().mockResolvedValue({
    owner: true,
    row: {
      id: id(9),
      fingerprint: '',
      status: 'pending',
      result: {},
      failureCode: null,
      correlationId: 'matrix',
    },
  }),
  completeCommand: vi.fn(),
  ...overrides,
});

const service = (overrides: Record<string, unknown> = {}) =>
  new AdministrativeCommandContextService(repository(overrides) as never);

const csrfContext = (request: Record<string, unknown>) =>
  ({
    getType: () => 'http',
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request }),
  }) as never;

const csrf = () => new CsrfGuard({ getAllAndOverride: () => false } as never);

describe('Gate 5A negative administrative authority matrix', () => {
  it('1. rejects an anonymous browser mutation', async () => {
    await expect(service().create(null as never, access, command)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('2. rejects an expired Dashboard session', async () => {
    await expect(
      service({ assertDashboardSession: vi.fn().mockResolvedValue(false) }).create(
        user,
        access,
        command,
      ),
    ).rejects.toMatchObject({ response: { code: 'SESSION_REVOKED' } });
  });

  it('3. rejects a revoked membership', async () => {
    await expect(
      service().create(user, { ...access, membershipId: null }, command),
    ).rejects.toMatchObject({ response: { code: 'EXPLICIT_MEMBERSHIP_REQUIRED' } });
  });

  it('4. rejects a target aggregate from another merchant', async () => {
    const catalog = new PosCatalogRepository({} as never);
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(
      catalog.updateAdministrative(client as never, access.merchantId, id(30), 1, {}),
    ).rejects.toThrow('CATALOG_PRODUCT_NOT_FOUND');
  });

  it('5. rejects a location outside the current assignment', async () => {
    await expect(
      service().create(user, access, { ...command, locationId: id(31) }),
    ).rejects.toMatchObject({ response: { code: 'LOCATION_SCOPE_VIOLATION' } });
  });

  it('6. rejects a missing permission', async () => {
    await expect(
      service().create(user, { ...access, permissions: [] }, command),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('7. rejects a Viewer mutation', async () => {
    await expect(
      service().create(
        user,
        { ...access, role: 'viewer', roles: ['viewer'], permissions: [] },
        command,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('8. rejects role-name authority spoofing', async () => {
    await expect(
      service().create(
        user,
        { ...access, role: 'owner', roles: ['owner'], permissions: [] },
        command,
      ),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('9. ignores a client-supplied actor user ID', async () => {
    const result = await service().create(user, access, {
      ...command,
      parameters: { actorUserId: id(32) },
    });
    expect(result.actorUserId).toBe(user.id);
  });

  it('10. ignores a client-supplied merchant authority', async () => {
    const result = await service().create(user, access, {
      ...command,
      parameters: { merchantId: id(32) },
    });
    expect(result.merchantId).toBe(access.merchantId);
  });

  it('11. rejects a POS-only command from Dashboard', async () => {
    await expect(
      service().create(user, access, { ...command, operation: 'sale.checkout' }),
    ).rejects.toMatchObject({ response: { code: 'COMMAND_CONTEXT_NOT_ALLOWED' } });
  });

  it('12. rejects a KDS-only command from Dashboard', async () => {
    await expect(
      service().create(user, access, { ...command, operation: 'kitchen.prepare' }),
    ).rejects.toMatchObject({ response: { code: 'COMMAND_CONTEXT_NOT_ALLOWED' } });
  });

  it('13. rejects a cookie mutation without CSRF evidence', () => {
    expect(() =>
      csrf().canActivate(csrfContext({ method: 'POST', cookies: { umi_access: 'access' } })),
    ).toThrow(ForbiddenException);
  });

  it('14. rejects invalid CSRF evidence', () => {
    expect(() =>
      csrf().canActivate(
        csrfContext({
          method: 'POST',
          cookies: { umi_access: 'access', umi_csrf: 'one' },
          headers: { 'x-umi-csrf': 'two' },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('15. rejects a reused one-use approval', async () => {
    await expect(rejectedApproval('reused')).rejects.toMatchObject({
      response: { code: 'APPROVAL_INVALID' },
    });
  });

  it('16. rejects an expired approval', async () => {
    await expect(rejectedApproval('expired')).rejects.toMatchObject({
      response: { code: 'APPROVAL_INVALID' },
    });
  });

  it('17. rejects a changed command fingerprint', async () => {
    await expect(
      service({
        findCommand: vi
          .fn()
          .mockResolvedValue({ fingerprint: 'f'.repeat(64), status: 'succeeded' }),
      }).create(user, access, command),
    ).rejects.toMatchObject({ response: { code: 'ADMINISTRATIVE_COMMAND_FINGERPRINT_CONFLICT' } });
  });

  it('18. rejects forbidden self-approval', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = new PosEntryRepository({ query } as never);
    await repo.administrativeManagerPinRecord({
      lookupHash: 'lookup',
      merchantId: access.merchantId,
      locationId: access.locationId,
      permission: 'inventory.adjust.approve',
      actingUserId: user.id,
      dashboardSessionId: user.sessionId,
    });
    expect(query.mock.calls[0][0]).toContain('s.user_id<>$5::uuid');
  });

  it('19. rejects a hardware command for an unassigned executor', async () => {
    await expect(remoteHardwareFailure('HARDWARE_NOT_ASSIGNED')).rejects.toMatchObject({
      response: { code: 'HARDWARE_NOT_ASSIGNED' },
    });
  });

  it('20. returns ExecutionDeviceUnavailable for an offline executor', async () => {
    await expect(remoteHardwareFailure('EXECUTION_DEVICE_UNAVAILABLE')).rejects.toMatchObject({
      response: { code: 'EXECUTION_DEVICE_UNAVAILABLE' },
    });
  });

  it('21. rejects permission revocation between preview and commit', async () => {
    await service().create(user, access, command);
    await expect(
      service().create(user, { ...access, permissions: [] }, command),
    ).rejects.toMatchObject({ response: { code: 'PERMISSION_DENIED' } });
  });

  it('22. rejects location revocation between preview and commit', async () => {
    await service().create(user, access, command);
    await expect(
      service().create(user, { ...access, locationId: id(40) }, command),
    ).rejects.toMatchObject({ response: { code: 'LOCATION_SCOPE_VIOLATION' } });
  });

  it('23. returns the original terminal result for the same mutation retry', async () => {
    const initial = await service().create(user, access, command);
    const repo = repository({
      claimCommand: vi.fn().mockResolvedValue({
        owner: false,
        row: {
          id: id(9),
          fingerprint: initial.fingerprint,
          status: 'succeeded',
          result: { ledgerSequence: 7 },
          failureCode: null,
          correlationId: 'matrix',
        },
      }),
    });
    await expect(
      new AdministrativeCommandContextService(repo as never).execute(initial, vi.fn()),
    ).resolves.toEqual({ ledgerSequence: 7 });
  });

  it('24. conflicts when a duplicate retry changes the mutation', async () => {
    const initial = await service().create(user, access, command);
    await expect(
      service({
        findCommand: vi
          .fn()
          .mockResolvedValue({ fingerprint: initial.fingerprint, status: 'succeeded' }),
      }).create(user, access, { ...command, parameters: { quantity: 2 } }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

function rejectedApproval(reason: 'reused' | 'expired') {
  const customerValue = new PosCustomerValueRepository({} as never, {} as never);
  const commandInput = {
    locationId: access.locationId,
    operatorSessionId: user.sessionId,
    customerId: id(41),
    accountId: id(42),
    direction: 'increase' as const,
    points: 501,
    reason: 'operational_correction' as const,
    note: null,
    expectedVersion: 1,
    commandId: id(43),
    idempotencyKey: id(44),
  };
  const approvalFingerprint = commandFingerprint('pos.points.adjust', commandInput);
  const query = vi.fn(async (text: string) => {
    expect(text).toContain(
      reason === 'reused' ? 'consumed_at IS NULL' : 'expires_at>clock_timestamp()',
    );
    return { rowCount: 0, rows: [] };
  });
  return customerValue.commitPointsAdjustment(
    { query } as never,
    access.merchantId,
    {
      ...commandInput,
      approvalId: id(45),
      approvalFingerprint,
    },
    {
      commandContextType: 'dashboard_administrative',
      operatorId: user.id,
      deviceId: null,
      durableSessionId: null,
      dashboardSessionId: user.sessionId,
      credentialVersion: null,
      permissions: ['loyalty.adjust'],
    },
  );
}

function remoteHardwareFailure(code: string) {
  const integrity = {
    execute: vi.fn(async (_input, operation) => {
      const value = await operation({ client: {}, appendAudit: vi.fn(), correlationId: 'matrix' });
      return { status: 'succeeded', result: value.value, failureCode: null };
    }),
  };
  const hardware = new PosHardwareService(
    { createAdministrativeCommand: vi.fn().mockRejectedValue(new Error(code)) } as never,
    integrity as never,
  );
  return hardware.executeAdministrative(
    user,
    access,
    {
      commandId: id(7),
      idempotencyKey: id(8),
      commandRecordId: id(9),
      correlationId: 'matrix',
      targetAggregateId: id(6),
      locationId: id(5),
    } as never,
    'hardware.diagnostic',
    { hardwareId: id(6), expectedConfigurationVersion: 1 },
  );
}
