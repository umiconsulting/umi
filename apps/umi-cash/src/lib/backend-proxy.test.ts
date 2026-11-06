import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyRequest } from './backend-proxy';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Cash API transport', () => {
  it('forwards conditional Wallet downloads and preserves an empty 304 response', async () => {
    vi.stubEnv('CASH_API_ORIGIN', 'https://api-staging.example.test');
    const modified = 'Thu, 05 Nov 2026 23:44:51 GMT';
    const fetch = vi.fn(async (_url: URL, init: RequestInit) => {
      expect(new Headers(init.headers).get('if-modified-since')).toBe(modified);
      return new Response(null, { status: 304, headers: { 'last-modified': modified } });
    });
    vi.stubGlobal('fetch', fetch);
    const response = await proxyRequest(new Request('https://cash.example.test/api/cafe/passes/apple/v1/passes/type/serial', {
      headers: { authorization: 'ApplePass test-token', 'if-modified-since': modified },
    }));
    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('last-modified')).toBe(modified);
  });

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
