import { describe, expect, it } from 'vitest';
import { KitchenBoardEvents } from './kitchen-board.events';

const merchantId = 'd0000000-0000-4000-8000-000000000001';
const locationId = 'd1000000-0000-4000-8000-000000000001';
const neighboursLocation = 'd1000000-0000-4000-8000-000000000002';

const changed = (location: string) => ({
  merchantId,
  locationId: location,
  kitchenOrderId: 'd2000000-0000-4000-8000-000000000001',
  changedAt: new Date().toISOString(),
});

describe('the kitchen board wake-up bus', () => {
  it('answers true when this location moves', async () => {
    const bus = new KitchenBoardEvents();

    const waiting = bus.waitForChange(merchantId, locationId, 5_000);
    bus.emitBoardChanged(changed(locationId));

    await expect(waiting).resolves.toBe(true);
  });

  it('answers false when the hold runs out, which is an answer and not an error', async () => {
    // The expired hold is the 8-second poll kept as the floor: the till re-reads either way, so
    // "nothing happened while you waited" has to be a normal reply rather than a failure the
    // client has to special-case.
    const bus = new KitchenBoardEvents();

    await expect(bus.waitForChange(merchantId, locationId, 30)).resolves.toBe(false);
  });

  it('does not wake a till for the café next door', async () => {
    const bus = new KitchenBoardEvents();

    const waiting = bus.waitForChange(merchantId, locationId, 150);
    bus.emitBoardChanged(changed(neighboursLocation));

    await expect(waiting).resolves.toBe(false);
  });

  it('releases every watcher that is waiting on the same kitchen', async () => {
    // Two cooks, two devices, one board: a ticket moving has to reach both, which is what makes
    // this a bus and not a single-slot notification.
    const bus = new KitchenBoardEvents();

    const first = bus.waitForChange(merchantId, locationId, 5_000);
    const second = bus.waitForChange(merchantId, locationId, 5_000);
    bus.emitBoardChanged(changed(locationId));

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });
});
