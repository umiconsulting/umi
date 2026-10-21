import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;
import 'package:umi_contract/umi_contract.dart';

import '../config/app_config.dart';
import '../errors/app_error.dart';
import '../observability/telemetry.dart';
import 'lan_discovery.dart';

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
  /// The device's credential headers for one request.
  ///
  /// [path] is the app-relative route the headers will ride. A provider that
  /// signs a possession proof needs it: the server verifies that proof on the
  /// routes that establish trust and nowhere else, so a proof on the others is
  /// pure cost. Providers that only carry a credential may ignore it.
  Future<Map<String, String>> deviceHeaders({String? path});
}

final class NoDeviceCredentialProvider implements DeviceCredentialProvider {
  const NoDeviceCredentialProvider();
  @override
  Future<Map<String, String>> deviceHeaders({String? path}) async => const {};
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
    this.lanHubResolver,
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

  /// Routes the kitchen surface to the LAN node while the cloud is known to be
  /// down. The heartbeat never uses this predicate: it must still test the
  /// cloud so the till can notice recovery.
  bool Function(String path)? preferLanRoute;

  /// Holds the one in-progress refresh so a burst of concurrent 401s triggers
  /// a single renewal that they all await.
  Future<bool>? _refreshInFlight;

  /// The moment the cloud will accept our traffic again after a 429.
  ///
  /// A rate limit is a statement about the server's budget, not about the
  /// wire. Without this gate every surface retries on its own cadence, the
  /// retries keep the bucket empty, and the till shows "offline" while the API
  /// is healthy. The gate is process-wide because the bucket belongs to the
  /// device, not to one screen.
  DateTime? _cloudRetryNotBefore;

  static const requestTimeout = Duration(seconds: 15);
  static const maxResponseBytes = 2 * 1024 * 1024;
  static const maxSafeReadAttempts = 2;

  /// The one transport failure that proves the request never left this device.
  /// [request] may move such a call to the LAN lane; every other failure stays
  /// where it happened.
  static const _preSendTransport = 'TRANSPORT_FAILURE_PRE_SEND';
  static const _upstreamUnavailable = 'UPSTREAM_UNAVAILABLE';

  final AppConfig _config;
  final Telemetry _telemetry;
  final AccessTokenProvider _tokenProvider;
  final DeviceCredentialProvider _deviceCredentialProvider;
  final http.Client _client;
  final LanHubResolver? lanHubResolver;

