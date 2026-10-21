import 'dart:convert';

import '../../core/storage/storage.dart';

final class PendingCashCommand {
  const PendingCashCommand({
    required this.merchantId,
    required this.locationId,
    required this.operation,
    required this.commandId,
    required this.idempotencyKey,
    this.hardwareReason,
    this.registerId,
  });

  final String merchantId;
  final String locationId;
  final String operation;
  final String commandId;
  final String idempotencyKey;
  final String? hardwareReason;
  final String? registerId;

  Map<String, Object?> toJson() => {
    'schemaVersion': 2,
    'merchantId': merchantId,
    'locationId': locationId,
    'operation': operation,
    'commandId': commandId,
    'idempotencyKey': idempotencyKey,
    'hardwareReason': hardwareReason,
    'registerId': registerId,
  };

  factory PendingCashCommand.fromJson(Map<String, Object?> json) {
    if (json['schemaVersion'] != 1 && json['schemaVersion'] != 2) {
      throw const FormatException('Unsupported cash recovery schema.');
    }
    return PendingCashCommand(
      merchantId: json['merchantId']! as String,
      locationId: json['locationId']! as String,
      operation: json['operation']! as String,
      commandId: json['commandId']! as String,
      idempotencyKey: json['idempotencyKey']! as String,
      hardwareReason: json['hardwareReason'] as String?,
      registerId: json['registerId'] as String?,
    );
  }
}

abstract interface class CashRecoveryStore {
  Future<PendingCashCommand?> load(String merchantId, String locationId);
  Future<void> save(PendingCashCommand command);
  Future<void> clear(String merchantId, String locationId);
}

final class MemoryCashRecoveryStore implements CashRecoveryStore {
  PendingCashCommand? _command;

  @override
  Future<PendingCashCommand?> load(String merchantId, String locationId) async {
    final command = _command;
    if (command?.merchantId != merchantId ||
        command?.locationId != locationId) {
      return null;
    }
    return command;
  }

  @override
  Future<void> save(PendingCashCommand command) async {
    _command = command;
  }

  @override
  Future<void> clear(String merchantId, String locationId) async {
    if (_command?.merchantId == merchantId &&
        _command?.locationId == locationId) {
      _command = null;
    }
  }
}

final class SecureCashRecoveryStore implements CashRecoveryStore {
  const SecureCashRecoveryStore(this._storage);

  final SecureKeyValueStorage _storage;

  String _key(String merchantId, String locationId) =>
      'cash.recovery.v1.$merchantId.$locationId';

  @override
  Future<PendingCashCommand?> load(String merchantId, String locationId) async {
    final encoded = await _storage.read(_key(merchantId, locationId));
    if (encoded == null) return null;
    final json = jsonDecode(encoded);
    if (json is! Map<String, Object?>) {
      throw const FormatException('Invalid cash recovery state.');
    }
    final command = PendingCashCommand.fromJson(json);
    if (command.merchantId != merchantId || command.locationId != locationId) {
      throw const FormatException('Cash recovery scope mismatch.');
    }
    return command;
  }

  @override
  Future<void> save(PendingCashCommand command) => _storage.write(
    _key(command.merchantId, command.locationId),
    jsonEncode(command.toJson()),
  );

  @override
  Future<void> clear(String merchantId, String locationId) =>
      _storage.delete(_key(merchantId, locationId));
}

/// The open drawer this till last saw, remembered across a cold start.
///
/// A cash sale needs the shift it belongs to. The shift is a server fact, so a
/// till that boots with no uplink has nothing to attach a sale to and refuses
/// the charge — even though the operator is standing at an open drawer that the
/// server itself opened. Remembering the id is enough: replay checks it against
/// the live shift and refuses if it has moved, so the cache can be wrong without
/// ever being trusted.
final class OpenShiftSnapshot {
  const OpenShiftSnapshot({
    required this.shiftId,
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
  });

  final String shiftId;
  final String merchantId;
  final String locationId;
  final String operatorSessionId;

  Map<String, Object?> toJson() => {
    'shiftId': shiftId,
    'merchantId': merchantId,
    'locationId': locationId,
    'operatorSessionId': operatorSessionId,
  };

  factory OpenShiftSnapshot.fromJson(Map<String, Object?> json) =>
      OpenShiftSnapshot(
        shiftId: json['shiftId']! as String,
        merchantId: json['merchantId']! as String,
        locationId: json['locationId']! as String,
        operatorSessionId: json['operatorSessionId']! as String,
      );
}

abstract interface class OpenShiftCache {
  Future<OpenShiftSnapshot?> load(String merchantId, String locationId);
  Future<void> save(OpenShiftSnapshot snapshot);
  Future<void> clear(String merchantId, String locationId);
}

final class MemoryOpenShiftCache implements OpenShiftCache {
  OpenShiftSnapshot? _snapshot;

  @override
  Future<OpenShiftSnapshot?> load(String merchantId, String locationId) async {
    final snapshot = _snapshot;
    if (snapshot == null ||
        snapshot.merchantId != merchantId ||
        snapshot.locationId != locationId) {
      return null;
    }
    return snapshot;
  }

  @override
  Future<void> save(OpenShiftSnapshot snapshot) async => _snapshot = snapshot;

  @override
  Future<void> clear(String merchantId, String locationId) async {
    if (_snapshot?.merchantId == merchantId &&
        _snapshot?.locationId == locationId) {
      _snapshot = null;
    }
  }
}

final class SecureOpenShiftCache implements OpenShiftCache {
  const SecureOpenShiftCache(this._storage);

  final SecureKeyValueStorage _storage;

  String _key(String merchantId, String locationId) =>
      'cash.open_shift.v1.$merchantId.$locationId';

  @override
  Future<OpenShiftSnapshot?> load(String merchantId, String locationId) async {
    final raw = await _storage.read(_key(merchantId, locationId));
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;
      return OpenShiftSnapshot.fromJson(decoded);
    } on FormatException {
      return null;
    }
  }

  @override
  Future<void> save(OpenShiftSnapshot snapshot) => _storage.write(
    _key(snapshot.merchantId, snapshot.locationId),
    jsonEncode(snapshot.toJson()),
  );

  @override
  Future<void> clear(String merchantId, String locationId) =>
      _storage.delete(_key(merchantId, locationId));
}
