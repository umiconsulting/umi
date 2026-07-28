import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/storage/storage.dart';

const offlineJournalSchemaVersion = 1;
const offlineJournalMaxDepth = 250;

enum JournalStatus {
  pending,
  replaying,
  accepted,
  duplicate,
  conflict,
  archived,
}

final class OfflineJournalException implements Exception {
  const OfflineJournalException(this.category);
  final String category;
  @override
  String toString() => 'OfflineJournalException($category)';
}

final class JournalEntry {
  const JournalEntry({
    required this.command,
    required this.status,
    required this.attempts,
    this.lastReplayAt,
    this.lastSafeErrorCategory,
    this.officialId,
    this.retentionDeadline,
  });
  final OfflineCommand command;
  final JournalStatus status;
  final int attempts;
  final DateTime? lastReplayAt;
  final String? lastSafeErrorCategory;
  final String? officialId;
  final DateTime? retentionDeadline;

  JournalEntry replayed({
    required JournalStatus status,
    String? error,
    String? officialId,
  }) => JournalEntry(
    command: command,
    status: status,
    attempts: attempts + 1,
    lastReplayAt: DateTime.now().toUtc(),
    lastSafeErrorCategory: error,
    officialId: officialId ?? this.officialId,
    retentionDeadline:
        (status == JournalStatus.accepted || status == JournalStatus.duplicate)
        ? DateTime.now().toUtc().add(const Duration(days: 30))
        : retentionDeadline,
  );

  Map<String, Object?> toJson() => {
    'command': command.toJson(),
    'status': status.name,
    'attempts': attempts,
    'lastReplayAt': lastReplayAt?.toIso8601String(),
    'lastSafeErrorCategory': lastSafeErrorCategory,
    'officialId': officialId,
    'retentionDeadline': retentionDeadline?.toIso8601String(),
  };
  factory JournalEntry.fromJson(Map<String, Object?> json) => JournalEntry(
    command: OfflineCommand.fromJson(json['command']! as Map<String, Object?>),
    status: JournalStatus.values.byName(json['status']! as String),
    attempts: json['attempts']! as int,
    lastReplayAt: _date(json['lastReplayAt']),
    lastSafeErrorCategory: json['lastSafeErrorCategory'] as String?,
    officialId: json['officialId'] as String?,
    retentionDeadline: _date(json['retentionDeadline']),
  );
}

DateTime? _date(Object? value) =>
    value == null ? null : DateTime.parse(value as String);

final class OfflineJournalSnapshot {
  const OfflineJournalSnapshot({
    required this.nextSequence,
    required this.lastAcknowledgedSequence,
    required this.entries,
    required this.mappings,
  });
  final int nextSequence;
  final int lastAcknowledgedSequence;
  final List<JournalEntry> entries;
  final Map<String, String> mappings;
  int get pendingCount =>
      entries.where((e) => e.status == JournalStatus.pending).length;
}

abstract interface class JournalCipherStore {
  Future<String?> readCiphertext();
  Future<void> writeCiphertext(String value);
  Future<String?> readKey();
  Future<void> writeKey(String value);
}

final class PlatformJournalCipherStore implements JournalCipherStore {
  PlatformJournalCipherStore(this._preferences, this._secure);
  final PreferencesStore _preferences;
  final SecureKeyValueStorage _secure;
  static const _document = 'offline.journal.v1';
  static const _key = 'offline.journal.key.v1';
  @override
  Future<String?> readCiphertext() => _preferences.readString(_document);
  @override
  Future<void> writeCiphertext(String value) =>
      _preferences.writeString(_document, value);
  @override
  Future<String?> readKey() => _secure.read(_key);
  @override
  Future<void> writeKey(String value) => _secure.write(_key, value);
}

/// Native-only authenticated encrypted, versioned and bounded command journal.
/// The AES key is held by platform secure storage; preferences contain ciphertext only.
final class EncryptedOfflineJournal {
  EncryptedOfflineJournal(this._store, {bool? web}) : _web = web ?? kIsWeb;
  final JournalCipherStore _store;
  final bool _web;
  final _cipher = AesGcm.with256bits();

  Future<OfflineJournalSnapshot> load() async {
    _ensureSupported();
    final encoded = await _store.readCiphertext();
    if (encoded == null) {
      return const OfflineJournalSnapshot(
        nextSequence: 1,
        lastAcknowledgedSequence: 0,
        entries: [],
        mappings: {},
      );
    }
    try {
      final wrapper = jsonDecode(encoded) as Map<String, Object?>;
      if (wrapper['schemaVersion'] != offlineJournalSchemaVersion) {
        throw const OfflineJournalException('schema_version_unsupported');
      }
      final key = await _key(create: false);
      final box = SecretBox(
        base64Decode(wrapper['ciphertext']! as String),
        nonce: base64Decode(wrapper['nonce']! as String),
        mac: Mac(base64Decode(wrapper['mac']! as String)),
      );
      final clear = await _cipher.decrypt(box, secretKey: key);
      final data = jsonDecode(utf8.decode(clear)) as Map<String, Object?>;
      return OfflineJournalSnapshot(
        nextSequence: data['nextSequence']! as int,
        lastAcknowledgedSequence: data['lastAcknowledgedSequence']! as int,
        entries: (data['entries']! as List<Object?>)
            .map((e) => JournalEntry.fromJson(e! as Map<String, Object?>))
            .toList(growable: false),
        mappings: (data['mappings']! as Map<String, Object?>).map(
          (key, value) => MapEntry(key, value! as String),
        ),
      );
    } on OfflineJournalException {
      rethrow;
    } catch (_) {
      throw const OfflineJournalException('journal_integrity_failed');
    }
  }

