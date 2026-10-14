import '../../core/theme/pos_ui.dart';

class StationEntryCover extends StatelessWidget {
  const StationEntryCover({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final es = Localizations.localeOf(context).languageCode == 'es';
    return ExcludeSemantics(
      child: ColoredBox(
        color: palette.rail,
        child: LayoutBuilder(
          builder: (context, size) {
            return Padding(
              padding: EdgeInsets.all(size.maxWidth < 500 ? 36 : 64),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'umi',
                    style: theme.textTheme.displayLarge!.copyWith(
                      color: palette.onRail,
                      fontSize: 48,
                    ),
                  ),
                  const Spacer(),
                  Text(
                    es
                        ? 'Carta.\nComanda.\nServicio.'
                        : 'Menu.\nOrder.\nService.',
                    style: theme.textTheme.displayLarge!.copyWith(
                      color: palette.onRail,
                      fontSize: 58,
                      height: 1.12,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -1.4,
                    ),
                  ),
                  const SizedBox(height: 32),
                  Container(width: 56, height: 4, color: palette.signal),
                  const Spacer(),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// A document heading. The small imprint belongs to the composition, while
/// assistive technology reads the title once.
class StationHeading extends StatelessWidget {
  const StationHeading({required this.title, this.subtitle, super.key});
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Semantics(
      container: true,
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // NO EYEBROW, ON ANY SCREEN.
          //
          // This printed "UMI / ESTACIÓN" above every screen's own title — the same
          // eight characters in twelve places, on the catalog, the till's cash
          // centre, the kitchen board, the receipt dialog — and it pushed each of
          // those titles down to say it. The screen already names itself one line
          // below, and the rail already carries the café's identity. Removed at the
          // owner's request (2026-10-12); the widget stays because the title and its
          // optional subtitle are what the screens actually share.
          Text(title, style: theme.textTheme.titleLarge),
          if (subtitle != null)
            Text(
              subtitle!,
              style: theme.textTheme.bodySmall!.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }
}

/// A section keeps its title beside the controls when the text has room.
class StationSection extends StatelessWidget {
  const StationSection({
    required this.title,
    required this.child,
    this.inlineTitle = true,
    this.padding = const EdgeInsets.symmetric(vertical: 24),
    super.key,
  });
  final String title;
  final Widget child;
  final bool inlineTitle;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final heading = Semantics(
      container: true,
      header: true,
      child: Text(title, style: theme.textTheme.titleLarge),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: theme.colorScheme.outlineVariant),
        ),
      ),
      child: Padding(
        padding: padding,
        child: LayoutBuilder(
          builder: (context, box) =>
              inlineTitle &&
                  box.maxWidth >= 680 &&
                  MediaQuery.textScalerOf(context).scale(16) < 24
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(width: 184, child: heading),
                    const SizedBox(width: 24),
                    Expanded(child: child),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [heading, const SizedBox(height: 16), child],
                ),
        ),
      ),
    );
  }
}

/// The order is a working document. A quiet perforation separates its parts
/// without imitating a printer, adding texture or animating a fake receipt.
class StationRule extends StatelessWidget {
  const StationRule({super.key});

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox(
      height: 17,
      width: double.infinity,
      child: CustomPaint(
        painter: _RulePainter(PosTheme.of(context).colorScheme.outlineVariant),
      ),
    ),
  );
}

class _RulePainter extends CustomPainter {
  const _RulePainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final ink = Paint()
      ..color = color
      ..strokeWidth = 1;
    for (double x = 0; x < size.width; x += 9) {
      canvas.drawLine(
        Offset(x, size.height / 2),
        Offset((x + 4).clamp(0, size.width), size.height / 2),
        ink,
      );
    }
  }

  @override
  bool shouldRepaint(_RulePainter old) => old.color != color;
}

class StationEmptyOrder extends StatelessWidget {
  const StationEmptyOrder({required this.message, super.key});
  final String message;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 12),
      child: Column(
        children: [
          ExcludeSemantics(
            child: Container(
              width: 76,
              height: 76,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: theme.colorScheme.surfaceContainerHigh,
              ),
              child: PosIcon(
                PosGlyphs.receiptLongOutlined,
                size: 36,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium!.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
