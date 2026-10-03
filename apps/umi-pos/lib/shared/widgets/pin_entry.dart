/// The till's PIN, entered the same way everywhere it is asked for.
///
/// This lived inside the operator login screen, which was the only place that
/// asked for a PIN. The manager approval asked for the same secret with a text
/// field — one screen's worth of digits in a control a thousand pixels wide that
/// summoned the operating system's keyboard on a counter tablet. Two controls
/// for one idea is how a product stops feeling like one product, so the drawing
/// lives here and both screens use it.
///
/// The keypad is the primary affordance, because a till is a touch device. The
/// caller is responsible for the [KeyboardListener] that keeps a physical
/// keyboard working; [PinPad] only draws.
library;

import 'package:flutter/material.dart';

import '../../core/theme/umi_theme.dart';

/// One circle per digit, filled as far as the operator has typed.
///
/// The row never shrinks below [minLength]: a single dot reads as a field that
/// has swallowed one keystroke, where four empty slots read as "four digits
/// belong here".
final class PinDots extends StatelessWidget {
  const PinDots({required this.length, required this.minLength, super.key});

  final int length;
  final int minLength;

  @override
  Widget build(BuildContext context) {
    final slots = length < minLength ? minLength : length;
    final scheme = Theme.of(context).colorScheme;
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        for (var i = 0; i < slots; i++)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Container(
              width: 16,
              height: 16,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < length ? scheme.primary : Colors.transparent,
                border: Border.all(
                  color: i < length ? scheme.primary : scheme.outlineVariant,
                  width: 2,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Three columns of large keys, one of them zero, with clear and backspace.
///
/// Laid out as rows rather than a grid so every key has the same height by
/// construction, whatever width the screen gives it. A grid sizes keys from
/// their aspect ratio, which means the same keypad is a different height on
/// every surface and cannot be composed with anything that needs to know how
/// tall it is.
final class PinPad extends StatelessWidget {
  const PinPad({
    required this.onDigit,
    required this.onBackspace,
    required this.onClear,
    required this.canEdit,
    required this.es,
    this.enabled = true,
    this.keyHeight = 68,
    super.key,
  });

  final ValueChanged<String> onDigit;
  final VoidCallback onBackspace;
  final VoidCallback onClear;
  final bool canEdit;
  final bool es;

  /// False greys the whole pad. A PIN that cannot be accepted — because the
  /// credential is locked, or because there is no credential at all — must stop
  /// inviting keystrokes.
  final bool enabled;

  /// The height of one key. The floor for a key on this till is the 48 px touch
  /// target; the default is what the PIN pad has always been drawn at.
  final double keyHeight;

  @override
  Widget build(BuildContext context) {
    final keys = <Widget>[
      for (final digit in const ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
        _PinKey(label: digit, onTap: enabled ? () => onDigit(digit) : null),
      _PinKey(
        icon: Icons.close,
        semanticLabel: es ? 'Borrar todo' : 'Clear all',
        onTap: enabled && canEdit ? onClear : null,
        emphasized: false,
      ),
      _PinKey(label: '0', onTap: enabled ? () => onDigit('0') : null),
      _PinKey(
        icon: Icons.backspace_outlined,
        semanticLabel: es ? 'Borrar' : 'Backspace',
        onTap: enabled && canEdit ? onBackspace : null,
        emphasized: false,
      ),
    ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var row = 0; row < 4; row++)
          Padding(
            padding: EdgeInsets.only(top: row == 0 ? 0 : UmiSpacing.sm),
            child: SizedBox(
              height: keyHeight,
              child: Row(
                children: [
                  for (var column = 0; column < 3; column++) ...[
                    if (column > 0) const SizedBox(width: UmiSpacing.sm),
                    Expanded(child: keys[row * 3 + column]),
                  ],
                ],
              ),
            ),
          ),
      ],
    );
  }
}

final class _PinKey extends StatelessWidget {
  const _PinKey({
    this.label,
    this.icon,
    this.semanticLabel,
    required this.onTap,
    this.emphasized = true,
  });

  final String? label;
  final IconData? icon;
  final String? semanticLabel;
  final VoidCallback? onTap;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final child = icon != null
        ? Icon(icon, size: 26)
        : Text(label!, style: Theme.of(context).textTheme.headlineSmall);
    return Semantics(
      button: true,
      label: semanticLabel ?? label,
      child: SizedBox.expand(
        child: emphasized
            ? FilledButton.tonal(onPressed: onTap, child: child)
            : OutlinedButton(onPressed: onTap, child: child),
      ),
    );
  }
}
