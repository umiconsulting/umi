import 'package:flutter/material.dart';
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

final class UmiPosApp extends StatefulWidget {
  const UmiPosApp({required this.root, super.key});
  final AppCompositionRoot root;

  @override
  State<UmiPosApp> createState() => _UmiPosAppState();
}

final class _UmiPosAppState extends State<UmiPosApp> {
  @override
  void initState() {
    super.initState();
    widget.root.controller.addListener(_changed);
    widget.root.entry.addListener(_changed);
  }

  @override
  void dispose() {
    widget.root.controller.removeListener(_changed);
    widget.root.entry.removeListener(_changed);
    widget.root.dispose();
    super.dispose();
  }

  void _changed() {
    if (widget.root.entry.state.phase != EntryPhase.ready) {
      widget.root.cart.clearLocal();
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
        checkout: root.checkout,
        connectivity: root.connectivity,
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
