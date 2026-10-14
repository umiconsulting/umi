import 'dart:convert';
import 'dart:math';

import 'package:cryptography/cryptography.dart';
import 'package:umi_contract/umi_contract.dart' show UmiRoutes;

import '../network/api_client.dart';
import '../storage/storage.dart';

/// A device-bound signing key. The device proves it holds this key on the
/// requests that matter (pairing, PIN login, refresh), so a stolen bearer
/// credential is useless without the key.
///
/// This interface is the seam for hardware backing. [SoftwareDeviceKey] keeps
/// the key in secure storage today; a Secure Enclave, Android Keystore, or TPM
/// implementation replaces it per platform behind the same two methods, without
/// touching the callers.
abstract interface class DeviceKey {
  /// Ensures a key pair exists and returns its public key, base64url-encoded.
  /// Stable for the life of the install; a caller may send it at pairing.
  Future<String> ensurePublicKey();

  /// Signs [payload] with the device private key and returns the signature,
  /// base64url-encoded.
  Future<String> sign(List<int> payload);

  /// The signature algorithm this key uses: `ed25519` for the software key,
  /// `es256` (ECDSA P-256) for the hardware keystores (Secure Enclave, Android
  /// Keystore, TPM). The client sends this as `x-umi-device-proof-alg` so the
  /// server selects the matching verifier and reads the registered public key
  /// in the matching format. A hardware backing changes only this value and the
  /// key/signature bytes; the callers stay the same.
  String get algorithm;
}

/// Ed25519 device key whose 32-byte seed lives in secure storage. This is the
/// baseline that runs on every platform, including the Linux desktop build. It
/// is not a hardware boundary: the seed is readable by code that can read
/// secure storage. Hardware implementations supersede it where available.
final class SoftwareDeviceKey implements DeviceKey {
  SoftwareDeviceKey(this._storage, {Ed25519? algorithm})
    : _algorithm = algorithm ?? Ed25519();

  final SecureKeyValueStorage _storage;
  final Ed25519 _algorithm;

  static const _seedKey = 'device.key_seed';

  /// The key pair, derived once. The seed is stable for the life of the
  /// install — nothing deletes `device.key_seed`, not even `clearDeviceTrust` —
  /// so re-reading secure storage and re-deriving the pair on every signed
  /// request bought nothing and cost a keystore read each time.
  Future<SimpleKeyPair>? _keyPairCache;

  @override
  String get algorithm => 'ed25519';

  Future<List<int>> _seed() async {
    final existing = await _storage.read(_seedKey);
    if (existing != null) return base64Url.decode(existing);
    final random = Random.secure();
    final seed = List<int>.generate(32, (_) => random.nextInt(256));
    await _storage.write(_seedKey, base64Url.encode(seed));
    return seed;
  }

  Future<SimpleKeyPair> _keyPair() {
    final cached = _keyPairCache;
    if (cached != null) return cached;
    // A derivation that failed is not cached: the next signed request retries
    // instead of replaying one failure forever.
    return _keyPairCache = _deriveKeyPair().onError<Object>((error, stack) {
      _keyPairCache = null;
      throw error;
    });
  }

  Future<SimpleKeyPair> _deriveKeyPair() async =>
      _algorithm.newKeyPairFromSeed(await _seed());

  @override
  Future<String> ensurePublicKey() async {
    final publicKey = await (await _keyPair()).extractPublicKey();
    return base64Url.encode(publicKey.bytes);
  }

  @override
  Future<String> sign(List<int> payload) async {
    final signature = await _algorithm.sign(
      payload,
      keyPair: await _keyPair(),
    );
    return base64Url.encode(signature.bytes);
  }
}

/// The canonical string a device signs to prove key possession on a request:
/// its installation id joined to a timestamp. The server rebuilds the same
/// string from the headers and verifies the signature against the registered
/// public key, then checks the timestamp is fresh.
String deviceProofPayload(String installationId, String timestampIso) =>
    '$installationId|$timestampIso';

/// Wraps another [DeviceCredentialProvider] and adds a fresh device-possession
/// proof to every enrolled request. The bearer credential travels as before;
/// the proof is what a stolen credential cannot reproduce without the key.
///
/// Headers added: `x-umi-device-proof` (base64url signature),
/// `x-umi-device-proof-ts` (the signed ISO-8601 UTC timestamp), and
/// `x-umi-device-proof-alg` (the key's signature algorithm, so the server picks
/// the matching verifier — `ed25519` today, `es256` for a hardware key).
final class ProvingDeviceCredentials implements DeviceCredentialProvider {
  ProvingDeviceCredentials(this._inner, this._deviceKey, {DateTime Function()? clock})
    : _clock = clock ?? (() => DateTime.now().toUtc());

  final DeviceCredentialProvider _inner;
  final DeviceKey _deviceKey;
  final DateTime Function() _clock;

  /// Whether the server verifies a possession proof on this route.
  ///
  /// TWO ROUTES, and they are the whole list: the API reads
  /// `x-umi-device-proof` in `PosAuthController.pinLogin` and `.refresh`
  /// (`apps/umi-api/src/modules/auth/auth.controller.ts`) and nowhere else. The
  /// names come from the contract, so a route rename cannot drift here in
  /// silence.
  ///
  /// WHY IT MATTERS. Signing is two Ed25519 scalar multiplications in pure
  /// Dart. On the pilot till every request paid them, and the poll loop makes
  /// dozens of requests a minute: the profile showed the till spending about
  /// half its CPU inside `Ed25519.sign`, with the UI starved. A proof the
  /// server never reads protects nothing.
  static bool requiresProof(String? path) =>
      path == UmiRoutes.posPinLogin || path == UmiRoutes.posRefresh;

  @override
  Future<Map<String, String>> deviceHeaders({String? path}) async {
    final base = await _inner.deviceHeaders(path: path);
    final installationId = base['x-umi-installation-id'];
    // No installation id means the device is not enrolled; nothing to prove.
    if (installationId == null) return base;
    if (!requiresProof(path)) return base;
    final timestamp = _clock().toUtc().toIso8601String();
    final proof = await _deviceKey.sign(
      utf8.encode(deviceProofPayload(installationId, timestamp)),
    );
    return {
      ...base,
      'x-umi-device-proof': proof,
      'x-umi-device-proof-ts': timestamp,
      'x-umi-device-proof-alg': _deviceKey.algorithm,
    };
  }
}
