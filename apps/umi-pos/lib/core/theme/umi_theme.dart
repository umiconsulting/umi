import 'package:flutter/material.dart';

abstract final class UmiSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
}

abstract final class UmiMotion {
  static const fast = Duration(milliseconds: 120);
  static const standard = Duration(milliseconds: 220);
}

abstract final class UmiTheme {
  static const _primary = Color(0xFF6857D9);
  static const _darkSurface = Color(0xFF17171D);

  static ThemeData dark() =>
      _theme(Brightness.dark, const Color(0xFF0E0E13), _darkSurface);

  static ThemeData light() =>
      _theme(Brightness.light, const Color(0xFFF7F6FB), Colors.white);

  static ThemeData _theme(
    Brightness brightness,
    Color background,
    Color surface,
  ) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _primary,
      brightness: brightness,
      surface: surface,
      error: const Color(0xFFB3261E),
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      visualDensity: VisualDensity.standard,
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(48, 48),
          backgroundColor: _primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
    );
  }
}
