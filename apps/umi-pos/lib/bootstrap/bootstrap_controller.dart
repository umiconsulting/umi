import 'package:flutter/foundation.dart';

import '../core/config/app_config.dart';
import '../core/contracts/contract_gateway.dart';
import '../core/errors/app_error.dart';
import '../core/observability/telemetry.dart';
import '../core/release/release_compatibility.dart';
import '../core/storage/storage.dart';
import 'bootstrap_state.dart';

final class BootstrapController extends ChangeNotifier {
  BootstrapController({
    required AppConfig config,
    required ContractGateway contracts,
    required ReleaseCompatibilityGateway releaseCompatibility,
    required SecureKeyValueStorage secureStorage,
    required Telemetry telemetry,
  }) : // ignore: prefer_initializing_formals
       _config = config,
       // ignore: prefer_initializing_formals
       _contracts = contracts,
       _releaseCompatibility = releaseCompatibility,
       // ignore: prefer_initializing_formals
       _secureStorage = secureStorage,
       // ignore: prefer_initializing_formals
       _telemetry = telemetry;

  final AppConfig _config;
  final ContractGateway _contracts;
  final ReleaseCompatibilityGateway _releaseCompatibility;
  final SecureKeyValueStorage _secureStorage;
  final Telemetry _telemetry;
  BootstrapState _state = const BootstrapState.initializing();
  bool _running = false;

  BootstrapState get state => _state;
  String get contractVersion => _contracts.version;

  Future<void> initialize() async {
    if (_running) return;
    _running = true;
    final stopwatch = Stopwatch()..start();
    _setState(const BootstrapState.initializing());
    try {
      final configFailure = _config.validate();
      if (configFailure != null) {
        _setState(
          BootstrapState(
            BootstrapPhase.configurationInvalid,
            diagnosticCategory: configFailure.category.name,
          ),
        );
        return;
      }
      if (!_contracts.isCompatible) {
        _setState(const BootstrapState(BootstrapPhase.sdkUnavailable));
        return;
      }
      final releaseCompatibility = await _releaseCompatibility.check();
      if (releaseCompatibility == ReleaseCompatibility.apiUnavailable) {
        _setState(
          const BootstrapState(
            BootstrapPhase.recoverableFailure,
            diagnosticCategory: 'apiUnavailable',
          ),
        );
        return;
      }
      if (releaseCompatibility != ReleaseCompatibility.compatible) {
        _setState(
          BootstrapState(
            BootstrapPhase.unrecoverableFailure,
            diagnosticCategory: releaseCompatibility.name,
          ),
        );
        return;
      }
      final storage = await _secureStorage.healthCheck();
      if (!storage.available) {
        _setState(
          BootstrapState(
            BootstrapPhase.storageUnavailable,
            diagnosticCategory: storage.category,
          ),
        );
        return;
      }
      _setState(const BootstrapState(BootstrapPhase.readyForAuthentication));
    } on AppException catch (error) {
      _setState(
        BootstrapState(
          error.recoverable
              ? BootstrapPhase.recoverableFailure
              : BootstrapPhase.unrecoverableFailure,
          correlationId: error.correlationId,
          diagnosticCategory: error.category.name,
        ),
      );
    } catch (_) {
      _setState(
        const BootstrapState(
          BootstrapPhase.unrecoverableFailure,
          diagnosticCategory: 'unknown',
        ),
      );
    } finally {
      stopwatch.stop();
      _telemetry.event(
        ClientEvent(
          name: 'bootstrap.completed',
          values: {
            'phase': _state.phase.name,
            'durationBucket': _durationBucket(stopwatch.elapsed),
          },
        ),
      );
      _running = false;
    }
  }

  Future<void> retry() => initialize();

  void _setState(BootstrapState next) {
    _state = next;
    notifyListeners();
  }

  String _durationBucket(Duration duration) {
    if (duration < const Duration(milliseconds: 250)) return 'under_250ms';
    if (duration < const Duration(seconds: 1)) return 'under_1s';
    if (duration < const Duration(seconds: 5)) return 'under_5s';
    return 'over_5s';
  }
}
