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

  int _pairingGeneration = 0;

  /// The realtime nudge subscription for the current pairing attempt. It is
  /// keyed to `_pairingGeneration`, exactly like the poll loop, so one counter
  /// cancels both.
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
    EntryPhase.checkingDevice => TrustedEntryStage.authentication,
    _ => TrustedEntryStage.blocked,
  };

  Future<void> initialize() async {
    _set(const EntryState(EntryPhase.checkingDevice));
    final identity = await _vault.deviceIdentity();
    if (!identity.isEnrolled) {
      final pairing = await _vault.pairingIdentity();
      if (pairing != null && pairing.expiresAt.isAfter(DateTime.now())) {
        _set(const EntryState(EntryPhase.enrollmentPending));
        _beginPairingWait(pairing);
        return;
      }
      if (pairing != null) await _vault.clearPairing();
      _set(const EntryState(EntryPhase.enrollmentRequired));
      return;
    }
    final pendingAcknowledgement = await _vault.pairingIdentity();
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
    try {
      final device = await _gateway.deviceStatus();
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
      _set(EntryState(EntryPhase.pinRequired, device: device));
      if (await _canRestoreSession()) {
        await restoreSession();
        return;
      }
      await _vault.clearSession();
    } on AppException catch (error) {
      if (error.code == 'DEVICE_REVOKED' ||
          error.code == 'DEVICE_CREDENTIAL_INVALID') {
        await _vault.clearDeviceTrust();
        _set(EntryState(EntryPhase.deviceRevoked, errorCode: error.code));
      } else {
        _set(EntryState(EntryPhase.recoverableFailure, errorCode: error.code));
      }
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
      _set(EntryState(EntryPhase.enrollmentRequired, errorCode: error.code));
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
    await _pairingWatch?.cancel();
    _pairingWatch = null;
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
    _event('operator.locked');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
  }

  Future<void> reselectBranch() async {
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
    await _gateway.globalLogout();
    await _vault.clearSession();
    _operatorName = null;
    _event('session.global_logout');
    _set(EntryState(EntryPhase.pinRequired, device: _state.device));
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
