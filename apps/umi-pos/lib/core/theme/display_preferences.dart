import 'dart:convert';

import 'package:flutter/widgets.dart';

import '../storage/storage.dart';
import 'pos_theme.dart';

enum DisplayPreferenceError { read, write }

enum PosTextSize { system, large, extraLarge }

/// Presentation only. Credentials, permissions and monetary state use their
/// existing stores; changing the display never starts another operator session.
final class DisplayPreferences extends ChangeNotifier {
  DisplayPreferences(this.store);
  static const storageKey = 'display.v1';
  final PreferencesStore store;
  PosThemeMode themeMode = PosThemeMode.system;
  String? language;
  bool reduceMotion = false;
  bool kitchenSoundsMuted = false;
  PosTextSize textSize = PosTextSize.system;

  /// WHICH KITCHEN STATION THIS SCREEN IS.
  ///
  /// A till has no station of its own, so its board is the whole pass — every station's
  /// ticket, with chips to narrow it. A screen that lives on a bar or in the kitchen is
  /// not that: the person standing in front of it works one station, and making them
  /// re-tap their chip after every restart is how a ticket gets read twice or not at all.
  /// The choice is remembered per DEVICE, like the theme and the language, because it is
  /// a fact about the screen on the wall and not about who is signed in (owner,
  /// 2026-10-13: "que la tablet de barra abra en Barra").
  String? kitchenStationId;

  /// Its label, kept so the chip stays readable even with no work on the rail.
  String? kitchenStationName;
  bool busy = true;
  DisplayPreferenceError? error;
  bool _alive = true;

  Future<void> load() async {
    busy = true;
    error = null;
    _notify();
    try {
      final raw = await store.readString(storageKey);
      if (raw != null) {
        final value = jsonDecode(raw) as Map<String, dynamic>;
        if (value['version'] != 1 ||
            !PosThemeMode.values.any((v) => v.name == value['theme']) ||
            ![null, 'es', 'en'].contains(value['language']) ||
            value['reduceMotion'] is! bool ||
            (value.containsKey('textSize') &&
                !PosTextSize.values.any((v) => v.name == value['textSize']))) {
          throw const FormatException('Invalid display preferences');
        }
        if (_alive) {
          themeMode = PosThemeMode.values.firstWhere(
            (v) => v.name == value['theme'],
          );
          language = value['language'] as String?;
          reduceMotion = value['reduceMotion'] as bool;
          kitchenSoundsMuted = value['kitchenSoundsMuted'] == true;
          kitchenStationId = value['kitchenStationId'] as String?;
          kitchenStationName = value['kitchenStationName'] as String?;
          textSize = value.containsKey('textSize')
              ? PosTextSize.values.firstWhere(
                  (v) => v.name == value['textSize'],
                )
              : PosTextSize.system;
        }
      }
    } catch (_) {
      if (_alive) error = DisplayPreferenceError.read;
    } finally {
      busy = false;
      _notify();
    }
  }

  Future<void> setTheme(PosThemeMode value) => _save(
    theme: value,
    locale: language,
    motion: reduceMotion,
    size: textSize,
    stationId: kitchenStationId,
    stationName: kitchenStationName,
  );
  Future<void> setLanguage(String? value) => _save(
    theme: themeMode,
    locale: value,
    motion: reduceMotion,
    size: textSize,
    stationId: kitchenStationId,
    stationName: kitchenStationName,
  );
  Future<void> setReduceMotion(bool value) => _save(
    theme: themeMode,
    locale: language,
    motion: value,
    size: textSize,
    stationId: kitchenStationId,
    stationName: kitchenStationName,
  );
  Future<void> setTextSize(PosTextSize value) => _save(
    theme: themeMode,
    locale: language,
    motion: reduceMotion,
    size: value,
    stationId: kitchenStationId,
    stationName: kitchenStationName,
  );

  /// Remember which station this screen is, or forget it (`null` = the pass).
  Future<void> setKitchenStation({
    required String? id,
    required String? name,
  }) => _save(
    theme: themeMode,
    locale: language,
    motion: reduceMotion,
    size: textSize,
    stationId: id,
    stationName: name,
  );

  TextScaler textScalerFor(TextScaler system) => switch (textSize) {
    PosTextSize.system => system,
    PosTextSize.large => system.clamp(minScaleFactor: 1.5),
    PosTextSize.extraLarge => system.clamp(minScaleFactor: 2),
  };

  Future<void> setKitchenSoundsMuted(bool value) => _save(
    theme: themeMode,
    locale: language,
    motion: reduceMotion,
    size: textSize,
    stationId: kitchenStationId,
    stationName: kitchenStationName,
    soundsMuted: value,
  );

  Future<void> _save({
    required PosThemeMode theme,
    required String? locale,
    required bool motion,
    required PosTextSize size,
    String? stationId,
    String? stationName,
    bool? soundsMuted,
  }) async {
    if (busy || !_alive) return;
    if (![null, 'es', 'en'].contains(locale)) {
      throw ArgumentError.value(locale, 'locale');
    }
    busy = true;
    error = null;
    _notify();
    try {
      await store.writeString(
        storageKey,
        jsonEncode({
          'version': 1,
          'theme': theme.name,
          'language': locale,
          'reduceMotion': motion,
          'textSize': size.name,
          'kitchenStationId': stationId,
          'kitchenStationName': stationName,
          'kitchenSoundsMuted': soundsMuted ?? kitchenSoundsMuted,
        }),
      );
      if (_alive) {
        themeMode = theme;
        language = locale;
        reduceMotion = motion;
        textSize = size;
        kitchenStationId = stationId;
        kitchenStationName = stationName;
        kitchenSoundsMuted = soundsMuted ?? kitchenSoundsMuted;
      }
    } catch (_) {
      if (_alive) error = DisplayPreferenceError.write;
    } finally {
      busy = false;
      _notify();
    }
  }

  void _notify() {
    if (_alive) notifyListeners();
  }

  @override
  void dispose() {
    _alive = false;
    super.dispose();
  }
}

final class DisplayPreferencesScope
    extends InheritedNotifier<DisplayPreferences> {
  const DisplayPreferencesScope({
    required DisplayPreferences preferences,
    required super.child,
    super.key,
  }) : super(notifier: preferences);

  static DisplayPreferences? maybeOf(BuildContext context) => context
      .dependOnInheritedWidgetOfExactType<DisplayPreferencesScope>()
      ?.notifier;
}
