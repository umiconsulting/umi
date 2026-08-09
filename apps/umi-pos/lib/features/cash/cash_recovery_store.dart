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
    if (command?.merchantId != merchantId || command?.locationId != locationId) {
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
    if (_command?.merchantId == merchantId && _command?.locationId == locationId) {
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
