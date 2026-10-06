import 'dart:convert';

import 'package:crypto/crypto.dart';

const _excludedKeys = {
  'accessToken',
  'authorizationToken',
  'customerContact',
  'giftCardCode',
  'managerPin',
  'password',
  'pin',
  'token',
  'transportCredential',
};

String hardwarePayloadFingerprint(Map<String, Object?> payload) {
  final safe = _canonical(payload);
  return sha256.convert(utf8.encode(jsonEncode(safe))).toString();
}

Object? _canonical(Object? value) {
  if (value is Map) {
    final entries =
        value.entries
            .where((entry) => !_excludedKeys.contains(entry.key.toString()))
            .toList()
          ..sort(
            (left, right) =>
                left.key.toString().compareTo(right.key.toString()),
          );
    return <String, Object?>{
      for (final entry in entries)
        entry.key.toString(): _canonical(entry.value),
    };
  }
  if (value is Iterable) return value.map(_canonical).toList(growable: false);
  if (value == null || value is bool || value is num || value is String) {
    return value;
  }
  throw ArgumentError.value(value, 'value', 'Unsupported fingerprint value');
}
