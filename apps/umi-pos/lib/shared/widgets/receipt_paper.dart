/// The receipt as the paper it is: a ticket that comes off a roll.
///
/// The owner asked for the ticket component that got popular online — the one
/// with a print animation — and then for what the paper actually does: _it
/// breaks from the top from the other receipt, slides down as it is being
/// printed, and the other slides in to take its place, but it is just the same._
///
/// That is a roll, and this is one:
///
/// * at rest the sheet is already out — opening a receipt is reading, not
///   printing;
/// * when a print starts, the sheet **breaks** from the one above (its
///   perforation line is the seam), **slides down** as it feeds, and the next
///   ticket — the same document — **slides in from the top** to take its place;
/// * the strip advances one ticket and stops, and the piece that arrives is
///   identical to the one that left, so the claim that it loops is true by
///   construction: there is only one document.
///
/// `Movimiento: reducido` prints with no movement at all.
library;

import 'dart:math' as math;

import '../../core/theme/pos_ui.dart';

final class ReceiptPaper extends StatefulWidget {
  const ReceiptPaper({
    required this.child,
    this.slotLabel,
    this.prints,
    super.key,
  });
  final Widget child;

  /// Read out with the slot, so a screen reader hears the machine and not only
  /// the paper. Null leaves the slot decorative.
  final String? slotLabel;

  /// Fires when the printer starts: the cue the roll answers to.
  final Listenable? prints;

  @override
  State<ReceiptPaper> createState() => _ReceiptPaperState();
}

