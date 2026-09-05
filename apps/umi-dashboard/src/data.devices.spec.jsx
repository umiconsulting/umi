import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvePosEnrollmentRequest,
  createPosEnrollmentRequest,
  denyPosEnrollmentRequest,
  getPosDevices,
  getPosEnrollmentRequests,
  revokePosDevice,
  updatePosDevice,
} from './data.jsx';

const merchantId = '1860305f-e864-d745-29e6-fb8830926cc6';
const requestId = 'b59fc6df-45f6-43e4-ad04-24819999fe29';
const deviceId = '322410ce-551f-44a0-804f-278203b1ba01';

function localStorageWith(values) {
  const entries = new Map(Object.entries(values));
  return {
    getItem: vi.fn((key) => entries.get(key) || null),
    setItem: vi.fn((key, value) => entries.set(key, value)),
    removeItem: vi.fn((key) => entries.delete(key)),
  };
}

describe('UmiPOS enrollment data client', () => {
  beforeEach(() => {
    globalThis.window = {
      localStorage: localStorageWith({
        'umi-dashboard-selected-merchant': merchantId,
      }),
    };
    globalThis.document = { cookie: '' };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
  });

  it('creates an enrollment for the selected merchant and location', async () => {
    await createPosEnrollmentRequest({
      locationId: '758c505d-5559-e877-bd01-9d5a41ffa9b4',
      displayName: 'Caja principal',
      type: 'pos_terminal',
      platform: 'web',
      idempotencyKey: '38f9cfe6-4777-4e3c-b7bc-fe16522b3024',
    });

    expect(fetch.mock.calls[0][0]).toMatch(
      new RegExp(`/api/v1/merchants/${merchantId}/devices/enrollment$`),
    );
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      locationId: '758c505d-5559-e877-bd01-9d5a41ffa9b4',
    });
  });

  it('uses contract routes for list, approve, and deny', async () => {
    await getPosEnrollmentRequests();
    await approvePosEnrollmentRequest(requestId);
    await denyPosEnrollmentRequest(requestId);

    expect(fetch.mock.calls.map(([url]) => new URL(url, 'http://local').pathname)).toEqual([
      `/api/v1/merchants/${merchantId}/devices/enrollment-requests`,
      `/api/v1/merchants/${merchantId}/devices/enrollment-requests/${requestId}/approve`,
      `/api/v1/merchants/${merchantId}/devices/enrollment-requests/${requestId}/deny`,
    ]);
  });

  it('reads the enrolled terminals from the device route, not the request route', async () => {
    await getPosDevices('758c505d-5559-e877-bd01-9d5a41ffa9b4');

    const url = new URL(fetch.mock.calls[0][0], 'http://local');
    expect(url.pathname).toBe(`/api/v1/merchants/${merchantId}/devices`);
    expect(url.searchParams.get('locationId')).toBe('758c505d-5559-e877-bd01-9d5a41ffa9b4');
  });

  it('renames a terminal and restates its floor use in one PATCH', async () => {
    await updatePosDevice(deviceId, { displayName: 'Caja 2', mobility: 'mobile' });

    expect(new URL(fetch.mock.calls[0][0], 'http://local').pathname).toBe(
      `/api/v1/merchants/${merchantId}/devices/${deviceId}`,
    );
    expect(fetch.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'PATCH' }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      displayName: 'Caja 2',
      mobility: 'mobile',
    });
  });

  it('revokes a terminal with its own idempotency key', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      'b0f8e0a2-9a1e-4c3e-9c1a-0d7d7a5f7f11',
    );

    await revokePosDevice(deviceId, 'removed_from_dashboard');

    expect(new URL(fetch.mock.calls[0][0], 'http://local').pathname).toBe(
      `/api/v1/merchants/${merchantId}/devices/${deviceId}/revoke`,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      idempotencyKey: 'b0f8e0a2-9a1e-4c3e-9c1a-0d7d7a5f7f11',
      reason: 'removed_from_dashboard',
    });
  });
});
