import 'dart:convert';

import '../../core/storage/storage.dart';

final class PendingCashCommand {
  const PendingCashCommand({
    required this.tenantId,
    required this.branchId,
    required this.operation,
    required this.commandId,
    required this.idempotencyKey,
  });

  final String tenantId;
  final String branchId;
  final String operation;
  final String commandId;
  final String idempotencyKey;

  Map<String, Object?> toJson() => {
    'schemaVersion': 1,
    'tenantId': tenantId,
    'branchId': branchId,
    'operation': operation,
    'commandId': commandId,
    'idempotencyKey': idempotencyKey,
  };

  factory PendingCashCommand.fromJson(Map<String, Object?> json) {
    if (json['schemaVersion'] != 1) {
      throw const FormatException('Unsupported cash recovery schema.');
    }
    return PendingCashCommand(
      tenantId: json['tenantId']! as String,
      branchId: json['branchId']! as String,
      operation: json['operation']! as String,
      commandId: json['commandId']! as String,
      idempotencyKey: json['idempotencyKey']! as String,
    );
  }
}

abstract interface class CashRecoveryStore {
  Future<PendingCashCommand?> load(String tenantId, String branchId);
  Future<void> save(PendingCashCommand command);
  Future<void> clear(String tenantId, String branchId);
}

final class MemoryCashRecoveryStore implements CashRecoveryStore {
  PendingCashCommand? _command;

  @override
  Future<PendingCashCommand?> load(String tenantId, String branchId) async {
    final command = _command;
    if (command?.tenantId != tenantId || command?.branchId != branchId) {
      return null;
    }
    return command;
  }

  @override
  Future<void> save(PendingCashCommand command) async {
    _command = command;
  }

  @override
  Future<void> clear(String tenantId, String branchId) async {
    if (_command?.tenantId == tenantId && _command?.branchId == branchId) {
      _command = null;
    }
  }
}

final class SecureCashRecoveryStore implements CashRecoveryStore {
  const SecureCashRecoveryStore(this._storage);

  final SecureKeyValueStorage _storage;

  String _key(String tenantId, String branchId) =>
      'cash.recovery.v1.$tenantId.$branchId';

  @override
  Future<PendingCashCommand?> load(String tenantId, String branchId) async {
    final encoded = await _storage.read(_key(tenantId, branchId));
    if (encoded == null) return null;
    final json = jsonDecode(encoded);
    if (json is! Map<String, Object?>) {
      throw const FormatException('Invalid cash recovery state.');
    }
    final command = PendingCashCommand.fromJson(json);
    if (command.tenantId != tenantId || command.branchId != branchId) {
      throw const FormatException('Cash recovery scope mismatch.');
    }
    return command;
  }

  @override
  Future<void> save(PendingCashCommand command) => _storage.write(
    _key(command.tenantId, command.branchId),
    jsonEncode(command.toJson()),
  );

  @override
  Future<void> clear(String tenantId, String branchId) =>
      _storage.delete(_key(tenantId, branchId));
}
