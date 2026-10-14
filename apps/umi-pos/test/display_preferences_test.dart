import 'dart:async';
import 'dart:convert';

import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/storage/storage.dart';
import 'package:umi_pos/core/theme/display_preferences.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/settings/display_settings_surface.dart';

final class _Store implements PreferencesStore {
  final values = <String, String>{};
  bool fail = false;
  Completer<void>? pending;
  @override
  Future<String?> readString(String key) async => values[key];
  @override
  Future<void> writeString(String key, String value) async {
    if (pending != null) await pending!.future;
    if (fail) throw StateError('Disk unavailable');
    values[key] = value;
  }

  @override
  Future<void> delete(String key) async => values.remove(key);
}

void main() {
  test('appearance, locale and motion survive another controller', () async {
    final store = _Store();
    final prefs = DisplayPreferences(store);
    await prefs.load();
    await prefs.setTheme(PosThemeMode.dark);
    await prefs.setLanguage('en');
    await prefs.setReduceMotion(true);
    await prefs.setKitchenSoundsMuted(true);
    final restored = DisplayPreferences(store);
    await restored.load();
    expect(restored.themeMode, PosThemeMode.dark);
    expect(restored.language, 'en');
    expect(restored.reduceMotion, isTrue);
    expect(restored.kitchenSoundsMuted, isTrue);
    expect(store.values.keys, [DisplayPreferences.storageKey]);
    prefs.dispose();
    restored.dispose();
  });

  test('failed write preserves the saved choice and supports retry', () async {
    final store = _Store();
    final prefs = DisplayPreferences(store);
    await prefs.load();
    await prefs.setTheme(PosThemeMode.light);
    final saved = store.values[DisplayPreferences.storageKey];
    store.fail = true;
    await prefs.setTheme(PosThemeMode.dark);
    expect(prefs.themeMode, PosThemeMode.light);
    expect(store.values[DisplayPreferences.storageKey], saved);
    expect(prefs.error, DisplayPreferenceError.write);
    expect(prefs.busy, isFalse);
    store.fail = false;
    await prefs.setTheme(PosThemeMode.dark);
    expect(prefs.themeMode, PosThemeMode.dark);
    expect(prefs.error, isNull);
    prefs.dispose();
  });

  test(
    'invalid saved settings keep safe defaults without deleting them',
    () async {
      final store = _Store();
      store.values[DisplayPreferences.storageKey] = jsonEncode({
        'version': 1,
        'theme': 'dark',
        'language': 'unknown',
        'reduceMotion': true,
      });
      final prefs = DisplayPreferences(store);
      await prefs.load();
      expect(prefs.themeMode, PosThemeMode.system);
      expect(prefs.language, isNull);
      expect(prefs.reduceMotion, isFalse);
      expect(prefs.error, DisplayPreferenceError.read);
      expect(store.values, isNotEmpty);
      prefs.dispose();
    },
  );

  test(
    'pending persistence prevents competing changes and disposed notifications',
    () async {
      final store = _Store();
      final prefs = DisplayPreferences(store);
      await prefs.load();
      store.pending = Completer<void>();
      final saving = prefs.setTheme(PosThemeMode.dark);
      await prefs.setLanguage('en');
      expect(prefs.language, isNull);
      prefs.dispose();
      store.pending!.complete();
      await saving;
      expect(
        (jsonDecode(store.values[DisplayPreferences.storageKey]!)
            as Map<String, dynamic>)['theme'],
        'dark',
      );
    },
  );

  test('text size persists and failed storage keeps the saved size', () async {
    final store = _Store();
    final prefs = DisplayPreferences(store);
    await prefs.load();
    await prefs.setTextSize(PosTextSize.large);
    store.fail = true;
    await prefs.setTextSize(PosTextSize.extraLarge);
    expect(prefs.textSize, PosTextSize.large);
    expect(prefs.error, DisplayPreferenceError.write);
    store.fail = false;
    await prefs.setTextSize(PosTextSize.extraLarge);
    await prefs.setLanguage('en');
    final restored = DisplayPreferences(store);
    await restored.load();
    expect(restored.textSize, PosTextSize.extraLarge);
    expect(restored.textScalerFor(TextScaler.noScaling).scale(16), 32);
    expect(restored.language, 'en');
    prefs.dispose();
    restored.dispose();
  });

  test(
    'old display preferences retain their choices and system text size',
    () async {
      final store = _Store()
        ..values[DisplayPreferences.storageKey] = jsonEncode({
          'version': 1,
          'theme': 'dark',
          'language': 'es',
          'reduceMotion': true,
        });
      final prefs = DisplayPreferences(store);
      await prefs.load();
      expect(prefs.textSize, PosTextSize.system);
      expect(prefs.themeMode, PosThemeMode.dark);
      expect(prefs.reduceMotion, isTrue);
      expect(prefs.error, isNull);
      final system = TextScaler.linear(2.5);
      expect(prefs.textScalerFor(system), same(system));
      await prefs.setTextSize(PosTextSize.extraLarge);
      expect(prefs.textScalerFor(system).scale(16), 40);
      prefs.dispose();
    },
  );

  test('a text minimum preserves system values above its floor', () async {
    final prefs = DisplayPreferences(_Store());
    await prefs.load();
    await prefs.setTextSize(PosTextSize.extraLarge);
    const system = _NonlinearScaler();
    expect(prefs.textScalerFor(system).scale(12), system.scale(12));
    expect(prefs.textScalerFor(system).scale(28), 56);
    prefs.dispose();
  });

  test(
    'an unknown saved text size keeps safe defaults without deleting it',
    () async {
      final store = _Store()
        ..values[DisplayPreferences.storageKey] = jsonEncode({
          'version': 1,
          'theme': 'dark',
          'language': 'es',
          'reduceMotion': true,
          'textSize': 'tiny',
        });
      final prefs = DisplayPreferences(store);
      await prefs.load();
      expect(prefs.textSize, PosTextSize.system);
      expect(prefs.themeMode, PosThemeMode.system);
      expect(prefs.error, DisplayPreferenceError.read);
      expect(store.values, isNotEmpty);
      prefs.dispose();
    },
  );

  for (final brightness in Brightness.values) {
    testWidgets('settings remain usable at phone scale 2 in $brightness', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(375, 812);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final prefs = DisplayPreferences(_Store());
      await prefs.load();
      addTearDown(prefs.dispose);
      await tester.pumpWidget(
        DisplayPreferencesScope(
          preferences: prefs,
          child: PosApp(
            theme: PosThemeData(brightness: brightness),
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(2)),
              child: child!,
            ),
            home: DisplaySettingsSurface(
              onLock: () async {},
              onLogout: () async {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Oscura'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Oscura'));
      await tester.pumpAndSettle();
      expect(prefs.themeMode, PosThemeMode.dark);
      await tester.scrollUntilVisible(
        find.text('Bloquear operador'),
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(
        tester.getRect(find.text('Bloquear operador')).right,
        lessThanOrEqualTo(375),
      );
      expect(tester.takeException(), isNull);
    });
  }
}

class _NonlinearScaler extends TextScaler {
  const _NonlinearScaler();
  @override
  double get textScaleFactor => 2;
  @override
  double scale(double fontSize) => fontSize * (fontSize <= 16 ? 2.5 : 1.5);
}
