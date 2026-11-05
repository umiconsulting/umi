import { backendFetch } from './backend';

function responseCookies(response: Response): string[] {
  return response.headers.getSetCookie().map((cookie) => cookie.replace(/;\s*Domain=[^;]*/gi, ''));
}

function cookieMap(header: string): Map<string, string> {
  return new Map(header.split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
}

export async function proxyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;
  let method = request.method;
  if (path === '/api/umi/auth') {
    path = method === 'DELETE' ? '/api/auth/local/logout' : '/api/auth/local/login';
    if (method === 'DELETE') method = 'POST';
  }
  if (path === '/api/umi/geocode') path = '/api/geocode';
  if (path === '/api/umi/tenants' && method === 'POST') path = '/api/merchants';
  if (path === '/api/umi/mfa/verify') path = '/api/auth/local/mfa/verify';
  const headers = new Headers();
  headers.set('accept-encoding', 'identity');
  for (const key of ['accept', 'content-type', 'authorization', 'cookie', 'user-agent', 'origin', 'x-umi-csrf']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  const cookies = cookieMap(headers.get('cookie') ?? '');
  // Middleware verifies the browser origin before this server proxy adds CSRF.
  if (cookies.get('umi_csrf')) headers.set('x-umi-csrf', cookies.get('umi_csrf')!);
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  const init: RequestInit = { method, headers, ...(body?.byteLength ? { body } : {}) };
  try {
    let upstream = await backendFetch(path + url.search, init);
    const renewed: string[] = [];
    if (upstream.status === 401 && cookies.has('umi_refresh') && url.pathname.startsWith('/api/umi/') && url.pathname !== '/api/umi/auth') {
      const refresh = await backendFetch('/api/auth/local/refresh', { method: 'POST', headers });
      if (refresh.ok) {
        renewed.push(...responseCookies(refresh));
        for (const value of renewed) {
          const [pair] = value.split(';');
          const index = pair.indexOf('=');
          cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
        headers.set('cookie', Array.from(cookies, ([key, value]) => `${key}=${value}`).join('; '));
        if (cookies.get('umi_csrf')) headers.set('x-umi-csrf', cookies.get('umi_csrf')!);
        await upstream.body?.cancel();
        upstream = await backendFetch(path + url.search, init);
      }
      await refresh.body?.cancel();
    }
    const outgoing = new Headers(upstream.headers);
    outgoing.delete('set-cookie');
    for (const cookie of [...renewed, ...responseCookies(upstream)]) outgoing.append('set-cookie', cookie);
    outgoing.set('Cache-Control', 'no-store');
    if (!upstream.ok && upstream.headers.get('content-type')?.includes('application/json')) {
      const data = await upstream.json();
      const error = typeof data.error === 'string' ? data.error : data.error?.message ?? data.message ?? 'No se pudo completar la solicitud.';
      outgoing.delete('content-length');
      return new Response(JSON.stringify({ ...data, error }), { status: upstream.status, headers: outgoing });
    }
    return new Response(upstream.body, { status: upstream.status, headers: outgoing });
  } catch {
    return Response.json({ error: 'El servicio de Umi no está disponible. Intenta de nuevo.' }, { status: 502 });
  }
}
