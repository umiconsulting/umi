import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { FacturapiAdapter } from './facturapi.adapter';

function adapterWith(values: Record<string, unknown>): FacturapiAdapter {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return new FacturapiAdapter(config);
}

const BASE = 'https://www.facturapi.io/v2';
const INVOICE = { customer: 'c1', items: [], payment_form: '01' };

describe('FacturapiAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('createOrganization skips (returns null) without a user key and makes no call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await adapterWith({}).createOrganization({ legal: {} })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('createOrganization POSTs /organizations with the master user key on success', async () => {
    const org = { id: 'org_1' };
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => org });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await adapterWith({ FACTURAPI_USER_KEY: 'sk_user_X' }).createOrganization({
      legal: {},
    });
    expect(out).toEqual(org);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/organizations`);
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('sk_user_X:').toString('base64')}`);
  });

  it('stampInvoice POSTs /invoices with Basic auth (org key as user, blank password)', async () => {
    const invoice = { id: 'inv_1', uuid: 'UUID', status: 'valid' };
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => invoice });
    vi.stubGlobal('fetch', fetchSpy);

    const out = await adapterWith({}).stampInvoice('sk_test_ABC', INVOICE);
    expect(out).toEqual(invoice);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE}/invoices`);
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe(`Basic ${Buffer.from('sk_test_ABC:').toString('base64')}`);
    expect(JSON.parse(opts.body)).toEqual(INVOICE);
  });

  it('throws on a non-ok response, surfacing the status and body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid rfc' }),
    );
    await expect(adapterWith({}).stampInvoice('sk_test_ABC', INVOICE)).rejects.toThrow(
      /Facturapi API error: 400 - invalid rfc/,
    );
  });

  it('propagates a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(adapterWith({}).getInvoice('sk_test_ABC', 'inv_1')).rejects.toThrow('ECONNRESET');
  });

  it('honors a configured base URL and encodes the invoice id', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchSpy);
    await adapterWith({ FACTURAPI_BASE_URL: 'https://sandbox.example/v2' }).getInvoice('sk', 'inv 1');
    expect(fetchSpy.mock.calls[0][0]).toBe('https://sandbox.example/v2/invoices/inv%201');
  });
});
