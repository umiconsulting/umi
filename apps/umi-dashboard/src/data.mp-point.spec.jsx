import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTestLocale } from '@/test/i18n.jsx';
import {
  bindMpPointTerminal,
  createMpPointStore,
  disconnectMpPointAccount,
  getMpPointAuthorization,
  getMpPointCredentialStatus,
  getMpPointTerminals,
  unbindMpPointTerminal,
} from './data.jsx';

// The Mercado Pago Point client of Phase 5 steps 1 and 3, at the WIRE: which contract route
// each call lands on, and what it carries. The card's own states are asserted in
// `screens/devices.mp-point.spec.jsx`; here the question is only whether the URL and the
// body are the ones the route table and `mercado-pago.ts` describe.

const merchantId = '1860305f-e864-d745-29e6-fb8830926cc6';
const terminalId = 'NEWLAND_N950__SBX0001';
const deviceId = '322410ce-551f-44a0-804f-278203b1ba01';
const locationId = '758c505d-5559-e877-bd01-9d5a41ffa9b4';

function localStorageWith(values) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: vi.fn((key) => entries.get(key) || null),
    setItem: vi.fn((key, value) => entries.set(key, value)),
    removeItem: vi.fn((key) => entries.delete(key)),
  };
}

const pathOf = (call) => new URL(call[0], 'http://local').pathname;

describe('Mercado Pago Point data client', () => {
  beforeEach(() => {
    // The guard's message is a macro translation, so the locale has to be active before it
    // is asked for: without one, Lingui's own "no active locale" error is what surfaces.
    activateTestLocale('es');
    globalThis.window = {
      localStorage: localStorageWith({
        'umi-dashboard-selected-merchant': merchantId,
        'umi-dashboard-selected-location': locationId,
      }),
    };
    globalThis.document = { cookie: '' };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
  });

  it('reads the account and the invitation from the two merchant routes', async () => {
    await getMpPointCredentialStatus();
    await getMpPointAuthorization();
    await getMpPointTerminals();

    expect(fetch.mock.calls.map(pathOf)).toEqual([
      `/api/merchants/${merchantId}/mp-point`,
      `/api/merchants/${merchantId}/mp-point/authorization`,
      `/api/merchants/${merchantId}/mp-point/terminals`,
    ]);
    expect(fetch.mock.calls.map(([, opts]) => (opts || {}).method || 'GET')).toEqual([
      'GET',
      'GET',
      'GET',
    ]);
  });

  it('binds a terminal with the whole binding: register, location, terminal and mode', async () => {
    await bindMpPointTerminal(terminalId, {
      deviceId,
      locationId,
      operatingMode: 'STANDALONE',
    });

    const [url, opts] = fetch.mock.calls[0];
    expect(pathOf([url])).toBe(`/api/merchants/${merchantId}/mp-point/terminals/${terminalId}`);
    expect(opts.method).toBe('PUT');
    // The vendor's terminal id carries characters a path must encode.
    expect(url).toContain(encodeURIComponent(terminalId));
    expect(JSON.parse(opts.body)).toEqual({
      terminalId,
      deviceId,
      locationId,
      operatingMode: 'STANDALONE',
    });
  });

  it('unbinds with a bodyless DELETE, so no JSON content-type is advertised', async () => {
    await unbindMpPointTerminal(terminalId);

    const [url, opts] = fetch.mock.calls[0];
    expect(pathOf([url])).toBe(`/api/merchants/${merchantId}/mp-point/terminals/${terminalId}`);
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('unlinks the account with a bodyless DELETE on the credential itself', async () => {
    await disconnectMpPointAccount();

    const [url, opts] = fetch.mock.calls[0];
    // The ACCOUNT, not a terminal: the merchant-scoped path with no terminal segment, which
    // is the one thing that tells the two DELETEs apart at the wire.
    expect(pathOf([url])).toBe(`/api/merchants/${merchantId}/mp-point`);
    expect(opts.method).toBe('DELETE');
    expect(opts.body).toBeUndefined();
    expect(opts.headers['Content-Type']).toBeUndefined();
  });

  it('crea la tienda del negocio con la dirección que el operador escribió', async () => {
    const address = {
      name: 'Café Central',
      streetName: 'Álvaro Obregón',
      streetNumber: '1234',
      cityName: 'Culiacán',
      stateName: 'Sinaloa',
      latitude: 24.809065,
      longitude: -107.393395,
      reference: 'Frente al parque',
    };

    await createMpPointStore(address);

    const [url, opts] = fetch.mock.calls[0];
    expect(pathOf([url])).toBe(`/api/merchants/${merchantId}/mp-point/store`);
    expect(opts.method).toBe('POST');
    // The accented city travels VERBATIM: the vendor's catalogue is the one with accents, and
    // nothing on this side normalises what the operator typed.
    expect(JSON.parse(opts.body)).toEqual(address);
    expect(opts.headers['Content-Type']).toBe('application/json');
  });

  it('lleva la referencia como null, no como una llave ausente', async () => {
    // The contract's `reference` is nullable and the object is `.strict()`, so the key has to
    // be THERE with a null — a dropped key is a 400 from our own validation pipe, not the
    // vendor's opinion of the address.
    await createMpPointStore({
      name: 'Café Central',
      streetName: 'Álvaro Obregón',
      streetNumber: '1234',
      cityName: 'Culiacán',
      stateName: 'Sinaloa',
      latitude: 24.809065,
      longitude: -107.393395,
      reference: null,
    });

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect('reference' in body).toBe(true);
    expect(body.reference).toBeNull();
  });

  it('refuses to call anything without a selected merchant', async () => {
    globalThis.window.localStorage = localStorageWith({});

    await expect(getMpPointCredentialStatus()).rejects.toThrow('No hay un negocio seleccionado');
    expect(fetch).not.toHaveBeenCalled();
  });
});
