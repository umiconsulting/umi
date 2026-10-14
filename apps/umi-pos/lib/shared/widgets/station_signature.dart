import 'package:flutter/widgets.dart';

import '../../core/theme/pos_theme.dart';

/// Firma propia: tres trazos de un instrumento, con un punto de referencia.
final class StationSignature extends StatelessWidget {
  const StationSignature({this.wordmarkOnly = false, super.key});

  final bool wordmarkOnly;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!wordmarkOnly) ...[
          ExcludeSemantics(
            child: SizedBox.square(
              dimension: 32,
              child: CustomPaint(
                painter: _StationMark(theme.colorScheme.primary),
              ),
            ),
          ),
          const SizedBox(width: 10),
        ],
        Text('umi', style: theme.textTheme.headlineSmall),
        if (!wordmarkOnly) ...[
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              Localizations.localeOf(context).languageCode == 'es'
                  ? 'Estación'
                  : 'Station',
              style: theme.textTheme.bodySmall!.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

final class _StationMark extends CustomPainter {
  const _StationMark(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.width / 32, size.height / 32);
    final stroke = Paint()
      ..color = color
      ..strokeWidth = 1.8
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final y in [8.0, 16.0, 24.0]) {
      canvas.drawPath(
        Path()
          ..moveTo(3, y)
          ..lineTo(11, y)
          ..cubicTo(17, y, 15, y - 5, 21, y - 5)
          ..lineTo(27, y - 5),
        stroke,
      );
    }
    canvas.drawCircle(const Offset(27, 27), 1.8, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_StationMark old) => old.color != color;
}
