import '../config/app_config.dart';
import '../network/api_client.dart';

enum ReleaseCompatibility {
  compatible,
  upgradeRequired,
  serverUpgradeRequiredFoundation,
  unsupported,
  apiUnavailable,
}

abstract interface class ReleaseCompatibilityGateway {
  Future<ReleaseCompatibility> check();
}

final class ApiReleaseCompatibilityGateway
    implements ReleaseCompatibilityGateway {
  const ApiReleaseCompatibilityGateway({
    required ApiClient api,
    required AppConfig config,
  }) : _api = api,
       _config = config;

  final ApiClient _api;
  final AppConfig _config;

  @override
  Future<ReleaseCompatibility> check() async {
    Map<String, Object?> server;
    try {
      server = await _api.request(
        method: ApiMethod.get,
        path: '/health/release',
      );
    } catch (_) {
      return ReleaseCompatibility.apiUnavailable;
    }
    if (server['environment'] != _config.environment.name) {
      return ReleaseCompatibility.unsupported;
    }
    final serverContract = _version(server['contractVersion']);
    final clientContract = _version(_config.release.contractVersion);
    final minimumPos = _version(server['minimumPosVersion']);
    final clientVersion = _version(_config.release.version);
    if ([
      serverContract,
      clientContract,
      minimumPos,
      clientVersion,
    ].contains(null)) {
      return ReleaseCompatibility.unsupported;
    }
    if (_compare(clientVersion!, minimumPos!) < 0) {
      return ReleaseCompatibility.upgradeRequired;
    }
    if (serverContract![0] > clientContract![0]) {
      return ReleaseCompatibility.upgradeRequired;
    }
    if (serverContract[0] < clientContract[0]) {
      return ReleaseCompatibility.serverUpgradeRequiredFoundation;
    }
    return ReleaseCompatibility.compatible;
  }

  List<int>? _version(Object? value) {
    final match = RegExp(r'^(\d+)\.(\d+)\.(\d+)').firstMatch('$value');
    if (match == null) return null;
    return [
      for (var index = 1; index <= 3; index += 1)
        int.parse(match.group(index)!),
    ];
  }

  int _compare(List<int> left, List<int> right) {
    for (var index = 0; index < 3; index += 1) {
      if (left[index] != right[index]) {
        return left[index].compareTo(right[index]);
      }
    }
    return 0;
  }
}
