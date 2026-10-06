import 'package:umi_contract/umi_contract.dart';

enum AppErrorCategory {
  configuration,
  transport,
  timeout,
  authentication,
  permission,
  conflict,
  storage,
  unsupported,
  server,
  unknown,
}

final class AppException implements Exception {
  const AppException({
    required this.category,
    required this.code,
    required this.recoverable,
    this.correlationId,
    this.fieldErrors,
    this.details,
  });

  factory AppException.fromApi(ApiError error) => AppException(
    category: switch (error.code) {
      'AUTHENTICATION_REQUIRED' ||
      'SESSION_REVOKED' => AppErrorCategory.authentication,
      'PERMISSION_DENIED' => AppErrorCategory.permission,
      'CONFLICT' ||
      'IDEMPOTENCY_CONFLICT' ||
      'OPTIMISTIC_VERSION_CONFLICT' ||
      // The kitchen command route names the same refusal its own way: the
      // ticket moved between the read and the bump, so the operator reloads
      // and reads the room again. Same bucket, same recovery.
      'KITCHEN_VERSION_CONFLICT' ||
      'KITCHEN_FINGERPRINT_CONFLICT' ||
      // A cash sale with no shift is a refusal with a recovery action, not a
      // fault: the till can resume, reclaim, or ask for a count. Classifying it
      // as a conflict keeps it out of the "server" bucket that offers only a
      // retry that re-sends the same broken payload.
      'CASH_SHIFT_REQUIRED' ||
      'REGISTER_NOT_AVAILABLE' ||
      'REGISTER_HELD_BY_ACTIVE_TILL' => AppErrorCategory.conflict,
      'RATE_LIMITED' || 'INTERNAL_ERROR' => AppErrorCategory.server,
      _ => AppErrorCategory.unknown,
    },
    code: error.code,
    recoverable: error.retryable,
    correlationId: error.correlationId,
    fieldErrors: error.fieldErrors,
    details: error.details,
  );

  final AppErrorCategory category;
  final String code;
  final bool recoverable;
  final String? correlationId;
  final Map<String, Object?>? fieldErrors;

  /// The facts a typed refusal carries so the operator has something to do
  /// besides tap the same button again (`ApiError.details`).
  final Map<String, Object?>? details;

  @override
  String toString() => 'AppException(${category.name}, $code)';
}
