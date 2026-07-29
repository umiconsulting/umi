import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { OfflineCommand } from '@umi/contract';
import { PosOfflineService } from './pos-offline.service';
import type { PosOfflineRepository } from './pos-offline.repository';
import type { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import { canonicalJson } from '../integrity/canonical-json';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: uid(1), email: 'operator@example.test', sessionId: uid(2), deviceId: uid(3) };
const checkout = {} as PosCheckoutService;
const command = (sequence: number): OfflineCommand => {
  const unsigned = {
    commandId: uid(100 + sequence),
    provisionalId: null,
    deviceId: uid(3),
    deviceCredentialVersion: 1,
    deviceSequence: sequence,
    tenantId: uid(4),
    branchId: uid(5),
    operatorSessionId: uid(6),
    commandType: 'operational.ack' as const,
    idempotencyKey: uid(200 + sequence),
    contractVersion: '1.5.0',
    schemaVersion: 1,
    createdAt: '2026-07-28T00:00:00.000Z',
    payload: { acknowledgement: 'safe' },
  };
  return {
    ...unsigned,
    fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
  };
};

describe('PosOfflineService', () => {
  it('issues a default-deny policy when no branch policy exists', async () => {
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        deviceKind: 'pos_terminal',
        currency: 'MXN',
        permissions: ['offline.replay', 'offline.cash.checkout'],
        entitlements: [{ featureKey: 'pos.offline_cash', enabled: true }],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
    } as unknown as PosOfflineRepository;
    const value = await new PosOfflineService(repo, checkout).issuePolicy(user, uid(4), {
      branchId: uid(5),
      operatorSessionId: uid(6),
      credentialVersion: 1,
    });
    expect(value.cash.enabled).toBe(false);
    expect(value.allowedCommandTypes).toEqual(['operational.ack']);
  });

  it('issues a bounded fingerprinted cash policy from server configuration', async () => {
    const now = new Date();
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        deviceKind: 'pos_terminal',
        currency: 'MXN',
        permissions: ['offline.replay', 'offline.cash.checkout'],
        entitlements: [{ featureKey: 'pos.offline_cash', enabled: true }],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => ({
        id: uid(70),
        enabled: true,
        version: 'policy-1',
        currency: 'MXN',
        maxPolicyAgeSeconds: 600,
        maxSingleSaleMinorUnits: '10000',
        maxAccumulatedMinorUnits: '30000',
        maxOfflineSaleCount: 3,
        maxActiveQueueDepth: 10,
        maxCommandAgeSeconds: 3600,
        maxCatalogAgeSeconds: 900,
        maxPricingAgeSeconds: 600,
        maxTaxAgeSeconds: 600,
        managerApprovalThresholdMinorUnits: null,
        allowedDeviceClasses: ['pos_terminal'],
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
      })),
    } as unknown as PosOfflineRepository;
    const value = await new PosOfflineService(repo, checkout).issuePolicy(user, uid(4), {
      branchId: uid(5),
      operatorSessionId: uid(6),
      credentialVersion: 1,
    });
    expect(value.cash.enabled).toBe(true);
    expect(value.cash.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(value.cash.limits.maxSingleSaleMinorUnits).toBe(10000);
    expect(value.allowedCommandTypes).toContain('pos.checkout.cash');
  });

  it('submits a contiguous sequence in order', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: null,
      failure: null,
    }));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay'],
        lastAcceptedSequence: 0,
      })),
      replay,
    } as unknown as PosOfflineRepository;
    const result = await new PosOfflineService(repo, checkout).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [command(1), command(2)],
    });
    expect(replay.mock.calls.map(([value]) => value.deviceSequence)).toEqual([1, 2]);
    expect(result.cursor.lastAcceptedSequence).toBe(2);
    expect(result.stopped).toBe(false);
  });

  it('fails closed on cross-tenant envelopes', async () => {
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay'],
        lastAcceptedSequence: 0,
      })),
    } as unknown as PosOfflineRepository;
    await expect(
      new PosOfflineService(repo, checkout).batch(user, uid(99), {
        replaySessionId: uid(9),
        commands: [command(1)],
      }),
    ).rejects.toMatchObject({ response: { code: 'REPLAY_SCOPE_INVALID' } });
  });

  it('reconciliation exposes gaps without accepting client timestamps', async () => {
    const repo = {
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay'],
        lastAcceptedSequence: 2,
      })),
      conflicts: vi.fn(async () => []),
      mappings: vi.fn(async () => []),
      persistReconciliation: vi.fn(async () => uid(90)),
    } as unknown as PosOfflineRepository;
    const result = await new PosOfflineService(repo, checkout).reconcile(
      user,
      uid(4),
      uid(5),
      uid(6),
      1,
      { localLastAllocatedSequence: 4, localLastAcknowledgedSequence: 2 },
    );
    expect(result.missingSequences).toEqual([3, 4]);
    expect(result.reconciliationRequired).toBe(true);
  });
});