  Future<OfflineCommand> append({
    required String commandId,
    required String deviceId,
    required int credentialVersion,
    required String tenantId,
    required String branchId,
    required String operatorSessionId,
    required String idempotencyKey,
    required Map<String, Object?> payload,
    String commandType = 'operational.ack',
    String? provisionalId,
  }) async {
    final current = await load();
    if (current.entries
            .where((e) => e.status != JournalStatus.archived)
            .length >=
        offlineJournalMaxDepth) {
      throw const OfflineJournalException('queue_capacity_exceeded');
    }
    if (current.entries.any((entry) => entry.command.commandId == commandId)) {
      throw const OfflineJournalException('duplicate_command');
    }
    if (commandType != 'operational.ack') {
      throw const OfflineJournalException('command_not_offline_eligible');
    }
    final canonical = jsonEncode(_canonical(payload));
    final command = OfflineCommand(
      commandId: commandId,
      provisionalId: provisionalId,
      deviceId: deviceId,
      deviceCredentialVersion: credentialVersion,
      deviceSequence: current.nextSequence,
      tenantId: tenantId,
      branchId: branchId,
      operatorSessionId: operatorSessionId,
      commandType: commandType,
      idempotencyKey: idempotencyKey,
      fingerprint: sha256.convert(utf8.encode(canonical)).toString(),
      contractVersion: contractVersion,
      schemaVersion: offlineJournalSchemaVersion,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      payload: payload,
    );
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence + 1,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: [
          ...current.entries,
          JournalEntry(
            command: command,
            status: JournalStatus.pending,
            attempts: 0,
          ),
        ],
        mappings: current.mappings,
      ),
    );
    return command;
  }

  Future<void> apply(ReplayResult result) async {
    final current = await load();
    final index = current.entries.indexWhere(
      (e) => e.command.commandId == result.commandId,
    );
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final old = current.entries[index];
    final status = switch (result.status) {
      'accepted' => JournalStatus.accepted,
      'duplicate' => JournalStatus.duplicate,
      'conflict' || 'rejected' => JournalStatus.conflict,
      _ => throw const OfflineJournalException('result_status_unknown'),
    };
    final entries = [...current.entries];
    entries[index] = old.replayed(
      status: status,
      error: result.failure?['classification'] as String?,
      officialId: result.officialId,
    );
    final mappings = {...current.mappings};
    if (old.command.provisionalId != null && result.officialId != null) {
      final existing = mappings[old.command.provisionalId];
      if (existing != null && existing != result.officialId) {
        throw const OfflineJournalException('provisional_mapping_conflict');
      }
      mappings[old.command.provisionalId!] = result.officialId!;
    }
    final acknowledged =
        status == JournalStatus.accepted || status == JournalStatus.duplicate
        ? max(current.lastAcknowledgedSequence, result.deviceSequence)
        : current.lastAcknowledgedSequence;
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: acknowledged,
        entries: entries,
        mappings: mappings,
      ),
    );
  }

  Future<void> compact(DateTime now) async {
    final current = await load();
    final retained = current.entries
        .where((entry) {
          if (entry.status == JournalStatus.pending ||
              entry.status == JournalStatus.conflict) {
            return true;
          }
          final deadline = entry.retentionDeadline;
          return deadline == null || deadline.isAfter(now);
        })
        .toList(growable: false);
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: retained,
        mappings: current.mappings,
      ),
    );
  }

  Future<void> _save(OfflineJournalSnapshot snapshot) async {
    _ensureSupported();
    final clear = utf8.encode(
      jsonEncode({
        'nextSequence': snapshot.nextSequence,
        'lastAcknowledgedSequence': snapshot.lastAcknowledgedSequence,
        'entries': snapshot.entries.map((e) => e.toJson()).toList(),
        'mappings': snapshot.mappings,
      }),
    );
    final box = await _cipher.encrypt(
      clear,
      secretKey: await _key(create: true),
    );
    await _store.writeCiphertext(
      jsonEncode({
        'schemaVersion': offlineJournalSchemaVersion,
        'keyVersion': 1,
        'nonce': base64Encode(box.nonce),
        'ciphertext': base64Encode(box.cipherText),
        'mac': base64Encode(box.mac.bytes),
      }),
    );
  }

  Future<SecretKey> _key({required bool create}) async {
    final existing = await _store.readKey();
    if (existing != null) {
      return SecretKey(base64Decode(existing));
    }
    if (!create) {
      throw const OfflineJournalException('encryption_key_unavailable');
    }
    final bytes = List<int>.generate(32, (_) => Random.secure().nextInt(256));
    await _store.writeKey(base64Encode(bytes));
    return SecretKey(bytes);
  }

  void _ensureSupported() {
    if (_web) {
      throw const OfflineJournalException('secure_offline_unsupported_on_web');
    }
  }

  Object? _canonical(Object? value) {
    if (value is Map<String, Object?>) {
      final keys = value.keys.toList()..sort();
      return {for (final key in keys) key: _canonical(value[key])};
    }
    if (value is List<Object?>) return value.map(_canonical).toList();
    return value;
  }
}
