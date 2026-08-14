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
  });

  factory AppException.fromApi(ApiError error) => AppException(
    category: switch (error.code) {
      'AUTHENTICATION_REQUIRED' ||
      'SESSION_REVOKED' => AppErrorCategory.authentication,
      'PERMISSION_DENIED' => AppErrorCategory.permission,
      'CONFLICT' ||
      'IDEMPOTENCY_CONFLICT' ||
      'OPTIMISTIC_VERSION_CONFLICT' => AppErrorCategory.conflict,
      'RATE_LIMITED' || 'INTERNAL_ERROR' => AppErrorCategory.server,
      _ => AppErrorCategory.unknown,
    },
    code: error.code,
    recoverable: error.retryable,
    correlationId: error.correlationId,
    fieldErrors: error.fieldErrors,
  );

  final AppErrorCategory category;
  final String code;
  final bool recoverable;
  final String? correlationId;
  final Map<String, Object?>? fieldErrors;

  @override
  String toString() => 'AppException(${category.name}, $code)';
}
