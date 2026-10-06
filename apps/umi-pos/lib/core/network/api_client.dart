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

/// Renews the access token after a request is rejected with
/// `AUTHENTICATION_REQUIRED`. Returns true when a fresh token is stored and the
/// request may be retried. The composition root wires this to the durable POS
/// refresh; it must itself call [ApiClient.request] with `authRefresh: false`
/// so a failing refresh cannot recurse.
typedef SessionRefresh = Future<bool> Function();

abstract interface class ApiClient {
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
    bool authRefresh = true,
    Map<String, String>? extraHeaders,
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
    this.sessionRefresh,
    http.Client? client,
  }) : // ignore: prefer_initializing_formals
       _config = config,
       // ignore: prefer_initializing_formals
       _telemetry = telemetry,
       // ignore: prefer_initializing_formals
       _tokenProvider = tokenProvider,
       _deviceCredentialProvider = deviceCredentialProvider,
       _client = client ?? http.Client();

  /// Renews an expired access token on demand. Set by the composition root
  /// after the entry gateway exists (the gateway and this client are mutually
  /// dependent), or injected directly in tests. Null disables auto-refresh.
  SessionRefresh? sessionRefresh;

  /// Holds the one in-progress refresh so a burst of concurrent 401s triggers
  /// a single renewal that they all await.
  Future<bool>? _refreshInFlight;

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
    bool authRefresh = true,
    Map<String, String>? extraHeaders,
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
    // The auth guard rejects an expired access token before the handler runs,
    // so no side effect has occurred and one retry after a token renewal is
    // safe even for a POST. A single renewal per request, shared across a
    // burst of concurrent 401s, guards against loops.
    var didRefresh = false;
    while (true) {
      try {
        return await _send(
          method: method,
          path: path,
          body: body,
          cancellation: cancellation,
          idempotent: idempotent,
          base: base,
          extraHeaders: extraHeaders,
        );
      } on AppException catch (error) {
        if (!didRefresh &&
            authRefresh &&
            sessionRefresh != null &&
            error.code == 'AUTHENTICATION_REQUIRED' &&
            await _refreshOnce()) {
          didRefresh = true;
          continue;
        }
        rethrow;
      }
    }
  }

  Future<bool> _refreshOnce() =>
      _refreshInFlight ??= sessionRefresh!().whenComplete(() {
        _refreshInFlight = null;
      });

  Future<Map<String, Object?>> _send({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    required bool idempotent,
    required Uri base,
    Map<String, String>? extraHeaders,
  }) async {
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
                // A route whose contract names no credential of ours can still
                // ask for one under its own header name. Applied last so the
                // caller, not the transport, decides a name it knows about.
                ...?extraHeaders,
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
    final legacyCode = _legacyErrorCode(response);
    if (legacyCode != null) {
      final message = response['message'];
      return AppException.fromApi(
        ApiError(
          code: legacyCode,
          message: message is String && message.isNotEmpty
              ? message
              : legacyCode,
          retryable: false,
          correlationId: fallbackCorrelationId,
        ),
      );
    }
    return AppException(
      category: AppErrorCategory.server,
      code: 'INVALID_ERROR_RESPONSE',
      recoverable: false,
      correlationId: fallbackCorrelationId,
    );
  }

  /// A machine code from a refusal that did not use the public envelope.
  ///
  /// The kitchen device route (`POST /api/kds/command`) kept the legacy iPad
  /// contract, so it answers refusals in two of its own shapes: a device
  /// refusal is `{"error":"device_revoked"}` — a string where the envelope has
  /// an object — and a version conflict is a 409 whose body is
  /// `{"ok":true,"data":{"code":"KITCHEN_VERSION_CONFLICT"}}`. Reading both
  /// here keeps one typed failure path for callers, which is what lets the
  /// board tell "the ticket moved under you" (reload, then say so) apart from
  /// "this device was removed" (pair again) instead of showing both as an
  /// unreadable generic failure.
  String? _legacyErrorCode(Map<String, Object?> response) {
    final error = response['error'];
    if (error is String && error.trim().isNotEmpty) {
      return error.trim().toUpperCase();
    }
    final data = response['data'];
    if (data is Map<String, Object?>) {
      final code = data['code'];
      if (code is String && code.trim().isNotEmpty) {
        return code.trim().toUpperCase();
      }
    }
    return null;
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
