import 'dart:convert';

import '../../core/storage/storage.dart';

final class PendingSaleException {
  const PendingSaleException({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    required this.saleId,
    required this.commandId,
    required this.idempotencyKey,
    required this.commandType,
    required this.requestedTerminalOutcome,
    required this.preview,
  });

  final String merchantId;
  final String locationId;
  final String operatorSessionId;
  final String saleId;
  final String commandId;
  final String idempotencyKey;
  final String commandType;
  final String? requestedTerminalOutcome;
  final Map<String, Object?> preview;

  Map<String, Object?> toJson() => {
    'schemaVersion': 3,
    'merchantId': merchantId,
    'locationId': locationId,
    'operatorSessionId': operatorSessionId,
    'saleId': saleId,
    'commandId': commandId,
    'idempotencyKey': idempotencyKey,
    'commandType': commandType,
    'requestedTerminalOutcome': requestedTerminalOutcome,
    'preview': preview,
  };

  factory PendingSaleException.fromJson(Map<String, Object?> json) {
    if (json['schemaVersion'] != 3) {
      throw const FormatException(
        'Unsupported sale exception recovery schema.',
      );
    }
    return PendingSaleException(
      merchantId: json['merchantId']! as String,
      locationId: json['locationId']! as String,
      operatorSessionId: json['operatorSessionId']! as String,
      saleId: json['saleId']! as String,
      commandId: json['commandId']! as String,
      idempotencyKey: json['idempotencyKey']! as String,
      commandType: json['commandType']! as String,
      requestedTerminalOutcome: json['requestedTerminalOutcome'] as String?,
      preview: (json['preview']! as Map<Object?, Object?>)
          .cast<String, Object?>(),
    );
  }
}

abstract interface class SaleExceptionRecoveryStore {
  Future<PendingSaleException?> load(String merchantId, String locationId);
  Future<void> save(PendingSaleException pending);
  Future<void> clear(String merchantId, String locationId);
}

final class MemorySaleExceptionRecoveryStore
    implements SaleExceptionRecoveryStore {
  PendingSaleException? value;

  @override
  Future<PendingSaleException?> load(
    String merchantId,
    String locationId,
  ) async {
    if (value?.merchantId != merchantId || value?.locationId != locationId) {
      return null;
    }
    return value;
  }

  @override
  Future<void> save(PendingSaleException pending) async => value = pending;

  @override
  Future<void> clear(String merchantId, String locationId) async {
    if (value?.merchantId == merchantId && value?.locationId == locationId) {
      value = null;
    }
  }
}

final class SecureSaleExceptionRecoveryStore
    implements SaleExceptionRecoveryStore {
  const SecureSaleExceptionRecoveryStore(this._storage);
  final SecureKeyValueStorage _storage;

  String _key(String merchantId, String locationId) =>
      'sale.exception.recovery.v1.$merchantId.$locationId';

  @override
  Future<PendingSaleException?> load(
    String merchantId,
    String locationId,
  ) async {
    final encoded = await _storage.read(_key(merchantId, locationId));
    if (encoded == null) return null;
    final decoded = jsonDecode(encoded);
    if (decoded is! Map<String, Object?>) {
      throw const FormatException('Invalid sale exception recovery state.');
    }
    final pending = PendingSaleException.fromJson(decoded);
    if (pending.merchantId != merchantId || pending.locationId != locationId) {
      throw const FormatException('Sale exception recovery scope mismatch.');
    }
    return pending;
  }

  @override
  Future<void> save(PendingSaleException pending) => _storage.write(
    _key(pending.merchantId, pending.locationId),
    jsonEncode(pending.toJson()),
  );

  @override
  Future<void> clear(String merchantId, String locationId) =>
      _storage.delete(_key(merchantId, locationId));
}
