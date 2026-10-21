import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../bootstrap/bootstrap_state.dart';
import '../bootstrap/composition_root.dart';
import '../core/localization/app_localizations.dart';
import '../core/navigation/app_navigation.dart';
import '../core/observability/tap_latency_probe.dart';
import '../core/observability/telemetry.dart';
import '../core/security/operator_permissions.dart';
import '../core/theme/display_preferences.dart';
import '../core/theme/umi_theme.dart';
import '../core/update/desktop_updater.dart';
import '../features/catalog/catalog_surface.dart';
import '../features/entry/entry_controller.dart';
import '../features/entry/entry_surface.dart';
import '../features/kitchen/kitchen_audio.dart';
import '../features/kitchen/kitchen_push_notifications.dart';
import '../shared/widgets/status_card.dart';
import 'activity_listener.dart';

final class HardwareKeyboardWedgeRouter {
  KeyEventResult route({
    required bool Function(int codeUnit, DateTime at)? acceptCodeUnit,
    required KeyEvent event,
    required bool textInputFocused,
    DateTime? occurredAt,
  }) {
    if (event is! KeyDownEvent || textInputFocused || acceptCodeUnit == null) {
      return KeyEventResult.ignored;
    }
    final at = occurredAt ?? DateTime.now().toUtc();
    if (event.logicalKey == LogicalKeyboardKey.enter) {
      return acceptCodeUnit('\n'.codeUnitAt(0), at)
          ? KeyEventResult.handled
          : KeyEventResult.ignored;
    }
    final character = event.character;
    if (character != null && character.runes.length == 1) {
      final codeUnit = character.runes.single;
      if (codeUnit >= 0x20 && codeUnit <= 0x7e) {
        acceptCodeUnit(codeUnit, at);
      }
    }
    return KeyEventResult.ignored;
  }
}

final class UmiPosApp extends StatefulWidget {
  const UmiPosApp({required this.root, super.key});
  final AppCompositionRoot root;

  @override
  State<UmiPosApp> createState() => _UmiPosAppState();
}

