import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:cryptography/cryptography.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/storage/storage.dart';

const offlineJournalSchemaVersion = 1;
const offlineJournalMaxDepth = 250;
const offlineOrderCommandTypes = {
  'pos.cart.open',
  'pos.cart.line.add',
  'pos.cart.line.update',
  'pos.cart.line.remove',
  'pos.cart.clear',
  'pos.cart.prepare',
  'pos.cart.fire',
  'pos.cart.fulfillment.set',
  'pos.cart.table.set',
  'pos.command.group',
  'pos.kds.command',
};
const offlineTableCommandTypes = {'pos.table.command'};
const offlineJournalCommandTypes = {
  ...offlineOrderCommandTypes,
  ...offlineTableCommandTypes,
};

enum JournalStatus {
  pending,
  replaying,
  unknown,
  accepted,
  duplicate,
  conflict,
  resolved,
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
    this.hubDeliveryState,
    this.hubCommandId,
    this.hubDeviceSequence,
    this.hubUpdatedAt,
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
  final String? hubDeliveryState;
  final String? hubCommandId;
  final int? hubDeviceSequence;
  final DateTime? hubUpdatedAt;

  JournalEntry replayed({
    required JournalStatus status,
    String? error,
    String? officialId,
    Map<String, Object?>? officialCommit,
    Map<String, Object?>? failure,
    String? serverConflictReference,
    String? hubDeliveryState,
    String? hubCommandId,
    int? hubDeviceSequence,
    DateTime? hubUpdatedAt,
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
    hubDeliveryState: hubDeliveryState ?? this.hubDeliveryState,
    hubCommandId: hubCommandId ?? this.hubCommandId,
    hubDeviceSequence: hubDeviceSequence ?? this.hubDeviceSequence,
    hubUpdatedAt: hubUpdatedAt ?? this.hubUpdatedAt,
    retentionDeadline:
        (status == JournalStatus.accepted || status == JournalStatus.duplicate)
        ? DateTime.now().toUtc().add(const Duration(days: 30))
        : retentionDeadline,
  );

  JournalEntry resolvedConflict() => JournalEntry(
    command: command,
    status: JournalStatus.resolved,
    attempts: attempts,
    lastReplayAt: DateTime.now().toUtc(),
    lastSafeErrorCategory: lastSafeErrorCategory,
    officialId: officialId,
    officialCommit: officialCommit,
    failure: failure,
    serverConflictReference: serverConflictReference,
    retentionDeadline: DateTime.now().toUtc().add(const Duration(days: 30)),
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
    'hubDeliveryState': hubDeliveryState,
    'hubCommandId': hubCommandId,
    'hubDeviceSequence': hubDeviceSequence,
    'hubUpdatedAt': hubUpdatedAt?.toIso8601String(),
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
    hubDeliveryState: json['hubDeliveryState'] as String?,
    hubCommandId: json['hubCommandId'] as String?,
    hubDeviceSequence: (json['hubDeviceSequence'] as num?)?.toInt(),
    hubUpdatedAt: _date(json['hubUpdatedAt']),
  );
}

DateTime? _date(Object? value) =>
    value == null ? null : DateTime.parse(value as String);

int _advanceAcknowledgedSequence(List<JournalEntry> entries, int acknowledged) {
  var next = acknowledged;
  while (true) {
    final matches = entries.where(
      (entry) => entry.command.deviceSequence == next + 1,
    );
    if (matches.isEmpty) return next;
    final entry = matches.single;
    if (entry.status != JournalStatus.accepted &&
        entry.status != JournalStatus.duplicate) {
      return next;
    }
    next += 1;
  }
}

final class OfflineJournalSnapshot {
  const OfflineJournalSnapshot({
    required this.nextSequence,
    required this.lastAcknowledgedSequence,
    required this.entries,
    required this.mappings,
    this.cachedPolicy,
    this.lastTrustedServerTime,
    this.lastTrustedLocalTime,
    this.recoveryAudit = const [],
  });
  final int nextSequence;
  final int lastAcknowledgedSequence;
  final List<JournalEntry> entries;
  final Map<String, String> mappings;
  final Map<String, Object?>? cachedPolicy;
  final DateTime? lastTrustedServerTime;
  final DateTime? lastTrustedLocalTime;
  final List<Map<String, Object?>> recoveryAudit;
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
        entry.status != JournalStatus.resolved &&
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
  EncryptedOfflineJournal(this._store, {bool? web})
    : _web = web ?? kIsWeb,
      _mutationQueue = _queues[_store] ??= _JournalMutationQueue();
  static final Expando<_JournalMutationQueue> _queues =
      Expando<_JournalMutationQueue>('encrypted-journal-writer');
  final JournalCipherStore _store;
  final _JournalMutationQueue _mutationQueue;
  final bool _web;
  final _cipher = AesGcm.with256bits();
  final ValueNotifier<int> pendingCount = ValueNotifier<int>(0);

