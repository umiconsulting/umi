import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { onRequestPost } from '../../../functions/api/contact';

describe('Cloudflare Pages Function /api/contact proxy', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns 503 when env.API_ORIGIN is missing', async () => {
    const req = new Request('https://umiconsulting.co/api/contact', {
      method: 'POST',
      body: JSON.stringify({ email: 'hola@onca.mx' }),
    });
    const res = await onRequestPost({ request: req, env: {} });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('El formulario no está disponible.');
  });

  test('proxies POST body to API_ORIGIN/api/contact preserving status and Cache-Control: no-store', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchMock;

    const payload = JSON.stringify({ name: 'Ana', email: 'ana@cafe.mx' });
    const req = new Request('https://umiconsulting.co/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    const res = await onRequestPost({
      request: req,
      env: { API_ORIGIN: 'https://api-staging.umiconsulting.co' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [targetUrl, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(targetUrl.toString()).toBe('https://api-staging.umiconsulting.co/api/contact');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(payload);
    expect(init.redirect).toBe('manual');
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({ ok: true });
  });

  test('returns 502 when upstream fetch throws', async () => {
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(new Error('network error'));

    const req = new Request('https://umiconsulting.co/api/contact', {
      method: 'POST',
      body: '{}',
    });
    const res = await onRequestPost({
      request: req,
      env: { API_ORIGIN: 'https://api-staging.umiconsulting.co' },
    });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('No pudimos enviar tu solicitud. Inténtalo de nuevo.');
  });
});
