import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/network/api_client.dart';
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
}
