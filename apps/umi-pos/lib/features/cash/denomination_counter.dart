import 'package:flutter/material.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';

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

  int get _total =>
      _counts.entries.fold(0, (sum, entry) => sum + entry.key * entry.value);

  String _money(int minorUnits) =>
      '${widget.currency} ${(minorUnits / 100).toStringAsFixed(2)}';

  void _set(int denomination, int quantity) {
    setState(() {
      if (quantity <= 0) {
        _counts.remove(denomination);
      } else {
        _counts[denomination] = quantity;
      }
    });
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
        final columns = constraints.maxWidth >= 620 ? 2 : 1;
        final width = (constraints.maxWidth - gap * (columns - 1)) / columns;
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
                    child: _denominationRow(context, l, theme, denomination),
                  ),
              ],
            ),
            const Divider(),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    Localizations.localeOf(context).languageCode == 'es'
                        ? 'Total contado'
                        : 'Counted total',
                    style: theme.textTheme.titleMedium,
                  ),
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
  ) {
    final quantity = _counts[denomination] ?? 0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          SizedBox(
            // Wide enough for the longest label a policy can produce
            // ("MXN 1000.00", the app's own format) on one line. It used to
            // wrap, so the top two rows read "MXN" above "1000.00" and the
            // column looked broken.
            width: 118,
            child: Text(
              _money(denomination),
              style: theme.textTheme.bodyLarge,
              maxLines: 1,
              softWrap: false,
            ),
          ),
          IconButton(
            tooltip: l.decreaseQuantity,
            onPressed: quantity > 0
                ? () => _set(denomination, quantity - 1)
                : null,
            icon: const Icon(Icons.remove_circle_outline),
          ),
          SizedBox(
            width: 32,
            child: Text(
              '$quantity',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
          ),
          IconButton(
            tooltip: l.increaseQuantity,
            onPressed: () => _set(denomination, quantity + 1),
            icon: const Icon(Icons.add_circle_outline),
          ),
          Expanded(
            child: Text(
              quantity > 0 ? _money(denomination * quantity) : '',
              textAlign: TextAlign.end,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.outline,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
