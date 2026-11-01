// These ports belong only to the disposable inventory import stack.
export const IMPORT_DASHBOARD_BASE = 'http://127.0.0.1:4083';

function localHttpOrigin(value, port) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid isolated import HTTP origin.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.port !== port ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid isolated import HTTP origin.');
}

export function assertImportFixtureOrigins(fixture, base = IMPORT_DASHBOARD_BASE, databaseUrl) {
  localHttpOrigin(base, '4083');
  localHttpOrigin(fixture.apiBase, '4082');
  if (databaseUrl !== undefined) {
    let url;
    try {
      url = new URL(databaseUrl);
    } catch {
      throw new Error('Invalid isolated import database.');
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55435' ||
      url.pathname !== '/umi_inventory_import' ||
      url.search ||
      url.hash
    )
      throw new Error('Invalid isolated import database.');
  }
}
