import 'dart:convert';

import '../../core/storage/storage.dart';

enum HardwareDispatchState {
  dispatching,
  retryable,
  succeeded,
  failed,
  unknown,
}

final class PendingHardwareDispatch {
  const PendingHardwareDispatch({
    required this.merchantId,
    required this.locationId,
    required this.commandId,
    required this.payloadFingerprint,
    required this.state,
    this.failureCode,
    this.safeMetadata = const {},
  });

  final String merchantId;
  final String locationId;
  final String commandId;
  final String payloadFingerprint;
  final HardwareDispatchState state;
  final String? failureCode;
  final Map<String, Object?> safeMetadata;

  Map<String, Object?> toJson() => {
    'schemaVersion': 1,
    'merchantId': merchantId,
    'locationId': locationId,
    'commandId': commandId,
    'payloadFingerprint': payloadFingerprint,
    'state': state.name,
    'failureCode': failureCode,
    'safeMetadata': safeMetadata,
  };

  factory PendingHardwareDispatch.fromJson(Map<String, Object?> json) {
    if (json['schemaVersion'] != 1) {
      throw const FormatException('Unsupported hardware recovery schema.');
    }
    return PendingHardwareDispatch(
      merchantId: json['merchantId']! as String,
      locationId: json['locationId']! as String,
      commandId: json['commandId']! as String,
      payloadFingerprint: json['payloadFingerprint']! as String,
      state: HardwareDispatchState.values.byName(json['state']! as String),
      failureCode: json['failureCode'] as String?,
      safeMetadata:
          (json['safeMetadata'] as Map?)?.cast<String, Object?>() ?? const {},
    );
  }
}

abstract interface class HardwareRecoveryStore {
  Future<PendingHardwareDispatch?> load(String commandId);
  Future<void> save(PendingHardwareDispatch dispatch);
  Future<void> clear(String commandId);
}

final class MemoryHardwareRecoveryStore implements HardwareRecoveryStore {
  final Map<String, PendingHardwareDispatch> _dispatches = {};

  @override
  Future<PendingHardwareDispatch?> load(String commandId) async =>
      _dispatches[commandId];

  @override
  Future<void> save(PendingHardwareDispatch dispatch) async {
    _dispatches[dispatch.commandId] = dispatch;
  }

  @override
  Future<void> clear(String commandId) async {
    _dispatches.remove(commandId);
  }
}

final class SecureHardwareRecoveryStore implements HardwareRecoveryStore {
  const SecureHardwareRecoveryStore(this._storage);
  final SecureKeyValueStorage _storage;

  String _key(String commandId) => 'hardware.recovery.v1.$commandId';

  @override
  Future<PendingHardwareDispatch?> load(String commandId) async {
    final value = await _storage.read(_key(commandId));
    if (value == null) return null;
    final json = jsonDecode(value);
    if (json is! Map<String, Object?>) {
      throw const FormatException('Invalid hardware recovery state.');
    }
    final dispatch = PendingHardwareDispatch.fromJson(json);
    if (dispatch.commandId != commandId) {
      throw const FormatException('Hardware recovery command mismatch.');
    }
    return dispatch;
  }

  @override
  Future<void> save(PendingHardwareDispatch dispatch) =>
      _storage.write(_key(dispatch.commandId), jsonEncode(dispatch.toJson()));

  @override
  Future<void> clear(String commandId) => _storage.delete(_key(commandId));
}
