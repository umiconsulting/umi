import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import 'money_input.dart';

/// Standard MXN cash denominations in minor units (centavos), largest first:
/// bills 1000/500/200/100/50/20 and coins 10/5/2/1/0.50. Used when the cash
/// policy does not carry its own denomination set.
const List<int> kMxnDenominationsMinorUnits = <int>[
  100000,
  50000,
  20000,
  10000,
  5000,
  2000,
  1000,
  500,
  200,
  100,
  50,
];

/// The running result of a denomination count: the summed total and the
/// per-denomination lines in the contract shape the API stores.
class DenominationTally {
  const DenominationTally(this.totalMinorUnits, this.lines);

  final int totalMinorUnits;

  /// Each line: `{denomination:{minorUnits,currency}, quantity,
  /// lineTotal:{minorUnits,currency}}` — only denominations with a quantity.
  final List<Map<String, Object?>> lines;
}

/// Reads the denomination set from a cash policy map, falling back to the
/// standard MXN set. The set is sorted largest first.
List<int> denominationsFromPolicy(Map<String, Object?>? policy) {
  final raw = policy?['denominations'];
  if (raw is! List || raw.isEmpty) return kMxnDenominationsMinorUnits;
  final values = <int>[];
  for (final entry in raw) {
    final minor = (entry is Map ? entry['minorUnits'] : null);
    if (minor is num) values.add(minor.toInt());
  }
  if (values.isEmpty) return kMxnDenominationsMinorUnits;
  values.sort((a, b) => b.compareTo(a));
  return values;
}

/// Count a drawer denomination by denomination with a live running total
/// (audit F3). This replaces a single free-text amount, which forced the
/// barista to sum the whole drawer in the head. Each `+`/`−` is a large, fixed
/// target, and the breakdown feeds the count/opening float that the API stores.
///
/// The quantity is also a field. An operator with a keyboard — a back-office
/// drawer, a supervisor recounting by hand — types `12` instead of pressing `+`
/// twelve times, and `Tab` walks down the denominations the way the drawer is
/// counted. The buttons stay for the counter terminal, where there is no
/// keyboard and the finger is already on the glass.
class DenominationCounter extends StatefulWidget {
  const DenominationCounter({
    required this.currency,
    required this.denominations,
    required this.onChanged,
    super.key,
  });

  final String currency;
  final List<int> denominations;
  final ValueChanged<DenominationTally> onChanged;

  @override
  State<DenominationCounter> createState() => _DenominationCounterState();
}

class _DenominationCounterState extends State<DenominationCounter> {
  final Map<int, int> _counts = <int, int>{};
  final Map<int, TextEditingController> _fields =
      <int, TextEditingController>{};

  @override
  void initState() {
    super.initState();
    _syncFields();
  }

