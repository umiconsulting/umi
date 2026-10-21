import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/navigation/app_navigation.dart';
import '../../core/observability/telemetry.dart';
import '../../core/security/credential_vault.dart';
import 'entry_gateway.dart';

enum EntryPhase {
  checkingDevice,
  restoringSession,
  enrollmentRequired,
  enrollmentPending,
  pinRequired,
  pinAuthenticating,
  authenticationRequired,
  authenticating,
  tenantRequired,
  branchRequired,
  operatorRequired,
  startingOperator,
  ready,
  deviceRevoked,
  rotationRequired,
  recoverableFailure,
  storageFailure,
}

final class EntryState {
  const EntryState(
    this.phase, {
    this.device,
    this.merchants = const [],
    this.selectedTenant,
    this.selectedBranch,
    this.operator,
    this.errorCode,
  });
  final EntryPhase phase;
  final DeviceSummary? device;
  final List<EntryMerchant> merchants;
  final EntryMerchant? selectedTenant;
  final LocationAccess? selectedBranch;
  final OperatorSessionView? operator;
  final String? errorCode;
}

final class EntryController extends ChangeNotifier {
  EntryController({
    required EntryGateway gateway,
    required CredentialVault vault,
    required Telemetry telemetry,
    Duration? idleTimeout,
  }) : _gateway = gateway,
       _vault = vault,
       _telemetry = telemetry,
       _idleTimeout = idleTimeout;

  final EntryGateway _gateway;
  final CredentialVault _vault;
  final Telemetry _telemetry;

  /// Retira el destino de avisos antes de cerrar una sesión de forma explícita.
  /// Un fallo de red no impide el cierre; el servidor también revoca la sesión.
  Future<void> Function()? beforeLogout;

  /// How long an operator may stay idle at a ready till before the POS locks
  /// itself and asks for the PIN again. Null disables the auto-lock, which is
  /// the default in tests; the composition root sets a real value in the app.
  final Duration? _idleTimeout;
  Timer? _idleTimer;

  /// A cold start may restore the operator session silently only when the app
  /// restarted within this window of the last proven session (login or
  /// refresh). Past it, or with no saved session, the POS falls back to the
  /// personal PIN. An explicit [lock] always requires the PIN regardless.
  static const _restoreWindow = Duration(minutes: 5);

  /// How long a server-issued operator session may reopen without the API.
  ///
  /// The five-minute window above protects an online restart: a PIN is one tap
  /// away. Offline, that same rule blocks the only route back into a valid
  /// shift. The snapshot still has to name this device, an active operator, a
  /// matching tenant and branch, and an unexpired server session.
  static const _offlineRestoreWindow = Duration(hours: 12);
  static const _localEntryTimeout = Duration(seconds: 10);

  int _pairingGeneration = 0;

  /// The realtime nudge subscription for the current pairing attempt. It is
  /// keyed to `_pairingGeneration`, exactly like the poll loop, so one counter
  /// cancels both.
  ///
  /// Cancelled through `_cancelPairingWatch`, which hands the handle to a local
  /// before it awaits: the lint only reads the one method that creates it.
  // ignore: cancel_subscriptions
  StreamSubscription<void>? _pairingWatch;

  /// Guards against a burst of nudges producing a burst of polls.
  bool _nudgeInFlight = false;
  EntryState _state = const EntryState(EntryPhase.checkingDevice);
  EntryState get state => _state;

  /// Display name of the operator who holds the current turn, taken from the
  /// PIN-login / refresh session envelope (`session.user.displayName`, backed by
  /// `umi.user.full_name`). Null until a session is saved; cleared on logout.
  /// Shown as a welcome in the till app bar. `OperatorSessionView` carries no
  /// name, so this is the only place the operator's name reaches the UI.
  String? _operatorName;
  String? get operatorName => _operatorName;
  TrustedEntryStage get navigationStage => switch (_state.phase) {
    EntryPhase.enrollmentRequired ||
    EntryPhase.enrollmentPending => TrustedEntryStage.enrollment,
    EntryPhase.authenticationRequired ||
    EntryPhase.authenticating ||
    EntryPhase.pinRequired ||
    EntryPhase.pinAuthenticating => TrustedEntryStage.authentication,
    EntryPhase.tenantRequired => TrustedEntryStage.tenant,
    EntryPhase.branchRequired => TrustedEntryStage.branch,
    EntryPhase.operatorRequired ||
    EntryPhase.startingOperator => TrustedEntryStage.operator,
    EntryPhase.ready => TrustedEntryStage.ready,
    EntryPhase.checkingDevice ||
    EntryPhase.restoringSession => TrustedEntryStage.authentication,
    _ => TrustedEntryStage.blocked,
  };

