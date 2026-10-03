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
  /// The smallest hit box any pointer target may publish, on every platform.
  /// Plan section 5.2: the floor is 44 px and this product's tap floor is 48.
  static const minimum = 48.0;
  static const primary = 52.0;
}

abstract final class UmiMotion {
  static const fast = Duration(milliseconds: 120);
  static const standard = Duration(milliseconds: 220);
}

abstract final class UmiTheme {
  // PoloTab-style palette: a bright blue primary on a neutral near-black ground
  // with slightly lighter grey panels — the tender-floor look a barista reads in
  // low light without the old violet cast.
  //
  // This is the brand blue, not the scheme's `primary`. Material 3 resolves a
  // dark-mode `primary` to a pale tone, and this till wants the vivid blue for
  // anything that acts or that marks the current choice. Use `UmiTheme.brand`
  // wherever the till speaks in its own colour.
  static const brand = Color(0xFF2E7DFF);
  static const _primary = brand;
  static const _darkSurface = Color(0xFF23252B);

  /// The colour of "act, but not because the money is wrong".
  ///
  /// Error red says a financial fact failed, and on this till that is almost
  /// never what happened: the ledger commits first, and what fails afterwards is
  /// the hardware. A drawer that did not answer needs the operator's hand, not
  /// their alarm, and it needs a colour that does not read as "the sale is
  /// broken". Amber on both grounds, dark enough for text on the light theme.
  static const warning = Color(0xFFB26A00);

  static ThemeData dark() =>
      _theme(Brightness.dark, const Color(0xFF121317), _darkSurface);

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
      // The till is a touch surface whatever platform the build runs on, and
      // `ThemeData` picks `shrinkWrap` for linux/macos/windows — which is how a
      // 38 px filter chip and a 40 px order-type segment reached the floor. One
      // tap floor for the whole product: `UmiTouchTarget.minimum`.
      materialTapTargetSize: MaterialTapTargetSize.padded,
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
        // PoloTab's primary buttons are the vivid brand blue with white text, not
        // Material's pale dark-mode primary tint — so pin the colour explicitly.
        style: FilledButton.styleFrom(
          minimumSize: const Size(
            UmiTouchTarget.minimum,
            UmiTouchTarget.primary,
          ),
          backgroundColor: _primary,
          foregroundColor: Colors.white,
          disabledBackgroundColor: _primary.withValues(alpha: .38),
          disabledForegroundColor: Colors.white.withValues(alpha: .70),
          shape: controlShape,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.square(UmiTouchTarget.minimum),
          // Material 3 inks an outlined button with the scheme's `primary`,
          // which a dark scheme resolves to a pale periwinkle. On this till it
          // read as purple text, so the label takes the surface ink instead and
          // the outline carries the boundary.
          foregroundColor: scheme.onSurface,
          shape: controlShape,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: const Size.square(UmiTouchTarget.minimum),
          // Same M3 default, same fix: a text button still acts, so it speaks
          // in the brand blue rather than in the pale dark-mode primary.
          foregroundColor: brand,
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
      // NO `snackBarTheme`, and no floating bottom notification anywhere in the
      // till. The owner's direction: those bars are distracting and are not this
      // design. They covered the destination bar, they sat on top of whatever
      // dialog was open, and a tap aimed at the dialog underneath dismissed the
      // bar instead of reaching the button - the sale-complete dialog's "Nuevo
      // pedido" was measurably stolen by the "listo para el siguiente cliente"
      // bar sitting on it. A message belongs where the work is: `InlineNotice`
      // in the surface that raised it, or the dialog that surface already uses.
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
