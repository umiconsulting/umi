import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../bootstrap/bootstrap_controller.dart';
import '../bootstrap/bootstrap_state.dart';
import '../bootstrap/composition_root.dart';
import '../core/localization/app_localizations.dart';
import '../core/navigation/app_navigation.dart';
import '../core/theme/umi_theme.dart';
import '../features/catalog/catalog_surface.dart';
import '../features/entry/entry_controller.dart';
import '../features/entry/entry_surface.dart';
import '../shared/widgets/status_card.dart';

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

final class _UmiPosAppState extends State<UmiPosApp> {
  final HardwareKeyboardWedgeRouter _keyboardRouter =
      HardwareKeyboardWedgeRouter();

  @override
  void initState() {
    super.initState();
    widget.root.controller.addListener(_changed);
    widget.root.entry.addListener(_changed);
    FocusManager.instance.addListener(_focusChanged);
    FocusManager.instance.addEarlyKeyEventHandler(_hardwareKeyEvent);
  }

  KeyEventResult _hardwareKeyEvent(KeyEvent event) {
    final context = FocusManager.instance.primaryFocus?.context;
    final own = context?.widget;
    final editable = own is EditableText
        ? own
        : context?.findAncestorWidgetOfExactType<EditableText>();
    return _keyboardRouter.route(
      acceptCodeUnit: widget.root.hardware?.acceptKeyboardCodeUnit,
      event: event,
      textInputFocused: editable != null,
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
    widget.root.controller.removeListener(_changed);
    widget.root.entry.removeListener(_changed);
    FocusManager.instance.removeListener(_focusChanged);
    FocusManager.instance.removeEarlyKeyEventHandler(_hardwareKeyEvent);
    widget.root.dispose();
    super.dispose();
  }

  void _changed() {
    if (widget.root.entry.state.phase != EntryPhase.ready) {
      widget.root.sales.clear();
      widget.root.cash.clear();
      widget.root.exceptions.clear();
    }
    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final platformBrightness =
        WidgetsBinding.instance.platformDispatcher.platformBrightness;
    return MaterialApp(
      title: 'UmiPOS',
      debugShowCheckedModeBanner: false,
      theme: UmiTheme.light(),
      darkTheme: UmiTheme.dark(),
      themeMode: platformBrightness == Brightness.dark
          ? ThemeMode.dark
          : ThemeMode.system,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      localeResolutionCallback: (locale, supported) =>
          supported.contains(locale) ? locale : const Locale('es'),
      home: _GuardedSurface(root: widget.root),
      onUnknownRoute: (_) => MaterialPageRoute<void>(
        builder: (_) => _UnknownRoute(root: widget.root),
      ),
    );
  }
}

final class _GuardedSurface extends StatelessWidget {
  const _GuardedSurface({required this.root});
  final AppCompositionRoot root;

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
        entry: root.entry,
        catalog: root.catalog,
        cart: root.cart,
        cash: root.cash,
        checkout: root.checkout,
        sales: root.sales,
        customerValue: root.customerValue,
        exceptions: root.exceptions,
        inventory: root.inventory,
        hardware: root.hardware,
        connectivity: root.connectivity,
        telemetry: root.telemetry,
        offlineJournal: root.offlineJournal,
        offlineRecovery: root.offlineRecovery,
      ),
      AppRoute.recoverableError => _FailureSurface(controller: root.controller),
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
    return Scaffold(
      body: Semantics(
        liveRegion: true,
        label: l10n.bootstrapLoadingTitle,
        child: const Center(child: CircularProgressIndicator()),
      ),
    );
  }
}

final class _FailureSurface extends StatelessWidget {
  const _FailureSurface({required this.controller});
  final BootstrapController controller;
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final retryable =
        controller.state.phase == BootstrapPhase.recoverableFailure ||
        controller.state.phase == BootstrapPhase.storageUnavailable;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: StatusCard(
            icon: Icons.error_outline,
            title: l10n.recoverableFailureTitle,
            message: l10n.configurationInvalidBody,
            action: retryable
                ? ElevatedButton(
                    onPressed: controller.retry,
                    child: Text(l10n.retryAction),
                  )
                : null,
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
    return Scaffold(
      appBar: AppBar(title: Text(l10n.diagnosticsTitle)),
      body: SelectionArea(
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
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: StatusCard(
          icon: Icons.route_outlined,
          title: AppLocalizations.of(context).unknownRouteTitle,
          message: AppLocalizations.of(context).unknownRouteBody,
        ),
      ),
    ),
  );
}
