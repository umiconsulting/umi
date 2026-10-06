import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

final class StorageHealth {
  const StorageHealth({required this.available, required this.category});
  final bool available;
  final String category;
}

abstract interface class SecureKeyValueStorage {
  Future<StorageHealth> healthCheck();
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
  Future<void> deleteAll();
}

final class FlutterSecureKeyValueStorage implements SecureKeyValueStorage {
  const FlutterSecureKeyValueStorage({
    FlutterSecureStorage storage = const FlutterSecureStorage(),
  }) : // ignore: prefer_initializing_formals
       _storage = storage;

  static const namespace = 'co.umiconsulting.umipos.';
  final FlutterSecureStorage _storage;

  String _key(String key) => '$namespace$key';

  @override
  Future<StorageHealth> healthCheck() async {
    const probe = 'health_probe';
    try {
      await _storage.write(key: _key(probe), value: 'available');
      final value = await _storage.read(key: _key(probe));
      await _storage.delete(key: _key(probe));
      return StorageHealth(
        available: value == 'available',
        category: value == 'available' ? 'available' : 'round_trip_failed',
      );
    } catch (_) {
      return const StorageHealth(
        available: false,
        category: 'secure_storage_unavailable',
      );
    }
  }

  @override
  Future<String?> read(String key) => _storage.read(key: _key(key));
  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: _key(key), value: value);
  @override
  Future<void> delete(String key) => _storage.delete(key: _key(key));
  @override
  Future<void> deleteAll() => _storage.deleteAll();
}

abstract interface class PreferencesStore {
  Future<String?> readString(String key);
  Future<void> writeString(String key, String value);
  Future<void> delete(String key);
}

final class SharedPreferencesStore implements PreferencesStore {
  const SharedPreferencesStore();
  static const namespace = 'umipos.preference.';

  @override
  Future<String?> readString(String key) async =>
      (await SharedPreferences.getInstance()).getString('$namespace$key');
  @override
  Future<void> writeString(String key, String value) async {
    await (await SharedPreferences.getInstance()).setString(
      '$namespace$key',
      value,
    );
  }

  @override
  Future<void> delete(String key) async {
    await (await SharedPreferences.getInstance()).remove('$namespace$key');
  }
}

abstract interface class LocalDatabase {
  int get schemaVersion;
  Future<StorageHealth> healthCheck();
  Future<void> securelyDelete();
}

final class UnsupportedLocalDatabase implements LocalDatabase {
  const UnsupportedLocalDatabase();
  @override
  int get schemaVersion => 0;
  @override
  Future<StorageHealth> healthCheck() async =>
      const StorageHealth(available: false, category: 'not_configured');
  @override
  Future<void> securelyDelete() async {}
}
