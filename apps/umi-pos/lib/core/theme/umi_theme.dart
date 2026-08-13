import 'package:flutter/material.dart';

abstract final class UmiSpacing {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
}

abstract final class UmiRadius {
  static const control = 14.0;
  static const surface = 20.0;
}

abstract final class UmiTouchTarget {
  static const minimum = 48.0;
  static const primary = 52.0;
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
    final textTheme = ThemeData(brightness: brightness).textTheme.apply(
      bodyColor: scheme.onSurface,
      displayColor: scheme.onSurface,
    );
    final controlShape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(UmiRadius.control),
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      visualDensity: VisualDensity.standard,
      textTheme: textTheme.copyWith(
        headlineMedium: textTheme.headlineMedium?.copyWith(
          height: 1.15,
          fontWeight: FontWeight.w600,
        ),
        headlineSmall: textTheme.headlineSmall?.copyWith(
          height: 1.2,
          fontWeight: FontWeight.w600,
        ),
        titleLarge: textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        bodyLarge: textTheme.bodyLarge?.copyWith(height: 1.5),
        bodyMedium: textTheme.bodyMedium?.copyWith(height: 1.45),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(UmiRadius.surface),
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(UmiRadius.control),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 16,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(
            UmiTouchTarget.minimum,
            UmiTouchTarget.primary,
          ),
          backgroundColor: _primary,
          foregroundColor: Colors.white,
          shape: controlShape,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(
            UmiTouchTarget.minimum,
            UmiTouchTarget.primary,
          ),
          shape: controlShape,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.square(UmiTouchTarget.minimum),
          shape: controlShape,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size.square(UmiTouchTarget.minimum),
          shape: controlShape,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          minimumSize: const Size.square(UmiTouchTarget.minimum),
        ),
      ),
      focusColor: _primary.withValues(alpha: .22),
      dialogTheme: DialogThemeData(shape: controlShape),
      bottomSheetTheme: const BottomSheetThemeData(
        showDragHandle: true,
        constraints: BoxConstraints(maxWidth: 760),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: controlShape,
      ),
      extensions: const <ThemeExtension<dynamic>>[UmiOperatorTokens()],
    );
  }
}

@immutable
final class UmiOperatorTokens extends ThemeExtension<UmiOperatorTokens> {
  const UmiOperatorTokens();

  TextStyle money(TextTheme textTheme) =>
      (textTheme.headlineMedium ?? const TextStyle()).copyWith(
        fontWeight: FontWeight.w700,
        fontFeatures: const [FontFeature.tabularFigures()],
      );

  @override
  UmiOperatorTokens copyWith() => const UmiOperatorTokens();

  @override
  UmiOperatorTokens lerp(
    covariant ThemeExtension<UmiOperatorTokens>? other,
    double t,
  ) => const UmiOperatorTokens();
}
