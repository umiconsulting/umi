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
    super.key,
  });
  final Future<void> Function() onLock, onLogout;
  final bool embedded;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final prefs = DisplayPreferencesScope.maybeOf(context);
    final theme = PosTheme.of(context);
    return PosPage(
      appBar: PosHeader(
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
              const StationSignature(),
              const SizedBox(height: UmiSpacing.lg),
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
