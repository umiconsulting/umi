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
      'OPERATOR_SESSION_BUSY' ||
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
      'CASH_POLICY_DENIED' ||
      'INSUFFICIENT_EXPECTED_CASH' ||
      'APPROVAL_REQUIRED' ||
      'APPROVAL_FINGERPRINT_REQUIRED' ||
      'APPROVAL_FINGERPRINT_MISMATCH' ||
      'REGISTER_NOT_AVAILABLE' ||
      'REGISTER_HELD_BY_ACTIVE_TILL' ||
      // A definite refusal about the account is not a transport failure. If it
      // entered the offline lane, the cash path would hide the server's real
      // reason and could ask the operator to charge again under a cash tender.
      'CHECKOUT_CART_CHANGED' ||
      'CHECKOUT_CONFIRMATION_REQUIRED' ||
      'CHECKOUT_PARTIAL_LEDGER_CONFLICT' ||
      'CART_VALIDATION_FAILED' ||
      'CART_VERSION_CONFLICT' => AppErrorCategory.conflict,
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

  /// The wait the server asked for, when it refused because of its own limit.
  ///
  /// A 429 is not an outage and not a conflict: the request was not executed,
  /// and sending it again before the window closes only extends the refusal.
  /// Null means the server did not state a wait, so the caller picks one.
  Duration? get retryAfter {
    final value = details?['retryAfterSeconds'];
    if (value is num && value.isFinite && value > 0) {
      return Duration(seconds: value.ceil().clamp(1, 300).toInt());
    }
    return null;
  }

  @override
  String toString() => 'AppException(${category.name}, $code)';
}