  Future<void> initialize() async {
    _set(const EntryState(EntryPhase.checkingDevice));
    try {
      final identity = await _vault.deviceIdentity().timeout(
        _localEntryTimeout,
      );
      if (!identity.isEnrolled) {
        final pairing = await _vault.pairingIdentity().timeout(
          _localEntryTimeout,
        );
        if (pairing != null && pairing.expiresAt.isAfter(DateTime.now())) {
          _set(const EntryState(EntryPhase.enrollmentPending));
          _beginPairingWait(pairing);
          return;
        }
        if (pairing != null) await _vault.clearPairing();
        _set(const EntryState(EntryPhase.enrollmentRequired));
        return;
      }
      final pendingAcknowledgement = await _vault.pairingIdentity().timeout(
        _localEntryTimeout,
      );
      if (pendingAcknowledgement != null && identity.credential != null) {
        try {
          await _gateway.acknowledgePairing(
            pendingAcknowledgement,
            identity.credential!,
          );
          await _vault.clearPairing();
        } catch (_) {
          // Device authentication remains safe. The next bootstrap retries this
          // acknowledgement with the same persisted pairing session.
        }
      }
      final DeviceSummary device;
      try {
        device = await _gateway.deviceStatus();
      } on AppException catch (error) {
        if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
          debugPrint(
            '[umipos] entry deviceStatus failed code=${error.code} category=${error.category.name}',
          );
        }
        if (await _restoreOffline(error)) return;
        rethrow;
      }
      if (device.state == 'revoked' || device.state == 'replaced') {
        await _vault.clearDeviceTrust();
        _set(EntryState(EntryPhase.deviceRevoked, device: device));
        return;
      }
      if (device.rotationRequired) {
        _set(EntryState(EntryPhase.rotationRequired, device: device));
        return;
      }
      // A durable server session can survive a brief restart, such as a crash
      // or an OS relaunch. Within a short grace window the POS restores the
      // operator session silently; past it, or with no saved session, it falls
      // back to the personal PIN. An explicit lock always requires the PIN.
      //
      // The decision is made BEFORE the keypad is published, and that ordering
      // is the point rather than a detail. This used to publish `pinRequired`
      // first and ask second, so a cold till drew a live keypad for the whole
      // beat it spent deciding. An operator who began typing had the screen
      // taken away mid-PIN: the digits were discarded with no rejection and no
      // log line, and the till landed in the previous operator's catalog. From
      // the operator's side it looks like a sign-in that silently did not
      // happen. A real keypad sign-in measured two of its four digits landing
      // in exactly that window. A spinner while the till decides is the honest
      // screen; `pinRequired` is published only once there is nothing left to
      // decide, and `restoreSession` publishes it itself when the restore is
      // refused or fails.
      _set(EntryState(EntryPhase.restoringSession, device: device));
      if (await _canRestoreSession()) {
        await restoreSession();
        return;
      }
      _set(EntryState(EntryPhase.pinRequired, device: device));
      await _vault.clearSession();
    } on TimeoutException {
      // A stalled secure-storage read must not leave the terminal on a spinner.
      debugPrint('umi_pos.entry timeout=local_credential_read');
      _set(
        const EntryState(
          EntryPhase.storageFailure,
          errorCode: 'ENTRY_STORAGE_TIMEOUT',
        ),
      );
    } on AppException catch (error) {
      if (error.code == 'DEVICE_REVOKED' ||
          error.code == 'DEVICE_CREDENTIAL_INVALID') {
        await _vault.clearDeviceTrust();
        _set(EntryState(EntryPhase.deviceRevoked, errorCode: error.code));
      } else {
        _set(EntryState(EntryPhase.recoverableFailure, errorCode: error.code));
      }
    } catch (_) {
      _set(
        const EntryState(
          EntryPhase.storageFailure,
          errorCode: 'ENTRY_STORAGE_FAILURE',
        ),
      );
    }
  }

  Future<void> enroll(String code) async {
    _set(const EntryState(EntryPhase.enrollmentPending));
    try {
      final result = await _gateway.claimPairing(code);
      await _vault.savePairing(
        sessionId: result.pairingSessionId,
        pollingCredential: result.pollingCredential,
        expiresAt: result.expiresAt,
      );
      _event('device.enrollment_claimed');
      final pairing = await _vault.pairingIdentity();
      if (pairing == null) throw StateError('pairing persistence failed');
      _beginPairingWait(pairing);
    } on AppException catch (error) {
      _event('device.enrollment_failed', error.code);
      // The screen shows one friendly sentence for every failure — including
      // "the request never left the device" and "the keystore refused" — so the
      // console has to carry the distinguishing fact. Measured on a real iPhone
      // against staging: the dashboard created the enrollment (201) and the API
      // never saw a `POST /api/v1/devices/pairing/claim`, while Safari on the
      // same phone reached `/health/release` in the same minute. This line is
      // what tells us which half failed next time.
      debugPrint(
        '[umipos] enrollment failed code=${error.code} '
        'category=${error.category.name} correlationId=${error.correlationId}',
      );
      _set(EntryState(EntryPhase.enrollmentRequired, errorCode: error.code));
    } catch (error, stack) {
      // Anything that is NOT an AppException — a PlatformException from the
      // Secure Enclave signer is the one that matters, because `claimPairing`
      // asks the keystore for a public key before it builds the request. It used
      // to escape this method entirely, which is why the screen could be blank of
      // any explanation at all.
      debugPrint('[umipos] enrollment threw ${error.runtimeType}: $error');
      debugPrintStack(stackTrace: stack, maxFrames: 6);
      _set(
        const EntryState(
          EntryPhase.enrollmentRequired,
          errorCode: 'UNEXPECTED_CLIENT_ERROR',
        ),
      );
    }
  }

  @override
  void dispose() {
    // Retire the generation first: it stops the poll loop and makes any nudge
    // already in flight a no-op before the subscription goes away.
    _pairingGeneration++;
    _idleTimer?.cancel();
    unawaited(_cancelPairingWatch());
    super.dispose();
  }

  Future<void> cancelPairing() async {
    _pairingGeneration++;
    await _cancelPairingWatch();
    await _vault.clearPairing();
    _set(const EntryState(EntryPhase.enrollmentRequired));
  }

  Future<void> retryPairing() async {
    final pairing = await _vault.pairingIdentity();
    if (pairing == null) {
      _set(const EntryState(EntryPhase.enrollmentRequired));
      return;
    }
    _set(const EntryState(EntryPhase.enrollmentPending));
    _beginPairingWait(pairing);
  }

  /// Starts both paths for one pairing attempt: the poll loop, which is
  /// authoritative, and the realtime nudge, which only makes it react sooner.
  void _beginPairingWait(PairingIdentity pairing) {
    final generation = ++_pairingGeneration;
    unawaited(_pollPairing(pairing, generation));
    _watchPairing(pairing, generation);
  }

  void _watchPairing(PairingIdentity pairing, int generation) {
    unawaited(_cancelPairingWatch());
    _pairingWatch = _gateway
        .watchPairing(pairing)
        .listen(
          (_) => unawaited(_onPairingNudge(pairing, generation)),
          // A realtime failure is not an enrollment failure. The poll loop is
          // still running and still decides the outcome.
          onError: (Object _) {},
          cancelOnError: false,
        );
  }

  Future<void> _cancelPairingWatch() async {
    // Take the handle and clear the field *before* awaiting the cancel.
    // `_watchPairing` cancels and then immediately installs the next watch, so
    // an `await` between those two steps let this continuation land afterwards
    // and null out the subscription that replaced it — which orphaned a live
    // listener on the realtime channel for the rest of the shift.
    final previous = _pairingWatch;
    _pairingWatch = null;
    await previous?.cancel();
  }

  /// A nudge says the state moved; it never carries the credential. So the
  /// device polls once, through the same handler the loop uses.
  Future<void> _onPairingNudge(PairingIdentity pairing, int generation) async {
    if (generation != _pairingGeneration || _nudgeInFlight) return;
    _nudgeInFlight = true;
    try {
      final response = await _gateway.pollPairing(pairing);
      if (generation != _pairingGeneration) return;
      if (await _handlePollResponse(response, pairing, generation)) {
        // The attempt is over. Retiring the generation stops the poll loop from
        // waking up and collecting a second credential.
        _pairingGeneration++;
        await _cancelPairingWatch();
      }
    } on AppException catch (_) {
      // Swallowed on purpose: the poll loop owns error handling and retries.
    } finally {
      _nudgeInFlight = false;
    }
  }

  Future<void> _pollPairing(PairingIdentity pairing, int generation) async {
    while (generation == _pairingGeneration &&
        pairing.expiresAt.isAfter(DateTime.now())) {
      try {
        final response = await _gateway.pollPairing(pairing);
        if (generation != _pairingGeneration) return;
        if (await _handlePollResponse(response, pairing, generation)) return;
        await Future<void>.delayed(
          Duration(seconds: response.pollAfterSeconds),
        );
      } on AppException catch (error) {
        if (error.code == 'ENROLLMENT_REJECTED') {
          await _vault.clearPairing();
          _set(
            EntryState(EntryPhase.enrollmentRequired, errorCode: error.code),
          );
          return;
        }
        _set(EntryState(EntryPhase.enrollmentPending, errorCode: error.code));
        await Future<void>.delayed(const Duration(seconds: 3));
      }
    }
    if (generation == _pairingGeneration) {
      await _cancelPairingWatch();
      await _vault.clearPairing();
      _set(
        const EntryState(
          EntryPhase.enrollmentRequired,
          errorCode: 'ENROLLMENT_EXPIRED',
        ),
      );
    }
  }

  /// The one place a poll response is interpreted, so the loop and the nudge
  /// can never diverge. Returns true when the pairing attempt is finished.
  Future<bool> _handlePollResponse(
    DevicePairingPollResponse response,
    PairingIdentity pairing,
    int generation,
  ) async {
    if (generation != _pairingGeneration) return true;
    if (response.state == 'awaiting_approval') {
      _set(const EntryState(EntryPhase.enrollmentPending));
      return false;
    }
    if (response.state == 'denied' ||
        response.state == 'expired' ||
        response.state == 'cancelled') {
      await _cancelPairingWatch();
      await _vault.clearPairing();
      _set(
        EntryState(
          EntryPhase.enrollmentRequired,
          errorCode: response.state == 'denied'
              ? 'ENROLLMENT_REJECTED'
              : 'ENROLLMENT_EXPIRED',
        ),
      );
      return true;
    }
    if (response.device != null && response.credential != null) {
      await _acceptCredential(response, pairing);
      return true;
    }
    return false;
  }

  /// The single write path for a delivered credential. Both the poll loop and
  /// the nudge reach the device credential through here, so it is stored and
  /// acknowledged exactly once.
  Future<void> _acceptCredential(
    DevicePairingPollResponse response,
    PairingIdentity pairing,
  ) async {
    final device = DeviceSummary.fromJson(response.device!);
    await _vault.saveDevice(
      id: device.id,
      publicId: device.publicId,
      credential: response.credential!,
      credentialVersion: device.credentialVersion,
      state: device.state,
      merchantId: device.merchantId,
      locationId: device.locationId,
    );
    try {
      await _gateway.acknowledgePairing(pairing, response.credential!);
      await _vault.clearPairing();
    } catch (_) {
      // Keep the pairing session. Bootstrap retries the same
      // acknowledgement without issuing a second credential.
    }
    await _cancelPairingWatch();
    _event('device.enrollment_completed');
    _set(EntryState(EntryPhase.pinRequired, device: device));
  }

  Future<void> login(String username, String password) async {
    _set(EntryState(EntryPhase.authenticating, device: _state.device));
    try {
      final response = await _gateway.login(username, password);
      await _saveSession(response);
      _event('authentication.succeeded');
      await _resolveContext();
    } on AppException catch (error) {
      _event('authentication.failed', error.code);
      _set(
        EntryState(
          EntryPhase.authenticationRequired,
          device: _state.device,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<void> loginWithPin(String pin) async {
    final device = _state.device;
    final merchantId = device?.merchantId;
    final locationId = device?.locationId;
    if (merchantId == null || locationId == null) {
      _set(
        EntryState(
          EntryPhase.pinRequired,
          device: device,
          errorCode: 'BRANCH_NOT_FOUND',
        ),
      );
      return;
    }
    _set(EntryState(EntryPhase.pinAuthenticating, device: device));
    try {
      final response = await _gateway.pinLogin(
        pin: pin,
        merchantId: merchantId,
        locationId: locationId,
      );
      await _saveSession(response);
      _event('authentication.pin_succeeded');
      // `_resolveContext` drives the rest of the chain — tenant, branch, and
      // then `startOperator` — on its own, so the PIN lands straight on the
      // menu with a single spinner and no intermediate operator screen.
      await _resolveContext();
    } on AppException catch (error) {
      _event('authentication.pin_failed', error.code);
      // The server rejected the proof, not the PIN. The device key that
      // enrolled this till is not the key that signs now, so no PIN can pass.
      // Send the operator to enrollment instead of clearing the PIN forever.
      final reason = error.details?['reason'];
      if (error.code == 'DEVICE_PROOF_INVALID' ||
          error.code == 'DEVICE_CREDENTIAL_ROTATED' ||
          reason == 'DEVICE_PROOF_INVALID' ||
          reason == 'DEVICE_PROOF_REQUIRED') {
        await _vault.clearDeviceTrust();
        _set(
          EntryState(
            EntryPhase.enrollmentRequired,
            errorCode: error.code,
          ),
        );
        return;
      }
      _set(
        EntryState(
          EntryPhase.pinRequired,
          device: device,
          errorCode: error.code,
        ),
      );
    }
  }

  /// True when a cold start may restore the operator session without a PIN:
  /// a refresh token is present and the last proven session is within the
  /// [_restoreWindow]. Fails closed on any missing or unreadable timestamp.
  Future<bool> _canRestoreSession() async {
    if (await _vault.refreshToken() == null) return false;
    final lastActive = await _vault.sessionActivityAt();
    if (lastActive == null) return false;
    return DateTime.now().toUtc().difference(lastActive.toUtc()) <=
        _restoreWindow;
  }

  Future<bool> _canRestoreOfflineSession() async {
    if (await _vault.refreshToken() == null) return false;
    final lastActive = await _vault.sessionActivityAt();
    if (lastActive == null) return false;
    return DateTime.now().toUtc().difference(lastActive.toUtc()) <=
        _offlineRestoreWindow;
  }

  /// Renews and persists the access token without changing the entry phase.
  /// The API client calls this when a request meets an expired token, so a
  /// long shift keeps working without a fresh PIN. Returns false on failure,
  /// which lets the original request surface its own authentication error.
  Future<bool> renewAccessToken() async {
    try {
      final response = await _gateway.refresh();
      await _saveSession(response);
      _event('session.renewed');
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<void> restoreSession() async {
    try {
      final response = await _gateway.refresh();
      await _saveSession(response);
      _event('session.renewed');
      // `_resolveContext` brings the operator all the way back to a working
      // till (tenant, branch, then `startOperator`) when the device already
      // knows its tenant and branch, mirroring loginWithPin.
      await _resolveContext();
    } catch (_) {
      await _vault.clearSession();
      _set(EntryState(EntryPhase.pinRequired, device: _state.device));
    }
  }

  Future<void> selectTenant(EntryMerchant tenant) async {
    await _vault.selectTenant(tenant.id);
    _event('tenant.selected');
    final locations = tenant.locations
        .map(LocationAccess.fromJson)
        .where((b) => b.deviceAllowed && b.operatorAllowed)
        .toList();
    if (locations.length == 1) {
      await selectBranch(tenant, locations.single);
    } else {
      _set(
        EntryState(
          EntryPhase.branchRequired,
          device: _state.device,
          merchants: _state.merchants,
          selectedTenant: tenant,
        ),
      );
    }
  }

  Future<void> selectBranch(EntryMerchant tenant, LocationAccess branch) async {
    if (branch.merchantId != tenant.id ||
        branch.status != 'active' ||
        !branch.deviceAllowed ||
        !branch.operatorAllowed) {
      _set(
        EntryState(EntryPhase.branchRequired, errorCode: 'BRANCH_NOT_FOUND'),
      );
      return;
    }
    await _vault.selectBranch(branch.id);
    _event('branch.selected');
    // Start the operator session automatically once the branch is known — both
    // on the auto path after a PIN and after a manual branch pick — so the
    // operator never has to tap a separate "start operator" button. The screen
    // stays on the spinner (`startingOperator`) until the till is ready.
    _set(
      EntryState(
        EntryPhase.startingOperator,
        device: _state.device,
        merchants: _state.merchants,
        selectedTenant: tenant,
        selectedBranch: branch,
      ),
    );
    await startOperator();
  }

  Future<void> startOperator() async {
    final tenant = _state.selectedTenant;
    final branch = _state.selectedBranch;
    if (tenant == null || branch == null) return;
    // Show the spinner while the session is created. This also covers a manual
    // retry from the operator error screen.
    _set(
      EntryState(
        EntryPhase.startingOperator,
        device: _state.device,
        merchants: _state.merchants,
        selectedTenant: tenant,
        selectedBranch: branch,
      ),
    );
    try {
      final operator = await _gateway.startOperator(tenant.id, branch.id);
      await _vault.saveOperatorSession(operator.id);
      await _rememberResolvedState(
        device: _state.device,
        tenant: tenant,
        branch: branch,
        operator: operator,
      );
      _event('operator.started');
      _set(
        EntryState(
          EntryPhase.ready,
          device: _state.device,
          merchants: _state.merchants,
          selectedTenant: tenant,
          selectedBranch: branch,
          operator: operator,
        ),
      );
    } on AppException catch (error) {
      // Keep the resolved context so the operator error screen can retry
      // `startOperator` without losing the tenant/branch it needs.
      _set(
        EntryState(
          EntryPhase.operatorRequired,
          device: _state.device,
          merchants: _state.merchants,
          selectedTenant: tenant,
          selectedBranch: branch,
          errorCode: error.code,
        ),
      );
    }
  }

  /// Keep the state the server resolved, so a cold start with no uplink can
  /// land on the catalogue instead of on "we could not finish preparing".
  Future<void> _rememberResolvedState({
    required DeviceSummary? device,
    required EntryMerchant tenant,
    required LocationAccess branch,
    required OperatorSessionView operator,
  }) async {
    try {
      await _vault.saveEntrySnapshot({
        'device': device?.toJson(),
        'tenant': tenant.toJson(),
        'branch': branch.toJson(),
        'operator': operator.toJson(),
        'operatorName': _operatorName,
        'savedAt': DateTime.now().toUtc().toIso8601String(),
      });
    } catch (_) {
      // A cache write must never fail a login that already succeeded.
    }
  }

  /// Boot from the remembered state when the API cannot be reached.
  ///
  /// Returns false — leaving the caller to report the failure it was already
  /// reporting — unless this is a transport/timeout failure *and* the cached
  /// session is still provably this device's: same device id, active, not yet
  /// expired, and inside the same restore window the silent refresh uses.
  /// Nothing here mints trust; it replays a state the server itself issued.
  Future<bool> _restoreOffline(AppException error) async {
    // `server` is in the list on purpose: the till talks to staging/production
    // through a proxy, so a dead backend arrives as a 502 rather than as a
    // transport error. Credential and permission failures are never in the
    // list — those must fail closed.
    final offline =
        error.category == AppErrorCategory.transport ||
        error.category == AppErrorCategory.timeout ||
        error.category == AppErrorCategory.server ||
        error.category == AppErrorCategory.unknown;
    if (!offline) return false;
    if (!await _canRestoreOfflineSession()) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint('[umipos] entry offline restore skipped=no_session');
      }
      return false;
    }
    final snapshot = await _vault.entrySnapshot();
    if (snapshot == null) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint('[umipos] entry offline restore skipped=no_snapshot');
      }
      return false;
    }
    final identity = await _vault.deviceIdentity();
    try {
      final device = DeviceSummary.fromJson(
        snapshot['device']! as Map<String, Object?>,
      );
      final tenant = EntryMerchant.fromJson(
        snapshot['tenant']! as Map<String, Object?>,
      );
      final branch = LocationAccess.fromJson(
        snapshot['branch']! as Map<String, Object?>,
      );
      final operator = OperatorSessionView.fromJson(
        snapshot['operator']! as Map<String, Object?>,
      );
      if (identity.deviceId == null || operator.deviceId != identity.deviceId) {
        return false;
      }
      if (operator.state != 'active') return false;
      if (!DateTime.parse(operator.expiresAt).isAfter(DateTime.now())) {
        return false;
      }
      if (tenant.id != identity.merchantId ||
          branch.id != identity.locationId) {
        return false;
      }
      final name = snapshot['operatorName'];
      _operatorName = name is String && name.trim().isNotEmpty ? name : null;
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint('[umipos] entry offline restore device=${operator.deviceId}');
      }
      _event('entry.offline_restored');
      _set(
        EntryState(
          EntryPhase.ready,
          device: device,
          merchants: [tenant],
          selectedTenant: tenant,
          selectedBranch: branch,
          operator: operator,
        ),
      );
      return true;
    } catch (_) {
      if (const bool.fromEnvironment('UMIPOS_TAP_LATENCY_PROBE')) {
        debugPrint('[umipos] entry offline restore skipped=invalid_snapshot');
      }
      return false;
    }
  }

  Future<void> lock() async {
    final operator = _state.operator;
    if (operator == null) return;
    try {
      await _gateway.lockOperator(operator.id);
    } on AppException catch (error) {
      _event('operator.lock_sync_failed', error.code);
    } catch (_) {
      _event('operator.lock_sync_failed', 'UNEXPECTED_FAILURE');
    }
    try {
      await _gateway.logout();
    } catch (_) {
      // The local lock remains authoritative for the presentation state.
      // Server session expiry and the next PIN authentication fail closed.
    }
    await _vault.clearSession();
    await _vault.clearEntrySnapshot();
    _event('operator.locked');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> reselectBranch() async {
    await _notifyBeforeLogout();
    final operator = _state.operator;
    if (operator != null) await _gateway.endOperator(operator.id);
    final tenant = _state.selectedTenant;
    if (tenant == null) {
      await _vault.clearSession();
      _set(EntryState(EntryPhase.pinRequired, device: _state.device));
      return;
    }
    await _vault.selectTenant(tenant.id);
    _event('branch.reselection_requested');
    _set(
      EntryState(
        EntryPhase.branchRequired,
        device: _state.device,
        merchants: _state.merchants,
        selectedTenant: tenant,
      ),
    );
  }

  Future<bool> requestRecoveryManagerReview(String managerPin) async {
    final operator = _state.operator;
    final tenant = _state.selectedTenant;
    final branch = _state.selectedBranch;
    if (operator == null || tenant == null || branch == null) return false;
    try {
      await _gateway.requestManagerApproval(
        operatorSessionId: operator.id,
        managerPin: managerPin,
        permission: 'offline.recovery.review',
        merchantId: tenant.id,
        locationId: branch.id,
      );
      _event('offline.recovery.manager_review_granted');
      return true;
    } on AppException catch (error) {
      _event('offline.recovery.manager_review_denied', error.code);
      return false;
    }
  }

  Future<String?> requestCheckoutApproval({
    required String managerPin,
    required String permission,
    required String commandFingerprint,
  }) async {
    final operator = _state.operator;
    final tenant = _state.selectedTenant;
    final branch = _state.selectedBranch;
    if (operator == null || tenant == null || branch == null) return null;
    try {
      final grant = await _gateway.requestManagerApproval(
        operatorSessionId: operator.id,
        managerPin: managerPin,
        permission: permission,
        merchantId: tenant.id,
        locationId: branch.id,
        commandFingerprint: commandFingerprint,
      );
      _event('checkout.approval_granted');
      return grant.elevationId;
    } on AppException catch (error) {
      _event('checkout.approval_denied', error.code);
      return null;
    }
  }

  Future<void> logout() async {
    await _notifyBeforeLogout();
    final operator = _state.operator;
    // Best-effort server teardown. The session may already be ended server-side
    // (a role/permission change ends active operator sessions), so these calls
    // can fail — but logout must ALWAYS reach the PIN. Local clearing is
    // authoritative; never let a server error trap the operator signed in.
    try {
      if (operator != null) await _gateway.endOperator(operator.id);
    } catch (_) {
      _event('operator.end_sync_failed');
    }
    try {
      await _gateway.logout();
    } catch (_) {}
    await _vault.clearSession();
    _operatorName = null;
    _event('session.ended');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> globalLogout() async {
    await _notifyBeforeLogout();
    await _gateway.globalLogout();
    await _vault.clearSession();
    _operatorName = null;
    _event('session.global_logout');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> _notifyBeforeLogout() async {
    try {
      await beforeLogout?.call();
    } catch (_) {
      _event('push.unregister_failed');
    }
  }

  Future<void> _saveSession(PosSessionResponse response) async {
    final tokens = PosSessionTokens.fromJson(response.tokens);
    await _vault.saveTokens(tokens.accessToken, tokens.refreshToken);
    final user = response.session['user'];
    if (user is Map) {
      final name = user['displayName'];
      _operatorName = name is String && name.trim().isNotEmpty ? name : null;
    }
  }

  Future<void> _resolveContext() async {
    final device = _state.device;
    final response = await _gateway.entryContext();
    final merchants = response.merchants.map(EntryMerchant.fromJson).toList();
    if (merchants.isEmpty) {
      _set(
        EntryState(
          EntryPhase.tenantRequired,
          device: device,
          merchants: merchants,
          errorCode: 'NO_ACCESS',
        ),
      );
    } else if (merchants.length == 1) {
      // Only one tenant: resolve it without flashing the tenant picker. Hold a
      // loading spinner (`startingOperator`) through the auto-selection down to
      // the menu, and keep `merchants` on the state for the steps that read it.
      _set(
        EntryState(
          EntryPhase.startingOperator,
          device: device,
          merchants: merchants,
        ),
      );
      await selectTenant(merchants.single);
    } else {
      _set(
        EntryState(
          EntryPhase.tenantRequired,
          device: device,
          merchants: merchants,
        ),
      );
    }
  }

  void _event(String name, [String? reason]) {
    _telemetry.event(
      ClientEvent(
        name: name,
        values: reason == null ? const {} : {'reason': reason},
      ),
    );
  }

  void _set(EntryState next) {
    _state = next;
    _manageIdleTimer();
    notifyListeners();
  }

  /// Records operator activity, pushing back the idle auto-lock. The till UI
  /// calls this on interaction. A no-op unless a ready session is being timed.
  void noteActivity() {
    if (_idleTimeout != null && _state.phase == EntryPhase.ready) {
      _armIdleTimer();
    }
  }

  /// Arms the auto-lock while a session is ready, cancels it otherwise. Called
  /// on every state change so the timer follows the session's life.
  void _manageIdleTimer() {
    if (_idleTimeout != null && _state.phase == EntryPhase.ready) {
      _armIdleTimer();
    } else {
      _idleTimer?.cancel();
      _idleTimer = null;
    }
  }

  void _armIdleTimer() {
    _idleTimer?.cancel();
    _idleTimer = Timer(_idleTimeout!, _onIdleTimeout);
  }

  void _onIdleTimeout() {
    if (_state.phase == EntryPhase.ready) {
      _event('operator.idle_timeout');
      unawaited(lock());
    }
  }
}
