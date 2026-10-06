import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deviceProofPayload, verifyDeviceProof } from './device-proof';

const installationId = '00000000-0000-4000-8000-000000000001';

function signedProof(timestampIso: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const message = Buffer.from(deviceProofPayload(installationId, timestampIso), 'utf8');
  const signature = cryptoSign(null, message, privateKey);
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  return {
    proof: {
      publicKeyB64Url: jwk.x,
      installationId,
      timestampIso,
      signatureB64Url: signature.toString('base64url'),
    },
    now: new Date(timestampIso),
  };
}

// The shape a hardware keystore produces: ECDSA P-256, SHA-256, an SPKI DER
// public key, and a raw r‖s signature.
function es256Proof(timestampIso: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const message = Buffer.from(deviceProofPayload(installationId, timestampIso), 'utf8');
  const signature = cryptoSign('sha256', message, {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return {
    proof: {
      publicKeyB64Url: Buffer.from(spki).toString('base64url'),
      installationId,
      timestampIso,
      signatureB64Url: Buffer.from(signature).toString('base64url'),
      algorithm: 'es256' as const,
    },
    now: new Date(timestampIso),
  };
}

describe('verifyDeviceProof', () => {
  it('accepts a fresh, correctly signed proof', () => {
    const { proof, now } = signedProof('2026-09-03T12:00:00.000Z');
    expect(verifyDeviceProof(proof, { now })).toBe(true);
  });

  it('rejects a proof signed for a different installation id', () => {
    const { proof, now } = signedProof('2026-09-03T12:00:00.000Z');
    expect(verifyDeviceProof({ ...proof, installationId: 'someone-else' }, { now })).toBe(false);
  });

  it('rejects a stale timestamp beyond the skew window', () => {
    const { proof } = signedProof('2026-09-03T12:00:00.000Z');
    const now = new Date('2026-09-03T12:10:00.000Z');
    expect(verifyDeviceProof(proof, { now })).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const { proof, now } = signedProof('2026-09-03T12:00:00.000Z');
    const bytes = Buffer.from(proof.signatureB64Url, 'base64url');
    bytes[0] ^= 0xff;
    expect(
      verifyDeviceProof({ ...proof, signatureB64Url: bytes.toString('base64url') }, { now }),
    ).toBe(false);
  });

  it('rejects the wrong public key', () => {
    const { proof, now } = signedProof('2026-09-03T12:00:00.000Z');
    const other = signedProof('2026-09-03T12:00:00.000Z');
    expect(
      verifyDeviceProof({ ...proof, publicKeyB64Url: other.proof.publicKeyB64Url }, { now }),
    ).toBe(false);
  });

  it('rejects malformed input without throwing', () => {
    const { proof, now } = signedProof('2026-09-03T12:00:00.000Z');
    expect(verifyDeviceProof({ ...proof, publicKeyB64Url: 'not-a-key' }, { now })).toBe(false);
    expect(verifyDeviceProof({ ...proof, timestampIso: 'not-a-date' }, { now })).toBe(false);
  });

  it('accepts a fresh es256 (hardware-keystore) proof', () => {
    const { proof, now } = es256Proof('2026-09-03T12:00:00.000Z');
    expect(verifyDeviceProof(proof, { now })).toBe(true);
  });

  it('rejects a tampered es256 signature', () => {
    const { proof, now } = es256Proof('2026-09-03T12:00:00.000Z');
    const bytes = Buffer.from(proof.signatureB64Url, 'base64url');
    bytes[0] ^= 0xff;
    expect(
      verifyDeviceProof({ ...proof, signatureB64Url: bytes.toString('base64url') }, { now }),
    ).toBe(false);
  });

  it('rejects an es256 key presented as ed25519', () => {
    const { proof, now } = es256Proof('2026-09-03T12:00:00.000Z');
    const { algorithm, ...withoutAlgorithm } = proof;
    void algorithm;
    expect(verifyDeviceProof(withoutAlgorithm, { now })).toBe(false);
  });

  // Cross-language vector: this public key and signature were produced by the
  // umi-pos Dart client (cryptography package, Ed25519) over the shared payload
  // `${installationId}|${timestamp}`. It proves the client and server agree on
  // key format, signature format, and the payload string.
  it('accepts a proof produced by the Dart client', () => {
    const proof = {
      publicKeyB64Url: 'iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=',
      installationId: 'vector-install',
      timestampIso: '2026-09-03T12:00:00.000Z',
      signatureB64Url:
        'dbC2ISONYCoRJtEGtg7Xaw1qHHKRN1Keab5ueOv4JaLmJHbxmOf02Fw6W8kaYg_ao8-XlYHnSRcdhhdlaJGeDw==',
    };
    expect(verifyDeviceProof(proof, { now: new Date('2026-09-03T12:00:00.000Z') })).toBe(true);
  });
});
