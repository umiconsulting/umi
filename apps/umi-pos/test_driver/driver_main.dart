// Development-only entrypoint. It enables the Flutter Driver extension so an
// external tool (dart mcp-server `flutter_driver_command`, or a flutter_driver
// script) can tap, type, read text, and take screenshots of the running app.
//
// Run it on the Linux desktop with:
//   flutter run -d linux -t test_driver/driver_main.dart --print-dtd \
//     --dart-define=... (same defines as docs/development/RUNNING_UMIPOS.md)
//
// It is never the production target: `lib/main.dart` stays the default.
import 'dart:convert';
import 'package:flutter/widgets.dart';
import 'package:flutter_driver/driver_extension.dart';
import 'package:flutter_driver/flutter_driver.dart' show SerializableFinder;
import 'package:flutter_test/flutter_test.dart' as flutter_test;
import 'package:umi_pos/bootstrap/entrypoint.dart';
import 'package:umi_pos/core/theme/pos_ui.dart' show PosTooltip, PosField;

import 'navigation_probe.dart';
import 'pos_tooltip_finder.dart';
import 'receipt_probe.dart';

Future<void> main() async {
  // Must run before any binding is created: it installs the driver binding.
  enableFlutterDriverExtension(
    enableTextEntryEmulation: false,
    finders: [_PosTooltipExtension(), _PosEditableFieldExtension()],
    handler: (message) async {
      if (message == 'navigation-text') return navigationMeasurements();
      if (message?.startsWith('receipt-probe:') ?? false) {
        return receiptProbe(message!);
      }
      if (message == 'text-scaling') {
        final element = flutter_test.find.byType(Text).evaluate().first;
        final scaler = MediaQuery.textScalerOf(element);
        return jsonEncode({
          'method': 'MediaQuery of a visible native Text; measurement only',
          'scaledFontSizes': {
            for (final size in [12.0, 14.0, 16.0, 20.0, 28.0])
              size.toString(): scaler.scale(size),
          },
        });
      }
      if (message != 'frame') throw ArgumentError.value(message, 'message');
      await WidgetsBinding.instance.endOfFrame;
      return 'ready';
    },
  );
  await launchUmiPos();
}

class _PosEditableFieldExtension extends FinderExtension {
  @override
  String get finderType => 'PosEditableField';
  @override
  SerializableFinder deserialize(
    Map<String, String> params,
    DeserializeFinderFactory finderFactory, {
    String? path,
  }) => PosEditableFieldFinder(params['label']!);
  @override
  flutter_test.Finder createFinder(
    SerializableFinder finder,
    CreateFinderFactory finderFactory,
  ) {
    final label = (finder as PosEditableFieldFinder).label;
    return flutter_test.find.descendant(
      of: flutter_test.find.byWidgetPredicate(
        (widget) =>
            widget is PosField &&
            (widget.semanticLabel ?? widget.decoration?.labelText) == label,
        description: 'PosField "$label"',
      ),
      matching: flutter_test.find.byType(EditableText),
    );
  }
}

class _PosTooltipExtension extends FinderExtension {
  @override
  String get finderType => 'PosTooltip';
  @override
  SerializableFinder deserialize(
    Map<String, String> params,
    DeserializeFinderFactory finderFactory, {
    String? path,
  }) => PosTooltipFinder(params['message']!);
  @override
  flutter_test.Finder createFinder(
    SerializableFinder finder,
    CreateFinderFactory finderFactory,
  ) {
    final message = (finder as PosTooltipFinder).message;
    return flutter_test.find.byWidgetPredicate(
      (widget) => widget is PosTooltip && widget.message == message,
      description: 'PosTooltip "$message"',
    );
  }
}