  @override
  void didUpdateWidget(covariant DenominationCounter oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!listEquals(oldWidget.denominations, widget.denominations)) {
      _syncFields();
    }
  }

  @override
  void dispose() {
    for (final field in _fields.values) {
      field.dispose();
    }
    super.dispose();
  }

  /// One controller per denomination, owned by this State — the same lifetime as
  /// the field that reads it. A controller created per build, or disposed while
  /// the widget is still mounted, is how this codebase once took the whole till
  /// down (see `CashFieldsDialog`).
  void _syncFields() {
    for (final denomination in _fields.keys.toList()) {
      if (!widget.denominations.contains(denomination)) {
        _fields.remove(denomination)?.dispose();
      }
    }
    for (final denomination in widget.denominations) {
      _fields.putIfAbsent(denomination, TextEditingController.new);
    }
  }

  int get _total =>
      _counts.entries.fold(0, (sum, entry) => sum + entry.key * entry.value);

  // The one money formatter in the app. This counter used to keep its own, so a
  // coin label read `MXN 1000.00` here and `MXN 1,000.00` everywhere else.
  String _money(int minorUnits) =>
      formatMinorUnits(minorUnits, widget.currency);

  /// Sets one denomination.
  ///
  /// `syncField` is false on the typing path: the field is what changed, and
  /// writing its text back would move the caret out from under the typist.
  void _set(int denomination, int quantity, {bool syncField = true}) {
    setState(() {
      if (quantity <= 0) {
        _counts.remove(denomination);
      } else {
        _counts[denomination] = quantity;
      }
    });
    if (syncField) {
      final text = quantity <= 0 ? '' : '$quantity';
      final field = _fields[denomination];
      if (field != null && field.text != text) {
        field.value = TextEditingValue(
          text: text,
          selection: TextSelection.collapsed(offset: text.length),
        );
      }
    }
    _emit();
  }

  void _emit() {
    final lines = <Map<String, Object?>>[];
    for (final denomination in widget.denominations) {
      final quantity = _counts[denomination] ?? 0;
      if (quantity <= 0) continue;
      lines.add({
        'denomination': {
          'minorUnits': denomination,
          'currency': widget.currency,
        },
        'quantity': quantity,
        'lineTotal': {
          'minorUnits': denomination * quantity,
          'currency': widget.currency,
        },
      });
    }
    widget.onChanged(DenominationTally(_total, lines));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    // Every denomination in the drawer, laid out in two columns whenever there
    // is room for them.
    //
    // One column is taller than the counter terminal it is filled in on, so the
    // count dialog used to scroll: the small coins and the running total sat
    // below the fold of a screen whose entire job is to be read top to bottom
    // and added up. Side by side, a café's twelve denominations and the total
    // are all on screen at once, and counting never moves the list under the
    // hand that is entering it.
    return LayoutBuilder(
      builder: (context, constraints) {
        const gap = UmiSpacing.md;
        // Everything in a row that holds text grows with the platform's text
        // scale; the two tap targets do not, because they are sized for a finger.
        // At 200 % the old fixed maths kept two columns and a 170 px name cell,
        // and "MXN 1,000.00" came out as "MXN 1,0…" — with "MXN 50…" and "MXN 50…"
        // in the same dialog, the operator could not tell the rows apart.
        final scale = MediaQuery.textScalerOf(context).scale(1);
        final field = 64.0 * scale;
        final minRow = 88.0 * scale + UmiSpacing.xs + 48 + field + 48;
        final columns = constraints.maxWidth >= minRow * 2 ? 2 : 1;
        final width = (constraints.maxWidth - gap * (columns - 1)) / columns;
        // The name cell is capped rather than stretched: on a wide card the row
        // otherwise leaves a hand's width of nothing between "MXN 1,000.00" and
        // its own buttons. Capped, every row's buttons start at the same offset
        // and the row reads as one line. The cap grows with the text, so a large
        // scale gets the width the money needs instead of an ellipsis.
        final labelWidth = (width - UmiSpacing.xs - 48 - field - 48).clamp(
          88.0 * scale,
          170.0 * scale,
        );
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              spacing: gap,
              children: [
                for (final denomination in widget.denominations)
                  SizedBox(
                    width: width,
                    child: _denominationRow(
                      context,
                      l,
                      theme,
                      denomination,
                      labelWidth,
                    ),
                  ),
              ],
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
              child: Row(
                children: [
                  // The label gives way, the figure does not. A counted total is
                  // money: it is the one thing on this row that must never be
                  // shortened, and a font or a locale with wider glyphs should
                  // cost the label a few characters, not the number its digits.
                  Expanded(
                    child: Text(
                      Localizations.localeOf(context).languageCode == 'es'
                          ? 'Total contado'
                          : 'Counted total',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleMedium,
                    ),
                  ),
                  const SizedBox(width: UmiSpacing.sm),
                  Text(
                    _money(_total),
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _denominationRow(
    BuildContext context,
    AppLocalizations l,
    ThemeData theme,
    int denomination,
    double labelWidth,
  ) {
    final quantity = _counts[denomination] ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            width: labelWidth,
            // What the denomination is, and — once it is counted — what the
            // count is worth. The line total used to sit at the far right of a
            // row that no longer had room for it: with the quantity field in
            // place, "MXN 12,000.00" broke over four lines in a 32 px column.
            // Under the name it reads like a ledger line: 1,000, counted 12
            // times, is 12,000.
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _money(denomination),
                  style: theme.textTheme.bodyLarge,
                  // A name may wrap when there is genuinely nowhere to put it: a
                  // wrapped "MXN 1,000.00" is still an amount, and an ellipsis is
                  // not.
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (quantity > 0)
                  Text(
                    '= ${_money(denomination * quantity)}',
                    maxLines: 1,
                    softWrap: false,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.outline,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: UmiSpacing.xs),
          IconButton(
            tooltip: l.decreaseQuantity,
            onPressed: quantity > 0
                ? () => _set(denomination, quantity - 1)
                : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          _QuantityField(
            denomination: denomination,
            money: _money(denomination),
            controller: _fields[denomination]!,
            onChanged: (text) =>
                _set(denomination, int.tryParse(text) ?? 0, syncField: false),
          ),
          IconButton(
            tooltip: l.increaseQuantity,
            onPressed: () => _set(denomination, quantity + 1),
            icon: const Icon(Icons.add_circle_outline),
          ),
          const Spacer(),
        ],
      ),
    );
  }
}

/// How many of one denomination the operator counted.
///
/// Digits only, at most three of them — a drawer with a thousand of one note is
/// not a count, it is a typo — and the whole value is selected when focus
/// arrives, so tabbing down the drawer and typing replaces rather than appends.
final class _QuantityField extends StatefulWidget {
  const _QuantityField({
    required this.denomination,
    required this.money,
    required this.controller,
    required this.onChanged,
  });

  /// The denomination this field counts, in minor units.
  final int denomination;

  /// The denomination as money, for the accessible name.
  final String money;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  State<_QuantityField> createState() => _QuantityFieldState();
}

final class _QuantityFieldState extends State<_QuantityField> {
  late final FocusNode _focus = FocusNode()..addListener(_selectOnFocus);

  void _selectOnFocus() {
    if (!_focus.hasFocus) return;
    final text = widget.controller.text;
    widget.controller.selection = TextSelection(
      baseOffset: 0,
      extentOffset: text.length,
    );
  }

  @override
  void dispose() {
    _focus
      ..removeListener(_selectOnFocus)
      ..dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l = AppLocalizations.of(context);
    return SizedBox(
      // Wide enough for three digits and their padding, and no wider: the row
      // also has to carry two 48 px tap targets and the denomination itself, and
      // on a 390 px window the old 76 px field pushed the row 10 px past the
      // dialog's edge.
      width: 64,
      child: Semantics(
        textField: true,
        label: l.denominationQuantityLabel(widget.money),
        child: TextField(
          controller: widget.controller,
          focusNode: _focus,
          keyboardType: TextInputType.number,
          textInputAction: TextInputAction.next,
          textAlign: TextAlign.center,
          inputFormatters: [
            FilteringTextInputFormatter.digitsOnly,
            LengthLimitingTextInputFormatter(3),
          ],
          onChanged: widget.onChanged,
          style: theme.textTheme.titleMedium?.copyWith(
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
          decoration: InputDecoration(
            isDense: true,
            hintText: '0',
            hintStyle: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.outline,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
            filled: true,
            fillColor: theme.colorScheme.surfaceContainerHighest,
            contentPadding: const EdgeInsets.symmetric(vertical: 12),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(UmiRadius.control),
              borderSide: BorderSide(color: theme.colorScheme.outlineVariant),
            ),
          ),
        ),
      ),
    );
  }
}
