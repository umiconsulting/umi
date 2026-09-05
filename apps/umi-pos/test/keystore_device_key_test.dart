import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/security/device_key.dart';
import 'package:umi_pos/core/security/keystore_device_key.dart';

import 'support/fakes.dart';

// Real ES256 material recorded from a hardware-style key (a TPM; an Android
// Keystore / Secure Enclave emit the same shapes): SPKI DER public key and a
// DER ECDSA signature. Proves the mobile client seam without a device.
final realSpkiDer = base64.decode(
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERyjjpDqJCLqN4T0dg20/GQDVy9jk'
  'La0rvJKaXW+hexCoWTuc7ZYNzrp70wVcnCyuBmKZBxhs0Gua81mnK0kTnA==',
);
final realDerSig = base64.decode(
  'MEUCIEpqGOLFCh+idJRMhUt+gAddmUTiYXtKiYgClH9DJDLPAiEA'
  'y2lRfrWytcgQSmFf3vQw1PZogpkpl2Q/p4HcCA8Wzvc=',
);
final expectedRawSig = _b64url(
  'SmoY4sUKH6J0lEyFS36AB12ZROJhe0qJiAKUf0MkMs_LaVF-tbK1yBBKYV_e9DDU9miCmSmXZD-ngdwIDxbO9w',
);

List<int> _b64url(String s) =>
    base64Url.decode(s + '=' * ((4 - s.length % 4) % 4));

final class _FakeKeystore implements HardwareKeystore {
  _FakeKeystore(this.publicKey, this.signature);
  final Object publicKey;
  final List<int> signature;
  @override
  Future<Object> ensurePublicKey() async => publicKey;
  @override
  Future<List<int>> sign(List<int> message) async => signature;
}

void main() {
  test('a keystore device key reports es256', () {
    expect(KeystoreDeviceKey(_FakeKeystore(realSpkiDer, realDerSig)).algorithm,
        'es256');
  });

  test('it encodes SPKI DER bytes from the keystore as base64url', () async {
    final key = KeystoreDeviceKey(_FakeKeystore(realSpkiDer, realDerSig));
    final der = base64Url.decode(await key.ensurePublicKey());
    expect(der.length, 91);
    expect(der, realSpkiDer);
  });

  test('it accepts a PEM public key too', () async {
    const pem = '''
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERyjjpDqJCLqN4T0dg20/GQDVy9jk
La0rvJKaXW+hexCoWTuc7ZYNzrp70wVcnCyuBmKZBxhs0Gua81mnK0kTnA==
-----END PUBLIC KEY-----''';
    final key = KeystoreDeviceKey(_FakeKeystore(pem, realDerSig));
    expect(base64Url.decode(await key.ensurePublicKey()), realSpkiDer);
  });

  test('it normalizes the keystore DER signature to 64-byte raw r‖s', () async {
    final key = KeystoreDeviceKey(_FakeKeystore(realSpkiDer, realDerSig));
    final raw = base64Url.decode(await key.sign(utf8.encode('any payload')));
    expect(raw.length, 64);
    expect(raw, expectedRawSig);
  });

  test('the keystore key drives the proof headers with es256', () async {
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
      KeystoreDeviceKey(_FakeKeystore(realSpkiDer, realDerSig)),
      clock: () => DateTime.utc(2026, 9, 3, 12),
    );

    final headers = await provider.deviceHeaders();

    expect(headers['x-umi-device-proof-alg'], 'es256');
    expect(base64Url.decode(headers['x-umi-device-proof']!).length, 64);
    expect(headers['x-umi-device-proof-ts'], '2026-09-03T12:00:00.000Z');
  });
}
