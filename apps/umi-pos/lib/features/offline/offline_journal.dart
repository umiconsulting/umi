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
  unknown,
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
    this.officialCommit,
    this.failure,
    this.serverConflictReference,
    this.retentionDeadline,
  });
  final OfflineCommand command;
  final JournalStatus status;
  final int attempts;
  final DateTime? lastReplayAt;
  final String? lastSafeErrorCategory;
  final String? officialId;
  final Map<String, Object?>? officialCommit;
  final Map<String, Object?>? failure;
  final String? serverConflictReference;
  final DateTime? retentionDeadline;

  JournalEntry replayed({
    required JournalStatus status,
    String? error,
    String? officialId,
    Map<String, Object?>? officialCommit,
    Map<String, Object?>? failure,
    String? serverConflictReference,
  }) => JournalEntry(
    command: command,
    status: status,
    attempts: attempts + 1,
    lastReplayAt: DateTime.now().toUtc(),
    lastSafeErrorCategory: error,
    officialId: officialId ?? this.officialId,
    officialCommit: officialCommit ?? this.officialCommit,
    failure: failure ?? this.failure,
    serverConflictReference:
        serverConflictReference ?? this.serverConflictReference,
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
    'officialCommit': officialCommit,
    'failure': failure,
    'serverConflictReference': serverConflictReference,
    'retentionDeadline': retentionDeadline?.toIso8601String(),
  };
  factory JournalEntry.fromJson(Map<String, Object?> json) => JournalEntry(
    command: OfflineCommand.fromJson(json['command']! as Map<String, Object?>),
    status: JournalStatus.values.byName(json['status']! as String),
    attempts: json['attempts']! as int,
    lastReplayAt: _date(json['lastReplayAt']),
    lastSafeErrorCategory: json['lastSafeErrorCategory'] as String?,
    officialId: json['officialId'] as String?,
    officialCommit: json['officialCommit'] as Map<String, Object?>?,
    failure: json['failure'] as Map<String, Object?>?,
    serverConflictReference: json['serverConflictReference'] as String?,
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
    this.cachedPolicy,
    this.lastTrustedServerTime,
    this.lastTrustedLocalTime,
  });
  final int nextSequence;
  final int lastAcknowledgedSequence;
  final List<JournalEntry> entries;
  final Map<String, String> mappings;
  final Map<String, Object?>? cachedPolicy;
  final DateTime? lastTrustedServerTime;
  final DateTime? lastTrustedLocalTime;
  int get pendingCount => entries
      .where(
        (e) =>
            e.status == JournalStatus.pending ||
            e.status == JournalStatus.unknown ||
            e.status == JournalStatus.conflict,
      )
      .length;
  Iterable<JournalEntry> get activeCash => entries.where(
    (entry) =>
        entry.command.commandType == 'pos.checkout.cash' &&
        entry.status != JournalStatus.accepted &&
        entry.status != JournalStatus.duplicate &&
        entry.status != JournalStatus.archived,
  );
  int get pendingCashCount => activeCash.length;
  int get pendingCashMinorUnits => activeCash.fold(0, (sum, entry) {
    final snapshot = entry.command.payload['snapshot'];
    if (snapshot is! Map<String, Object?>) return sum;
    return sum + ((snapshot['amountDueMinorUnits'] as num?)?.toInt() ?? 0);
  });
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
  bool _mutating = false;

  Future<OfflineJournalSnapshot> load() async {
    _ensureSupported();
    final encoded = await _store.readCiphertext();
    if (encoded == null) {
      return const OfflineJournalSnapshot(
        nextSequence: 1,
        lastAcknowledgedSequence: 0,
        entries: [],
        mappings: {},
        cachedPolicy: null,
        lastTrustedServerTime: null,
        lastTrustedLocalTime: null,
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
        cachedPolicy: data['cachedPolicy'] as Map<String, Object?>?,
        lastTrustedServerTime: _date(data['lastTrustedServerTime']),
        lastTrustedLocalTime: _date(data['lastTrustedLocalTime']),
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
    if (_mutating) {
      throw const OfflineJournalException('journal_write_in_progress');
    }
    _mutating = true;
    try {
      final current = await load();
      if (commandType != 'operational.ack' &&
          commandType != 'pos.checkout.cash') {
        throw const OfflineJournalException('command_not_offline_eligible');
      }
      final duplicate = current.entries.where(
        (entry) => entry.command.commandId == commandId,
      );
      if (duplicate.isNotEmpty) {
        final existing = duplicate.single.command;
        final same =
            existing.deviceId == deviceId &&
            existing.deviceCredentialVersion == credentialVersion &&
            existing.tenantId == tenantId &&
            existing.branchId == branchId &&
            existing.operatorSessionId == operatorSessionId &&
            existing.commandType == commandType &&
            existing.idempotencyKey == idempotencyKey &&
            existing.provisionalId == provisionalId &&
            jsonEncode(_canonical(existing.payload)) ==
                jsonEncode(_canonical(payload));
        if (same) return existing;
        throw const OfflineJournalException('fingerprint_mismatch');
      }
      final createdAt = DateTime.now().toUtc().toIso8601String();
      final unsigned = OfflineCommand(
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
        fingerprint: List.filled(64, '0').join(),
        contractVersion: contractVersion,
        schemaVersion: offlineJournalSchemaVersion,
        createdAt: createdAt,
        payload: payload,
      ).toJson()..remove('fingerprint');
      final canonical = jsonEncode(_canonical(unsigned));
      final fingerprint = sha256.convert(utf8.encode(canonical)).toString();
      if (current.entries
              .where((e) => e.status != JournalStatus.archived)
              .length >=
          offlineJournalMaxDepth) {
        throw const OfflineJournalException('queue_capacity_exceeded');
      }
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
        fingerprint: fingerprint,
        contractVersion: contractVersion,
        schemaVersion: offlineJournalSchemaVersion,
        createdAt: createdAt,
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
          cachedPolicy: current.cachedPolicy,
          lastTrustedServerTime: current.lastTrustedServerTime,
          lastTrustedLocalTime: current.lastTrustedLocalTime,
        ),
      );
      return command;
    } finally {
      _mutating = false;
    }
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
      officialCommit: result.officialCommit,
      failure: result.failure,
      serverConflictReference: result.serverConflictReference,
    );
    final mappings = {...current.mappings};
    if (old.command.provisionalId != null && result.officialId != null) {
      final existing = mappings[old.command.provisionalId];
      if (existing != null && existing != result.officialId) {
        throw const OfflineJournalException('provisional_mapping_conflict');
      }
      mappings[old.command.provisionalId!] = result.officialId!;
    }
    var acknowledged = current.lastAcknowledgedSequence;
    while (true) {
      final next = entries.where(
        (entry) => entry.command.deviceSequence == acknowledged + 1,
      );
      if (next.isEmpty ||
          (next.single.status != JournalStatus.accepted &&
              next.single.status != JournalStatus.duplicate)) {
        break;
      }
      acknowledged += 1;
    }
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: acknowledged,
        entries: entries,
        mappings: mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
      ),
    );
  }

  Future<void> markUnknown(String commandId) async {
    final current = await load();
    final index = current.entries.indexWhere(
      (entry) => entry.command.commandId == commandId,
    );
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final entries = [...current.entries];
    final old = entries[index];
    entries[index] = JournalEntry(
      command: old.command,
      status: JournalStatus.unknown,
      attempts: old.attempts + 1,
      lastReplayAt: DateTime.now().toUtc(),
      lastSafeErrorCategory: 'response_unknown',
      officialId: old.officialId,
      officialCommit: old.officialCommit,
      failure: old.failure,
      serverConflictReference: old.serverConflictReference,
      retentionDeadline: old.retentionDeadline,
    );
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
      ),
    );
  }

  Future<void> cachePolicy(
    OfflinePolicy policy,
    DateTime trustedServerTime,
  ) async {
    final current = await load();
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: current.entries,
        mappings: current.mappings,
        cachedPolicy: policy.toJson(),
        lastTrustedServerTime: trustedServerTime.toUtc(),
        lastTrustedLocalTime: DateTime.now().toUtc(),
      ),
    );
  }

  Future<void> compact(DateTime now) async {
    final current = await load();
    final retained = current.entries
        .where((entry) {
          if (entry.status == JournalStatus.pending ||
              entry.status == JournalStatus.unknown ||
              entry.status == JournalStatus.conflict) {
            return true;
          }
          final deadline = entry.retentionDeadline;
          if ((entry.status == JournalStatus.accepted ||
                  entry.status == JournalStatus.duplicate) &&
              entry.command.commandType == 'pos.checkout.cash' &&
              (entry.command.provisionalId == null ||
                  !current.mappings.containsKey(entry.command.provisionalId))) {
            return true;
          }
          return deadline == null || deadline.isAfter(now);
        })
        .toList(growable: false);
    await _save(
      OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: retained,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
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
        'cachedPolicy': snapshot.cachedPolicy,
        'lastTrustedServerTime': snapshot.lastTrustedServerTime
            ?.toIso8601String(),
        'lastTrustedLocalTime': snapshot.lastTrustedLocalTime
            ?.toIso8601String(),
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
