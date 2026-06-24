import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { TwilioAdapter } from './twilio.adapter';

function adapterWith(values: Record<string, unknown>): TwilioAdapter {
  const config = { get: (k: string) => values[k] } as unknown as ConfigService<
    Record<string, unknown>,
    true
  >;
  return new TwilioAdapter(config);
}

const FULL = {
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 'tok',
  TWILIO_WHATSAPP_FROM: '+1555',
};

describe('TwilioAdapter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns null when config is missing', async () => {
    const r = await adapterWith({}).sendWhatsAppMessage({ to: '+1', body: 'hi' });
    expect(r).toBeNull();
  });

  it('posts to the Twilio Messages API and returns the SID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM123' }) });
    vi.stubGlobal('fetch', fetchMock);

    const r = await adapterWith(FULL).sendWhatsAppMessage({
      to: '+1999',
      body: 'hello',
    });

    expect(r).toEqual({ sid: 'SM123' });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json',
    );
    expect(opts.headers.Authorization).toBe(
      'Basic ' + Buffer.from('AC1:tok').toString('base64'),
    );
    expect(opts.body).toContain('From=whatsapp%3A%2B1555');
    expect(opts.body).toContain('To=whatsapp%3A%2B1999');
    expect(opts.body).toContain('Body=hello');
  });

  it('returns null on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      }),
    );
    const r = await adapterWith(FULL).sendWhatsAppMessage({
      to: '+1999',
      body: 'hi',
    });
    expect(r).toBeNull();
  });

  it('builds a geo PersistentAction for location pins', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM9' }) });
    vi.stubGlobal('fetch', fetchMock);

    await adapterWith(FULL).sendLocationPin({
      to: '+1999',
      from: 'whatsapp:+1555',
      body: 'here',
      lat: 19.4,
      lng: -99.1,
      label: 'Cafe',
    });

    expect(fetchMock.mock.calls[0][1].body).toContain(
      'PersistentAction=geo%3A19.4%2C-99.1%7CCafe',
    );
  });
});