  bool get supportsSecureOffline => !_web;

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
      final snapshot = OfflineJournalSnapshot(
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
        recoveryAudit: (data['recoveryAudit'] as List<Object?>? ?? const [])
            .map((item) => item! as Map<String, Object?>)
            .toList(growable: false),
      );
      _publishPending(snapshot);
      return snapshot;
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
    required String merchantId,
    required String locationId,
    required String operatorSessionId,
    required String idempotencyKey,
    required Map<String, Object?> payload,
    String commandType = 'operational.ack',
    String? provisionalId,
    String? originDeviceId,
    String? originOperatorSessionId,
    String? hubReceivedAt,
    bool hubOwned = false,
    String? deduplicationKey,
    int? maxPendingCashCount,
    int? maxPendingCashMinorUnits,
    int? cashAmountMinorUnits,
  }) => _mutate((current) async {
    if (commandType != 'operational.ack' &&
        commandType != 'pos.checkout.cash' &&
        !offlineJournalCommandTypes.contains(commandType)) {
      throw const OfflineJournalException('command_not_offline_eligible');
    }
    if (deduplicationKey != null) {
      final matchingCheckout = current.entries.where(
        (entry) =>
            entry.command.commandType == commandType &&
            entry.command.payload['checkoutIdentity'] == deduplicationKey,
      );
      if (matchingCheckout.isNotEmpty) {
        return _MutationResult(
          snapshot: current,
          value: matchingCheckout.single.command,
          changed: false,
        );
      }
    }
    if (commandType == 'pos.checkout.cash') {
      if (maxPendingCashCount == null ||
          maxPendingCashMinorUnits == null ||
          cashAmountMinorUnits == null) {
        throw const OfflineJournalException('cash_policy_limits_missing');
      }
      if (current.pendingCashCount >= maxPendingCashCount) {
        throw const OfflineJournalException('sale_count_limit');
      }
      if (cashAmountMinorUnits >
          maxPendingCashMinorUnits - current.pendingCashMinorUnits) {
        throw const OfflineJournalException('accumulated_amount_limit');
      }
    }
    final duplicate = current.entries.where(
      (entry) => entry.command.commandId == commandId,
    );
    if (duplicate.isNotEmpty) {
      final existing = duplicate.single.command;
      final same =
          existing.deviceId == deviceId &&
          existing.deviceCredentialVersion == credentialVersion &&
          existing.merchantId == merchantId &&
          existing.locationId == locationId &&
          existing.operatorSessionId == operatorSessionId &&
          existing.commandType == commandType &&
          existing.idempotencyKey == idempotencyKey &&
          existing.provisionalId == provisionalId &&
          jsonEncode(_canonical(existing.payload)) ==
              jsonEncode(_canonical(payload));
      if (same) {
        return _MutationResult(
          snapshot: current,
          value: existing,
          changed: false,
        );
      }
      throw const OfflineJournalException('fingerprint_mismatch');
    }
    final createdAt = DateTime.now().toUtc().toIso8601String();
    final unsigned = OfflineCommand(
      commandId: commandId,
      provisionalId: provisionalId,
      deviceId: deviceId,
      deviceCredentialVersion: credentialVersion,
      deviceSequence: current.nextSequence,
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      commandType: commandType,
      idempotencyKey: idempotencyKey,
      fingerprint: List.filled(64, '0').join(),
      contractVersion: contractVersion,
      schemaVersion: offlineJournalSchemaVersion,
      createdAt: createdAt,
      originDeviceId: originDeviceId,
      originOperatorSessionId: originOperatorSessionId,
      hubReceivedAt: hubReceivedAt,
      hubOwned: hubOwned,
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
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
      commandType: commandType,
      idempotencyKey: idempotencyKey,
      fingerprint: fingerprint,
      contractVersion: contractVersion,
      schemaVersion: offlineJournalSchemaVersion,
      createdAt: createdAt,
      originDeviceId: originDeviceId,
      originOperatorSessionId: originOperatorSessionId,
      hubReceivedAt: hubReceivedAt,
      hubOwned: hubOwned,
      payload: payload,
    );
    final next = OfflineJournalSnapshot(
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
      recoveryAudit: current.recoveryAudit,
    );
    return _MutationResult(snapshot: next, value: command);
  });

  Future<void> apply(ReplayResult result) => _mutate((current) async {
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
    final acknowledged = _advanceAcknowledgedSequence(
      entries,
      current.lastAcknowledgedSequence,
    );
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: acknowledged,
        entries: entries,
        mappings: mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  /// Record the hub's custody state for one peer-owned command.
  ///
  /// A queued receipt proves that the hub has a durable copy. The peer keeps
  /// the entry in its own queue until the hub reports the cloud result. An
  /// accepted receipt closes the peer entry and installs the official ID.
  Future<void> recordHubDelivery({
    required String commandId,
    required String state,
    required String hubCommandId,
    required int hubDeviceSequence,
    String? officialId,
    Map<String, Object?>? officialCommit,
    Map<String, Object?>? failure,
    String? errorCode,
  }) => _mutate((current) async {
    final index = current.entries.indexWhere(
      (entry) => entry.command.commandId == commandId,
    );
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final old = current.entries[index];
    if (old.command.hubOwned != true) {
      throw const OfflineJournalException('hub_delivery_not_peer_owned');
    }
    final status = switch (state) {
      'queued' || 'pending' => JournalStatus.pending,
      'accepted' => JournalStatus.accepted,
      'duplicate' => JournalStatus.duplicate,
      'conflict' || 'rejected' => JournalStatus.conflict,
      'resolved' => JournalStatus.resolved,
      _ => throw const OfflineJournalException('hub_status_unknown'),
    };
    final terminal =
        status == JournalStatus.accepted ||
        status == JournalStatus.duplicate ||
        status == JournalStatus.conflict ||
        status == JournalStatus.resolved;
    final entries = [...current.entries];
    entries[index] = JournalEntry(
      command: old.command,
      status: status,
      attempts: old.attempts + (terminal ? 1 : 0),
      lastReplayAt: terminal ? DateTime.now().toUtc() : old.lastReplayAt,
      lastSafeErrorCategory:
          errorCode ?? (terminal ? null : old.lastSafeErrorCategory),
      officialId: officialId ?? old.officialId,
      officialCommit: officialCommit ?? old.officialCommit,
      failure:
          failure ??
          (terminal && status != JournalStatus.conflict ? null : old.failure),
      serverConflictReference: old.serverConflictReference,
      retentionDeadline:
          status == JournalStatus.accepted ||
              status == JournalStatus.duplicate ||
              status == JournalStatus.resolved
          ? DateTime.now().toUtc().add(const Duration(days: 30))
          : old.retentionDeadline,
      hubDeliveryState: state,
      hubCommandId: hubCommandId,
      hubDeviceSequence: hubDeviceSequence,
      hubUpdatedAt: DateTime.now().toUtc(),
    );
    final mappings = {...current.mappings};
    if (old.command.provisionalId != null && officialId != null) {
      final existing = mappings[old.command.provisionalId];
      if (existing != null && existing != officialId) {
        throw const OfflineJournalException('provisional_mapping_conflict');
      }
      mappings[old.command.provisionalId!] = officialId;
    }
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: _advanceAcknowledgedSequence(
          entries,
          current.lastAcknowledgedSequence,
        ),
        entries: entries,
        mappings: mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  /// Forget a hub receipt that the hub no longer knows.
  ///
  /// The local copy stays pending and is safe to submit again with the same
  /// identities. This covers a hub restore from an older backup.
  Future<void> clearHubDelivery(String commandId) => _mutate((current) async {
    final index = current.entries.indexWhere(
      (entry) => entry.command.commandId == commandId,
    );
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final old = current.entries[index];
    if (old.command.hubOwned != true || old.status != JournalStatus.pending) {
      throw const OfflineJournalException('hub_delivery_not_resettable');
    }
    final entries = [...current.entries];
    entries[index] = JournalEntry(
      command: old.command,
      status: JournalStatus.pending,
      attempts: old.attempts,
      lastReplayAt: old.lastReplayAt,
      lastSafeErrorCategory: old.lastSafeErrorCategory,
      officialId: old.officialId,
      officialCommit: old.officialCommit,
      failure: old.failure,
      serverConflictReference: old.serverConflictReference,
      retentionDeadline: old.retentionDeadline,
    );
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  /// Return a refused command to the ordered queue after its cause is fixed.
  ///
  /// The command identity and sequence do not change, so the server's
  /// idempotency and ordered cursor still apply. This is limited to writes for
  /// which a second submission cannot create a second business fact.
  Future<void> retryConflict(String commandId) => _mutate((current) async {
    final index = current.entries.indexWhere(
      (entry) => entry.command.commandId == commandId,
    );
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final entry = current.entries[index];
    if (entry.status != JournalStatus.conflict ||
        (entry.command.commandType != 'pos.kds.command' &&
            entry.command.commandType != 'pos.table.command' &&
            entry.command.commandType != 'pos.checkout.cash')) {
      throw const OfflineJournalException('command_not_retryable');
    }
    final entries = [...current.entries];
    entries[index] = JournalEntry(
      command: entry.command,
      status: JournalStatus.pending,
      attempts: entry.attempts,
    );
    return _MutationResult(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  /// Start a clean ordered stream after this installation is enrolled as a new
  /// device identity.
  ///
  /// Replaying an old device's sequence under the new device is impossible: the
  /// server correctly refuses the command as a scope change. Keeping those cart
  /// commands forever left the queue blocked and allowed a provisional local
  /// cart to survive beside the server's real account. Financial commands are
  /// never discarded here; they remain for explicit recovery.
  Future<int> discardForeignReplayScope({
    required String deviceId,
    required int credentialVersion,
  }) => _mutate((current) async {
    final foreign = current.entries
        .where(
          (entry) =>
              entry.command.deviceId != deviceId ||
              entry.command.deviceCredentialVersion != credentialVersion,
        )
        .toList(growable: false);
    if (foreign.isEmpty) {
      return _MutationResult(snapshot: current, value: 0, changed: false);
    }
    if (foreign.any(
      (entry) => entry.command.commandType == 'pos.checkout.cash',
    )) {
      throw const OfflineJournalException(
        'foreign_device_cash_requires_recovery',
      );
    }
    return _MutationResult(
      snapshot: OfflineJournalSnapshot(
        // A device-identity reset invalidates the whole ordered stream. Keeping
        // even same-device commands from after the reset would preserve their
        // old sequence numbers and recreate the same gap.
        nextSequence: 1,
        lastAcknowledgedSequence: 0,
        entries: const [],
        mappings: const {},
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: current.entries.length,
    );
  });

  /// Close a refused command and return gap conflicts behind it to the queue.
  ///
  /// The resolved entry remains in the journal. A later `sequence_gap` was
  /// caused by the refused sequence, so it is pending again only after the
  /// server advances the cursor.
  Future<int> resolveConflictAndRetryFollowing(String commandId) =>
      _mutate((current) async {
        final index = current.entries.indexWhere(
          (entry) => entry.command.commandId == commandId,
        );
        if (index < 0) {
          throw const OfflineJournalException('result_command_unknown');
        }
        final entry = current.entries[index];
        if (entry.status != JournalStatus.conflict) {
          throw const OfflineJournalException('command_not_in_conflict');
        }
        final entries = [...current.entries];
        entries[index] = entry.resolvedConflict();
        var retried = 0;
        for (var cursor = index + 1; cursor < entries.length; cursor++) {
          final following = entries[cursor];
          if (following.status != JournalStatus.conflict ||
              (following.lastSafeErrorCategory != 'sequence_gap' &&
                  following.lastSafeErrorCategory != 'stream_blocked')) {
            continue;
          }
          entries[cursor] = JournalEntry(
            command: following.command,
            status: JournalStatus.pending,
            attempts: following.attempts,
          );
          retried++;
        }
        var acknowledged = current.lastAcknowledgedSequence;
        while (true) {
          final next = entries.where(
            (value) => value.command.deviceSequence == acknowledged + 1,
          );
          if (next.isEmpty ||
              (next.single.status != JournalStatus.accepted &&
                  next.single.status != JournalStatus.duplicate &&
                  next.single.status != JournalStatus.resolved)) {
            break;
          }
          acknowledged += 1;
        }
        return _MutationResult(
          snapshot: OfflineJournalSnapshot(
            nextSequence: current.nextSequence,
            lastAcknowledgedSequence: acknowledged,
            entries: entries,
            mappings: current.mappings,
            cachedPolicy: current.cachedPolicy,
            lastTrustedServerTime: current.lastTrustedServerTime,
            lastTrustedLocalTime: current.lastTrustedLocalTime,
            recoveryAudit: current.recoveryAudit,
          ),
          value: retried,
        );
      });

  /// Return an unknown command to the ordered queue after the server confirms
  /// that it never received the command.
  ///
  /// The command keeps its identity and sequence. The server can therefore
  /// reject a duplicate, and the cursor still sees one ordered fact.
  Future<void> retryUnknown(String commandId) => _mutate((current) async {
    final index = current.entries.indexWhere(
      (entry) => entry.command.commandId == commandId,
    );
    if (index < 0) {
      throw const OfflineJournalException('result_command_unknown');
    }
    final entry = current.entries[index];
    if (entry.status != JournalStatus.unknown ||
        !offlineJournalCommandTypes.contains(entry.command.commandType)) {
      throw const OfflineJournalException('command_not_retryable');
    }
    final entries = [...current.entries];
    entries[index] = JournalEntry(
      command: entry.command,
      status: JournalStatus.pending,
      attempts: entry.attempts,
    );
    return _MutationResult(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  Future<void> markUnknown(String commandId) => _mutate((current) async {
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
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: entries,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  Future<void> cachePolicy(OfflinePolicy policy, DateTime trustedServerTime) =>
      _mutate((current) async {
        return _MutationResult<void>(
          snapshot: OfflineJournalSnapshot(
            nextSequence: current.nextSequence,
            lastAcknowledgedSequence: current.lastAcknowledgedSequence,
            entries: current.entries,
            mappings: current.mappings,
            cachedPolicy: policy.toJson(),
            lastTrustedServerTime: trustedServerTime.toUtc(),
            lastTrustedLocalTime: DateTime.now().toUtc(),
            recoveryAudit: current.recoveryAudit,
          ),
          value: null,
        );
      });

  Future<void> compact(DateTime now) => _mutate((current) async {
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
    return _MutationResult<void>(
      snapshot: OfflineJournalSnapshot(
        nextSequence: current.nextSequence,
        lastAcknowledgedSequence: current.lastAcknowledgedSequence,
        entries: retained,
        mappings: current.mappings,
        cachedPolicy: current.cachedPolicy,
        lastTrustedServerTime: current.lastTrustedServerTime,
        lastTrustedLocalTime: current.lastTrustedLocalTime,
        recoveryAudit: current.recoveryAudit,
      ),
      value: null,
    );
  });

  Future<void> recordRecoveryAction(RecoveryAction action, String outcome) =>
      _mutate((current) async {
        final audit = [
          ...current.recoveryAudit,
          <String, Object?>{
            'eventCategory': action.auditEvent,
            'occurredAt': DateTime.now().toUtc().toIso8601String(),
            'diagnosticCode': action.diagnosticCode,
            'outcome': outcome,
          },
        ];
        return _MutationResult<void>(
          snapshot: OfflineJournalSnapshot(
            nextSequence: current.nextSequence,
            lastAcknowledgedSequence: current.lastAcknowledgedSequence,
            entries: current.entries,
            mappings: current.mappings,
            cachedPolicy: current.cachedPolicy,
            lastTrustedServerTime: current.lastTrustedServerTime,
            lastTrustedLocalTime: current.lastTrustedLocalTime,
            recoveryAudit: audit.length <= 100
                ? audit
                : audit.sublist(audit.length - 100),
          ),
          value: null,
        );
      });

  Future<T> _mutate<T>(
    Future<_MutationResult<T>> Function(OfflineJournalSnapshot current)
    mutation,
  ) {
    final result = _mutationQueue.tail.then((_) async {
      final change = await mutation(await load());
      if (change.changed) await _save(change.snapshot);
      return change.value;
    });
    _mutationQueue.tail = result.then<void>((_) {}, onError: (_, _) {});
    return result;
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
        'recoveryAudit': snapshot.recoveryAudit,
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
    _publishPending(snapshot);
  }

  void _publishPending(OfflineJournalSnapshot snapshot) {
    pendingCount.value = snapshot.entries
        .where(
          (entry) =>
              entry.status != JournalStatus.accepted &&
              entry.status != JournalStatus.duplicate &&
              entry.status != JournalStatus.resolved &&
              entry.status != JournalStatus.archived,
        )
        .length;
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

final class _JournalMutationQueue {
  Future<void> tail = Future<void>.value();
}

final class _MutationResult<T> {
  const _MutationResult({
    required this.snapshot,
    required this.value,
    this.changed = true,
  });
  final OfflineJournalSnapshot snapshot;
  final T value;
  final bool changed;
}
