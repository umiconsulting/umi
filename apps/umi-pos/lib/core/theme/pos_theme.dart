import 'package:flutter/widgets.dart';

abstract final class PosGeometry {
  static const controlRadius = 10.0;
  static const surfaceRadius = 16.0;
}

abstract final class PosColors {
  static const white = Color(0xFFFFFFFF),
      black87 = Color(0xDE000000),
      transparent = Color(0x00000000),
      grey = Color(0xFF758292),
      green = Color(0xFF267047);
}

final class PosPalette {
  const PosPalette({this.brightness = Brightness.light, this.midnight = false});
  final Brightness brightness;
  bool get dark => brightness == Brightness.dark;

  /// THE ALL-BLACK DARK, AND ITS VALUES COME FROM THE DASHBOARD.
  ///
  /// The dashboard ships two dark themes — `dark` (the deep ocean navy) and
  /// `midnight` (all black) — and the till had a third set of dark colours nobody
  /// else used, so the same café saw two different nights depending on the screen.
  /// The owner asked for the till's dark to BE the dashboard's, and for the black one
  /// to exist here too (2026-10-12). These are `packages/tokens/tokens/dashboard.json`
  /// under `$themes.dark` / `$themes.midnight`: canvas, surface, the two lines and
  /// the ink scale, which is what "the sidebar with the content" means.
  ///
  /// Midnight uses dark fills and small bands of the original brand colours.
  /// Text accents and filled actions have separate roles.
  final bool midnight;

  Color get background => dark
      ? (midnight ? const Color(0xFF000000) : const Color(0xFF070C18))
      : const Color(0xFFF3F2EE);
  Color get surface => dark
      ? (midnight ? const Color(0xFF000000) : const Color(0xFF0F1728))
      : const Color(0xFFFFFEFA);
  Color get onSurface => dark
      ? (midnight ? const Color(0xFFF2F2F2) : const Color(0xFFEDF1F8))
      : const Color(0xFF131F44);
  Color get onSurfaceVariant => dark
      ? (midnight ? const Color(0xFFB0B0B0) : const Color(0xFF99A2B5))
      : const Color(0xFF59677F);
  Color get primary => dark ? const Color(0xFFA8BBDE) : const Color(0xFF223979);
  Color get onPrimary =>
      dark ? const Color(0xFF131F44) : const Color(0xFFFFFEFA);
  Color get primaryContainer => dark
      ? (midnight ? const Color(0xFF111A2E) : const Color(0xFF1A2440))
      : const Color(0xFFE4EAF5);
  Color get onPrimaryContainer => primary;
  // Reserve a larger colour area for the main action. The blue edge separates
  // the navy fill from Midnight's black surface.
  Color get action => midnight ? const Color(0xFF223979) : signal;
  Color get onAction => midnight ? onSurface : onSignal;
  Color get outline => dark
      ? (midnight ? const Color(0xFF3A3A3A) : const Color(0xFF2D3854))
      : const Color(0xFF728098);
  Color get outlineVariant => dark
      ? (midnight ? const Color(0xFF2A2A2A) : const Color(0xFF1E273D))
      : const Color(0xFFD6DBE5);
  Color get surfaceContainerHighest => dark
      ? (midnight ? const Color(0xFF0D0D0D) : const Color(0xFF0C1322))
      : const Color(0xFFE9ECF2);
  Color get surfaceContainerHigh => dark
      ? (midnight ? const Color(0xFF0D0D0D) : const Color(0xFF0F1626))
      : const Color(0xFFEEF0F5);
  Color get secondaryContainer => surfaceContainerHighest;
  Color get onSecondaryContainer => onSurface;
  Color get tertiary =>
      dark ? const Color(0xFFFFD38A) : const Color(0xFF805100);
  Color get tertiaryContainer =>
      dark ? const Color(0xFF3F311C) : const Color(0xFFFFF2D8);
  Color get onTertiaryContainer => tertiary;
  Color get error => dark ? const Color(0xFFFFAD9E) : const Color(0xFFA4362B);
  Color get errorContainer =>
      dark ? const Color(0xFF492B25) : const Color(0xFFFFEDE6);
  Color get onErrorContainer => error;
  // A small signal on navigation and the checkout action, never a status colour.
  Color get signal => const Color(0xFF7692CB);
  Color get onSignal => const Color(0xFF131F44);
  // The rail: the dashboard's sidebar in the dark themes, the brand navy in the light
  // one — which is where it already was.
  Color get rail => dark
      ? (midnight ? const Color(0xFF000000) : const Color(0xFF070C16))
      : const Color(0xFF131F44);
  Color get onRail => const Color(0xFFF2F4FA);
}

