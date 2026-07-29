import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:umi_contract/umi_contract.dart';

import '../config/app_config.dart';
import '../errors/app_error.dart';
import '../observability/telemetry.dart';

enum ApiMethod { get, head, post, put, patch, delete }

final class CancellationToken {
  bool _cancelled = false;
  bool get isCancelled => _cancelled;
  void cancel() => _cancelled = true;
}

abstract interface class AccessTokenProvider {
  Future<String?> accessToken();
}

abstract interface class DeviceCredentialProvider {
  Future<Map<String, String>> deviceHeaders();
}

final class NoDeviceCredentialProvider implements DeviceCredentialProvider {
  const NoDeviceCredentialProvider();
  @override
  Future<Map<String, String>> deviceHeaders() async => const {};
}

final class NoAccessTokenProvider implements AccessTokenProvider {
  const NoAccessTokenProvider();
  @override
  Future<String?> accessToken() async => null;
}

abstract interface class ApiClient {
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
  });
  void dispose();
}

final class BoundedApiClient implements ApiClient {
  BoundedApiClient({
    required AppConfig config,
    required Telemetry telemetry,
    AccessTokenProvider tokenProvider = const NoAccessTokenProvider(),
    DeviceCredentialProvider deviceCredentialProvider =
        const NoDeviceCredentialProvider(),
    http.Client? client,
  }) : // ignore: prefer_initializing_formals
       _config = config,
       // ignore: prefer_initializing_formals
       _telemetry = telemetry,
       // ignore: prefer_initializing_formals
       _tokenProvider = tokenProvider,
       _deviceCredentialProvider = deviceCredentialProvider,
       _client = client ?? http.Client();

  static const requestTimeout = Duration(seconds: 15);
  static const maxResponseBytes = 2 * 1024 * 1024;
  static const maxSafeReadAttempts = 2;

  final AppConfig _config;
  final Telemetry _telemetry;
  final AccessTokenProvider _tokenProvider;
  final DeviceCredentialProvider _deviceCredentialProvider;
  final http.Client _client;

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
  }) async {
    if (!path.startsWith('/')) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'INVALID_API_PATH',
        recoverable: false,
      );
    }
    final base = _config.apiBaseUri;
    if (base == null) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'CONFIGURATION_INVALID',
        recoverable: false,
      );
    }
    final safeRetry =
        method == ApiMethod.get || method == ApiMethod.head || idempotent;
    final attempts = safeRetry ? maxSafeReadAttempts : 1;
    AppException? lastFailure;
    for (var attempt = 1; attempt <= attempts; attempt += 1) {
      if (cancellation?.isCancelled ?? false) {
        throw const AppException(
          category: AppErrorCategory.transport,
          code: 'REQUEST_CANCELLED',
          recoverable: true,
        );
      }
      final correlationId = _correlationId();
      try {
        final token = await _tokenProvider.accessToken();
        final deviceHeaders = await _deviceCredentialProvider.deviceHeaders();
        final request =
            http.Request(method.name.toUpperCase(), base.resolve(path))
              ..headers.addAll({
                'accept': 'application/json',
                'x-correlation-id': correlationId,
                'x-umi-client': 'umi-pos',
                'x-umi-app': 'pos',
                ...deviceHeaders,
              });
        if (token != null) request.headers['authorization'] = 'Bearer $token';
        if (body != null) {
          request.headers['content-type'] = 'application/json';
          request.body = jsonEncode(body);
        }
        final streamed = await _client.send(request).timeout(requestTimeout);
        final bytes = await streamed.stream
            .fold<List<int>>(<int>[], (buffer, chunk) {
              if (buffer.length + chunk.length > maxResponseBytes) {
                throw const AppException(
                  category: AppErrorCategory.transport,
                  code: 'RESPONSE_TOO_LARGE',
                  recoverable: false,
                );
              }
              return buffer..addAll(chunk);
            })
            .timeout(requestTimeout);
        final decoded = bytes.isEmpty ? <String, Object?>{} : _decode(bytes);
        if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
          return decoded;
        }
        throw _publicError(decoded, correlationId);
      } on TimeoutException {
        lastFailure = AppException(
          category: AppErrorCategory.timeout,
          code: 'REQUEST_TIMEOUT',
          recoverable: safeRetry,
          correlationId: correlationId,
        );
      } on AppException catch (error) {
        lastFailure = error;
        if (!error.recoverable) rethrow;
      } catch (_) {
        lastFailure = AppException(
          category: AppErrorCategory.transport,
          code: 'TRANSPORT_FAILURE',
          recoverable: safeRetry,
          correlationId: correlationId,
        );
      }
      _telemetry.event(
        ClientEvent(
          name: 'network.failure',
          values: {
            'category': lastFailure.category.name,
            'attempt': attempt,
            'method': method.name,
          },
        ),
      );
    }
    throw lastFailure!;
  }

  Map<String, Object?> _decode(List<int> bytes) {
    final value = jsonDecode(utf8.decode(bytes));
    if (value is! Map<String, Object?>) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'INVALID_RESPONSE',
        recoverable: false,
      );
    }
    return value;
  }

  AppException _publicError(
    Map<String, Object?> response,
    String fallbackCorrelationId,
  ) {
    final error = response['error'];
    if (error is Map<String, Object?>) {
      try {
        return AppException.fromApi(ApiError.fromJson(error));
      } catch (_) {
        // The server response is not a valid public error contract.
      }
    }
    return AppException(
      category: AppErrorCategory.server,
      code: 'INVALID_ERROR_RESPONSE',
      recoverable: false,
      correlationId: fallbackCorrelationId,
    );
  }

  String _correlationId() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  @override
  void dispose() => _client.close();
}