final class _ReceiptPaperState extends State<ReceiptPaper>
    with SingleTickerProviderStateMixin {
  /// Slow enough to read as a mechanism, short enough to never make the
  /// cashier wait: a real TM-T20III feeds a receipt this length in about two
  /// seconds.
  static const _feed = Duration(milliseconds: 1600);

  /// Three logical pixels: the step a thermal transport actually advances.
  static const _step = 3.0;
  static const _steps = 48;

  /// The perforation between two tickets.
  static const _perforation = 9.0;

  late final AnimationController _print = AnimationController(
    vsync: this,
    duration: _feed,
  );
  bool _started = false;

  @override
  void initState() {
    super.initState();
    widget.prints?.addListener(_startFeed);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    // The sheet is out from the first frame.
    _print.value = 1;
  }

  void _startFeed() {
    if (MediaQuery.disableAnimationsOf(context)) {
      _print.value = 1;
      return;
    }
    _print.forward(from: 0);
  }

  @override
  void dispose() {
    widget.prints?.removeListener(_startFeed);
    _print.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return AnimatedBuilder(
      animation: _print,
      builder: (context, child) {
        final ticket = child ?? widget.child;
        final t = Curves.easeOutCubic.transform(_print.value);
        // The paper advances in steps: that is what makes the movement
        // mechanical instead of a wipe.
        final fed = t >= 1 ? 1.0 : (t * _steps).floor() / _steps;
        // Printing is the whole of the feed, first frame included: the roll has
        // to be there the moment the sheet starts moving.
        final working = _print.value < 1;
        // The head's own vibration: about a millimetre, twice per step.
        final shake = working
            ? math.sin(_print.value * math.pi * 24) * 1.2
            : 0.0;
        // The document keeps the height the dialog gave it — it is a lazily
        // built viewport of 500-line receipts and was already measured
        // unbounded once — so the feed only ever hides pixels, never
        // re-measures the child.
        return LayoutBuilder(
          builder: (context, constraints) {
            // On a short, doubled-text screen the machine's own chrome must not
            // eat the paper: a 375-pixel-tall dialog at 2× has about a hundred
            // pixels to show a receipt with, and the slot and the perforation
            // took forty of them (measured by the long-receipt guard, iMin
            // D3-504 sizes, 2026-10-11).
            final tight = constraints.maxHeight < 300;
            final slotHeight = tight ? 6.0 : _slotHeight;
            final perforation = tight ? 4.0 : _perforation;
            // What is left of the machine's face is its lamp. The height is
            // fixed here and given to the row below, so the two cannot drift and
            // overflow the case.
            final face = tight ? 0.0 : _faceHeight;
            final paper = (constraints.maxHeight - slotHeight - face).clamp(
              0.0,
              double.infinity,
            );
            // The machine's body, so the sheet reads as a sheet: the same
            // colour on the same colour made the strip — and its torn edge —
            // invisible.
            final body = tight ? 2.0 : 10.0;
            final sheet = (paper - body * 2).clamp(0.0, double.infinity);
            return DecoratedBox(
              decoration: BoxDecoration(
                // The machine's shell: a vertical sheen, so the body reads as a
                // moulded case and not as a flat panel.
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    palette.surfaceContainerHighest,
                    palette.surfaceContainerHigh,
                  ],
                ),
                borderRadius: BorderRadius.circular(12),
                border: Border(
                  top: BorderSide(
                    color: palette.surface.withValues(alpha: 0.5),
                  ),
                ),
              ),
              child: Padding(
                padding: EdgeInsets.all(body),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _MachineHead(
                      theme: theme,
                      label: widget.slotLabel,
                      offset: shake,
                      working: working,
                      height: slotHeight,
                      tight: tight,
                    ),
                    SizedBox(
                      height: sheet,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12),
                        child: ClipPath(
                          clipper: _RollEdge(step: _step),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              // Paper: the same colour, with the light falling
                              // across it and the mouth's shadow at the top.
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [
                                  palette.surface,
                                  palette.surface.withValues(alpha: 0.94),
                                ],
                              ),
                              // The fold where the sheet leaves the roller.
                              border: Border(
                                top: BorderSide(
                                  color: const Color(0x1A000000),
                                  width: 2,
                                ),
                              ),
                              boxShadow: [
                                BoxShadow(
                                  // Neutral: a shadow is a shadow in either
                                  // theme.
                                  color: const Color(0x2E000000),
                                  blurRadius: 6,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            child: working
                                // The roll, while it prints: the same ticket
                                // above (its seam is the perforation) slides in
                                // as this one slides away.
                                ? ClipRect(
                                    // The strip is two tickets tall and the
                                    // window is one: it is meant to overflow,
                                    // and the clip is what shows the window.
                                    child: OverflowBox(
                                      maxHeight: double.infinity,
                                      alignment: Alignment.topCenter,
                                      child: Transform.translate(
                                        key: const ValueKey('receipt-roll'),
                                        offset: Offset(0, -sheet * (1 - fed)),
                                        child: Column(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            _RollBlock(
                                              height: sheet,
                                              perforation: perforation,
                                              theme: theme,
                                              ticket: ticket,
                                            ),
                                            _RollBlock(
                                              height: sheet,
                                              perforation: perforation,
                                              theme: theme,
                                              ticket: ticket,
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  )
                                : ticket,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
      child: widget.child,
    );
  }
}

/// One ticket on the roll: the document, and the perforation under it.
final class _RollBlock extends StatelessWidget {
  const _RollBlock({
    required this.height,
    required this.perforation,
    required this.theme,
    required this.ticket,
  });
  final double height;
  final double perforation;
  final PosThemeData theme;
  final Widget ticket;

  @override
  Widget build(BuildContext context) => SizedBox(
    height: height,
    child: Column(
      children: [
        Expanded(child: ticket),
        SizedBox(
          height: perforation,
          child: Center(
            child: CustomPaint(
              size: const Size(double.infinity, 1),
              painter: _Perforation(color: theme.colorScheme.outlineVariant),
            ),
          ),
        ),
      ],
    ),
  );
}

/// The mouth the paper comes out of. Its height is fixed so the paper's
/// viewport is always `dialog height - this`.
const double _slotHeight = 14;

/// The lamp, the model plate and the feed button above the mouth.
const double _faceHeight = 18;

/// The face of the machine: the lamp, the model plate, the feed button and the
/// mouth the paper comes out of.
final class _MachineHead extends StatelessWidget {
  const _MachineHead({
    required this.theme,
    required this.offset,
    required this.working,
    required this.height,
    required this.tight,
    this.label,
  });
  final PosThemeData theme;
  final double offset;
  final bool working;
  final double height;

  /// A short paper has no room for the machine's face, only for its mouth.
  final bool tight;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final palette = theme.colorScheme;
    final slot = Container(
      height: height,
      decoration: BoxDecoration(
        color: palette.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(4),
        border: Border(
          bottom: BorderSide(color: palette.outlineVariant, width: 1),
        ),
      ),
      // The mouth itself: a highlight above a dark slit, the way a real slot
      // catches the light on its lip.
      child: Column(
        children: [
          Container(height: 1, color: const Color(0x33FFFFFF)),
          Expanded(
            child: Align(
              alignment: Alignment.bottomCenter,
              child: Container(
                height: 2,
                decoration: BoxDecoration(
                  color: palette.outline,
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x40000000),
                      blurRadius: 2,
                      offset: Offset(0, 1),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
    // Keyed so a test can read the head's own movement without reaching into
    // private paint state.
    final mouth = Transform.translate(
      key: const ValueKey('receipt-slot'),
      offset: Offset(0, offset),
      child: slot,
    );
    final face = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!tight)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: SizedBox(
              height: _faceHeight - 4,
              child: Row(
                children: [
                  _Lamp(theme: theme, working: working),
                  const Spacer(),
                ],
              ),
            ),
          ),
        mouth,
      ],
    );
    if (label == null) return face;
    return Semantics(label: label, child: face);
  }
}

/// The status lamp every printer has: steady when it is ready, breathing while
/// it works.
final class _Lamp extends StatelessWidget {
  const _Lamp({required this.theme, required this.working});
  final PosThemeData theme;
  final bool working;

  @override
  Widget build(BuildContext context) => Semantics(
    label: working ? 'Imprimiendo' : 'Lista',
    child: Container(
      width: 7,
      height: 7,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: working ? const Color(0xFFFFB300) : const Color(0xFF3FBF6F),
        boxShadow: [
          BoxShadow(
            color: (working ? const Color(0xFFFFB300) : const Color(0xFF3FBF6F))
                .withValues(alpha: working ? 0.55 : 0.4),
            blurRadius: working ? 5 : 3,
            spreadRadius: 0.5,
          ),
        ],
      ),
    ),
  );
}

/// How deep the tear eats into the sheet's bottom edge. The document keeps this
/// much extra room under its last line, so the thank-you can always be scrolled
/// clear of the teeth.
const double kReceiptTearDepth = 6;

/// The bottom of the sheet: torn from the roll, as paper is.
final class _RollEdge extends CustomClipper<Path> {
  const _RollEdge({this.step = 3});
  final double step;

  @override
  Path getClip(Size size) {
    final teeth = math.max(4, (size.width / (step * 4)).floor());
    final w = size.width / teeth;
    const tooth = kReceiptTearDepth;
    final path = Path()..moveTo(0, 0);
    path.lineTo(size.width, 0);
    path.lineTo(size.width, size.height - tooth);
    for (var i = teeth; i > 0; i--) {
      final x = i * w;
      path.lineTo(x - w / 2, size.height);
      path.lineTo(x - w, size.height - tooth);
    }
    path.close();
    return path;
  }

  @override
  bool shouldReclip(_RollEdge oldClipper) => oldClipper.step != step;
}

/// The dashed line a printer leaves between two tickets.
final class _Perforation extends CustomPainter {
  const _Perforation({required this.color});
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.2;
    const dash = 4.0;
    const gap = 3.0;
    var x = 0.0;
    while (x < size.width) {
      canvas.drawLine(
        Offset(x, size.height / 2),
        Offset(math.min(x + dash, size.width), size.height / 2),
        paint,
      );
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_Perforation oldPainter) => oldPainter.color != color;
}
