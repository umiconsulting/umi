import { describe, expect, it, vi } from 'vitest';
import type { OfflineCommand } from '@umi/contract';
import { PosOfflineService } from './pos-offline.service';
import type { PosOfflineRepository } from './pos-offline.repository';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: uid(1), email: 'operator@example.test', sessionId: uid(2), deviceId: uid(3) };
const command = (sequence: number): OfflineCommand => ({
  commandId: uid(100 + sequence), provisionalId: null, deviceId: uid(3),
  deviceCredentialVersion: 1, deviceSequence: sequence, tenantId: uid(4),
  branchId: uid(5), operatorSessionId: uid(6), commandType: 'operational.ack',
  idempotencyKey: uid(200 + sequence), fingerprint: 'a'.repeat(64),
  contractVersion: '1.5.0', schemaVersion: 1,
  createdAt: '2026-07-28T00:00:00.000Z', payload: { acknowledgement: 'safe' },
});

describe('PosOfflineService', () => {
  it('submits a contiguous sequence in order', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId, deviceSequence: value.deviceSequence,
      status: 'accepted' as const, officialId: null, failure: null,
    }));
    const repo = {
      context: vi.fn(async () => ({
        lifecycle: 'active', credentialVersion: 1,
        permissions: ['offline.replay'], lastAcceptedSequence: 0,
      })),
      replay,
    } as unknown as PosOfflineRepository;
    const result = await new PosOfflineService(repo).batch(user, uid(4), {
      replaySessionId: uid(9), commands: [command(1), command(2)],
    });
    expect(replay.mock.calls.map(([value]) => value.deviceSequence)).toEqual([1, 2]);
    expect(result.cursor.lastAcceptedSequence).toBe(2);
    expect(result.stopped).toBe(false);
  });

  it('fails closed on cross-tenant envelopes', async () => {
    const repo = {
      context: vi.fn(async () => ({
        lifecycle: 'active', credentialVersion: 1,
        permissions: ['offline.replay'], lastAcceptedSequence: 0,
      })),
    } as unknown as PosOfflineRepository;
    await expect(new PosOfflineService(repo).batch(user, uid(99), {
      replaySessionId: uid(9), commands: [command(1)],
    })).rejects.toMatchObject({ response: { code: 'REPLAY_SCOPE_INVALID' } });
  });

  it('reconciliation exposes gaps without accepting client timestamps', async () => {
    const repo = {
      context: vi.fn(async () => ({
        lifecycle: 'active', credentialVersion: 1,
        permissions: ['offline.replay'], lastAcceptedSequence: 2,
      })),
    } as unknown as PosOfflineRepository;
    const result = await new PosOfflineService(repo).reconcile(
      user, uid(4), uid(5), uid(6), 1,
      { localLastAllocatedSequence: 4, localLastAcknowledgedSequence: 2 },
    );
    expect(result.missingSequences).toEqual([3, 4]);
    expect(result.reconciliationRequired).toBe(true);
  });
});
