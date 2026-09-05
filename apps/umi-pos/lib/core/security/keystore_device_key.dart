import 'package:flutter/services.dart';

import 'device_key.dart';
import 'es256_encoding.dart';

/// The native keystore operations a [KeystoreDeviceKey] needs, behind an
/// interface so the Dart logic is testable without a device. The real
/// implementation ([MethodChannelKeystore]) talks to the platform's hardware
/// keystore (Android Keystore, iOS Secure Enclave) over a MethodChannel; tests
/// inject a fake with recorded output.
abstract interface class HardwareKeystore {
  /// Ensures a device signing key exists in the platform keystore and returns
  /// its public key — as SPKI DER bytes, or a PEM string. [KeystoreDeviceKey]
  /// accepts either.
  Future<Object> ensurePublicKey();

  /// Signs [message] (the platform hashes it with SHA-256) and returns the
  /// ECDSA signature as DER or raw r‖s bytes.
  Future<List<int>> sign(List<int> message);
}

/// A hardware-backed [DeviceKey] for mobile: the private key is generated inside
/// the platform keystore (Android Keystore / iOS Secure Enclave) and never
/// leaves it. Like [TpmDeviceKey] it produces `es256` proofs and reuses the same
/// wire encoding, so the server accepts its output with no change. Only the
/// key's home differs.
final class KeystoreDeviceKey implements DeviceKey {
  KeystoreDeviceKey(this._keystore);

  final HardwareKeystore _keystore;

  @override
  String get algorithm => 'es256';

  @override
  Future<String> ensurePublicKey() async =>
      spkiPublicKeyToB64Url(await _keystore.ensurePublicKey());

  @override
  Future<String> sign(List<int> payload) async =>
      ecdsaSignatureToRawB64Url(await _keystore.sign(payload));
}

/// Talks to the native side over a MethodChannel. The native handlers live in
/// `android/` (Kotlin, Android Keystore) and `ios/` (Swift, Secure Enclave).
/// Importing `flutter/services` is web-safe (no `dart:io`); the channel simply
/// has no handler off mobile, which is fine because this key is opt-in and
/// mobile-only.
final class MethodChannelKeystore implements HardwareKeystore {
  MethodChannelKeystore([MethodChannel? channel])
    : _channel =
          channel ??
          const MethodChannel('co.umiconsulting.umi_pos/device_key');

  final MethodChannel _channel;

  @override
  Future<Object> ensurePublicKey() async {
    final publicKey = await _channel.invokeMethod<Uint8List>(
      'ensurePublicKey',
    );
    if (publicKey == null) {
      throw StateError('the keystore returned no public key');
    }
    return publicKey; // SPKI DER bytes
  }

  @override
  Future<List<int>> sign(List<int> message) async {
    final signature = await _channel.invokeMethod<Uint8List>('sign', {
      'message': Uint8List.fromList(message),
    });
    if (signature == null) {
      throw StateError('the keystore returned no signature');
    }
    return signature;
  }
}
