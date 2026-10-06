import { describe, expect, it, vi } from 'vitest';
import { DevicesService } from './devices.service';

const device = {
  id: '00000000-0000-4000-8000-000000000010',
  publicId: '00000000-0000-4000-8000-000000000011',
  merchantId: '00000000-0000-4000-8000-000000000012',
  locationId: '00000000-0000-4000-8000-000000000013',
  displayName: 'Caja principal',
  type: 'pos_terminal' as const,
  platform: 'android' as const,
  mobility: 'static' as const,
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
    listDevices: vi.fn().mockResolvedValue([device]),
    updateDevice: vi.fn().mockResolvedValue(device),
    decidePairing: vi.fn(),
    pollPairing: vi.fn(),
    findPairingSessionForRealtime: vi.fn(),
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
  const pairingEvents = { emitPairingChanged: vi.fn() };
  return {
    service: new DevicesService(
      repo as never,
      config as never,
      integrity as never,
      rateLimit as never,
      pairingEvents as never,
    ),
    repo,
    integrity,
    pairingEvents,
  };
};

describe('DevicesService', () => {
  it('creates a bounded deterministic one-time challenge', async () => {
    const { service, repo } = make();
    const first = await service.begin(device.merchantId, device.id, {
      locationId: device.locationId,
      displayName: device.displayName,
      type: 'pos_terminal',
      platform: 'android',
      mobility: 'mobile',
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
      device.merchantId,
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

  it('nudges the waiting device once a decision commits, without the credential', async () => {
    const { service, repo, pairingEvents } = make();
    const pairingSessionId = '00000000-0000-4000-8000-0000000000aa';
    const decidedAt = new Date().toISOString();
    repo.decidePairing.mockResolvedValue({
      enrollmentRequestId: device.id,
      state: 'credential_ready',
      decidedAt,
      pairingSessionId,
    });

    const decision = await service.approve(
      device.merchantId,
      device.id,
      device.id,
      '00000000-0000-4000-8000-0000000000ab',
      null,
    );

    expect(pairingEvents.emitPairingChanged).toHaveBeenCalledTimes(1);
    expect(pairingEvents.emitPairingChanged).toHaveBeenCalledWith({
      pairingSessionId,
      state: 'credential_ready',
      occurredAt: decidedAt,
    });
    // The nudge carries these three fields and nothing else: no device object
    // and no credential, which only the poll route may release.
    expect(Object.keys(pairingEvents.emitPairingChanged.mock.calls[0][0])).toEqual([
      'pairingSessionId',
      'state',
      'occurredAt',
    ]);
    expect(decision.state).toBe('credential_ready');
  });

  it('nudges with the denied state when an administrator denies the request', async () => {
    const { service, repo, pairingEvents } = make();
    const pairingSessionId = '00000000-0000-4000-8000-0000000000ac';
    repo.decidePairing.mockResolvedValue({
      enrollmentRequestId: device.id,
      state: 'denied',
      decidedAt: new Date().toISOString(),
      pairingSessionId,
    });

    await service.deny(
      device.merchantId,
      device.id,
      device.id,
      '00000000-0000-4000-8000-0000000000ad',
      null,
    );

    expect(pairingEvents.emitPairingChanged).toHaveBeenCalledTimes(1);
    expect(pairingEvents.emitPairingChanged.mock.calls[0][0]).toMatchObject({
      pairingSessionId,
      state: 'denied',
    });
  });

  it('does not nudge when the decision is rejected', async () => {
    const { service, repo, pairingEvents } = make();
    repo.decidePairing.mockResolvedValue(null);

    await expect(
      service.approve(
        device.merchantId,
        device.id,
        device.id,
        '00000000-0000-4000-8000-0000000000ae',
        null,
      ),
    ).rejects.toMatchObject({ response: { code: 'ENROLLMENT_REJECTED' } });
    expect(pairingEvents.emitPairingChanged).not.toHaveBeenCalled();
  });

  it('does not nudge on a poll: the poll is the credential delivery gate', async () => {
    const { service, repo, pairingEvents } = make();
    repo.pollPairing.mockResolvedValue({
      requestId: device.id,
      state: 'credential_delivered',
      expiresAt: new Date(Date.now() + 60_000),
      device,
    });

    await service.poll(
      '00000000-0000-4000-8000-0000000000af',
      { pollingCredential: 'c'.repeat(43), installationId: device.id },
      '203.0.113.10',
    );

    expect(pairingEvents.emitPairingChanged).not.toHaveBeenCalled();
  });

  it('validates a realtime handshake without spending a poll attempt', async () => {
    const { service, repo } = make();
    const pairingSessionId = '00000000-0000-4000-8000-0000000000b0';
    repo.findPairingSessionForRealtime = vi.fn().mockResolvedValue({
      pairingSessionId,
      requestId: device.id,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.authorizePairingSocket({
      pairingSessionId,
      pollingCredential: 'polling-credential',
      installationId: 'installation-id',
    });

    expect(result).toEqual({ pairingSessionId });
    // Hashes travel to the repository; the plaintext never does.
    const forwarded = JSON.stringify(repo.findPairingSessionForRealtime.mock.calls[0]);
    expect(forwarded).not.toContain('polling-credential');
    expect(forwarded).not.toContain('installation-id');
    expect(repo.pollPairing).not.toHaveBeenCalled();
  });

  it('fails closed when the handshake triplet does not match', async () => {
    const { service, repo } = make();
    repo.findPairingSessionForRealtime = vi.fn().mockResolvedValue(null);

    await expect(
      service.authorizePairingSocket({
        pairingSessionId: '00000000-0000-4000-8000-0000000000b1',
        pollingCredential: 'wrong',
        installationId: 'wrong',
      }),
    ).resolves.toBeNull();
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
    const result = await service.rotate(device.merchantId, device.id, 1, idempotencyKey);

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
      device.merchantId,
      device.id,
      1,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(JSON.stringify(integrity.execute.mock.calls[0][0])).not.toContain(result.credential);
  });

  it('carries the declared floor use from the request into the pairing row', async () => {
    const { service, repo } = make();
    await service.begin(device.merchantId, device.id, {
      locationId: device.locationId,
      displayName: device.displayName,
      type: 'pos_terminal',
      platform: 'android',
      mobility: 'mobile',
      idempotencyKey: '00000000-0000-4000-8000-000000000100',
    });
    expect(repo.beginPairing).toHaveBeenCalledWith(expect.objectContaining({ mobility: 'mobile' }));
  });

  it('lists enrolled terminals under the caller location scope', async () => {
    const { service, repo } = make();
    const result = await service.listDevices(device.merchantId, [device.locationId]);
    expect(repo.listDevices).toHaveBeenCalledWith(device.merchantId, [device.locationId]);
    expect(result.devices).toEqual([device]);
  });

  it('refuses an update the caller location scope does not reach', async () => {
    const { service, repo } = make();
    repo.updateDevice.mockResolvedValueOnce(null);
    await expect(
      service.update(
        device.merchantId,
        device.id,
        { displayName: 'Caja 2', mobility: 'mobile' },
        [],
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
