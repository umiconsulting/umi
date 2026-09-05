import 'device_key.dart';
import 'es256_encoding.dart';

/// The TPM operations a [TpmDeviceKey] needs, kept behind an interface so the
/// pure format logic below carries no `dart:io` and stays safe for the web
/// build. The real backend ([Tpm2ToolsBackend], in `tpm_backend_io.dart`)
/// drives `tpm2-tools`; tests supply a fake with recorded TPM output.
abstract interface class TpmBackend {
  /// Ensures a persistent device signing key exists in the TPM and returns its
  /// public key as SPKI in PEM form (`-----BEGIN PUBLIC KEY----- ...`).
  Future<String> ensureKeyPublicKeyPem();

  /// Signs [message] with the device key. The TPM hashes [message] with
  /// SHA-256 and returns the ECDSA signature. Some `tpm2-tools` builds return
  /// ASN.1 DER here, others raw r‖s; [TpmDeviceKey] normalizes both.
  Future<List<int>> signToDer(List<int> message);
}

/// Raised when a TPM operation fails.
final class TpmException implements Exception {
  TpmException(this.message);
  final String message;
  @override
  String toString() => 'TpmException: $message';
}

/// A hardware-backed [DeviceKey] whose private key is generated inside a TPM and
/// never leaves it. It produces `es256` (ECDSA P-256) proofs — the algorithm a
/// hardware keystore emits and the server's `es256` verifier accepts.
///
/// This class holds only the pure, platform-independent orchestration; the wire
/// encoding lives in `es256_encoding.dart` (shared with the mobile keystore
/// key), and the `dart:io` subprocess work lives in the backend. So this file
/// compiles on every target, web included.
final class TpmDeviceKey implements DeviceKey {
  TpmDeviceKey(this._backend);

  final TpmBackend _backend;

  @override
  String get algorithm => 'es256';

  @override
  Future<String> ensurePublicKey() async =>
      spkiPublicKeyToB64Url(await _backend.ensureKeyPublicKeyPem());

  @override
  Future<String> sign(List<int> payload) async =>
      ecdsaSignatureToRawB64Url(await _backend.signToDer(payload));
}
