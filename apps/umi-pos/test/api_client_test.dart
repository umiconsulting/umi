import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';

import 'support/fakes.dart';

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
}
