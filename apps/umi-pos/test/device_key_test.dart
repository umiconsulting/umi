import 'dart:convert';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/security/device_key.dart';

import 'support/fakes.dart';

Future<bool> _verify(String payload, String signatureB64, String publicKeyB64) {
  return Ed25519().verify(
    utf8.encode(payload),
    signature: Signature(
      base64Url.decode(signatureB64),
      publicKey: SimplePublicKey(
        base64Url.decode(publicKeyB64),
        type: KeyPairType.ed25519,
      ),
    ),
  );
}

void main() {
  test('the device public key is stable across calls', () async {
    final key = SoftwareDeviceKey(MemorySecureStorage());
    final first = await key.ensurePublicKey();
    final second = await key.ensurePublicKey();
    expect(first, isNotEmpty);
    expect(first, second);
  });

  test('a fresh store yields a different device key', () async {
    final one = await SoftwareDeviceKey(MemorySecureStorage()).ensurePublicKey();
    final two = await SoftwareDeviceKey(MemorySecureStorage()).ensurePublicKey();
    expect(one, isNot(two));
  });

  test('a signature verifies against the device public key', () async {
    final key = SoftwareDeviceKey(MemorySecureStorage());
    final publicKeyB64 = await key.ensurePublicKey();
    final payload = utf8.encode('pos/pin-login|2026-09-03T00:00:00Z');
    final signatureB64 = await key.sign(payload);

    final verified = await Ed25519().verify(
      payload,
      signature: Signature(
        base64Url.decode(signatureB64),
        publicKey: SimplePublicKey(
          base64Url.decode(publicKeyB64),
          type: KeyPairType.ed25519,
        ),
      ),
    );
    expect(verified, isTrue);
  });

  test('a tampered payload fails verification', () async {
    final key = SoftwareDeviceKey(MemorySecureStorage());
    final publicKeyB64 = await key.ensurePublicKey();
    final signatureB64 = await key.sign(utf8.encode('original payload'));

    final verified = await _verify(
      'tampered payload',
      signatureB64,
      publicKeyB64,
    );
    expect(verified, isFalse);
  });

  test('proving credentials add a verifiable device proof', () async {
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: 'device-1',
      publicId: 'public-1',
      credential: 'bearer-secret',
      credentialVersion: 1,
      state: 'active',
      merchantId: 'merchant-1',
      locationId: 'location-1',
    );
    final deviceKey = SoftwareDeviceKey(storage);
    final publicKeyB64 = await deviceKey.ensurePublicKey();
    final provider = ProvingDeviceCredentials(
      vault,
      deviceKey,
      clock: () => DateTime.utc(2026, 9, 3, 12),
    );

    final headers = await provider.deviceHeaders();

    final installationId = headers['x-umi-installation-id']!;
    final timestamp = headers['x-umi-device-proof-ts']!;
    expect(timestamp, '2026-09-03T12:00:00.000Z');
    expect(headers['x-umi-device-credential'], 'bearer-secret');
    expect(headers['x-umi-device-proof-alg'], 'ed25519');
    final verified = await _verify(
      deviceProofPayload(installationId, timestamp),
      headers['x-umi-device-proof']!,
      publicKeyB64,
    );
    expect(verified, isTrue);
  });

  test('proving credentials announce the key algorithm (es256 seam)', () async {
    // A hardware key (Secure Enclave / Keystore / TPM) signs es256. The proof
    // header must carry that algorithm so the server picks the es256 verifier;
    // the seam is algorithm-generic and needs no real hardware to prove.
    final storage = MemorySecureStorage();
    final vault = CredentialVault(storage);
    await vault.saveDevice(
      id: 'device-1',
      publicId: 'public-1',
      credential: 'bearer-secret',
      credentialVersion: 1,
      state: 'active',
      merchantId: 'merchant-1',
      locationId: 'location-1',
    );
    final provider = ProvingDeviceCredentials(
      vault,
      _FakeEs256Key(),
      clock: () => DateTime.utc(2026, 9, 3, 12),
    );

    final headers = await provider.deviceHeaders();

    expect(headers['x-umi-device-proof-alg'], 'es256');
    expect(headers['x-umi-device-proof'], 'es256-signature');
    expect(headers['x-umi-device-proof-ts'], '2026-09-03T12:00:00.000Z');
  });

  test('proving credentials add no proof when not enrolled', () async {
    final storage = MemorySecureStorage();
    final provider = ProvingDeviceCredentials(
      CredentialVault(storage),
      SoftwareDeviceKey(storage),
    );

    expect(await provider.deviceHeaders(), isEmpty);
  });
}

/// A stand-in hardware key: it reports es256 and returns fixed bytes, so the
/// header seam can be proven without a Secure Enclave / Keystore / TPM present.
final class _FakeEs256Key implements DeviceKey {
  @override
  String get algorithm => 'es256';

  @override
  Future<String> ensurePublicKey() async => 'es256-public-key';

  @override
  Future<String> sign(List<int> payload) async => 'es256-signature';
}
