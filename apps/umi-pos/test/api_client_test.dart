import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_pos/core/config/app_config.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/network/lan_discovery.dart';
import 'package:umi_pos/core/observability/telemetry.dart';

import 'support/fakes.dart';

const _jsonHeaders = {'content-type': 'application/json'};

String _authError() => jsonEncode({
  'error': {
    'code': 'AUTHENTICATION_REQUIRED',
    'message': 'authentication required',
    'retryable': false,
    'correlationId': '00000000-0000-4000-8000-000000000000',
  },
});

BoundedApiClient _client(http.Client client, {SessionRefresh? sessionRefresh}) {
  return BoundedApiClient(
    config: testConfig,
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    sessionRefresh: sessionRefresh,
    client: client,
  );
}

void main() {
  test(
    'a request that never left the till is served by the LAN node',
    () async {
      final seen = <String>[];
      final client = MockClient((request) async {
        seen.add(request.url.host);
        if (request.url.host == 'api.example.test') {
          throw const SocketException('Connection refused');
        }
        return http.Response(
          '{"ok":true}',
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final api = BoundedApiClient(
        config: AppConfig(
          environment: AppEnvironment.development,
          apiBaseUri: Uri.parse('https://api.example.test'),
          lanHubUri: Uri.parse('http://192.168.1.10:8099'),
          telemetryEnabled: false,
          developmentDiagnostics: true,
          featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
          hardwareSimulatorEnabled: false,
          realtimeEnrollmentEnabled: false,
          release: testConfig.release,
        ),
        telemetry: SafeTelemetry(
          enabled: false,
          context: TelemetryContext.current(testConfig),
          exporter: RecordingExporter(),
        ),
        client: client,
      );

      final answer = await api.request(
        method: ApiMethod.post,
        path: '/api/kds/board',
        body: const {'action': 'snapshot'},
        idempotent: true,
      );

      expect(answer['ok'], isTrue);
      // The primary gets its usual safe-read retry, then the lane moves once.
      expect(seen.last, '192.168.1.10');
      expect(seen.where((host) => host == '192.168.1.10'), hasLength(1));
    },
  );

  test(
    'a request the cloud may have executed is never also sent to the LAN',
    () async {
      final seen = <String>[];
      final client = MockClient((request) async {
        seen.add(request.url.host);
        // The request was accepted and the response never arrived: the cloud may
        // have applied it, so the LAN node must not see a second copy.
        throw TimeoutException('response lost');
      });
      final api = BoundedApiClient(
        config: AppConfig(
          environment: AppEnvironment.development,
          apiBaseUri: Uri.parse('https://api.example.test'),
          lanHubUri: Uri.parse('http://192.168.1.10:8099'),
          telemetryEnabled: false,
          developmentDiagnostics: true,
          featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
          hardwareSimulatorEnabled: false,
          realtimeEnrollmentEnabled: false,
          release: testConfig.release,
        ),
        telemetry: SafeTelemetry(
          enabled: false,
          context: TelemetryContext.current(testConfig),
          exporter: RecordingExporter(),
        ),
        client: client,
      );

      await expectLater(
        api.request(
          method: ApiMethod.post,
          path: '/api/kds/command',
          body: const {'action': 'command'},
          idempotent: true,
        ),
        throwsA(isA<AppException>()),
      );
      expect(seen.where((host) => host == '192.168.1.10'), isEmpty);
    },
  );

  test('a proxy 502 uses the LAN lane for a kitchen request', () async {
    final seen = <String>[];
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:8099'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        seen.add(request.url.host);
        if (request.url.host == 'api.example.test') {
          return http.Response('Bad Gateway', 502);
        }
        return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
      }),
    );

    final answer = await api.request(
      method: ApiMethod.get,
      path: '/api/v1/pos/merchants/merchant/kitchen/board',
    );

    expect(answer['ok'], isTrue);
    expect(seen.last, '192.168.1.10');
  });

  test('a proxy 502 never moves a non-kitchen write to the LAN', () async {
    final seen = <String>[];
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:8099'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        seen.add(request.url.host);
        return http.Response('Bad Gateway', 502);
      }),
    );

    await expectLater(
      api.request(
        method: ApiMethod.post,
        path: '/api/v1/pos/merchants/merchant/cart/lines',
        idempotent: true,
      ),
      throwsA(isA<AppException>()),
    );
    expect(seen.where((host) => host == '192.168.1.10'), isEmpty);
  });

  test(
    'discovery supplies the LAN node when the build has no fixed hub URL',
    () async {
      final seen = <String>[];
      final api = BoundedApiClient(
        config: AppConfig(
          environment: AppEnvironment.development,
          apiBaseUri: Uri.parse('https://api.example.test'),
          telemetryEnabled: false,
          developmentDiagnostics: true,
          featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
          hardwareSimulatorEnabled: false,
          realtimeEnrollmentEnabled: false,
          release: testConfig.release,
        ),
        telemetry: SafeTelemetry(
          enabled: false,
          context: TelemetryContext.current(testConfig),
          exporter: RecordingExporter(),
        ),
        lanHubResolver: _Resolver(Uri.parse('http://192.168.1.20:4244')),
        client: MockClient((request) async {
          seen.add(request.url.host);
          if (request.url.host == 'api.example.test') {
            throw const SocketException('No route to host');
          }
          return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
        }),
      );

      final answer = await api.request(
        method: ApiMethod.post,
        path: '/api/kds/board',
        body: const {'action': 'snapshot'},
        idempotent: true,
      );

      expect(answer['ok'], isTrue);
      expect(seen.last, '192.168.1.20');
    },
  );

  test('mDNS discovery falls back to the configured hub URL', () async {
    final fallback = Uri.parse('http://192.168.1.10:4244');
    final resolver = MdnsLanHubResolver(
      fallback: fallback,
      clientFactory: () => throw StateError('mDNS unavailable'),
    );
    expect(await resolver.resolve(), fallback);
  });

  test('the hub health probe reports the LAN node separately', () async {
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:4244'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        expect(request.url.host, '192.168.1.10');
        return http.Response(
          '{"status":"ok","lanNode":true}',
          200,
          headers: _jsonHeaders,
        );
      }),
    );

    expect(await api.probeLanHub(), isTrue);
  });

  test('a KDS board read uses the LAN hub before the cloud', () async {
    final seen = <String>[];
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:4244'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        seen.add(request.url.host);
        return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
      }),
    )..preferLanRoute = (path) => path.contains('/kitchen/');

    final answer = await api.request(
      method: ApiMethod.get,
      path: '/api/v1/pos/merchants/merchant/kitchen/board',
    );

    expect(answer['ok'], isTrue);
    expect(seen, ['192.168.1.10']);
  });

  test('a KDS command uses the LAN hub before the cloud', () async {
    final seen = <String>[];
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:4244'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        seen.add(request.url.host);
        return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
      }),
    )..preferLanRoute = (path) => path.contains('/kitchen/command');

    final answer = await api.request(
      method: ApiMethod.post,
      path: '/api/v1/pos/merchants/merchant/kitchen/command',
      body: const {'commandType': 'start_preparation'},
      idempotent: true,
    );

    expect(answer['ok'], isTrue);
    expect(seen, ['192.168.1.10']);
  });

  test('a failed LAN KDS read falls back to the cloud', () async {
    final seen = <String>[];
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:4244'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        seen.add(request.url.host);
        if (request.url.host == '192.168.1.10') {
          throw const SocketException('Connection refused');
        }
        return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
      }),
    )..preferLanRoute = (path) => path.contains('/kitchen/board');

    final answer = await api.request(
      method: ApiMethod.get,
      path: '/api/v1/pos/merchants/merchant/kitchen/board',
    );

    expect(answer['ok'], isTrue);
    expect(seen.last, 'api.example.test');
    expect(seen.where((host) => host == 'api.example.test'), hasLength(1));
  });

  test('a failed LAN KDS command does not reach the cloud', () async {
    final seen = <String>[];
    final api = BoundedApiClient(
      config: AppConfig(
        environment: AppEnvironment.development,
        apiBaseUri: Uri.parse('https://api.example.test'),
        lanHubUri: Uri.parse('http://192.168.1.10:4244'),
        telemetryEnabled: false,
        developmentDiagnostics: true,
        featureBootstrapMode: FeatureBootstrapMode.localSafeDefaults,
        hardwareSimulatorEnabled: false,
        realtimeEnrollmentEnabled: false,
        release: testConfig.release,
      ),
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: MockClient((request) async {
        seen.add(request.url.host);
        if (request.url.host == '192.168.1.10') {
          throw const SocketException('Connection refused');
        }
        return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
      }),
    )..preferLanRoute = (path) => path.contains('/kitchen/command');

    await expectLater(
      api.request(
        method: ApiMethod.post,
        path: '/api/v1/pos/merchants/merchant/kitchen/command',
        body: const {'commandType': 'mark_item_ready'},
        idempotent: true,
      ),
      throwsA(isA<AppException>()),
    );

    expect(seen, everyElement('192.168.1.10'));
  });

  test('a bodyless POST does not declare a JSON request body', () async {
    late http.Request observed;
    final client = MockClient((request) async {
      observed = request;
      return http.Response(
        '{}',
        200,
        headers: {'content-type': 'application/json'},
      );
    });
    final api = BoundedApiClient(
      config: testConfig,
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      client: client,
    );

    await api.request(
      method: ApiMethod.post,
      path:
          '/api/pos/operator-sessions/00000000-0000-4000-8000-000000000001/lock',
      idempotent: true,
    );

    expect(observed.bodyBytes, isEmpty);
    expect(observed.headers.containsKey('content-type'), isFalse);
  });

  test('an expired token is renewed once and the POST is retried', () async {
    var calls = 0;
    var refreshes = 0;
    final client = MockClient((request) async {
      calls += 1;
      if (calls == 1) {
        return http.Response(_authError(), 401, headers: _jsonHeaders);
      }
      return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
    });
    final api = _client(
      client,
      sessionRefresh: () async {
        refreshes += 1;
        return true;
      },
    );

    final result = await api.request(
      method: ApiMethod.post,
      path: '/api/v1/checkout/commit',
    );

    expect(refreshes, 1);
    expect(calls, 2);
    expect(result['ok'], isTrue);
  });

  test('a dead session surfaces the original error without looping', () async {
    var calls = 0;
    var refreshes = 0;
    final client = MockClient((request) async {
      calls += 1;
      return http.Response(_authError(), 401, headers: _jsonHeaders);
    });
    final api = _client(
      client,
      sessionRefresh: () async {
        refreshes += 1;
        return false;
      },
    );

    await expectLater(
      api.request(method: ApiMethod.post, path: '/api/v1/checkout/commit'),
      throwsA(
        isA<AppException>().having(
          (e) => e.code,
          'code',
          'AUTHENTICATION_REQUIRED',
        ),
      ),
    );
    expect(refreshes, 1);
    expect(calls, 1);
  });

  test('a burst of expired requests triggers a single renewal', () async {
    var refreshes = 0;
    final gate = Completer<void>();
    // First two sends (one per concurrent request) see the expiry; the retries
    // after a single renewal succeed.
    var attempts = 0;
    final client = MockClient((request) async {
      attempts += 1;
      if (attempts <= 2) {
        return http.Response(_authError(), 401, headers: _jsonHeaders);
      }
      return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
    });
    final api = _client(
      client,
      sessionRefresh: () async {
        refreshes += 1;
        await gate.future;
        return true;
      },
    );

    final first = api.request(method: ApiMethod.get, path: '/api/v1/a');
    final second = api.request(method: ApiMethod.get, path: '/api/v1/b');
    // Let both requests reach the shared in-flight renewal before releasing it.
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    gate.complete();
    await Future.wait([first, second]);

    expect(refreshes, 1);
    expect(attempts, 4);
  });

  test('the renewal request itself does not auto-refresh', () async {
    var refreshes = 0;
    final client = MockClient((request) async {
      return http.Response(_authError(), 401, headers: _jsonHeaders);
    });
    final api = _client(
      client,
      sessionRefresh: () async {
        refreshes += 1;
        return true;
      },
    );

    await expectLater(
      api.request(
        method: ApiMethod.post,
        path: '/api/v1/auth/pos/refresh',
        authRefresh: false,
      ),
      throwsA(isA<AppException>()),
    );
    expect(refreshes, 0);
  });

  test('a local credential read failure is not a network outage', () async {
    var sent = 0;
    final api = BoundedApiClient(
      config: testConfig,
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
      deviceCredentialProvider: const _FailingCredentialProvider(),
      client: MockClient((_) async {
        sent += 1;
        return http.Response('{}', 200, headers: _jsonHeaders);
      }),
    );

    await expectLater(
      api.request(method: ApiMethod.get, path: '/health/release'),
      throwsA(
        isA<AppException>()
            .having(
              (error) => error.category,
              'category',
              AppErrorCategory.storage,
            )
            .having(
              (error) => error.code,
              'code',
              'LOCAL_CREDENTIAL_READ_FAILED',
            ),
      ),
    );
    expect(sent, 0);
  });

  test('a rate limit is not retried and the wait closes the cloud lane', () async {
    var sent = 0;
    final api = _client(
      MockClient((request) async {
        sent += 1;
        if (request.url.path == '/health/live') {
          return http.Response('{"ok":true}', 200, headers: _jsonHeaders);
        }
        return http.Response(
          jsonEncode({
            'error': {
              'code': 'RATE_LIMITED',
              'message': 'Request rate limit exceeded.',
              'retryable': true,
              'correlationId': '00000000-0000-4000-8000-000000000000',
              'details': {'retryAfterSeconds': 30},
            },
          }),
          429,
          headers: {..._jsonHeaders, 'retry-after': '30'},
        );
      }),
    );

    await expectLater(
      api.request(method: ApiMethod.get, path: '/api/v1/kitchen/board'),
      throwsA(
        isA<AppException>()
            .having((error) => error.code, 'code', 'RATE_LIMITED')
            .having(
              (error) => error.retryAfter,
              'retryAfter',
              const Duration(seconds: 30),
            ),
      ),
    );
    expect(sent, 1, reason: 'the refusal must not be sent again at once');

    await expectLater(
      api.request(method: ApiMethod.get, path: '/api/v1/kitchen/board'),
      throwsA(
        isA<AppException>().having(
          (error) => error.code,
          'code',
          'RATE_LIMITED',
        ),
      ),
    );
    expect(sent, 1, reason: 'the closed window must not touch the wire');

    final probe = await api.request(method: ApiMethod.get, path: '/health/live');
    expect(probe['ok'], true, reason: 'the probe must still learn the truth');
  });
}

final class _FailingCredentialProvider implements DeviceCredentialProvider {
  const _FailingCredentialProvider();

  @override
  Future<Map<String, String>> deviceHeaders({String? path}) =>
      throw StateError('keystore alias missing');
}

final class _Resolver implements LanHubResolver {
  const _Resolver(this.uri);
  final Uri uri;

  @override
  Future<Uri?> resolve() async => uri;
}
