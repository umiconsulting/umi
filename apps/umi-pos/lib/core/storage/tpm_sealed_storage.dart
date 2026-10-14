import 'dart:convert';

import 'storage.dart';

/// A trust anchor that seals a named blob and persists the sealed bytes.
///
/// The Linux backend drives `systemd-creds`, which binds the blob to the host
/// key and to the TPM 2.0. A copied disk image cannot unseal the blob on
/// another machine.
///
/// This interface carries no `dart:io`, so the web build stays clean. The
/// selector in `sealing_backend.dart` picks the real backend or the stub.
abstract interface class SealingBackend {
  /// Seal [plaintext] against the trust anchor and persist it as [name].
  Future<void> store(String name, List<int> plaintext);

  /// Read and unseal the blob [name]. Returns null when the blob is absent.
  Future<List<int>?> load(String name);

  /// Remove the blob [name].
  Future<void> remove(String name);
}

/// Raised when a seal or an unseal operation fails.
final class SealingException implements Exception {
  SealingException(this.message);
  final String message;
  @override
  String toString() => 'SealingException: $message';
}

/// A [SecureKeyValueStorage] whose values live in one sealed blob.
///
/// The vault is a JSON object. Every write seals the whole object again, so the
/// plaintext lives only in memory. This is the counter-terminal path: no
/// prompter appears, no session keyring takes part, and the credential stays
/// bound to the physical device.
final class TpmSealedStorage implements SecureKeyValueStorage {
  TpmSealedStorage(this._backend, {this.blobName = 'umipos.vault'});

  /// The namespace the libsecret path uses, so one key means one thing.
  static const namespace = 'co.umiconsulting.umipos.';

  final SealingBackend _backend;
  final String blobName;

  Map<String, String>? _cache;
  Future<Map<String, String>>? _loading;

  String _key(String key) => '$namespace$key';

  Future<Map<String, String>> _values() {
    final cached = _cache;
    if (cached != null) return Future.value(cached);
    final pending = _loading;
    if (pending != null) return pending;
    // A load that failed is not cached, so the next call tries again.
    return _loading = _load().onError<Object>((error, stack) {
      _loading = null;
      throw error;
    });
  }

  Future<Map<String, String>> _load() async {
    final plaintext = await _backend.load(blobName);
    if (plaintext == null || plaintext.isEmpty) {
      return _cache = <String, String>{};
    }
    final decoded = json.decode(utf8.decode(plaintext));
    if (decoded is! Map) {
      throw SealingException('the sealed vault is not a JSON object');
    }
    return _cache = decoded.map(
      (key, value) => MapEntry(key.toString(), value.toString()),
    );
  }

  Future<void> _save() async {
    final values = _cache ?? const <String, String>{};
    await _backend.store(blobName, utf8.encode(json.encode(values)));
  }

  @override
  Future<String?> read(String key) async => (await _values())[_key(key)];

  @override
  Future<void> write(String key, String value) async {
    final values = await _values();
    values[_key(key)] = value;
    await _save();
  }

  @override
  Future<void> delete(String key) async {
    final values = await _values();
    values.remove(_key(key));
    await _save();
  }

  @override
  Future<void> deleteAll() async {
    _cache = <String, String>{};
    _loading = null;
    await _backend.remove(blobName);
  }

  @override
  Future<StorageHealth> healthCheck() async {
    const probe = 'health_probe';
    try {
      await write(probe, 'available');
      final value = await read(probe);
      await delete(probe);
      return StorageHealth(
        available: value == 'available',
        category: value == 'available' ? 'available' : 'round_trip_failed',
      );
    } catch (_) {
      _cache = null;
      _loading = null;
      return const StorageHealth(
        available: false,
        category: 'secure_storage_unavailable',
      );
    }
  }
}
