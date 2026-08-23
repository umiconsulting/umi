import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/release/release_compatibility.dart';

import 'support/fakes.dart';

void main() {
  test('accepts a matching pilot release', () async {
    final gateway = ApiReleaseCompatibilityGateway(
      api: _ReleaseApi(),
      config: pilotTestConfig,
    );
    expect(await gateway.check(), ReleaseCompatibility.compatible);
  });

  test('requires an update below the server minimum', () async {
    final gateway = ApiReleaseCompatibilityGateway(
      api: _ReleaseApi(minimumPosVersion: '1.0.0'),
      config: pilotTestConfig,
    );
    expect(await gateway.check(), ReleaseCompatibility.upgradeRequired);
  });

  test('rejects an environment mismatch', () async {
    final gateway = ApiReleaseCompatibilityGateway(
      api: _ReleaseApi(environment: 'production'),
      config: pilotTestConfig,
    );
    expect(await gateway.check(), ReleaseCompatibility.unsupported);
  });
}

final class _ReleaseApi implements ApiClient {
  _ReleaseApi({this.environment = 'pilot', this.minimumPosVersion = '0.1.0'});

  final String environment;
  final String minimumPosVersion;

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
  }) async => {
    'environment': environment,
    'contractVersion': '2.12.0',
    'minimumPosVersion': minimumPosVersion,
  };

  @override
  void dispose() {}
}
