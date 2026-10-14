import 'package:flutter/widgets.dart';
import 'pos_theme.dart';
export 'pos_theme.dart';

abstract final class UmiSpacing {
  static const xs = 4.0, sm = 8.0, md = 16.0, lg = 24.0, xl = 32.0;
}

abstract final class UmiRadius {
  static const control = PosGeometry.controlRadius,
      surface = PosGeometry.surfaceRadius;
}

abstract final class UmiTouchTarget {
  static const minimum = 48.0, primary = 56.0;
}

abstract final class UmiMotion {
  static const fast = Duration(milliseconds: 120);
  static const standard = Duration(milliseconds: 220);
}

abstract final class UmiTheme {
  static const brand = Color(0xFF223979);
  static const warning = Color(0xFF805100);
  static PosThemeData light() => PosThemeData();
  static PosThemeData dark() => PosThemeData(brightness: Brightness.dark);

  /// The second dark: the dashboard's all-black `midnight`, so the café that picks
  /// it on the console gets it on the till too (owner, 2026-10-12).
  static PosThemeData midnight() =>
      PosThemeData(brightness: Brightness.dark, midnight: true);
}

final class UmiOperatorTokens {
  const UmiOperatorTokens();
  TextStyle money(PosTextStyles textTheme) =>
      (textTheme.bodyLarge ?? const TextStyle()).copyWith(
        fontSize: 30,
        height: 1.16,
        fontWeight: FontWeight.w700,
      );
}
