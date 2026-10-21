import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTestLocale } from '@/test/i18n.jsx';
import { removeMerchantLogo, saveMerchantLogo } from './data.jsx';

// The café logo client, at the WIRE and at the pixel. Two questions: which contract
// route the bytes land on, and whether the picture that leaves the browser is the
// one the API is willing to store. The second is the reason this file exists — the
// edge refuses a request body over 1 MB, so a 4 MB phone photo would die at Caddy
// unless the browser shrinks it first.

const merchantId = '10000000-0000-4000-8000-000000000101';

const CAP = 262_144;
const pathOf = (call) => new URL(call[0], 'http://local').pathname;
const bodyOf = (call) => JSON.parse(call[1].body);

/**
 * A canvas that reports the plane it was given, without a real rasteriser. `blob`
 * is handed the type the client asked for, the way a real `toBlob` is.
 */
function canvasStub(blob) {
  const canvas = {
    width: 0,
    height: 0,
    drawn: null,
    getContext: () => ({ drawImage: (_image, ...args) => (canvas.drawn = args) }),
    toBlob: (callback, type) => callback(blob(canvas, type)),
  };
  return canvas;
}

function installDom({ png } = {}) {
  globalThis.window = {
    localStorage: {
      getItem: vi.fn((key) => (key === 'umi-dashboard-selected-merchant' ? merchantId : null)),
    },
  };
  globalThis.document = { cookie: '', createElement: vi.fn(() => canvasStub(png)) };
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  // jsdom is not the environment here: the two browser APIs the client leans on
  // are stubbed the way every other data spec stubs the DOM.
  globalThis.FileReader = class {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        const bytes = [...new Uint8Array(buffer)];
        this.result = `data:;base64,${btoa(String.fromCharCode(...bytes))}`;
        this.onload();
      });
    }
  };
}

function file(type, name) {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  return { type, name, arrayBuffer: async () => bytes.buffer };
}

describe('the café logo client', () => {
  beforeEach(() => {
    activateTestLocale('es');
    vi.unstubAllGlobals();
  });

  it('sends the removal to the route table’s branding URL', async () => {
    installDom();

    await removeMerchantLogo();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(pathOf(fetch.mock.calls[0])).toBe(`/api/merchants/${merchantId}/branding/logo`);
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('refuses a file that is not a PNG, JPG or SVG before anything leaves the browser', async () => {
    installDom();

    await expect(saveMerchantLogo(file('image/gif', 'logo.gif'))).rejects.toThrow(
      /PNG, JPG o SVG/,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fits the picture in 768 px, keeps it a PNG, and PUTs it to the branding URL', async () => {
    installDom({ png: () => new Blob([new Uint8Array(1200)], { type: 'image/png' }) });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2400, height: 1200 })),
    );

    await saveMerchantLogo(file('image/png', 'logo.png'));

    const canvas = document.createElement.mock.results[0].value;
    expect([canvas.width, canvas.height]).toEqual([768, 384]);
    expect(canvas.drawn).toEqual([0, 0, 768, 384]);
    const call = fetch.mock.calls[0];
    expect(pathOf(call)).toBe(`/api/merchants/${merchantId}/branding/logo`);
    expect(call[1].method).toBe('PUT');
    expect(bodyOf(call).contentType).toBe('image/png');
    expect(bodyOf(call).dataBase64.length).toBeGreaterThan(0);
  });

  it('falls back to JPEG when the PNG would not fit under the cap the API enforces', async () => {
    installDom({
      png: (_canvas, type) =>
        type === 'image/png'
          ? new Blob([new Uint8Array(CAP + 1)], { type: 'image/png' })
          : new Blob([new Uint8Array(10)], { type: 'image/jpeg' }),
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 800 })),
    );

    await saveMerchantLogo(file('image/jpeg', 'photo.jpg'));

    expect(bodyOf(fetch.mock.calls[0]).contentType).toBe('image/jpeg');
  });
});
