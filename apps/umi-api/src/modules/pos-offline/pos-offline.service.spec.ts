import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { OfflineCommand } from '@umi/contract';
import { PosOfflineService } from './pos-offline.service';
import type { PosOfflineRepository } from './pos-offline.repository';
import type { PosCheckoutService } from '../pos-checkout/pos-checkout.service';
import type { PosCartService } from '../pos-cart/pos-cart.service';
import type { KdsService } from '../kds/kds.service';
import { canonicalJson } from '../integrity/canonical-json';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const user = { id: uid(1), email: 'operator@example.test', sessionId: uid(2), deviceId: uid(3) };
const checkout = {} as PosCheckoutService;
const cart = {} as PosCartService;
const kds = { commandForReplay: vi.fn() } as unknown as KdsService;
const command = (sequence: number): OfflineCommand => {
  const unsigned = {
    commandId: uid(100 + sequence),
    provisionalId: null,
    deviceId: uid(3),
    deviceCredentialVersion: 1,
    deviceSequence: sequence,
    merchantId: uid(4),
    locationId: uid(5),
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

const hubOwnedCommand = (sequence: number): OfflineCommand => {
  const base = command(sequence);
  const unsigned = {
    ...base,
    hubOwned: true,
    fingerprint: undefined,
  };
  delete (unsigned as { fingerprint?: string }).fingerprint;
  return {
    ...unsigned,
    fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
  };
};

const lineAddCommand = (sequence: number): OfflineCommand => {
  const unsigned = {
    ...command(sequence),
    commandType: 'pos.cart.line.add' as const,
    payload: {
      cartId: uid(40),
      locationId: uid(5),
      operatorSessionId: uid(6),
      productId: uid(41),
      variantId: null,
      modifierSelections: [],
      quantity: 1,
      courseNumber: 1,
      note: null,
      expectedVersion: 1,
      idempotencyKey: uid(200 + sequence),
    },
    fingerprint: undefined,
  };
  delete (unsigned as { fingerprint?: string }).fingerprint;
  return {
    ...unsigned,
    fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
  };
};

/** A dine-in table chosen while the till had no uplink. */
const tableSetCommand = (sequence: number): OfflineCommand => {
  const unsigned = {
    ...command(sequence),
    commandType: 'pos.cart.table.set' as const,
    payload: {
      cartId: uid(40),
      locationId: uid(5),
      operatorSessionId: uid(6),
      tableId: uid(42),
      expectedVersion: 1,
      idempotencyKey: uid(200 + sequence),
    },
    fingerprint: undefined,
  };
  delete (unsigned as { fingerprint?: string }).fingerprint;
  return {
    ...unsigned,
    fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
  };
};

const commandGroup = (
  sequence: number,
  partySize = 4,
  provisionalCartId = uid(40),
  tableId = uid(42),
): OfflineCommand => {
  const base = command(sequence);
  const unsigned = {
    ...base,
    provisionalId: provisionalCartId,
    commandType: 'pos.command.group' as const,
    payload: {
      groupId: base.idempotencyKey,
      aggregateKeys: [`account:${provisionalCartId}`, `table:${tableId}`],
      effects: [
        {
          type: 'open_table_account',
          provisionalCartId,
          tableId,
          partySize,
        },
      ],
    },
    fingerprint: undefined,
  };
  delete (unsigned as { fingerprint?: string }).fingerprint;
  return {
    ...unsigned,
    fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
  };
};

const cartOpenCommand = (sequence: number): OfflineCommand => {
  const unsigned = {
    ...command(sequence),
    commandType: 'pos.cart.open' as const,
    payload: {
      cartId: uid(40),
      locationId: uid(5),
      operatorSessionId: uid(6),
      idempotencyKey: uid(200 + sequence),
    },
    fingerprint: undefined,
  };
  delete (unsigned as { fingerprint?: string }).fingerprint;
  return {
    ...unsigned,
    fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
  };
};

describe('PosOfflineService', () => {
  it('refuses a peer copy marked for hub delivery', async () => {
    const recordConflict = vi.fn(async (value: OfflineCommand, classification: string) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'conflict' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: uid(95),
      failure: {
        classification,
        retryable: false,
        blocksFollowing: true,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode: 'hub_owned_command_cannot_replay_to_cloud',
        correlationId: uid(96),
      },
    }));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      recordConflict,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(repo, checkout, cart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [hubOwnedCommand(1)],
    });

    expect(recordConflict).toHaveBeenCalledWith(
      expect.any(Object),
      'unsupported_offline_command',
      true,
      'hub_owned_command_cannot_replay_to_cloud',
    );
    expect(result.stopped).toBe(true);
  });

  it('resolves a safe refused step and advances the replay cursor', async () => {
    const repo = {
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        deviceKind: 'pos_terminal',
        currency: 'MXN',
        permissions: ['offline.replay'],
        entitlements: [],
        lastAcceptedSequence: 4,
      })),
      resolveConflict: vi.fn(async () => ({
        resolved: true,
        deviceSequence: 4,
        nextAcceptedSequence: 4,
      })),
    } as unknown as PosOfflineRepository;
    const value = await new PosOfflineService(repo, checkout, cart, kds).resolveConflict(
      user,
      uid(4),
      {
        locationId: uid(5),
        operatorSessionId: uid(6),
        credentialVersion: 1,
      },
      uid(9),
    );
    expect(repo.resolveConflict).toHaveBeenCalledWith(uid(4), uid(5), uid(3), 1, uid(9));
    expect(value).toEqual({
      resolved: true,
      commandId: uid(9),
      deviceSequence: 4,
      nextAcceptedSequence: 4,
    });
  });

  it('refuses a conflict that is not safe to discard', async () => {
    const repo = {
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        deviceKind: 'pos_terminal',
        currency: 'MXN',
        permissions: ['offline.replay'],
        entitlements: [],
        lastAcceptedSequence: 4,
      })),
      resolveConflict: vi.fn(async () => ({
        resolved: false,
        deviceSequence: 5,
        nextAcceptedSequence: 4,
      })),
    } as unknown as PosOfflineRepository;
    await expect(
      new PosOfflineService(repo, checkout, cart, kds).resolveConflict(
        user,
        uid(4),
        {
          locationId: uid(5),
          operatorSessionId: uid(6),
          credentialVersion: 1,
        },
        uid(9),
      ),
    ).rejects.toMatchObject({ response: { code: 'CONFLICT_NOT_RESOLVABLE' } });
  });

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
    const value = await new PosOfflineService(repo, checkout, cart, kds).issuePolicy(user, uid(4), {
      locationId: uid(5),
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
    const value = await new PosOfflineService(repo, checkout, cart, kds).issuePolicy(user, uid(4), {
      locationId: uid(5),
      operatorSessionId: uid(6),
      credentialVersion: 1,
    });
    expect(value.cash.enabled).toBe(true);
    expect(value.cash.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(value.cash.limits.maxSingleSaleMinorUnits).toBe(10000);
    expect(value.allowedCommandTypes).toContain('pos.checkout.cash');
  });

  it('replays a sale written under a session that has since ended', async () => {
    const replay = vi.fn(
      async (
        value: OfflineCommand,
        _officialCommit?: unknown,
        _officialId?: unknown,
        _replaySession?: string,
      ) => ({
        commandId: value.commandId,
        deviceSequence: value.deviceSequence,
        status: 'accepted' as const,
        officialId: null,
        failure: null,
      }),
    );
    const context = vi.fn(async () => ({
      lifecycle: 'active',
      credentialVersion: 1,
      permissions: ['offline.replay'],
      lastAcceptedSequence: 0,
    }));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context,
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;
    // The command was written by uid(6); the operator has since locked and
    // signed in again as uid(77). The sale must still replay under the live
    // session, and must still be attributed to uid(6).
    const liveScope = {
      locationId: uid(5),
      operatorSessionId: uid(77),
      credentialVersion: 1,
    };
    const result = await new PosOfflineService(repo, checkout, cart, kds).batch(
      user,
      uid(4),
      { replaySessionId: uid(9), commands: [command(1)] },
      liveScope,
    );
    expect(context).toHaveBeenCalledWith(expect.objectContaining({ operatorSessionId: uid(77) }));
    expect(replay.mock.calls[0][0].operatorSessionId).toBe(uid(6));
    expect(replay.mock.calls[0][3]).toBe(uid(77));
    expect(result.stopped).toBe(false);
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
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;
    const result = await new PosOfflineService(repo, checkout, cart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [command(1), command(2)],
    });
    expect(replay.mock.calls.map(([value]) => value.deviceSequence)).toEqual([1, 2]);
    expect(result.cursor.lastAcceptedSequence).toBe(2);
    expect(result.stopped).toBe(false);
  });

  it('applies a table account command group once and returns its cart id', async () => {
    const group = commandGroup(1);
    const replay = vi.fn(
      async (value: OfflineCommand, _commit?: unknown, officialId?: string | null) => ({
        commandId: value.commandId,
        deviceSequence: value.deviceSequence,
        status: 'accepted' as const,
        officialId: officialId ?? null,
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      }),
    );
    const openTable = vi.fn(async () => ({
      id: uid(80),
      version: 1,
      tableId: uid(42),
      partySize: 4,
      items: [],
    }));
    const orderCart = { openTable } as unknown as PosCartService;
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(repo, checkout, orderCart, kds).batch(
      user,
      uid(4),
      {
        replaySessionId: uid(9),
        commands: [group],
      },
      {
        locationId: uid(5),
        operatorSessionId: uid(77),
        credentialVersion: 1,
      },
    );

    expect(openTable).toHaveBeenCalledOnce();
    expect(openTable).toHaveBeenCalledWith(
      user,
      uid(4),
      expect.objectContaining({
        tableId: uid(42),
        partySize: 4,
        operatorSessionId: uid(77),
        idempotencyKey: group.idempotencyKey,
      }),
    );
    expect(replay).toHaveBeenCalledOnce();
    expect(replay.mock.calls[0][2]).toBe(uid(80));
    expect(result.results[0]).toMatchObject({
      status: 'accepted',
      officialId: uid(80),
    });
    expect(result.cursor.lastAcceptedSequence).toBe(1);
  });

  it('keeps an unrelated account moving after a table refusal', async () => {
    const first = commandGroup(1, 2, uid(40), uid(42));
    const second = commandGroup(2, 4, uid(43), uid(44));
    const openTable = vi
      .fn()
      .mockRejectedValueOnce(new ConflictException({ code: 'TABLE_UNAVAILABLE' }))
      .mockResolvedValueOnce({
        id: uid(80),
        version: 1,
        tableId: uid(44),
        partySize: 4,
        items: [],
      });
    const blocked = new Set<string>();
    const conflict = (value: OfflineCommand, classification: string, retryable = false) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'conflict' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: uid(96),
      failure: {
        classification,
        retryable,
        blocksFollowing: false,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode: classification,
        correlationId: uid(97),
      },
    });
    const recordStreamConflict = vi.fn(
      async (
        value: OfflineCommand,
        classification: string,
        streamKey: string,
        _guidance?: string,
        retryable = false,
      ) => {
        if (classification !== 'stream_blocked') blocked.add(streamKey);
        return conflict(value, classification, retryable);
      },
    );
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: uid(80),
      officialCommit: null,
      serverConflictReference: null,
      failure: null,
    }));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
        lastProcessedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      recordStreamConflict,
      hasOpenStreamConflict: vi.fn(
        async (
          _merchantId: string,
          _locationId: string,
          _deviceId: string,
          _credentialVersion: number,
          streamKey: string,
        ) => blocked.has(streamKey),
      ),
      hasResolvedConflict: vi.fn(async () => false),
      commandResult: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(
      repo,
      checkout,
      { openTable } as unknown as PosCartService,
      kds,
    ).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [first, second],
    });

    expect(result.stopped).toBe(false);
    expect(result.results.map((item) => item.status)).toEqual(['conflict', 'accepted']);
    expect(result.results[0].failure).toMatchObject({
      classification: 'table_unavailable',
      blocksFollowing: false,
    });
    expect(openTable).toHaveBeenCalledTimes(2);
    expect(result.cursor).toMatchObject({
      lastAcceptedSequence: 2,
      lastProcessedSequence: 2,
    });
  });

  it('blocks only the same account after its earlier command needs action', async () => {
    const first = commandGroup(1, 2, uid(40), uid(42));
    const second = commandGroup(2, 3, uid(40), uid(43));
    const openTable = vi.fn(async () => {
      throw new ConflictException({ code: 'TABLE_UNAVAILABLE' });
    });
    const blocked = new Set<string>();
    const conflict = (value: OfflineCommand, classification: string, retryable = false) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'conflict' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: uid(96),
      failure: {
        classification,
        retryable,
        blocksFollowing: false,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode: classification,
        correlationId: uid(97),
      },
    });
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
        lastProcessedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      recordStreamConflict: vi.fn(
        async (
          value: OfflineCommand,
          classification: string,
          streamKey: string,
          _guidance?: string,
          retryable = false,
        ) => {
          if (classification !== 'stream_blocked') blocked.add(streamKey);
          return conflict(value, classification, retryable);
        },
      ),
      hasOpenStreamConflict: vi.fn(
        async (
          _merchantId: string,
          _locationId: string,
          _deviceId: string,
          _credentialVersion: number,
          streamKey: string,
        ) => blocked.has(streamKey),
      ),
      hasResolvedConflict: vi.fn(async () => false),
      commandResult: vi.fn(async () => null),
      replay: vi.fn(),
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(
      repo,
      checkout,
      { openTable } as unknown as PosCartService,
      kds,
    ).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [first, second],
    });

    expect(result.stopped).toBe(false);
    expect(result.results.map((item) => item.status)).toEqual(['conflict', 'conflict']);
    expect(result.results[1].failure).toMatchObject({
      classification: 'stream_blocked',
      retryable: true,
      blocksFollowing: false,
    });
    expect(openTable).toHaveBeenCalledOnce();
    expect(result.cursor.lastProcessedSequence).toBe(2);
    expect(result.cursor.lastAcceptedSequence).toBe(0);
  });

  it('resolves a provisional cart from an earlier replay batch', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: uid(80),
      officialCommit: null,
      serverConflictReference: null,
      failure: null,
    }));
    const readAccount = vi.fn(async () => ({ id: uid(80), version: 3 }));
    const add = vi.fn(async () => ({ id: uid(80), version: 4 }));
    const orderCart = { readAccount, add } as unknown as PosCartService;
    const provisionalCartId = vi.fn(async () => uid(80));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 1,
      })),
      policy: vi.fn(async () => null),
      provisionalCartId,
      replay,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(repo, checkout, orderCart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [lineAddCommand(2)],
    });

    expect(provisionalCartId).toHaveBeenCalledWith(uid(4), uid(5), uid(40));
    expect(readAccount).toHaveBeenCalledWith(user, uid(4), uid(80), uid(5), uid(6));
    expect(add).toHaveBeenCalledWith(
      user,
      uid(4),
      expect.objectContaining({ cartId: uid(80), expectedVersion: 3 }),
    );
    expect(result.results[0].status).toBe('accepted');
  });

  it('refuses a command group with more than one effect without applying it', async () => {
    const group = commandGroup(1);
    const twoEffects = {
      ...group,
      payload: {
        ...group.payload,
        effects: [
          ...((group.payload as { effects: unknown[] }).effects ?? []),
          {
            type: 'open_table_account',
            provisionalCartId: uid(41),
            tableId: uid(43),
            partySize: 2,
          },
        ],
      },
    };
    const unsigned = { ...twoEffects, fingerprint: undefined };
    delete (unsigned as { fingerprint?: string }).fingerprint;
    const invalid = {
      ...unsigned,
      fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
    } as OfflineCommand;
    const openTable = vi.fn();
    const conflict = vi.fn(async (value: OfflineCommand, classification: string) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'conflict' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: uid(95),
      failure: {
        classification,
        retryable: false,
        blocksFollowing: true,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode: classification,
        correlationId: uid(96),
      },
    }));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      recordConflict: conflict,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(
      repo,
      checkout,
      { openTable } as unknown as PosCartService,
      kds,
    ).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [invalid],
    });

    expect(openTable).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({
      status: 'conflict',
      failure: { classification: 'server_validation_failed' },
    });
    expect(result.stopped).toBe(true);
  });

  it('settles a table assignment that had already landed as accepted', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: uid(42),
      officialCommit: null,
      serverConflictReference: null,
      failure: null,
    }));
    const orderCart = {
      readAccount: vi.fn(async () => ({
        id: uid(40),
        version: 8,
        tableId: uid(42),
      })),
      assignAccountTable: vi.fn(async () => {
        throw new ConflictException({ code: 'CART_ALREADY_ASSIGNED' });
      }),
    } as unknown as PosCartService;
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(repo, checkout, orderCart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [tableSetCommand(1)],
    });

    expect(result.results[0].status).toBe('accepted');
    expect(result.stopped).toBe(false);
  });

  it('assigns the table the till chose while it had no uplink', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: uid(40),
      officialCommit: null,
      serverConflictReference: null,
      failure: null,
    }));
    const assignAccountTable = vi.fn(async () => ({ id: uid(40), version: 9 }));
    const orderCart = {
      readAccount: vi.fn(async () => ({ id: uid(40), version: 8 })),
      assignAccountTable,
    } as unknown as PosCartService;
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(repo, checkout, orderCart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [tableSetCommand(1)],
    });

    expect(assignAccountTable).toHaveBeenCalledWith(
      user,
      uid(4),
      uid(40),
      expect.objectContaining({ tableId: uid(42), expectedVersion: 8 }),
    );
    expect(result.results[0].status).toBe('accepted');
  });

  it('replays an order command through the live cart with the current version', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: null,
      failure: null,
    }));
    const add = vi.fn(async () => ({ id: uid(40), version: 8 }));
    const orderCart = {
      readAccount: vi.fn(async () => ({ id: uid(40), version: 7 })),
      add,
    } as unknown as PosCartService;
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;
    const item = lineAddCommand(1);

    const result = await new PosOfflineService(repo, checkout, orderCart, kds).batch(
      user,
      uid(4),
      {
        replaySessionId: uid(9),
        commands: [item],
      },
      {
        locationId: uid(5),
        operatorSessionId: uid(77),
        credentialVersion: 1,
      },
    );

    expect(orderCart.readAccount).toHaveBeenCalledWith(
      user,
      uid(4),
      uid(40),
      uid(5),
      uid(77),
    );
    expect(add).toHaveBeenCalledWith(
      user,
      uid(4),
      expect.objectContaining({
        expectedVersion: 7,
        idempotencyKey: item.idempotencyKey,
        operatorSessionId: uid(77),
      }),
    );
    expect(result.results[0].status).toBe('accepted');
  });

  it('saves the cart it would have resumed before opening a new account', async () => {
    const replay = vi.fn(async (value: OfflineCommand) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: uid(81),
      officialCommit: null,
      serverConflictReference: null,
      failure: null,
    }));
    // `create` resumes the operator's open account first; the second call is
    // the genuinely new one, once the old account has been saved.
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        id: uid(80),
        version: 6,
        locationId: uid(5),
        operatorSessionId: uid(6),
        items: [{ id: uid(41) }],
        tableId: null,
      })
      .mockResolvedValueOnce({ id: uid(81), version: 1 });
    const suspendAccount = vi.fn(async () => ({ id: uid(80), version: 7 }));
    const orderCart = { create, suspendAccount } as unknown as PosCartService;
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;

    const result = await new PosOfflineService(repo, checkout, orderCart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [cartOpenCommand(1)],
    });

    expect(suspendAccount).toHaveBeenCalledWith(
      user,
      uid(4),
      expect.objectContaining({ cartId: uid(80), expectedVersion: 6 }),
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(result.results[0].officialId).toBe(uid(81));
  });

  it('maps an offline cart id to the cart the server creates', async () => {
    const replay = vi.fn(
      async (value: OfflineCommand, _officialCommit?: unknown, officialId?: string | null) => ({
        commandId: value.commandId,
        deviceSequence: value.deviceSequence,
        status: 'accepted' as const,
        officialId: officialId ?? uid(40),
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      }),
    );
    const create = vi.fn(async () => ({ id: uid(80), version: 1 }));
    const orderCart = { create } as unknown as PosCartService;
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        permissions: ['offline.replay', 'cart.write'],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      replay,
    } as unknown as PosOfflineRepository;

    await new PosOfflineService(repo, checkout, orderCart, kds).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [cartOpenCommand(1)],
    });

    expect(create).toHaveBeenCalledOnce();
    expect(replay.mock.calls[0][2]).toBe(uid(80));
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
      new PosOfflineService(repo, checkout, cart, kds).batch(user, uid(99), {
        replaySessionId: uid(9),
        commands: [command(1)],
      }),
    ).rejects.toMatchObject({ response: { code: 'REPLAY_SCOPE_INVALID' } });
  });

  it('commits a replayed cash sale at the charged total and records the delta', async () => {
    const now = new Date().toISOString();
    const policyIssuedAt = new Date();
    const policyExpiresAt = new Date(policyIssuedAt.getTime() + 300_000);
    const money = (minorUnits: number) => ({ minorUnits, currency: 'MXN' });
    const trustedFingerprint = 'c'.repeat(64);
    const trustedTotals = {
      cartVersion: 1,
      fingerprint: trustedFingerprint,
      totals: {
        subtotal: money(20_000),
        tax: money(2_759),
        discounts: { total: money(0), entries: [] },
        grandTotal: money(20_000),
        businessDate: '2026-10-17',
      },
      taxes: {
        total: money(2_759),
        entries: [
          {
            rateBasisPoints: 1_600,
            taxableAmount: money(17_241),
            taxAmount: money(2_759),
          },
        ],
      },
      discounts: { total: money(0), entries: [] },
      catalogVersion: 'catalog-1',
      pricingVersion: 'pricing-1',
      taxVersion: 'tax-1',
      snapshotAt: now,
      confirmedAt: null,
    };
    const serverTotals = {
      ...trustedTotals,
      fingerprint: 'd'.repeat(64),
      totals: {
        ...trustedTotals.totals,
        subtotal: money(23_200),
        tax: money(3_200),
        grandTotal: money(23_200),
      },
      taxes: {
        total: money(3_200),
        entries: [
          {
            rateBasisPoints: 1_600,
            taxableAmount: money(20_000),
            taxAmount: money(3_200),
          },
        ],
      },
    };
    const cartSnapshot = {
      id: uid(40),
      merchantId: uid(4),
      locationId: uid(5),
      operatorSessionId: uid(6),
      status: 'draft',
      lifecycleState: 'building_cart',
      version: 1,
      firedOrderId: null,
      fulfillmentType: 'dine_in',
      items: [
        {
          id: uid(41),
          productId: uid(42),
          productName: 'Cappuccino',
          saleAction: 'merchandise',
          quantity: 1,
          courseNumber: 1,
          variant: null,
          modifiers: [],
          note: null,
          fired: true,
          price: {
            unitPrice: money(20_000),
            lineSubtotal: money(20_000),
            tax: money(2_759),
            lineTotal: money(20_000),
            taxRateBasisPoints: 1_600,
          },
        },
      ],
      totals: trustedTotals.totals,
      checkoutEnabled: false,
      checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
      updatedAt: '2026-10-17 22:34:31.417387+00',
    };
    const checkoutCommand = {
      commandId: uid(100),
      customerValueFingerprintCommandId: uid(101),
      cartId: uid(40),
      locationId: uid(5),
      operatorSessionId: uid(6),
      cashShiftId: null,
      expectedCartVersion: 1,
      paymentMethod: 'cash',
      totalsFingerprint: trustedFingerprint,
      idempotencyKey: uid(102),
      tenderDrafts: [
        {
          id: uid(103),
          type: 'cash',
          amount: money(20_000),
          amountReceived: money(20_000),
          tipAmount: money(0),
          status: 'draft',
          correlationId: null,
        },
      ],
      tipDraft: null,
      discountDrafts: [],
      approvalIds: [],
      receiptDelivery: {
        destination: 'display',
        channel: null,
        customerContactId: null,
      },
      customerValue: null,
    };
    const unsigned = {
      ...command(1),
      commandType: 'pos.checkout.cash' as const,
      provisionalId: uid(80),
      createdAt: now,
      payload: {
        policyVersion: 'policy-1',
        policyFingerprint: 'e'.repeat(64),
        checkoutIdentity: 'f'.repeat(64),
        snapshot: {
          checkoutCommand,
          cartSnapshot,
          totals: trustedTotals,
          catalogVersion: 'catalog-1',
          pricingVersion: 'pricing-1',
          taxVersion: 'tax-1',
          catalogSnapshotAt: now,
          pricingSnapshotAt: now,
          taxSnapshotAt: now,
          currency: 'MXN',
          amountDueMinorUnits: 20_000,
          amountReceivedMinorUnits: 20_000,
          changeDueMinorUnits: 0,
          businessDate: '2026-10-17',
        },
      },
      fingerprint: undefined,
    };
    delete (unsigned as { fingerprint?: string }).fingerprint;
    let checkoutCommandEnvelope: OfflineCommand = {
      ...unsigned,
      fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
    };
    const replayed = vi.fn(async (value: OfflineCommand, commit?: unknown) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'accepted' as const,
      officialId: uid(81),
      officialCommit: commit ?? null,
      serverConflictReference: null,
      failure: null,
    }));
    const conflict = vi.fn(async (value: OfflineCommand, classification: string) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'conflict' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: uid(95),
      failure: {
        classification,
        retryable: false,
        blocksFollowing: true,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode: classification,
        correlationId: uid(96),
      },
    }));
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
        maxSingleSaleMinorUnits: '100000',
        maxAccumulatedMinorUnits: '100000',
        maxOfflineSaleCount: 10,
        maxActiveQueueDepth: 10,
        maxCommandAgeSeconds: 3600,
        maxCatalogAgeSeconds: 900,
        maxPricingAgeSeconds: 900,
        maxTaxAgeSeconds: 900,
        managerApprovalThresholdMinorUnits: null,
        allowedDeviceClasses: ['pos_terminal'],
        issuedAt: policyIssuedAt,
        expiresAt: policyExpiresAt,
      })),
      cashExposure: vi.fn(async () => ({ count: 0, amount: 0 })),
      recordConflict: conflict,
      replay: replayed,
    } as unknown as PosOfflineRepository;
    const checkoutService = {
      checkout: vi
        .fn()
        .mockResolvedValueOnce({
          status: 'confirmation_required',
          confirmation: serverTotals,
        })
        .mockResolvedValueOnce({
          status: 'completed',
          confirmation: trustedTotals,
          sale: {
            id: uid(81),
            orderId: uid(82),
            receiptId: uid(83),
            receiptRef: '0009',
            status: 'committed',
            committedAt: now,
            totals: trustedTotals.totals,
          },
          receipt: {
            receiptRef: '0009',
            businessDate: '2026-10-17',
          },
          payment: {
            attempt: {
              id: uid(84),
              method: 'cash',
              amount: money(20_000),
              status: 'succeeded',
            },
          },
        }),
    } as unknown as PosCheckoutService;
    const orderCart = {
      readAccount: vi.fn(async () => ({
        ...cartSnapshot,
        lines: [
          {
            id: uid(41),
            productId: uid(42),
            variantId: null,
            quantity: 1,
            courseNumber: 1,
            note: null,
            modifiers: [],
          },
        ],
      })),
    } as unknown as PosCartService;

    const service = new PosOfflineService(repo, checkoutService, orderCart, kds);
    const issued = await service.issuePolicy(user, uid(4), {
      locationId: uid(5),
      operatorSessionId: uid(6),
      credentialVersion: 1,
    });
    const correctedUnsigned = {
      ...checkoutCommandEnvelope,
      payload: {
        ...checkoutCommandEnvelope.payload,
        policyVersion: issued.cash.version,
        policyFingerprint: issued.cash.fingerprint,
      },
      fingerprint: undefined,
    };
    delete (correctedUnsigned as { fingerprint?: string }).fingerprint;
    checkoutCommandEnvelope = {
      ...correctedUnsigned,
      fingerprint: createHash('sha256').update(canonicalJson(correctedUnsigned)).digest('hex'),
    };
    const result = await service.batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [checkoutCommandEnvelope],
    });

    expect(conflict).not.toHaveBeenCalled();
    expect(result.results[0].status).toBe('accepted');
    const commit = replayed.mock.calls[0][1] as {
      committedTotals: { totals: { grandTotal: { minorUnits: number } } };
      divergence: { deltaMinorUnits: number };
    };
    expect(commit.committedTotals.totals.grandTotal.minorUnits).toBe(20_000);
    expect(commit.divergence.deltaMinorUnits).toBe(-3_200);
    expect((checkoutService.checkout as ReturnType<typeof vi.fn>).mock.calls[1][3]).toMatchObject({
      trustedConfirmation: trustedTotals,
      trustedLineSnapshot: cartSnapshot.items,
    });
  });

  it('replays a LAN kitchen bump in order and keeps a cloud refusal visible', async () => {
    const kitchen = {
      commandForReplay: vi
        .fn()
        .mockRejectedValueOnce(new ConflictException({ code: 'KITCHEN_VERSION_CONFLICT' })),
    } as unknown as KdsService;
    const recordConflict = vi.fn(async (value: OfflineCommand, classification: string) => ({
      commandId: value.commandId,
      deviceSequence: value.deviceSequence,
      status: 'conflict' as const,
      officialId: null,
      officialCommit: null,
      serverConflictReference: uid(91),
      failure: {
        classification,
        retryable: false,
        blocksFollowing: true,
        operatorActionRequired: true,
        managerActionRequired: false,
        guidanceCode: classification,
        correlationId: uid(92),
      },
    }));
    const repo = {
      acquireReplayLock: vi.fn(async () => async () => undefined),
      context: vi.fn(async () => ({
        lifecycle: 'active',
        credentialVersion: 1,
        deviceKind: 'pos_terminal',
        currency: 'MXN',
        permissions: ['offline.replay', 'kitchen.prepare'],
        entitlements: [],
        lastAcceptedSequence: 0,
      })),
      policy: vi.fn(async () => null),
      recordConflict,
    } as unknown as PosOfflineRepository;
    const unsigned = {
      ...command(1),
      commandType: 'pos.kds.command' as const,
      payload: {
        action: 'command',
        commandId: uid(120),
        idempotencyKey: uid(121),
        correlationId: uid(122),
        expectedVersion: 3,
        kitchenOrderId: uid(123),
        commandType: 'mark_item_ready',
        itemIds: [uid(124)],
        reasonCode: null,
        reasonNote: null,
        priority: null,
        courseNumber: null,
        locationId: uid(5),
        operatorSessionId: uid(6),
        actorDeviceId: uid(125),
        sourceReference: `pos-cart:${uid(40)}`,
        lineMap: { [uid(124)]: 0 },
        hubReceivedAt: new Date().toISOString(),
      },
      fingerprint: undefined,
    };
    delete (unsigned as { fingerprint?: string }).fingerprint;
    const kitchenCommand: OfflineCommand = {
      ...unsigned,
      fingerprint: createHash('sha256').update(canonicalJson(unsigned)).digest('hex'),
    };

    const result = await new PosOfflineService(repo, checkout, cart, kitchen).batch(user, uid(4), {
      replaySessionId: uid(9),
      commands: [kitchenCommand],
    });

    expect(kitchen.commandForReplay).toHaveBeenCalledWith(
      user,
      uid(4),
      expect.objectContaining({
        kitchenOrderId: uid(123),
        commandType: 'mark_item_ready',
      }),
      uid(125),
      ['offline.replay', 'kitchen.prepare'],
      `pos-cart:${uid(40)}`,
      { [uid(124)]: 0 },
    );
    expect(result.results[0].status).toBe('conflict');
    expect(recordConflict).toHaveBeenCalledWith(
      kitchenCommand,
      'aggregate_version_conflict',
      true,
      'kitchen_refusal:KITCHEN_VERSION_CONFLICT',
    );
    expect(result.stopped).toBe(true);
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
    const result = await new PosOfflineService(repo, checkout, cart, kds).reconcile(
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
