import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/storage/tpm_sealed_storage.dart';

/// An in-memory trust anchor. The bytes stay readable, so the test can inspect
/// what the vault would seal. A real backend seals with the TPM.
final class _FakeSealingBackend implements SealingBackend {
  final Map<String, List<int>> blobs = {};

  @override
  Future<void> store(String name, List<int> plaintext) async {
    blobs[name] = List<int>.of(plaintext);
  }

  @override
  Future<List<int>?> load(String name) async {
    final value = blobs[name];
    return value == null ? null : List<int>.of(value);
  }

  @override
  Future<void> remove(String name) async => blobs.remove(name);
}

final class _BrokenSealingBackend implements SealingBackend {
  @override
  Future<void> store(String name, List<int> plaintext) async =>
      throw SealingException('no TPM 2.0 here');

  @override
  Future<List<int>?> load(String name) async =>
      throw SealingException('no TPM 2.0 here');

  @override
  Future<void> remove(String name) async {}
}

void main() {
  test('a sealed vault keeps a value across two instances', () async {
    final backend = _FakeSealingBackend();
    await TpmSealedStorage(backend).write('device.credential', 'secret');
    expect(
      await TpmSealedStorage(backend).read('device.credential'),
      'secret',
    );
  });

  test('a fresh vault holds no value', () async {
    final vault = TpmSealedStorage(_FakeSealingBackend());
    expect(await vault.read('device.credential'), isNull);
  });

  test('the vault stores the namespace, not the bare key', () async {
    final backend = _FakeSealingBackend();
    await TpmSealedStorage(backend).write('device.credential', 'secret');
    final sealed = String.fromCharCodes(backend.blobs['umipos.vault']!);
    expect(sealed, contains('co.umiconsulting.umipos.device.credential'));
    expect(sealed, isNot(contains('"device.credential"')));
  });

  test('delete removes one value and keeps the rest', () async {
    final backend = _FakeSealingBackend();
    final vault = TpmSealedStorage(backend);
    await vault.write('a', '1');
    await vault.write('b', '2');
    await vault.delete('a');
    expect(await vault.read('a'), isNull);
    expect(await vault.read('b'), '2');
  });

  test('deleteAll drops the sealed blob itself', () async {
    final backend = _FakeSealingBackend();
    final vault = TpmSealedStorage(backend);
    await vault.write('device.credential', 'secret');
    await vault.deleteAll();
    expect(backend.blobs, isEmpty);
    expect(await vault.read('device.credential'), isNull);
  });

  test('healthCheck reports an available round trip', () async {
    final health = await TpmSealedStorage(_FakeSealingBackend()).healthCheck();
    expect(health.available, isTrue);
    expect(health.category, 'available');
  });

  test('healthCheck fails closed when the trust anchor is absent', () async {
    final health = await TpmSealedStorage(_BrokenSealingBackend()).healthCheck();
    expect(health.available, isFalse);
    expect(health.category, 'secure_storage_unavailable');
  });
}
