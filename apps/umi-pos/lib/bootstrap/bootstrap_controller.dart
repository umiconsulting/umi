import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../core/config/app_config.dart';
import '../core/contracts/contract_gateway.dart';
import '../core/errors/app_error.dart';
import '../core/observability/telemetry.dart';
import '../core/release/release_compatibility.dart';
import '../core/security/credential_vault.dart';
import '../core/storage/storage.dart';
import 'bootstrap_state.dart';

final class BootstrapController extends ChangeNotifier {
  BootstrapController({
    required AppConfig config,
    required ContractGateway contracts,
    required ReleaseCompatibilityGateway releaseCompatibility,
    required SecureKeyValueStorage secureStorage,
    required PreferencesStore preferences,
    required Telemetry telemetry,
  }) : // ignore: prefer_initializing_formals
       _config = config,
       // ignore: prefer_initializing_formals
       _contracts = contracts,
       _releaseCompatibility = releaseCompatibility,
       // ignore: prefer_initializing_formals
       _secureStorage = secureStorage,
       // ignore: prefer_initializing_formals
       _preferences = preferences,
       // ignore: prefer_initializing_formals
       _telemetry = telemetry;

  final AppConfig _config;
  final ContractGateway _contracts;
  final ReleaseCompatibilityGateway _releaseCompatibility;
  final SecureKeyValueStorage _secureStorage;
  final PreferencesStore _preferences;
  final Telemetry _telemetry;
  BootstrapState _state = const BootstrapState.initializing();
  bool _running = false;
  bool _provenCompatibility = false;

  static const _compatibilityKey = 'bootstrap.compatibility_proof.v1';
  static const _compatibilityPreferenceKey =
      'bootstrap.compatibility_proof.v1';
  static const _lastFailureKey = 'bootstrap.last_failure';
  static const _proofValidity = Duration(days: 7);

  /// Records that this build's contract was verified against a live API.
  Future<void> _rememberCompatibility() async {
    final value = jsonEncode({
      'contract': _contracts.version,
      'release': _config.release.version,
      'at': DateTime.now().toUtc().toIso8601String(),
    });
    try {
      await _secureStorage.write(_compatibilityKey, value);
    } catch (_) {
      // Losing the marker only costs an offline start later; never fail boot.
    }
    // The secure store can lose access to a value while the application data
    // remains installable, notably across an APK replacement. This copy is not
    // a credential: it only names the release that this till already proved.
    // Device trust and the encrypted journal remain in the secure store.
    try {
      await _preferences.writeString(_compatibilityPreferenceKey, value);
    } catch (_) {
      // The secure marker still covers the normal path.
    }
  }

  /// True when *this* contract and release were verified here, recently.
  Future<bool> _lastCompatibilityProven() async {
    try {
      final raw = await _secureStorage.read(_compatibilityKey);
      if (_proofIsValid(raw)) return true;
    } catch (_) {
      // Try the install-scoped copy below.
    }
    try {
      return _proofIsValid(
        await _preferences.readString(_compatibilityPreferenceKey),
      );
    } catch (_) {
      return false;
    }
  }

  bool _proofIsValid(String? raw) {
    if (raw == null) return false;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return false;
      if (decoded['contract'] != _contracts.version) return false;
      if (decoded['release'] != _config.release.version) return false;
      final at = DateTime.tryParse(decoded['at'] as String? ?? '');
      if (at == null) return false;
      return DateTime.now().toUtc().difference(at.toUtc()) <= _proofValidity;
    } catch (_) {
      return false;
    }
  }

  /// A recent entry snapshot is a state this device obtained from the API.
  ///
  /// It carries the same trust that offline operator restore already uses.
  /// Requiring a second marker after an APK replacement blocked a valid till
  /// when secure storage lost only that marker.
  Future<bool> _lastEnrolledStateProven() async {
    try {
      final raw = await _secureStorage.read(CredentialVault.entrySnapshotKey);
      if (raw == null) return false;
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return false;
      final at = DateTime.tryParse(decoded['savedAt'] as String? ?? '');
      if (at == null) return false;
      return DateTime.now().toUtc().difference(at.toUtc()) <= _proofValidity;
    } catch (_) {
      return false;
    }
  }

  BootstrapState get state => _state;
  String get contractVersion => _contracts.version;

  Future<void> initialize() async {
    if (_running) return;
    _running = true;
    _provenCompatibility = false;
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
        // A till that has already proven this exact build against the API keeps
        // that proof. Refusing to start because the uplink is down turns a
        // network outage into "the POS does not open", which is the one outcome
        // local-first exists to prevent. Anything that is not this build's own
        // recorded proof — a different contract, a different release, or a
        // marker older than the serving window — still fails as before.
        if (await _lastCompatibilityProven() ||
            await _lastEnrolledStateProven()) {
          _provenCompatibility = true;
          _telemetry.event(
            const ClientEvent(name: 'bootstrap.offline_compatible'),
          );
        } else {
          _setState(
            const BootstrapState(
              BootstrapPhase.recoverableFailure,
              diagnosticCategory: 'apiUnavailable',
            ),
          );
          return;
        }
      }
      if (releaseCompatibility != ReleaseCompatibility.compatible &&
          !(releaseCompatibility == ReleaseCompatibility.apiUnavailable &&
              _provenCompatibility)) {
        _setState(
          BootstrapState(
            BootstrapPhase.unrecoverableFailure,
            diagnosticCategory: releaseCompatibility.name,
          ),
        );
        return;
      }
      if (releaseCompatibility == ReleaseCompatibility.compatible) {
        await _rememberCompatibility();
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
    final failed = next.phase == BootstrapPhase.recoverableFailure ||
        next.phase == BootstrapPhase.unrecoverableFailure ||
        next.phase == BootstrapPhase.configurationInvalid ||
        next.phase == BootstrapPhase.storageUnavailable;
    if (failed) {
      unawaited(
        _preferences.writeString(
          _lastFailureKey,
          '${next.phase.name}|${next.diagnosticCategory ?? 'unknown'}',
        ),
      );
    }
    if (_config.developmentDiagnostics || failed) {
      // A failed bootstrap is otherwise an opaque card, and the card is the
      // same for several phases. Name the phase, the category and the client's
      // own identity so the log answers "why did it stop" without a debugger.
      debugPrint(
        'umi_pos.bootstrap phase=${next.phase.name} '
        'category=${next.diagnosticCategory ?? '-'} '
        'correlation=${next.correlationId ?? '-'} '
        'clientContract=${_config.release.contractVersion} '
        'clientVersion=${_config.release.version} '
        'environment=${_config.environment.name}',
      );
    }
    notifyListeners();
  }

  String _durationBucket(Duration duration) {
    if (duration < const Duration(milliseconds: 250)) return 'under_250ms';
    if (duration < const Duration(seconds: 1)) return 'under_1s';
    if (duration < const Duration(seconds: 5)) return 'under_5s';
    return 'over_5s';
  }
}
