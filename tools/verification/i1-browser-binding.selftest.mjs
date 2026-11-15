#!/usr/bin/env node
// Deliberate-fault run for the browser binding control.
// Each fault must be refused. A control that accepts any fault exits 1.

import { assertConformingBinding } from './i1-browser-binding.mjs';

const faults = [
  { name: 'launched browser', binding: { transport: 'launch', endpoint: null, contexts: 1 } },
  {
    name: 'headless CDP browser',
    binding: {
      transport: 'cdp',
      endpoint: 'http://127.0.0.1:9222',
      browserVersion: 'HeadlessChrome/151.0.7922.34',
      userAgent: 'Mozilla/5.0 HeadlessChrome/151.0.7922.34',
      contexts: 1,
      pages: 1,
    },
  },
  {
    name: 'missing CDP context',
    binding: {
      transport: 'cdp',
      endpoint: 'http://127.0.0.1:9222',
      browserVersion: '151.0.7922.34',
      userAgent: 'Mozilla/5.0 Chrome/151.0.7922.34',
      contexts: 0,
      pages: 0,
    },
  },
];

const results = [];
for (const fault of faults) {
  let rejected = false;
  try {
    assertConformingBinding(fault.binding);
  } catch {
    rejected = true;
  }
  results.push({ fault: fault.name, rejected });
  if (!rejected) {
    console.error(`FAIL: the control accepted ${fault.name}`);
    process.exit(1);
  }
}
console.log(JSON.stringify({ status: 'PASS', control: 'browser-binding', results }, null, 2));
