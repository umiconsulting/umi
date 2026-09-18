import 'package:flutter/material.dart';

import '../../core/theme/umi_theme.dart';

/// A message that stays where the work is.
///
/// The till used to say things like this in a bar that slid up from the bottom
/// of the screen and vanished on its own. Those bars are gone on purpose: they
/// covered the destination bar, they sat on top of whatever dialog was open,
/// and a tap aimed at the dialog underneath dismissed the bar instead of
/// reaching the button. A message belongs beside the control that caused it,
/// where it stays put until the operator does something else.
///
/// `liveRegion` is what keeps that move from costing a screen reader anything:
/// the bar used to be announced when it appeared, and this is announced the
/// same way without a floating overlay.
final class InlineNotice extends StatelessWidget {
  const InlineNotice({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: UmiSpacing.md,
          vertical: UmiSpacing.sm,
        ),
        decoration: BoxDecoration(
          color: scheme.error.withValues(alpha: .14),
          borderRadius: BorderRadius.circular(UmiRadius.control),
          border: Border.all(color: scheme.error.withValues(alpha: .45)),
        ),
        child: Row(
          children: [
            Icon(Icons.error_outline, size: 20, color: scheme.error),
            const SizedBox(width: UmiSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: Theme.of(
                  context,
                ).textTheme.bodyMedium?.copyWith(color: scheme.onSurface),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
