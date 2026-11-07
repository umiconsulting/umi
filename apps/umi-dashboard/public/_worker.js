/**
 * Cloudflare Pages advanced-mode Worker for umi-dashboard.
 *
 * WHY THIS EXISTS
 * On the Cloudflare Pages preview the dashboard is served from `*.pages.dev`
 * while the API lives on `*.umiconsulting.co` — a DIFFERENT site. The session
 * cookie was therefore a third-party cookie, and Safari iOS "Prevent Cross-Site
 * Tracking" (ITP) dropped it: `/api/me/merchants` returned 401, the café list
 * was empty and the menu/café switcher never rendered. (Chrome is removing
 * third-party cookies too, so this would have broken there next.)
 *
 * FIX: proxy the API under the dashboard's OWN origin, so the cookie is
 * first-party and every browser keeps it. Preview builds ship with
 * VITE_API_BASE="" (see .github/workflows/deploy-dashboard.yml), so the SPA
 * calls same-origin `/api`, `/socket.io` and `/health`; this Worker forwards
 * those to the real backend. Production keeps calling the API directly (it is
 * already same-site with the dashboard), so on production this proxy branch is
 * never exercised — the Worker only serves static assets there.
 *
 * The backend origin comes from the Pages env var API_ORIGIN, set per
 * environment (Preview = api-staging, Production = api).
 *
 * Everything else is the static SPA served from env.ASSETS, with an index.html
 * fallback for client routes — advanced mode ignores `public/_redirects`, so
 * that SPA rule is reproduced here.
 */

function isBackendPath(pathname) {
  return (
    pathname === '/api' ||
    pathname.startsWith('/api/') ||
    pathname === '/socket.io' ||
    pathname.startsWith('/socket.io/') ||
    pathname === '/health'
  );
}

const AUTH_COOKIE_NAMES = new Set(['umi_access', 'umi_refresh', 'umi_csrf', 'umi_remember']);
const STAGING_COOKIE_PREFIX = 'umi_staging_';

function stagingRequest(request, target) {
  const headers = new Headers(request.headers);
  const cookies = (headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
  const scoped = [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    const name = cookie.slice(0, separator);
    if (name.startsWith(STAGING_COOKIE_PREFIX)) {
      const original = `umi_${name.slice(STAGING_COOKIE_PREFIX.length)}`;
      if (AUTH_COOKIE_NAMES.has(original)) scoped.push(`${original}${cookie.slice(separator)}`);
    } else if (!AUTH_COOKIE_NAMES.has(name)) {
      scoped.push(cookie);
    }
  }
  headers.set('cookie', scoped.join('; '));
  return new Request(target, new Request(request, { headers }));
}

function stagingResponse(response) {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.getAll('Set-Cookie');
  if (!cookies.length) return response;
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  for (const cookie of cookies) {
    const name = cookie.slice(0, cookie.indexOf('='));
    const scoped = AUTH_COOKIE_NAMES.has(name)
      ? cookie.replace(/^umi_/, STAGING_COOKIE_PREFIX).replace(/;\s*Domain=[^;]*/gi, '')
      : cookie;
    headers.append('set-cookie', scoped);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isBackendPath(url.pathname)) {
      const origin = (env.API_ORIGIN || '').replace(/\/+$/, '');
      if (!origin) {
        return new Response('API_ORIGIN is not configured for this environment', {
          status: 500,
        });
      }
      // Pass the request through unchanged so the WebSocket upgrade used by
      // socket.io survives. fetch() sets the Host header from the target URL,
      // so Caddy on the backend routes to the right vhost.
      const target = origin + url.pathname + url.search;
      if (new URL(origin).hostname === 'api-staging.umiconsulting.co') {
        const response = await fetch(stagingRequest(request, target));
        return response.webSocket ? response : stagingResponse(response);
      }
      return fetch(new Request(target, request));
    }

    // Static asset, else SPA fallback to index.html for client-side routes.
    const response = await env.ASSETS.fetch(request);
    if (
      response.status === 404 &&
      request.method === 'GET' &&
      (request.headers.get('accept') || '').includes('text/html')
    ) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url.origin).toString(), request));
    }
    return response;
  },
};
