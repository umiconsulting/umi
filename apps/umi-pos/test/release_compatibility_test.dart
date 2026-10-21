import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/errors/app_error.dart';
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

  test('a local storage failure stays visible by category', () async {
    final gateway = ApiReleaseCompatibilityGateway(
      api: _ReleaseApi(
        error: const AppException(
          category: AppErrorCategory.storage,
          code: 'LOCAL_CREDENTIAL_READ_FAILED',
          recoverable: false,
        ),
      ),
      config: pilotTestConfig,
    );

    await expectLater(
      gateway.check(),
      throwsA(
        isA<AppException>().having(
          (error) => error.category,
          'category',
          AppErrorCategory.storage,
        ),
      ),
    );
  });
}

final class _ReleaseApi implements ApiClient {
  _ReleaseApi({
    this.environment = 'pilot',
    this.minimumPosVersion = '0.1.0',
    this.error,
  });

  final String environment;
  final String minimumPosVersion;
  final AppException? error;

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
    if (error != null) throw error!;
    return {
      'environment': environment,
      'contractVersion': '2.12.0',
      'minimumPosVersion': minimumPosVersion,
    };
  }

  @override
  void dispose() {}
}
