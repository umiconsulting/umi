#!/usr/bin/env node
// Delayed-response gate for the I1 group races (GRP-04 and GRP-05).
//
// The gate holds every report response after its request reaches the server,
// lets the test save or delete a group, then releases the held responses. This
// is the "start the report request with a 2-second delay, save/delete before it
// returns, release the old response" action. A browser screenshot alone cannot
// prove the cache result, so the caller reads queryClient state from the dev
// build.
//
// Usage as a library:
//   const gate = await openGate(page, { delayMs: 2000 });
//   ... trigger the report request ...
//   await gate.waitForHeld();
//   ... save or delete the group ...
//   await gate.release();
//   await gate.waitForReleased();
//   const cache = await page.evaluate(async () => {
//     const { queryClient } = await import('/src/lib/query-client.js');
//     return queryClient.getQueryCache().getAll().map((query) => ({
//       key: query.queryKey, dataUpdatedAt: query.state.dataUpdatedAt,
//     }));
//   });

export async function openGate(
  page,
  { delayMs = 2000, match = '**/operations/reports/sales/analysis?*' } = {},
) {
  let releaseGate;
  const released = new Promise((resolveRelease) => {
    releaseGate = resolveRelease;
  });
  let heldCount = 0;
  let finishedCount = 0;
  const handler = async (route) => {
    heldCount += 1;
    await released;
    if (delayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    }
    try {
      await route.continue();
    } catch {
      // The app cancels the in-flight query when a group write invalidates it.
      // A cancelled request cannot continue, and that is the expected path.
    }
    finishedCount += 1;
  };
  await page.route(match, handler);
  const waitFor = async (predicate, timeoutMs, message) => {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(message);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  };
  return {
    get heldCount() {
      return heldCount;
    },
    get finishedCount() {
      return finishedCount;
    },
    async waitForHeld(timeoutMs = 15000) {
      await waitFor(() => heldCount > 0, timeoutMs, 'the report request was not held');
      return heldCount;
    },
    async waitForHeldCount(count, timeoutMs = 15000) {
      await waitFor(
        () => heldCount >= count,
        timeoutMs,
        `fewer than ${count} report requests reached the gate`,
      );
      return heldCount;
    },
    async release() {
      releaseGate();
    },
    async waitForReleased(timeoutMs = 30000) {
      await waitFor(
        () => finishedCount >= heldCount,
        timeoutMs,
        'the held report responses did not finish',
      );
      await page.unroute(match).catch(() => {});
    },
    async close() {
      releaseGate();
      await page.unroute(match).catch(() => {});
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(
    JSON.stringify(
      {
        status: 'READY',
        note: 'Import openGate() from a browser case. This CLI does not attach to a page by itself.',
      },
      null,
      2,
    ),
  );
}
