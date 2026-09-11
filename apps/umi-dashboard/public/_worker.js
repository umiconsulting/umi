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