final class PosTextStyles {
  PosTextStyles({
    required Color ink,
    String fontFamily = 'IBM Plex Sans',
    String headingFamily = 'Bricolage Grotesque',
  }) {
    TextStyle style(
      double size,
      double height,
      FontWeight weight, [
      double spacing = 0,
    ]) => TextStyle(
      fontFamily: fontFamily,
      color: ink,
      fontSize: size,
      height: height,
      fontWeight: weight,
      letterSpacing: spacing,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    TextStyle heading(double size, double height, FontWeight weight) =>
        style(size, height, weight, -.35).copyWith(fontFamily: headingFamily);
    displayLarge = heading(44, 1.08, FontWeight.w700);
    displaySmall = heading(36, 1.12, FontWeight.w700);
    headlineMedium = heading(30, 1.16, FontWeight.w700);
    headlineSmall = heading(24, 1.2, FontWeight.w600);
    titleLarge = heading(20, 1.25, FontWeight.w600);
    titleMedium = style(16, 1.3, FontWeight.w600);
    titleSmall = style(14, 1.3, FontWeight.w600);
    bodyLarge = style(16, 1.45, FontWeight.w400);
    bodyMedium = style(15, 1.4, FontWeight.w400);
    bodySmall = style(13, 1.4, FontWeight.w400);
    labelLarge = style(14, 1.25, FontWeight.w600);
    labelMedium = style(13, 1.3, FontWeight.w400);
    labelSmall = style(12, 1.3, FontWeight.w400);
  }
  late final TextStyle? displayLarge,
      displaySmall,
      headlineMedium,
      headlineSmall,
      titleLarge,
      titleMedium,
      titleSmall,
      bodyLarge,
      bodyMedium,
      bodySmall,
      labelLarge,
      labelMedium,
      labelSmall;
  PosTextStyles apply({
    String? fontFamily,
    Color? bodyColor,
    Color? displayColor,
  }) => PosTextStyles(
    ink: bodyColor ?? bodyMedium!.color!,
    fontFamily: fontFamily ?? bodyMedium!.fontFamily!,
    headingFamily: fontFamily ?? headlineSmall!.fontFamily!,
  );
}

final class PosThemeData {
  PosThemeData({
    this.brightness = Brightness.light,
    this.midnight = false,
    PosTextStyles? textTheme,
  }) : colorScheme = PosPalette(brightness: brightness, midnight: midnight),
       textTheme =
           textTheme ??
           PosTextStyles(
             ink: PosPalette(
               brightness: brightness,
               midnight: midnight,
             ).onSurface,
           );
  final Brightness brightness;

  /// The all-black variant of the dark theme. See `PosPalette.midnight`.
  final bool midnight;

  final PosPalette colorScheme;
  final PosTextStyles textTheme;
  Color get scaffoldBackgroundColor => colorScheme.background;
  PosThemeData copyWith({
    PosTextStyles? textTheme,
    Brightness? brightness,
    bool? midnight,
  }) => PosThemeData(
    brightness: brightness ?? this.brightness,
    midnight: midnight ?? this.midnight,
    textTheme: textTheme ?? this.textTheme,
  );
}

class PosTheme extends InheritedWidget {
  const PosTheme({required this.data, required super.child, super.key});
  final PosThemeData data;
  static PosThemeData of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<PosTheme>()?.data ??
      PosThemeData();
  @override
  bool updateShouldNotify(PosTheme oldWidget) => data != oldWidget.data;
}

/// What the operator chose in Ajustes. Four, not three: the dashboard already ships
/// two dark themes (the ocean navy and the all-black midnight) and this till now
/// speaks the same two.
enum PosThemeMode { system, light, dark, midnight }
