import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * The canonical string a device signs to prove it holds its key on a request:
 * its installation id joined to a timestamp. This MUST match the umi-pos client
 * (`deviceProofPayload` in apps/umi-pos/lib/core/security/device_key.dart). If
 * one side changes the join, every proof stops verifying.
 */
export function deviceProofPayload(installationId: string, timestampIso: string): string {
  return `${installationId}|${timestampIso}`;
}

const stripPadding = (value: string): string => value.replace(/=+$/, '');

/**
 * Which key backs the proof. `ed25519` is the software key the current client
 * ships. `es256` (ECDSA P-256, SHA-256) is what every hardware keystore
 * produces — Apple Secure Enclave, Android Keystore, and a TPM — so the server
 * accepts it now, before those backends land on the device.
 */
export type DeviceProofAlgorithm = 'ed25519' | 'es256';

export interface DeviceProof {
  /**
   * The public key the device registered at pairing, base64url. For `ed25519`
   * this is the raw 32-byte key; for `es256` it is the SubjectPublicKeyInfo
   * (SPKI) DER, which is the portable export every keystore can produce.
   */
  publicKeyB64Url: string;
  installationId: string;
  /** The signed timestamp, ISO-8601 UTC, echoed in the request header. */
  timestampIso: string;
  /**
   * The signature over the payload, base64url. For `es256` this is the raw
   * IEEE-P1363 form (r‖s, 64 bytes), as WebCrypto and the platform keystores
   * emit, not DER.
   */
  signatureB64Url: string;
  /** Defaults to `ed25519`. */
  algorithm?: DeviceProofAlgorithm;
}

export interface DeviceProofOptions {
  now?: Date;
  /** How far the signed timestamp may drift from now. Default five minutes. */
  maxSkewMs?: number;
}

/**
 * Verifies an Ed25519 device-possession proof against the registered public key
 * and checks the signed timestamp is fresh. Returns false on any malformed
 * input instead of throwing, so a bad proof is a clean rejection, never a 500.
 *
 * This proves possession of the private key; it does not by itself bind the
 * proof to one HTTP request. The freshness window limits replay.
 */
export function verifyDeviceProof(proof: DeviceProof, options: DeviceProofOptions = {}): boolean {
  const now = options.now ?? new Date();
  const maxSkewMs = options.maxSkewMs ?? 5 * 60_000;

  const timestamp = Date.parse(proof.timestampIso);
  if (Number.isNaN(timestamp)) return false;
  if (Math.abs(now.getTime() - timestamp) > maxSkewMs) return false;

  const algorithm = proof.algorithm ?? 'ed25519';
  const message = Buffer.from(deviceProofPayload(proof.installationId, proof.timestampIso), 'utf8');

  let signature: Buffer;
  try {
    signature = Buffer.from(stripPadding(proof.signatureB64Url), 'base64url');
  } catch {
    return false;
  }

  if (algorithm === 'ed25519') {
    if (signature.length !== 64) return false;
    let key;
    try {
      key = createPublicKey({
        key: {
          kty: 'OKP',
          crv: 'Ed25519',
          x: stripPadding(proof.publicKeyB64Url),
        },
        format: 'jwk',
      });
    } catch {
      return false;
    }
    try {
      return cryptoVerify(null, message, key, signature);
    } catch {
      return false;
    }
  }

  // es256: an ECDSA P-256 key exported as SPKI DER, signature in raw r‖s form.
  if (signature.length !== 64) return false;
  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(stripPadding(proof.publicKeyB64Url), 'base64url'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return false;
  }
  if (key.asymmetricKeyType !== 'ec') return false;
  try {
    return cryptoVerify('sha256', message, { key, dsaEncoding: 'ieee-p1363' }, signature);
  } catch {
    return false;
  }
}
