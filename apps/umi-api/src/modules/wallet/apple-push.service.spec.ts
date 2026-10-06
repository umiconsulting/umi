import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { ApplePushService } from './apple-push.service';

/**
 * THE TOUCH IS PART OF THE PUSH.
 *
 * Apple's web service answers `passesUpdatedSince` by comparing the card row.
 * A push with no newer row makes the phone wake, ask what changed, hear
 * "nothing", and download nothing — a push that reports success and does
 * nothing, which is this module's whole silent-failure family.
 *
 * umi-cash had both behaviours in one codebase: `push-passes` touched the rows
 * and worked; `sendApplePushUpdateForTenant`, behind the reward-config and
 * settings screens, did not and never updated a single pass.
 */

/**
 * A REAL P-256 key, because a fake one changes what is tested. `providerToken()`
 * signs an ES256 JWT and returns null if the key will not load — and `pushCard`
 * gives up before it ever asks the repository for devices, so the ordering this
 * file asserts would never be reached.
 */
const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function configured() {
  const env: Record<string, string | undefined> = {
    APPLE_APN_KEY_ID: 'KEYID',
    APPLE_TEAM_ID: 'TEAMID',
    APPLE_PASS_TYPE_ID: 'pass.co.umicash.loyalty',
    APPLE_APN_KEY: Buffer.from(privateKey).toString('base64'),
  };
  return { get: (k: string) => env[k] } as never;
}

function harness() {
  const calls: string[] = [];
  const repo = {
    touchCards: vi.fn(async () => {
      calls.push('touch');
    }),
    cardsWithApplePass: vi.fn(async () => ['c1', 'c2']),
    // No devices, so nothing reaches the network — the ORDER is what is asserted.
    pushTokensForCard: vi.fn(async () => {
      calls.push('push');
      return [] as string[];
    }),
  };
  return { svc: new ApplePushService(configured(), repo as never), repo, calls };
}

describe('pushCards · the operator’s escape hatch', () => {
  it('touches every card BEFORE pushing it', async () => {
    const h = harness();
    await h.svc.pushCards(['c1', 'c2']);
    expect(h.repo.touchCards).toHaveBeenCalledWith(['c1', 'c2']);
    // The order is the assertion. Reversed, the phone asks what changed and is
    // told nothing did.
    expect(h.calls[0]).toBe('touch');
    expect(h.calls.slice(1)).toEqual(['push', 'push']);
  });

  it('reports how many cards it addressed', async () => {
    const h = harness();
    expect(await h.svc.pushCards(['c1', 'c2'])).toEqual({ cards: 2, sent: 0 });
  });

  it('touches nothing when given nothing', async () => {
    const h = harness();
    expect(await h.svc.pushCards([])).toEqual({ cards: 0, sent: 0 });
    expect(h.repo.touchCards).not.toHaveBeenCalled();
  });

  it('does nothing at all when APNs is not configured', async () => {
    // Not a silent success: `pushCard` logs `apn_not_configured`. What matters
    // here is that no row is touched, so a later real push still has work to do.
    const repo = { touchCards: vi.fn(), pushTokensForCard: vi.fn() };
    const svc = new ApplePushService({ get: () => undefined } as never, repo as never);
    expect(await svc.pushCards(['c1'])).toEqual({ cards: 0, sent: 0 });
    expect(repo.touchCards).not.toHaveBeenCalled();
  });
});
