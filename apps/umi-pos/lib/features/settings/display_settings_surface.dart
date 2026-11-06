import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/display_preferences.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/widgets/inline_notice.dart';
import '../../shared/widgets/station_document.dart';
import '../../shared/widgets/station_signature.dart';

Future<void> showDisplaySettings(
  BuildContext context, {
  required Future<void> Function() onLock,
  required Future<void> Function() onLogout,
}) => Navigator.of(context).push<void>(
  PosPageRoute<void>(
    builder: (_) => DisplaySettingsSurface(onLock: onLock, onLogout: onLogout),
  ),
);

final class DisplaySettingsSurface extends StatelessWidget {
  const DisplaySettingsSurface({
    required this.onLock,
    required this.onLogout,
    this.embedded = false,
    this.operationalActions = const [],
    this.sectionOnly = false,
    super.key,
  });
  final Future<void> Function() onLock, onLogout;
  final bool embedded;
  final List<Widget> operationalActions;
  final bool sectionOnly;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final prefs = DisplayPreferencesScope.maybeOf(context);
    final theme = PosTheme.of(context);
    return PosPage(
      appBar: sectionOnly
          ? null
          : PosHeader(
              automaticallyImplyLeading: !embedded,
              title: StationHeading(title: l.displaySettingsTitle),
            ),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 960),
          child: ListView(
            padding: const EdgeInsets.all(UmiSpacing.lg),
            children: [
              ...operationalActions,
              if (!sectionOnly) ...[
                const StationSignature(),
                const SizedBox(height: UmiSpacing.lg),
              ],
              Text(l.displaySettingsScope, style: theme.textTheme.bodyMedium),
              const SizedBox(height: UmiSpacing.lg),
              if (prefs?.busy ?? false) ...[
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const PosProgress(),
                    const SizedBox(height: UmiSpacing.sm),
                    Semantics(
                      liveRegion: true,
                      child: Text(l.savingDisplayPreferences),
                    ),
                  ],
                ),
                const SizedBox(height: UmiSpacing.md),
              ],
              if (prefs?.error != null) ...[
                InlineNotice(
                  message: prefs!.error == DisplayPreferenceError.read
                      ? l.displayPreferencesReadError
                      : l.displayPreferencesWriteError,
                  tone: InlineNoticeTone.error,
                ),
                const SizedBox(height: UmiSpacing.md),
              ],
              if (prefs != null) ...[
                PosSwitchRow(
                  key: const ValueKey('settings-product-photos'),
                  title: Text(
                    Localizations.localeOf(context).languageCode == 'es'
                        ? 'Fotos en el detalle del producto'
                        : 'Product detail photos',
                  ),
                  value: prefs.showProductPhotos,
                  onChanged: prefs.busy ? null : prefs.setShowProductPhotos,
                ),
                PosSwitchRow(
                  key: const ValueKey('settings-menu-labels'),
                  title: Text(
                    Localizations.localeOf(context).languageCode == 'es'
                        ? 'Nombres en el menú'
                        : 'Menu labels',
                  ),
                  value: prefs.menuLabels,
                  onChanged: prefs.busy ? null : prefs.setMenuLabels,
                ),
                const SizedBox(height: 16),
                _Section(
                  title: l.appearanceLabel,
                  child: Wrap(
                    spacing: UmiSpacing.sm,
                    runSpacing: UmiSpacing.sm,
                    children: [
                      for (final (value, label) in [
                        (PosThemeMode.system, l.followSystemLabel),
                        (PosThemeMode.light, l.lightAppearanceLabel),
                        (PosThemeMode.dark, l.darkAppearanceLabel),
                        (PosThemeMode.midnight, l.midnightAppearanceLabel),
                      ])
                        PosChoice(
                          label: Text(label),
                          selected: prefs.themeMode == value,
                          onSelected: prefs.busy
                              ? null
                              : (_) => prefs.setTheme(value),
                        ),
                    ],
                  ),
                ),
                _Section(
                  title: l.textSizeLabel,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(l.textSizeDescription),
                      const SizedBox(height: UmiSpacing.sm),
                      Wrap(
                        spacing: UmiSpacing.sm,
                        runSpacing: UmiSpacing.sm,
                        children: [
                          for (final (value, label) in [
                            (PosTextSize.system, l.followSystemLabel),
                            (PosTextSize.large, l.largeTextLabel),
                            (PosTextSize.extraLarge, l.extraLargeTextLabel),
                          ])
                            PosChoice(
                              label: Text(label),
                              selected: prefs.textSize == value,
                              onSelected: prefs.busy
                                  ? null
                                  : (_) => prefs.setTextSize(value),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                _Section(
                  title: l.languageLabel,
                  child: Wrap(
                    spacing: UmiSpacing.sm,
                    runSpacing: UmiSpacing.sm,
                    children: [
                      for (final (value, label) in <(String?, String)>[
                        (null, l.followSystemLabel),
                        ('es', 'Español'),
                        ('en', 'English'),
                      ])
                        PosChoice(
                          label: Text(label),
                          selected: prefs.language == value,
                          onSelected: prefs.busy
                              ? null
                              : (_) => prefs.setLanguage(value),
                        ),
                    ],
                  ),
                ),
                _Section(
                  title: l.motionLabel,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(l.reducedMotionDescription),
                      const SizedBox(height: UmiSpacing.sm),
                      Wrap(
                        spacing: UmiSpacing.sm,
                        runSpacing: UmiSpacing.sm,
                        children: [
                          PosChoice(
                            label: Text(l.followSystemLabel),
                            selected: !prefs.reduceMotion,
                            onSelected: prefs.busy
                                ? null
                                : (_) => prefs.setReduceMotion(false),
                          ),
                          PosChoice(
                            label: Text(l.reducedMotionLabel),
                            selected: prefs.reduceMotion,
                            onSelected: prefs.busy
                                ? null
                                : (_) => prefs.setReduceMotion(true),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
              _Section(
                title: l.operatorSessionLabel,
                child: Wrap(
                  spacing: UmiSpacing.sm,
                  runSpacing: UmiSpacing.sm,
                  children: [
                    PosOutlineButton.icon(
                      icon: const PosIcon(PosGlyphs.lockOutline),
                      label: Text(l.lockAction),
                      onPressed: onLock,
                    ),
                    PosTextButton.icon(
                      icon: const PosIcon(PosGlyphs.logout),
                      label: Text(l.logoutAction),
                      onPressed: onLogout,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

final class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});
  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) =>
      StationSection(title: title, child: child);
}

/// Operational settings share one native workspace while device commands keep
/// their existing owner and permission checks.
final class PosSettingsWorkspace extends StatefulWidget {
  const PosSettingsWorkspace({
    required this.onLock,
    required this.onLogout,
    this.hardwareBuilder,
    this.onBack,
    this.operationalActions = const [],
    super.key,
  });
  final Future<void> Function() onLock, onLogout;
  final Widget Function(String section)? hardwareBuilder;
  final VoidCallback? onBack;
  final List<Widget> operationalActions;
  @override
  State<PosSettingsWorkspace> createState() => _PosSettingsWorkspaceState();
}

final class _PosSettingsWorkspaceState extends State<PosSettingsWorkspace> {
  String? _selected;
  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final theme = PosTheme.of(context);
    final tabs = <(String, String)>[
      if (widget.hardwareBuilder != null) ...[
        ('devices', es ? 'Dispositivos' : 'Devices'),
        ('print', es ? 'Impresión' : 'Printing'),
      ],
      ('display', es ? 'Pantalla' : 'Display'),
      ('session', es ? 'Sesión' : 'Session'),
    ];
    final selected = tabs.any((tab) => tab.$1 == _selected)
        ? _selected!
        : tabs.first.$1;
    final content = switch (selected) {
      'devices' || 'print' => widget.hardwareBuilder!(selected),
      'display' => DisplaySettingsSurface(
        embedded: true,
        sectionOnly: true,
        onLock: widget.onLock,
        onLogout: widget.onLogout,
      ),
      _ => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          ...widget.operationalActions,
          const SizedBox(height: 16),
          PosOutlineButton.icon(
            onPressed: widget.onLock,
            icon: const PosIcon(PosGlyphs.lockOutline),
            label: Text(AppLocalizations.of(context).lockAction),
          ),
          const SizedBox(height: 8),
          PosTextButton.icon(
            onPressed: widget.onLogout,
            icon: const PosIcon(PosGlyphs.logout),
            label: Text(AppLocalizations.of(context).logoutAction),
          ),
        ],
      ),
    };
    Widget sectionButton((String, String) tab, {required bool wide}) => Padding(
      padding: EdgeInsets.zero,
      child: PosTapRegion(
        selected: selected == tab.$1,
        semanticLabel: tab.$2,
        onTap: () => setState(() => _selected = tab.$1),
        borderRadius: BorderRadius.circular(8),
        child: Container(
          constraints: const BoxConstraints(minHeight: 48),
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(
            color: selected == tab.$1
                ? theme.colorScheme.primaryContainer
                : theme.colorScheme.surface,
            border: Border.all(
              color: selected == tab.$1
                  ? theme.colorScheme.primary
                  : theme.colorScheme.outlineVariant,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(tab.$2, style: theme.textTheme.bodySmall),
        ),
      ),
    );
    return PosPage(
      appBar: PosHeader(
        automaticallyImplyLeading: false,
        leading: widget.onBack == null
            ? null
            : PosIconButton(
                key: const ValueKey('settings-back'),
                tooltip: es ? 'Volver' : 'Back',
                onPressed: widget.onBack,
                icon: const PosIcon(PosGlyphs.arrowBack),
              ),
        title: StationHeading(title: es ? 'Configuración' : 'Settings'),
      ),
      body: LayoutBuilder(
        builder: (context, constraints) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                key: const ValueKey('settings-sections'),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: LayoutBuilder(
                  builder: (context, bank) {
                    final scale = MediaQuery.textScalerOf(context).scale(1);
                    final columns = bank.maxWidth < 600 || scale >= 1.5
                        ? 2
                        : tabs.length;
                    final width = (bank.maxWidth - 8 * (columns - 1)) / columns;
                    return Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (final tab in tabs)
                          SizedBox(
                            width: width,
                            child: sectionButton(tab, wide: columns > 2),
                          ),
                      ],
                    );
                  },
                ),
              ),
              const SizedBox(height: 24),
              Expanded(child: content),
            ],
          );
        },
      ),
    );
  }
}
