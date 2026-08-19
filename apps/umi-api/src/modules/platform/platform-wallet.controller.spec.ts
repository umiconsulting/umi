import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PlatformWalletController } from './platform-wallet.controller';

function harness(configured = true) {
  const push = {
    pushCards: vi.fn().mockResolvedValue({ cards: 2, sent: 2 }),
    pushMerchant: vi.fn().mockResolvedValue({ cards: 10, sent: 9 }),
    isConfigured: () => configured,
  };
  const repo = {
    passHealth: vi.fn().mockResolvedValue({ total: 751, unregistered: 89, stale: 4 }),
  };
  return { c: new PlatformWalletController(push as never, repo as never), push, repo };
}

const CAFE_A = '9f000000-0000-4000-8000-00000000a001';
const CAFE_B = '9f000000-0000-4000-8000-00000000b002';

describe('the operator’s wallet surface', () => {
  it('reports pass health, and says whether a push could even be sent', async () => {
    // A zero `sent` from an unconfigured host looks exactly like a defect. The
    // flag is what lets an operator tell "nothing to do" from "nothing works".
    const h = harness(false);
    expect(await h.c.passHealth()).toEqual({
      total: 751,
      unregistered: 89,
      stale: 4,
      staleDays: 30,
      pushConfigured: false,
    });
    expect(h.repo.passHealth).toHaveBeenCalledWith(30);
  });

  it('takes a stale window, and refuses one that is not a window', async () => {
    const h = harness();
    await h.c.passHealth('7');
    expect(h.repo.passHealth).toHaveBeenCalledWith(7);
    for (const bad of ['-1', '9999', 'thirty', '1.5']) {
      await expect(h.c.passHealth(bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('REFUSES an empty body rather than pushing everything', async () => {
    // Pushing every pass Umi ever issued is a thing an operator may want and
    // must ask for. An empty body is a mistake, not a request.
    const h = harness();
    await expect(h.c.pushPasses({})).rejects.toBeInstanceOf(BadRequestException);
    expect(h.push.pushCards).not.toHaveBeenCalled();
    expect(h.push.pushMerchant).not.toHaveBeenCalled();
  });

  it('pushes named cards through the path that touches them first', async () => {
    const h = harness();
    const out = await h.c.pushPasses({ cardIds: ['c1', 'c2'] });
    expect(h.push.pushCards).toHaveBeenCalledWith(['c1', 'c2']);
    expect(out).toEqual({ cards: 2, sent: 2, pushConfigured: true });
  });

  it('pushes each café in series, and sums what it did', async () => {
    const h = harness();
    const out = await h.c.pushPasses({ cardIds: ['c1', 'c2'], merchantIds: [CAFE_A, CAFE_B] });
    expect(h.push.pushMerchant).toHaveBeenNthCalledWith(1, CAFE_A);
    expect(h.push.pushMerchant).toHaveBeenNthCalledWith(2, CAFE_B);
    // 2 cards + 10 + 10; 2 sent + 9 + 9.
    expect(out).toEqual({ cards: 22, sent: 20, pushConfigured: true });
  });
});