final class _UmiPosAppState extends State<UmiPosApp>
    with WidgetsBindingObserver {
  /// Set only when the build asks for the tap-latency counter
  /// (`--dart-define=UMIPOS_TAP_LATENCY_PROBE=true`). A counter on every press
  /// is a diagnostic: it costs a stopwatch per tap and a line of log, which a
  /// till in service should not pay for.
  static const _measureTaps = bool.fromEnvironment(
    'UMIPOS_TAP_LATENCY_PROBE',
    defaultValue: false,
  );

  late final DisplayPreferences _display;
  late final KitchenPushNotifications _push;
  TapLatencyProbe? _tapLatency;
  final KitchenAudio _pushAudio = KitchenAudio();
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();
  PushSession? _lastPushSession;
  OverlayEntry? _pushNotice;
  Timer? _pushNoticeTimer;
  PushSession? _failedPushSession;
  DateTime? _pushRetryAfter;
  final ValueNotifier<KitchenPushNotice?> _openedKitchenNotice = ValueNotifier(
    null,
  );
  final HardwareKeyboardWedgeRouter _keyboardRouter =
      HardwareKeyboardWedgeRouter();

  @override
  void initState() {
    super.initState();
    _display = DisplayPreferences(widget.root.preferences);
    unawaited(_display.load());
    _push = KitchenPushNotifications(
      api: widget.root.apiClient,
      transport: FirebaseKitchenPushTransport(),
      onNotice: _showPushNotice,
      onOpen: _openPushNotice,
    );
    widget.root.entry.beforeLogout = _push.unregister;
    widget.root.controller.addListener(_changed);
    widget.root.entry.addListener(_changed);
    widget.root.connectivity.addListener(_retryPushSession);
    WidgetsBinding.instance.addObserver(this);
    if (_measureTaps) {
      _tapLatency = TapLatencyProbe(report: _reportTapLatency)..attach();
    }
    _syncPushSession();
    FocusManager.instance.addListener(_focusChanged);
    FocusManager.instance.addEarlyKeyEventHandler(_hardwareKeyEvent);
  }

  /// One line per tap: the number the owner asked for, taken from the engine
  /// rather than from a camera pointed at the screen.
  void _reportTapLatency(TapLatency latency) {
    // Logcat as well as telemetry, because the telemetry exporter is a no-op in
    // the builds that are actually on the till: a measurement nobody can read is
    // not a measurement.
    debugPrint('[umipos] $latency');
    widget.root.telemetry.event(
      ClientEvent(name: 'pos.tap_latency', values: latency.toJson()),
    );
  }

  KeyEventResult _hardwareKeyEvent(KeyEvent event) {
    final context = FocusManager.instance.primaryFocus?.context;
    final own = context?.widget;
    final editable = own is EditableText
        ? own
        : context?.findAncestorWidgetOfExactType<EditableText>();
    final textField = context?.findAncestorWidgetOfExactType<PosField>();
    return _keyboardRouter.route(
      acceptCodeUnit: widget.root.hardware?.acceptKeyboardCodeUnit,
      event: event,
      textInputFocused:
          editable != null &&
          textField?.key != const ValueKey('hardware-barcode-search'),
    );
  }

  void _focusChanged() {
    final context = FocusManager.instance.primaryFocus?.context;
    final own = context?.widget;
    final editable = own is EditableText
        ? own
        : context?.findAncestorWidgetOfExactType<EditableText>();
    widget.root.hardware?.setSensitiveInputActive(
      editable?.obscureText ?? false,
    );
  }

  @override
  void dispose() {
    _pushNoticeTimer?.cancel();
    _pushNotice?.remove();
    _openedKitchenNotice.dispose();
    widget.root.entry.beforeLogout = null;
    _push.dispose();
    _pushAudio.dispose();
    widget.root.controller.removeListener(_changed);
    widget.root.entry.removeListener(_changed);
    widget.root.connectivity.removeListener(_retryPushSession);
    WidgetsBinding.instance.removeObserver(this);
    _tapLatency?.dispose();
    FocusManager.instance.removeListener(_focusChanged);
    FocusManager.instance.removeEarlyKeyEventHandler(_hardwareKeyEvent);
    _display.dispose();
    widget.root.dispose();
    super.dispose();
  }

  void _changed() {
    _syncPushSession();
    if (widget.root.entry.state.phase != EntryPhase.ready) {
      widget.root.sales.clear();
      widget.root.cash.clear();
      widget.root.exceptions.clear();
    }
    if (mounted) {
      setState(() {});
    }
  }

  void _syncPushSession() {
    final state = widget.root.entry.state;
    final operator = state.operator;
    final session =
        !kIsWeb &&
            defaultTargetPlatform == TargetPlatform.android &&
            state.phase == EntryPhase.ready &&
            state.device?.type != 'kds' &&
            operator != null &&
            OperatorPermissions(operator.permissions).allows('order.fire') &&
            state.selectedTenant != null
        ? (merchantId: state.selectedTenant!.id, operatorSessionId: operator.id)
        : null;
    if (session == _lastPushSession) return;
    _lastPushSession = session;
    _retryPushSession();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _retryPushSession();
  }

  void _retryPushSession() {
    final session = _lastPushSession;
    if (session == null) return;
    // A push registration that keeps failing is a fact about the deployment
    // (staging has no FCM credentials), not about this tap. Retrying it on every
    // resume and every session tick produced six failed calls a minute per
    // terminal and a log line for each — load on the API and noise in the field
    // for a feature that is simply not switched on. One attempt per session per
    // ten minutes is enough to notice when it comes back.
    final blockedUntil = _pushRetryAfter;
    if (_failedPushSession == session &&
        blockedUntil != null &&
        DateTime.now().isBefore(blockedUntil)) {
      return;
    }
    final attemptSession = session;
    unawaited(
      _push
          .updateSession(session)
          .then((_) {
            _failedPushSession = null;
            _pushRetryAfter = null;
          })
          .catchError((Object error) {
            final firstFailure = _failedPushSession != attemptSession;
            _failedPushSession = attemptSession;
            _pushRetryAfter = DateTime.now().add(
              const Duration(minutes: 10),
            );
            if (firstFailure) {
              debugPrint('push.token registration=failed error=$error');
            }
          }),
    );
  }

  void _showPushNotice(KitchenPushNotice notice) {
    if (!mounted || _lastPushSession == null) return;
    if (!_display.kitchenSoundsMuted) {
      unawaited(_pushAudio.play('ready'));
    }
    final overlay = _navigatorKey.currentState?.overlay;
    if (overlay == null) return;
    _pushNoticeTimer?.cancel();
    _pushNotice?.remove();
    final orderReady = notice.type == 'kitchen_order_ready';
    _pushNotice = OverlayEntry(
      builder: (context) => SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: Semantics(
            liveRegion: true,
            button: true,
            child: GestureDetector(
              onTap: () => _openPushNotice(notice),
              child: Container(
                margin: const EdgeInsets.all(16),
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 14,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFF173B35),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: DefaultTextStyle(
                  style: const TextStyle(
                    color: Color(0xFFFFFFFF),
                    fontSize: 17,
                  ),
                  child: Text(
                    notice.message ??
                        (orderReady
                            ? 'La orden está lista. Consulta la cuenta.'
                            : 'Un producto está listo. Consulta la cuenta.'),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    overlay.insert(_pushNotice!);
    _pushNoticeTimer = Timer(const Duration(seconds: 6), () {
      _pushNotice?.remove();
      _pushNotice = null;
    });
  }

  void _openPushNotice(KitchenPushNotice notice) {
    if (!mounted) return;
    _pushNoticeTimer?.cancel();
    _pushNotice?.remove();
    _pushNotice = null;
    _openedKitchenNotice.value = notice;
  }

  @override
  Widget build(BuildContext context) {
    return DisplayPreferencesScope(
      preferences: _display,
      child: AnimatedBuilder(
        animation: _display,
        builder: (context, _) => PosApp(
          title: 'UmiPOS · Estación',
          debugShowCheckedModeBanner: false,
          theme: UmiTheme.light(),
          darkTheme: UmiTheme.dark(),
          midnightTheme: UmiTheme.midnight(),
          themeMode: _display.themeMode,
          locale: _display.language == null ? null : Locale(_display.language!),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,

            GlobalWidgetsLocalizations.delegate,
          ],
          localeResolutionCallback: (locale, supported) => supported.firstWhere(
            (candidate) => candidate.languageCode == locale?.languageCode,
            orElse: () => const Locale('es'),
          ),
          // Wrap the whole navigator, so a press on any route or dialog counts as
          // activity and pushes back the idle auto-lock.
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: _display.textScalerFor(
                MediaQuery.textScalerOf(context),
              ),
              disableAnimations:
                  _display.reduceMotion ||
                  MediaQuery.disableAnimationsOf(context),
            ),
            child: ActivityListener(
              onActivity: widget.root.entry.noteActivity,
              onPress: _tapLatency?.mark,
              child: child ?? const SizedBox.shrink(),
            ),
          ),
          home: TurnClosesSurfaces(
            session: widget.root.entry,
            hasTurn: () =>
                widget.root.entry.navigationStage == TrustedEntryStage.ready,
            child: _GuardedSurface(
              root: widget.root,
              notificationOpen: _openedKitchenNotice,
            ),
          ),
          onUnknownRoute: (_) => PosPageRoute<void>(
            builder: (_) => _UnknownRoute(root: widget.root),
          ),
          navigatorKey: _navigatorKey,
        ),
      ),
    );
  }
}

/// Closes everything the operator's turn had open when the turn ends.
///
/// The cash center, the floor plan, the checkout sheet and the settings screens
/// are all routes pushed *above* the shell. The shell's route is chosen from the
/// entry stage, so when the till locks — the idle timer, a handoff, or a session
/// the server ended — the PIN pad is swapped in underneath those routes and the
/// operator keeps looking at the tool that no longer has a session.
///
/// That is how a till that locked itself after half an hour showed a cash screen
/// saying it could not read the drawer, with a Retry button that could not work,
/// instead of the PIN pad it was actually asking for. A till that locks has to
/// close what the till was doing.
///
/// It watches for the edge only, from a ready turn to anything else, so ordinary
/// navigation inside a turn is left alone.
final class TurnClosesSurfaces extends StatefulWidget {
  const TurnClosesSurfaces({
    required this.session,
    required this.hasTurn,
    required this.child,
    super.key,
  });

  /// The thing that says the turn ended. A [Listenable], not the entry
  /// controller, so this can be tested without a whole till behind it.
  final Listenable session;

  /// Whether the operator still holds the till. Read on every notification.
  final bool Function() hasTurn;

  final Widget child;

  @override
  State<TurnClosesSurfaces> createState() => _TurnClosesSurfacesState();
}

final class _TurnClosesSurfacesState extends State<TurnClosesSurfaces> {
  bool _hadTurn = false;

  @override
  void initState() {
    super.initState();
    // Read here rather than through a lazy `late` initialiser: a lazy field is
    // first read inside the very notification this is built to catch, by which
    // time the turn is already over and the edge it looks for is invisible.
    _hadTurn = widget.hasTurn();
    widget.session.addListener(_changed);
  }

  @override
  void dispose() {
    widget.session.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    final hasTurn = widget.hasTurn();
    final lost = _hadTurn && !hasTurn;
    _hadTurn = hasTurn;
    if (!lost) return;
    // A microtask, not a post-frame callback: the routes have to go even if the
    // lock lands while nothing else is being pumped, and `popUntil` mutates the
    // navigator, which must not happen inside a listener turn.
    scheduleMicrotask(() {
      if (!mounted) return;
      final navigator = Navigator.of(context);
      if (navigator.canPop()) {
        navigator.popUntil((route) => route.isFirst);
      }
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

final class _GuardedSurface extends StatelessWidget {
  const _GuardedSurface({required this.root, required this.notificationOpen});
  final AppCompositionRoot root;
  final ValueListenable<KitchenPushNotice?> notificationOpen;

  @override
  Widget build(BuildContext context) {
    final route = NavigationGuard.resolve(
      requested: AppRoute.mainShell,
      bootstrap: root.controller.state,
      config: root.config,
      flags: root.features,
      entryStage: root.entry.navigationStage,
    );
    return switch (route) {
      AppRoute.bootstrap => const _LoadingSurface(),
      AppRoute.authentication ||
      AppRoute.enrollment ||
      AppRoute.tenantSelection ||
      AppRoute.branchSelection ||
      AppRoute.operatorSession => EntrySurface(controller: root.entry),
      AppRoute.mainShell => CatalogSurface(
        notificationOpen: notificationOpen,
        entry: root.entry,
        catalog: root.catalog,
        cart: root.cart,
        incomingOrders: root.incomingOrders,
        cash: root.cash,
        checkout: root.checkout,
        sales: root.sales,
        kitchenStatus: root.kitchenStatus,
        kitchenBoard: root.kitchenBoard,
        floorPlan: root.floorPlan,
        tableState: root.tableState,
        customerValue: root.customerValue,
        deviceChannel: root.deviceChannel,
        exceptions: root.exceptions,
        inventory: root.inventory,
        hardware: root.hardware,
        connectivity: root.connectivity,
        telemetry: root.telemetry,
        offlineJournal: root.offlineJournal,
        offlineRecovery: root.offlineRecovery,
      ),
      AppRoute.recoverableError => _FailureSurface(root: root),
      AppRoute.diagnostics => _DiagnosticsSurface(root: root),
      _ => _UnknownRoute(root: root),
    };
  }
}

final class _LoadingSurface extends StatelessWidget {
  const _LoadingSurface();
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PosPage(
      body: Semantics(
        liveRegion: true,
        label: l10n.bootstrapLoadingTitle,
        child: StatusCard(
          icon: PosGlyphs.pointOfSaleOutlined,
          title: l10n.bootstrapLoadingTitle,
          message: l10n.entryLoadingBody,
          action: PosSpinner(semanticsLabel: l10n.bootstrapLoadingTitle),
        ),
      ),
    );
  }
}

enum _UpdateStage { idle, updating, ready, failed }

final class _FailureSurface extends StatefulWidget {
  const _FailureSurface({required this.root});
  final AppCompositionRoot root;

  @override
  State<_FailureSurface> createState() => _FailureSurfaceState();
}

class _FailureSurfaceState extends State<_FailureSurface> {
  _UpdateStage _stage = _UpdateStage.idle;

  bool get _isUpgradeRequired =>
      widget.root.controller.state.diagnosticCategory == 'upgradeRequired';

  bool get _canSelfUpdate =>
      _isUpgradeRequired && widget.root.updater.isSupported;

  Future<void> _runUpdate() async {
    setState(() => _stage = _UpdateStage.updating);
    final result = await widget.root.updater.update();
    if (!mounted) return;
    setState(() {
      _stage = result.outcome == DesktopUpdateOutcome.applied
          ? _UpdateStage.ready
          : _UpdateStage.failed;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final controller = widget.root.controller;
    final retryable =
        controller.state.phase == BootstrapPhase.recoverableFailure ||
        controller.state.phase == BootstrapPhase.storageUnavailable;

    late final PosGlyph icon;
    late final String title;
    late final String message;
    Widget? action;

    if (_stage == _UpdateStage.updating) {
      icon = PosGlyphs.downloadingOutlined;
      title = l10n.updateAvailableTitle;
      message = l10n.updateInProgress;
      action = const Padding(
        padding: EdgeInsets.only(top: 8),
        child: PosSpinner(),
      );
    } else if (_stage == _UpdateStage.ready) {
      icon = PosGlyphs.checkCircleOutline;
      title = l10n.updateReadyTitle;
      message = l10n.updateReadyBody;
      action = PosButton(
        onPressed: widget.root.updater.relaunch,
        child: Text(l10n.updateRestartAction),
      );
    } else if (_stage == _UpdateStage.failed) {
      icon = PosGlyphs.errorOutline;
      title = l10n.updateAvailableTitle;
      message = l10n.updateFailedBody;
      action = PosButton(onPressed: _runUpdate, child: Text(l10n.updateAction));
    } else if (_canSelfUpdate) {
      icon = PosGlyphs.systemUpdateAltOutlined;
      title = l10n.updateAvailableTitle;
      message = l10n.updateRequiredBody;
      action = PosButton(onPressed: _runUpdate, child: Text(l10n.updateAction));
    } else {
      icon = PosGlyphs.errorOutline;
      title = l10n.recoverableFailureTitle;
      message = l10n.configurationInvalidBody;
      action = retryable
          ? PosButton(
              onPressed: controller.retry,
              child: Text(l10n.retryAction),
            )
          : null;
    }

    return PosPage(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: StatusCard(
            icon: icon,
            title: title,
            message: message,
            action: action,
          ),
        ),
      ),
    );
  }
}

final class _DiagnosticsSurface extends StatelessWidget {
  const _DiagnosticsSurface({required this.root});
  final AppCompositionRoot root;
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return PosPage(
      appBar: PosHeader(title: Text(l10n.diagnosticsTitle)),
      body: PosSelectionArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'environment=${root.config.environment.name}\n'
            'bootstrap=${root.controller.state.phase.name}\n'
            'contract=${root.controller.contractVersion}',
          ),
        ),
      ),
    );
  }
}

final class _UnknownRoute extends StatelessWidget {
  const _UnknownRoute({required this.root});
  final AppCompositionRoot root;
  @override
  Widget build(BuildContext context) => PosPage(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: StatusCard(
          icon: PosGlyphs.routeOutlined,
          title: AppLocalizations.of(context).unknownRouteTitle,
          message: AppLocalizations.of(context).unknownRouteBody,
        ),
      ),
    ),
  );
}
