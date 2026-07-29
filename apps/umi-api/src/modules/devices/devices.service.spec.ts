import { describe, expect, it, vi } from 'vitest';
import { DevicesService } from './devices.service';

const device = {
  id: '00000000-0000-4000-8000-000000000010',
  publicId: '00000000-0000-4000-8000-000000000011',
  tenantId: '00000000-0000-4000-8000-000000000012',
  branchId: '00000000-0000-4000-8000-000000000013',
  displayName: 'Caja principal',
  type: 'pos_terminal' as const,
  platform: 'android' as const,
  state: 'active' as const,
  credentialVersion: 1,
  lastSeenAt: null,
  rotationRequired: false,
  revokedAt: null,
  replacementDeviceId: null,
};

const make = () => {
  const repo = {
    beginEnrollment: vi.fn().mockImplementation((input) => ({
      id: input.id,
      expiresAt: input.expiresAt,
    })),
    beginPairing: vi.fn().mockImplementation((input) => ({
      id: input.id,
      expiresAt: input.expiresAt,
    })),
    claimPairing: vi.fn(),
    listPairingRequests: vi.fn().mockResolvedValue([]),
    decidePairing: vi.fn(),
    pollPairing: vi.fn(),
    acknowledgePairing: vi.fn(),
    authenticate: vi.fn().mockResolvedValue(device),
    rotate: vi.fn().mockResolvedValue(device),
    revoke: vi.fn().mockResolvedValue(device),
  };
  const config = { get: vi.fn().mockReturnValue('0123456789abcdef0123456789abcdef') };
  const integrity = {
    execute: vi.fn().mockImplementation(async (input, operation) => {
      const outcome = await operation({
        client: {},
        appendAudit: vi.fn(),
      });
      return {
        commandId: input.commandId,
        status: outcome.ok ? 'succeeded' : 'failed',
        duplicate: false,
        retryable: false,
        result: outcome.ok ? outcome.value : null,
        failureCode: outcome.ok ? null : outcome.code,
        failureClass: outcome.ok ? null : outcome.failureClass,
        correlationId: 'correlation-id',
      };
    }),
  };
  const rateLimit = {
    hit: vi.fn().mockReturnValue({
      allowed: true,
      remaining: 10,
      resetAt: Date.now() + 60_000,
    }),
  };
  return {
    service: new DevicesService(
      repo as never,
      config as never,
      integrity as never,
      rateLimit as never,
    ),
    repo,
    integrity,
  };
};

describe('DevicesService', () => {
  it('creates a bounded deterministic one-time challenge', async () => {
    const { service, repo } = make();
    const first = await service.begin(device.tenantId, device.id, {
      branchId: device.branchId,
      displayName: device.displayName,
      type: 'pos_terminal',
      platform: 'android',
      idempotencyKey: '00000000-0000-4000-8000-000000000099',
    });
    expect(first.setupCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(new Date(first.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    expect(JSON.stringify(repo.beginPairing.mock.calls)).not.toContain(first.setupCode);
    expect(repo.beginPairing).toHaveBeenCalledWith(
      expect.objectContaining({ codeHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    );
  });

  it('returns a separate polling credential without persisting it as plaintext', async () => {
    const { service, repo } = make();
    const expiresAt = new Date(Date.now() + 300_000);
    repo.claimPairing.mockImplementation((input) => ({
      state: 'claimed',
      pairingSessionId: input.pairingSessionId,
      expiresAt,
    }));
    const result = await service.claim(
      {
        setupCode: 'ABCDEFGH',
        installationId: device.publicId,
        platform: 'web',
        deviceType: 'pos_terminal',
      },
      '127.0.0.1',
    );
    expect(result.pollingCredential).toHaveLength(43);
    expect(repo.claimPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        setupCodeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        pollingCredentialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(repo.claimPairing.mock.calls)).not.toContain(result.pollingCredential);
  });

  it('uses one constant public rejection for an unavailable setup code', async () => {
    const { service, repo } = make();
    repo.claimPairing.mockResolvedValue({ state: 'rejected' });
    await expect(
      service.claim(
        {
          setupCode: 'ABCDEFGH',
          installationId: device.publicId,
          platform: 'web',
          deviceType: 'pos_terminal',
        },
        '127.0.0.1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'ENROLLMENT_REJECTED' },
    });
  });

  it('issues a credential only after an administrator approves the request', async () => {
    const { service, repo } = make();
    repo.decidePairing.mockResolvedValue({
      enrollmentRequestId: device.id,
      state: 'credential_ready',
      decidedAt: new Date().toISOString(),
    });
    await service.approve(
      device.tenantId,
      device.id,
      device.id,
      '00000000-0000-4000-8000-000000000099',
      null,
    );
    expect(repo.decidePairing).toHaveBeenCalledWith(
      expect.objectContaining({
        approve: true,
        credentialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('fails closed when credential headers are absent', async () => {
    const { service } = make();
    await expect(service.authenticate(undefined, undefined, undefined)).rejects.toMatchObject({
      response: { code: 'DEVICE_CREDENTIAL_INVALID' },
    });
  });

  it('routes credential rotation through canonical idempotency without storing plaintext', async () => {
    const { service, repo, integrity } = make();
    const idempotencyKey = '00000000-0000-4000-8000-000000000099';
    const result = await service.rotate(device.tenantId, device.id, 1, idempotencyKey);

    expect(integrity.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey,
        commandType: 'device.credential.rotate',
        payload: { deviceId: device.id, currentVersion: 1 },
      }),
      expect.any(Function),
    );
    expect(repo.rotate).toHaveBeenCalledWith(
      expect.anything(),
      device.tenantId,
      device.id,
      1,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(JSON.stringify(integrity.execute.mock.calls[0][0])).not.toContain(result.credential);
  });
});