  /// Probe the LAN hub without changing the cloud request path.
  ///
  /// Null means this build has no LAN hub. False means a hub is configured but
  /// did not answer. The main station reports true because it is the hub.
  Future<bool?> probeLanHub() async {
    if (_config.lanNodeEnabled) return true;
    final hub = await lanHubResolver?.resolve() ?? _config.lanHubUri;
    if (hub == null || hub == _config.apiBaseUri) return null;
    try {
      final answer = await _send(
        method: ApiMethod.get,
        path: '/health/live',
        idempotent: true,
        base: hub,
      ).timeout(const Duration(seconds: 2));
      return answer['lanNode'] == true;
    } on Object {
      return false;
    }
  }

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
    if (preferLanRoute?.call(path) ?? false) {
      final hub = await lanHubResolver?.resolve() ?? _config.lanHubUri;
      if (hub != null && hub != base) {
        _telemetry.event(const ClientEvent(name: 'network.lan_lane_preferred'));
        try {
          return await _send(
            method: method,
            path: path,
            body: body,
            cancellation: cancellation,
            idempotent: idempotent,
            base: hub,
            extraHeaders: extraHeaders,
          );
        } on AppException catch (error) {
          final safeRead = method == ApiMethod.get || method == ApiMethod.head;
          if (!safeRead || error.code == 'REQUEST_CANCELLED') rethrow;
          // A read cannot change money or stock. If the local node cannot
          // answer, the cloud is still a valid read lane.
          _telemetry.event(
            const ClientEvent(name: 'network.lan_lane_read_fallback'),
          );
        }
      }
    }
    // The auth guard rejects an expired access token before the handler runs,
    // so no side effect has occurred and one retry after a token renewal is
    // safe even for a POST. A single renewal per request, shared across a
    // burst of concurrent 401s, guards against loops.
    var didRefresh = false;
    while (true) {
      try {
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
          // The LAN node is a *lane*, not a retry. It is used only when the
          // request provably never left this device — a refused connection, a
          // dead DNS name, no route — because anything later than that could
          // have been executed by the cloud, and replaying it against a second
          // server is how one sale becomes two.
          final hub = await lanHubResolver?.resolve() ?? _config.lanHubUri;
          final cloudDidNotRun =
              error.code == _preSendTransport ||
              (error.code == _upstreamUnavailable && _isKitchenPath(path));
          if (hub == null || !cloudDidNotRun || hub == base) {
            rethrow;
          }
          _telemetry.event(const ClientEvent(name: 'network.lan_lane_used'));
          return await _send(
            method: method,
            path: path,
            body: body,
            cancellation: cancellation,
            idempotent: idempotent,
            base: hub,
            extraHeaders: extraHeaders,
          );
        }
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

  /// Send one read straight to the configured LAN node.
  ///
  /// The hub validates the presented device credential with the cloud and
  /// stores its hash while the cloud is healthy. A peer therefore has an
  /// offline trust entry before the first outage.
  Future<void> warmLanHub(String path) async {
    final hub = await lanHubResolver?.resolve() ?? _config.lanHubUri;
    if (hub == null) return;
    await _send(
      method: ApiMethod.get,
      path: path,
      cancellation: null,
      idempotent: true,
      base: hub,
      extraHeaders: null,
    );
  }

  /// Send one explicit command to the main station.
  ///
  /// This does not fall back to the cloud. A peer command must have one writer.
  /// The hub assigns the cloud sequence and keeps the durable copy.
  Future<Map<String, Object?>> sendLanHub({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    Map<String, String>? extraHeaders,
  }) async {
    if (!path.startsWith('/')) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'INVALID_API_PATH',
        recoverable: false,
      );
    }
    final hub = await lanHubResolver?.resolve() ?? _config.lanHubUri;
    if (hub == null) {
      throw const AppException(
        category: AppErrorCategory.configuration,
        code: 'LAN_HUB_NOT_CONFIGURED',
        recoverable: true,
      );
    }
    _telemetry.event(const ClientEvent(name: 'network.lan_hub_command'));
    return _send(
      method: method,
      path: path,
      body: body,
      cancellation: null,
      idempotent: true,
      base: hub,
      extraHeaders: extraHeaders,
    );
  }

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
      // The probe is the one request that must pass the gate. It is how the
      // till learns that the API is healthy again, and it costs one row.
      final gate = _cloudRetryNotBefore;
      if (base == _config.apiBaseUri &&
          path != '/health/live' &&
          gate != null &&
          DateTime.now().isBefore(gate)) {
        throw _rateLimited(
          gate.difference(DateTime.now()).inSeconds.clamp(1, 300).toInt(),
        );
      }
      final correlationId = _correlationId();
      try {
        final String? token;
        final Map<String, String> deviceHeaders;
        try {
          token = await _tokenProvider.accessToken();
          deviceHeaders = await _deviceCredentialProvider.deviceHeaders(
            path: path,
          );
        } on AppException {
          rethrow;
        } catch (_) {
          throw AppException(
            category: AppErrorCategory.storage,
            code: 'LOCAL_CREDENTIAL_READ_FAILED',
            recoverable: false,
            correlationId: correlationId,
          );
        }
        final request =
            http.Request(method.name.toUpperCase(), base.resolve(path))
              ..headers.addAll({
                'accept': 'application/json',
                'x-correlation-id': correlationId,
                'x-umi-client': 'umi-pos',
                'x-umi-app': 'pos',
                'x-umi-client-time': DateTime.now().toUtc().toIso8601String(),
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
        final http.StreamedResponse streamed;
        try {
          streamed = await _client.send(request).timeout(requestTimeout);
        } catch (error) {
          // Nothing was delivered: the socket was refused, the name did not
          // resolve, or there was no route. Only this shape may move to the LAN
          // lane; a failure while reading the response is "unknown outcome" and
          // must stay with the lane that may have executed it.
          if (error is TimeoutException) rethrow;
          throw AppException(
            category: AppErrorCategory.transport,
            code: _preSendTransport,
            recoverable: safeRetry,
            correlationId: correlationId,
          );
        }
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
        if (streamed.statusCode >= 200 && streamed.statusCode < 300) {
          // The probe answers even while the window is closed. Only a normal
          // request proves that the window is open again.
          if (path != '/health/live' && path != '/health/ready') {
            _cloudRetryNotBefore = null;
          }
          return bytes.isEmpty ? <String, Object?>{} : _decode(bytes);
        }
        if (streamed.statusCode == 429) {
          final decoded = bytes.isEmpty ? <String, Object?>{} : _decode(bytes);
          final refusal = _publicError(decoded, correlationId);
          final stated = int.tryParse(streamed.headers['retry-after'] ?? '');
          final seconds = (stated ??
                  (refusal.details?['retryAfterSeconds'] as num?)?.ceil() ??
                  30)
              .clamp(1, 300)
              .toInt();
          _cloudRetryNotBefore = DateTime.now().add(Duration(seconds: seconds));
          _telemetry.event(
            ClientEvent(
              name: 'network.rate_limited',
              values: {'waitSeconds': seconds},
            ),
          );
          // The refusal already names the wait. Retrying inside this call
          // would charge the same bucket again before its window closes.
          throw refusal;
        }
        if (streamed.statusCode == 502 ||
            streamed.statusCode == 503 ||
            streamed.statusCode == 504) {
          // The proxy could not reach its upstream, so no API handler ran.
          // Kitchen reads and idempotent commands may use the LAN lane for
          // this same reason they use it after a refused connection.
          throw AppException(
            category: AppErrorCategory.server,
            code: _upstreamUnavailable,
            recoverable: safeRetry,
            correlationId: correlationId,
          );
        }
        final decoded = bytes.isEmpty ? <String, Object?>{} : _decode(bytes);
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
        if (error.code == 'RATE_LIMITED') rethrow;
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
      if (attempt < attempts) {
        await Future<void>.delayed(Duration(milliseconds: 200 * attempt));
      }
    }
    throw lastFailure!;
  }

  AppException _rateLimited(int seconds) => AppException(
    category: AppErrorCategory.server,
    code: 'RATE_LIMITED',
    recoverable: true,
    details: {'retryAfterSeconds': seconds},
  );

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

  bool _isKitchenPath(String path) =>
      path.startsWith('/api/kds/') || path.contains('/kitchen/');

  @override
  void dispose() => _client.close();
}
