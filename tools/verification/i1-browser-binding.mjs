// Browser binding control for the I1 timing harness.
//
// Acceptance timing must come from the pinned CDP Chromium window. This module
// records the binding and refuses a launched browser or a headless substitute.

export async function describeBinding(browser, endpoint) {
  const contexts = browser.contexts();
  const pages = contexts.flatMap((context) => context.pages());
  const userAgent = pages[0] ? await pages[0].evaluate(() => navigator.userAgent) : null;
  return {
    transport: 'cdp',
    endpoint,
    browserVersion: await browser.version(),
    userAgent,
    contexts: contexts.length,
    pages: pages.length,
  };
}

export function assertConformingBinding(binding) {
  if (!binding || binding.transport !== 'cdp')
    throw new Error('NON_CONFORMING_BROWSER: the harness must attach to CDP');
  if (!binding.endpoint)
    throw new Error('NON_CONFORMING_BROWSER: the CDP endpoint is not recorded');
  if (!binding.contexts || binding.contexts < 1)
    throw new Error('NON_CONFORMING_BROWSER: no attached CDP context');
  const headless =
    /headless/i.test(binding.browserVersion || '') ||
    /HeadlessChrome/i.test(binding.userAgent || '');
  if (headless)
    throw new Error('NON_CONFORMING_BROWSER: a headless browser cannot produce acceptance timing');
  return true;
}
