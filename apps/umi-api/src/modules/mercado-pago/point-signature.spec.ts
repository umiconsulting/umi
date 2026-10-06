import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  POINT_SIGNATURE_TOLERANCE_MS,
  pointSignatureManifest,
  verifyPointSignature,
} from './point-signature';

/**
 * The vendor's own worked example carries no published secret —
 * `X-Signature: ts=1742505638683,v1=ced36ab6…` (research note 02 §2.1) cannot be
 * reproduced — so every expected HMAC below is computed here with an INDEPENDENT
 * `createHmac` call over a manifest written out in full, never by calling the
 * function under test to produce its own expected value.
 */
const SECRET = 'umipos-point-panel-secret';

// 2025-03-20T18:40:38.683Z — the `ts` of the vendor's Point example, 13 digits.
const TS_MS = '1742505638683';
const TS_SECONDS = '1742505638'; // the same instant, 10 digits: the general page's shape
const ID_UPPERCASE = 'ORD01JQ4S4KY8HWQ6NA5PXB65B3D3';
const ID = 'ord01jq4s4ky8hwq6na5pxb65b3d3';
const REQUEST_ID = '2066ca19-c6f1-498a-be75-1923005edd06';

const INSTANT_MS = 1742505638683;

const v1Of = (manifest: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(manifest).digest('hex');

const signatureHeader = (ts: string, v1: string): string => `ts=${ts},v1=${v1}`;

describe('pointSignatureManifest', () => {
  it('renders the documented shape when both routing values are present', () => {
    expect(pointSignatureManifest({ dataId: ID_UPPERCASE, requestId: REQUEST_ID, ts: TS_MS })).toBe(
      `id:${ID};request-id:${REQUEST_ID};ts:${TS_MS};`,
    );
  });

  it('omits the request-id part when the header is absent (shape 2 of 3)', () => {
    expect(pointSignatureManifest({ dataId: ID_UPPERCASE, requestId: null, ts: TS_MS })).toBe(
      `id:${ID};ts:${TS_MS};`,
    );
  });

  it('omits the id part when data.id is absent (shape 3 of 3)', () => {
    expect(pointSignatureManifest({ dataId: undefined, requestId: REQUEST_ID, ts: TS_MS })).toBe(
      `request-id:${REQUEST_ID};ts:${TS_MS};`,
    );
  });

  it('lowercases an uppercase order id before it enters the manifest', () => {
    const manifest = pointSignatureManifest({ dataId: ID_UPPERCASE, requestId: null, ts: TS_MS });
    expect(manifest).toContain(`id:${ID};`);
    expect(manifest).not.toContain(ID_UPPERCASE);
  });

  it('always keeps the trailing semicolon, in every shape', () => {
    const shapes = [
      pointSignatureManifest({ dataId: ID, requestId: REQUEST_ID, ts: TS_MS }),
      pointSignatureManifest({ dataId: ID, requestId: null, ts: TS_MS }),
      pointSignatureManifest({ dataId: null, requestId: REQUEST_ID, ts: TS_MS }),
    ];
    for (const shape of shapes) expect(shape.endsWith(';')).toBe(true);
  });
});

describe('verifyPointSignature', () => {
  it('accepts a notification signed over the documented manifest', () => {
    const manifest = `id:${ID};request-id:${REQUEST_ID};ts:${TS_MS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, v1Of(manifest)),
      requestId: REQUEST_ID,
      dataId: ID_UPPERCASE,
      secret: SECRET,
      now: new Date(INSTANT_MS),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('accepts a 13-digit millisecond ts inside the window', () => {
    const manifest = `id:${ID};ts:${TS_MS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, v1Of(manifest)),
      requestId: null,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS + POINT_SIGNATURE_TOLERANCE_MS),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('accepts a 10-digit seconds ts inside the window', () => {
    const manifest = `id:${ID};request-id:${REQUEST_ID};ts:${TS_SECONDS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_SECONDS, v1Of(manifest)),
      requestId: REQUEST_ID,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('accepts the request-id-less shape', () => {
    const manifest = `id:${ID};ts:${TS_MS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, v1Of(manifest)),
      requestId: undefined,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS),
    });
    expect(verdict).toEqual({ ok: true });
  });

  it('rejects a ts one millisecond past the tolerance as stale', () => {
    const manifest = `id:${ID};ts:${TS_MS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, v1Of(manifest)),
      requestId: null,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS + POINT_SIGNATURE_TOLERANCE_MS + 1),
    });
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a 16-minute-old notification as stale even with a valid HMAC', () => {
    const manifest = `id:${ID};request-id:${REQUEST_ID};ts:${TS_SECONDS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_SECONDS, v1Of(manifest)),
      requestId: REQUEST_ID,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS + 16 * 60 * 1000),
    });
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects a ts far in the future as stale', () => {
    const manifest = `id:${ID};ts:${TS_MS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, v1Of(manifest)),
      requestId: null,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS - 60 * 60 * 1000),
    });
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('reports a tampered v1 as a mismatch', () => {
    const manifest = `id:${ID};request-id:${REQUEST_ID};ts:${TS_MS};`;
    const v1 = v1Of(manifest);
    const tampered = `${v1.slice(0, -1)}${v1.endsWith('a') ? 'b' : 'a'}`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, tampered),
      requestId: REQUEST_ID,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS),
    });
    expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('reports a wrong secret as a mismatch', () => {
    const manifest = `id:${ID};ts:${TS_MS};`;
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, v1Of(manifest, 'some-other-secret')),
      requestId: null,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS),
    });
    expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('reports a short v1 as a mismatch instead of throwing on the length check', () => {
    const verdict = verifyPointSignature({
      signatureHeader: signatureHeader(TS_MS, 'abc123'),
      requestId: REQUEST_ID,
      dataId: ID,
      secret: SECRET,
      now: new Date(INSTANT_MS),
    });
    expect(verdict).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('fails closed with missing_secret when the panel secret is not configured', () => {
    const manifest = `id:${ID};ts:${TS_MS};`;
    for (const secret of [undefined, null, '']) {
      const verdict = verifyPointSignature({
        signatureHeader: signatureHeader(TS_MS, v1Of(manifest)),
        requestId: null,
        dataId: ID,
        secret,
        now: new Date(INSTANT_MS),
      });
      expect(verdict).toEqual({ ok: false, reason: 'missing_secret' });
    }
  });

  it('rejects a request with no x-signature header', () => {
    for (const signatureHeader of [undefined, null, '']) {
      const verdict = verifyPointSignature({
        signatureHeader,
        requestId: REQUEST_ID,
        dataId: ID,
        secret: SECRET,
        now: new Date(INSTANT_MS),
      });
      expect(verdict).toEqual({ ok: false, reason: 'missing_signature' });
    }
  });

  it('rejects a header with no ts/v1 pair as malformed', () => {
    for (const header of [
      'garbage',
      `ts=${TS_MS}`,
      `v1=${'a'.repeat(64)}`,
      'ts=,v1=',
      'ts=abc,v1=def',
    ]) {
      const verdict = verifyPointSignature({
        signatureHeader: header,
        requestId: REQUEST_ID,
        dataId: ID,
        secret: SECRET,
        now: new Date(INSTANT_MS),
      });
      expect(verdict).toEqual({ ok: false, reason: 'malformed_signature' });
    }
  });

  it('documents the 15-minute window as a deliberate, vendor-unspecified choice', () => {
    expect(POINT_SIGNATURE_TOLERANCE_MS).toBe(15 * 60 * 1000);
  });
});
