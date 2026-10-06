import '../config/app_config.dart';

enum FeatureKey {
  authentication,
  enrollment,
  catalog,
  checkout,
  offline,
  diagnostics,
}

final class FeatureFlag {
  const FeatureFlag({
    required this.key,
    required this.enabled,
    required this.source,
  });
  final FeatureKey key;
  final bool enabled;
  final String source;
}

final class FeatureFlags {
  const FeatureFlags._(this._values);

  factory FeatureFlags.bootstrap(FeatureBootstrapMode mode) {
    final diagnostics = mode == FeatureBootstrapMode.localSafeDefaults;
    return FeatureFlags._({
      for (final key in FeatureKey.values)
        key: FeatureFlag(
          key: key,
          enabled: key == FeatureKey.diagnostics && diagnostics,
          source: 'environment-bootstrap',
        ),
    });
  }

  final Map<FeatureKey, FeatureFlag> _values;
  FeatureFlag flag(FeatureKey key) => _values[key]!;
  bool get diagnostics => flag(FeatureKey.diagnostics).enabled;
}
