#!/usr/bin/env node
// Delayed-response gate for the I1 group races (GRP-04 and GRP-05).
//
// The gate holds one report response after its request reaches the server, lets
// the test save or delete a group, then releases the old response. This is the
// "start the report request with a 2-second delay, save/delete before it returns,
// release the old response" action. A browser screenshot alone cannot prove the
// cache result, so the caller reads queryClient.dataUpdatedAt from the dev build.
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

export async function openGate(page, { delayMs = 2000, match = '**/operations/reports/sales/analysis?*' } = {}) {
  let release;
  const released = new Promise((resolveRelease) => {
    release = resolveRelease;
  });
  let held;
  const heldOnce = new Promise((resolveHeld) => {
    held = resolveHeld;
  });
  let heldCount = 0;
  await page.route(match, async (route) => {
    heldCount += 1;
    held();
    await released;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
    await route.continue();
  });
  return {
    async waitForHeld(timeoutMs = 15000) {
      await Promise.race([
        heldOnce,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('the report request was not held')), timeoutMs),
        ),
      ]);
      return heldCount;
    },
    async release() {
      release();
    },
    async waitForReleased() {
      await page.unroute(match);
    },
    async close() {
      release();
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
