import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyRequest } from './backend-proxy';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Cash API transport', () => {
  it('preserves a signed pass as binary data', async () => {
    vi.stubEnv('CASH_API_ORIGIN', 'https://api-staging.example.test');
    const bytes = new Uint8Array([0x50, 0x4b, 0, 255, 37]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/vnd.apple.pkpass' } })));
    const response = await proxyRequest(new Request('https://cash.example.test/api/cafe/passes/apple'));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
  });

  it('refreshes an expired admin session and retries the original mutation once', async () => {
    vi.stubEnv('CASH_API_ORIGIN', 'https://api-staging.example.test');
    const calls: { path: string; cookie: string | null; csrf: string | null; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
      const headers = new Headers(init.headers);
      calls.push({ path: url.pathname, cookie: headers.get('cookie'), csrf: headers.get('x-umi-csrf'), body: init.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : '' });
      if (calls.length === 1) return Response.json({ error: 'expired' }, { status: 401 });
      if (calls.length === 2) {
        const response = Response.json({ ok: true });
        for (const cookie of ['umi_access=new; Domain=.example.test; HttpOnly; Secure', 'umi_csrf=new-csrf; Domain=.example.test; Secure']) response.headers.append('set-cookie', cookie);
        return response;
      }
      return Response.json({ ok: true });
    }));
    const response = await proxyRequest(new Request('https://cash.example.test/api/umi/tenants/merchant-1', {
      method: 'PATCH', body: '{"name":"Café"}', headers: { cookie: 'umi_access=old; umi_refresh=refresh; umi_csrf=old-csrf', 'content-type': 'application/json' },
    }));
    expect(response.status).toBe(200);
    expect(calls.map((call) => call.path)).toEqual(['/api/umi/tenants/merchant-1', '/api/auth/local/refresh', '/api/umi/tenants/merchant-1']);
    expect(calls[2]).toMatchObject({ body: '{"name":"Café"}', csrf: 'new-csrf' });
    expect(calls[2].cookie).toContain('umi_access=new');
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(response.headers.get('set-cookie')).not.toContain('Domain=');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
  });

  it('returns a safe error when the backend connection fails', async () => {
    vi.stubEnv('CASH_API_ORIGIN', 'https://api-staging.example.test');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private connection details')));
    const response = await proxyRequest(new Request('https://cash.example.test/api/cafe/admin/stats'));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private connection details');
  });
});
