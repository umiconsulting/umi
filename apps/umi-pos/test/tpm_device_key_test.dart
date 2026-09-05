import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/security/device_key.dart';
import 'package:umi_pos/core/security/tpm_device_key.dart';

import 'support/fakes.dart';

// Recorded from a real TPM 2.0: an ECDSA P-256 signing key generated inside the
// TPM. `realPem` is its SPKI public key; `realDerSig` is a `tpm2_sign` output
// (ASN.1 DER, as this tpm2-tools build emits even for `-f plain`). These let the
// pure format logic be proven against genuine TPM bytes with no TPM present.
const realPem = '''
-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERyjjpDqJCLqN4T0dg20/GQDVy9jk
La0rvJKaXW+hexCoWTuc7ZYNzrp70wVcnCyuBmKZBxhs0Gua81mnK0kTnA==
-----END PUBLIC KEY-----''';

final realDerSig = base64.decode(
  'MEUCIEpqGOLFCh+idJRMhUt+gAddmUTiYXtKiYgClH9DJDLPAiEA'
  'y2lRfrWytcgQSmFf3vQw1PZogpkpl2Q/p4HcCA8Wzvc=',
);

// The 91-byte SPKI DER (the PEM body) and the 64-byte raw r‖s the server needs,
// computed independently (openssl / node) from the fixtures above.
final expectedSpkiDer = base64.decode(
  'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERyjjpDqJCLqN4T0dg20/GQDVy9jk'
  'La0rvJKaXW+hexCoWTuc7ZYNzrp70wVcnCyuBmKZBxhs0Gua81mnK0kTnA==',
);
final expectedRawSig = _b64url(
  'SmoY4sUKH6J0lEyFS36AB12ZROJhe0qJiAKUf0MkMs_LaVF-tbK1yBBKYV_e9DDU9miCmSmXZD-ngdwIDxbO9w',
);

List<int> _b64url(String s) =>
    base64Url.decode(s + '=' * ((4 - s.length % 4) % 4));

final class _FakeTpmBackend implements TpmBackend {
  _FakeTpmBackend(this.pem, this.der);
  final String pem;
  final List<int> der;
  @override
  Future<String> ensureKeyPublicKeyPem() async => pem;
  @override
  Future<List<int>> signToDer(List<int> message) async => der;
}

void main() {
  test('a TPM device key reports es256', () {
    expect(TpmDeviceKey(_FakeTpmBackend(realPem, realDerSig)).algorithm, 'es256');
  });

  test('it exposes the TPM public key as base64url SPKI DER', () async {
    final key = TpmDeviceKey(_FakeTpmBackend(realPem, realDerSig));
    final publicKeyB64Url = await key.ensurePublicKey();
    final der = base64Url.decode(publicKeyB64Url);
    expect(der.length, 91, reason: 'P-256 SPKI is 91 bytes');
    expect(der[0], 0x30, reason: 'DER SEQUENCE');
    expect(der, expectedSpkiDer);
  });

  test('it normalizes the TPM DER signature to 64-byte raw r‖s', () async {
    final key = TpmDeviceKey(_FakeTpmBackend(realPem, realDerSig));
    final signatureB64Url = await key.sign(utf8.encode('any payload'));
    final raw = base64Url.decode(signatureB64Url);
    expect(raw.length, 64, reason: 'the server requires a 64-byte signature');
    expect(raw, expectedRawSig);
  });

  test('an already-raw 64-byte signature passes through unchanged', () async {
    final raw = List<int>.generate(64, (i) => (i * 7) % 256);
    final key = TpmDeviceKey(_FakeTpmBackend(realPem, raw));
    final out = base64Url.decode(await key.sign(utf8.encode('x')));
    expect(out, raw);
  });

  test('the TPM key drives the proof headers with the es256 algorithm', () async {
    // The whole client path: a real TPM public key and signature travel through
    // ProvingDeviceCredentials, announcing es256 so the server picks the right
    // verifier — the same seam a software Ed25519 key uses.
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
      TpmDeviceKey(_FakeTpmBackend(realPem, realDerSig)),
      clock: () => DateTime.utc(2026, 9, 3, 12),
    );

    final headers = await provider.deviceHeaders();

    expect(headers['x-umi-device-proof-alg'], 'es256');
    expect(base64Url.decode(headers['x-umi-device-proof']!).length, 64);
    expect(headers['x-umi-device-proof-ts'], '2026-09-03T12:00:00.000Z');
  });
}
