import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';

void main() {
  test('POS retains the two shared UMI brand colours', () {
    final tokens =
        jsonDecode(
              File('../../packages/tokens/tokens/core.json').readAsStringSync(),
            )
            as Map<String, dynamic>;
    final colors = tokens['color'] as Map<String, dynamic>;
    Color color(String name) {
      final token = colors[name] as Map<String, dynamic>;
      return Color(
        0xFF000000 |
            int.parse((token['\$value'] as String).substring(1), radix: 16),
      );
    }

    expect(UmiTheme.brand, color('navy'));
    final light = UmiTheme.light().colorScheme;
    expect(light.primary, color('navy'));
    expect(light.signal, color('blue'));
    expect(UmiTheme.dark().colorScheme.signal, color('blue'));
  });

  test('primary, paper and checkout labels retain readable solid pairs', () {
    double luminance(Color color) {
      double channel(double value) => value <= .04045
          ? value / 12.92
          : math.pow((value + .055) / 1.055, 2.4).toDouble();
      return .2126 * channel(color.r) +
          .7152 * channel(color.g) +
          .0722 * channel(color.b);
    }

    double contrast(Color a, Color b) {
      final x = luminance(a), y = luminance(b);
      return (math.max(x, y) + .05) / (math.min(x, y) + .05);
    }

    for (final theme in [UmiTheme.light(), UmiTheme.dark()]) {
      final p = theme.colorScheme;
      for (final pair in [
        (p.onSurface, p.surface),
        (p.onSurfaceVariant, p.surface),
        (p.onPrimary, p.primary),
        (p.onSignal, p.signal),
        (p.onRail, p.rail),
        (p.onSurfaceVariant, p.surfaceContainerHighest),
      ]) {
        expect(contrast(pair.$1, pair.$2), greaterThanOrEqualTo(4.5));
      }
    }
  });
}
