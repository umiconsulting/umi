import 'package:flutter/material.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import 'money_input.dart';

/// The shift's journal: the same ledger the expected cash is computed from.
///
/// The till shows one shift, bounded and in sequence order. The whole history,
/// across shifts and drawers, is a back-office read: a list that grows belongs
/// where somebody can sit down with it.
final class CashJournal extends StatelessWidget {
  const CashJournal({required this.lines, this.expand = false, super.key});

  /// `CashJournalLine` payloads from the cash-centre snapshot, oldest first.
  final List<Map<String, Object?>> lines;

  /// True when the card has a bounded height to fill: the list takes the space
  /// left in the card and scrolls inside it. False inside a page-level scroll
  /// view, where the journal lists every line and the page does the scrolling.
  final bool expand;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        // The journal is the one card that may be squeezed: it scrolls. Its
        // minimum is one row plus a header, so the controls above it can never be
        // pushed off a 720 px terminal.
        // The same padding as every other card: the journal's rows and its
        // neighbours share one left edge.
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l.cashJournalLabel,
                    style: theme.textTheme.titleSmall,
                  ),
                ),
                Text(
                  '${lines.length}',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: theme.colorScheme.outline,
                  ),
                ),
              ],
            ),
            const SizedBox(height: UmiSpacing.xs),
            if (lines.isEmpty)
              Text(
                l.cashJournalEmptyMessage,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.outline,
                ),
              )
            else if (expand)
              // The list takes exactly the height the card has left and scrolls
              // inside it, so a long shift can never push the card past its
              // bounds — which is what the operator sees as a clipped row. The
              // fade at the foot of the list turns that clipped row into the
              // sentence it is: there is more, keep going.
              Expanded(
                child: ShaderMask(
                  shaderCallback: (rect) => const LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Color(0xFF000000),
                      Color(0xFF000000),
                      Color(0x00000000),
                    ],
                    stops: [0.0, 0.9, 1.0],
                  ).createShader(rect),
                  blendMode: BlendMode.dstIn,
                  child: ListView.separated(
                    padding: EdgeInsets.zero,
                    itemCount: lines.length,
                    separatorBuilder: (context, index) => Divider(
                      height: 1,
                      color: theme.colorScheme.outlineVariant,
                    ),
                    itemBuilder: (context, index) => _Line(line: lines[index]),
                  ),
                ),
              )
            else
              // No inner scroll view: one scroll region per screen. The page
              // owns the scrolling, so the journal simply lists its lines.
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: EdgeInsets.zero,
                itemCount: lines.length,
                separatorBuilder: (context, index) =>
                    Divider(height: 1, color: theme.colorScheme.outlineVariant),
                itemBuilder: (context, index) => _Line(line: lines[index]),
              ),
          ],
        ),
      ),
    );
  }
}

final class _Line extends StatelessWidget {
  const _Line({required this.line});

  final Map<String, Object?> line;

  /// The ledger stores every amount as a magnitude; the entry type carries the
  /// direction. Signing it here keeps the stored fact unambiguous.
  static bool _subtracts(String type) =>
      type == 'paid_out' || type == 'safe_drop' || type == 'cash_refund';

  static bool _neutral(String type) =>
      type == 'count_observation' ||
      type == 'variance_resolution' ||
      type == 'handoff_transfer';

  String _label(AppLocalizations l, String type) => switch (type) {
    'opening_float' => l.openingFloatLabel,
    'cash_sale' => l.cashSalesLabel,
    'paid_in' => l.cashPaidInLabel,
    'paid_out' => l.cashPaidOutLabel,
    'safe_drop' => l.cashSafeDropLabel,
    'cash_refund' => l.cashRefundLabel,
    'drawer_correction' => l.drawerCorrectionAction,
    'handoff_transfer' => l.handoffShiftAction,
    'count_observation' => l.cashCountObservationLabel,
    'variance_resolution' => l.cashVarianceResolutionLabel,
    'close_adjustment' => l.cashCloseAdjustmentLabel,
    _ => type,
  };

  String _detail() {
    final parts = <String>[];
    final at = _time();
    if (at != null) parts.add(at);
    final received =
        ((line['cashReceived'] as Map<String, Object?>?)?['minorUnits'] as num?)
            ?.toInt() ??
        0;
    final change =
        ((line['changeGiven'] as Map<String, Object?>?)?['minorUnits'] as num?)
            ?.toInt() ??
        0;
    // A sale with no change shows what went in and stops. Printing
    // "− MXN 0.00" beside every exact-cash sale adds a subtraction the operator
    // has to check for nothing.
    if (received > 0) {
      final takenIn = formatMinorUnits(received, _currency());
      parts.add(
        change > 0
            ? '$takenIn − ${formatMinorUnits(change, _currency())}'
            : takenIn,
      );
    }
    final note = line['note'] as String?;
    if (note != null && note.isNotEmpty) parts.add(note);
    final reason = line['reasonCode'] as String?;
    if (reason != null && reason.isNotEmpty) parts.add(reason);
    final operator = line['operatorReference'] as String?;
    if (operator != null && operator.isNotEmpty) parts.add(operator);
    final receipt = line['receiptNumber'] as String?;
    if (receipt != null && receipt.isNotEmpty) parts.add(receipt);
    return parts.join(' · ');
  }

  /// `HH:mm` in the terminal's own zone. The journal is read next to a clock, so
  /// the local time is the one that matches what the operator remembers.
  String? _time() {
    final raw = line['occurredAt'] as String?;
    if (raw == null) return null;
    final at = DateTime.tryParse(raw);
    if (at == null) return null;
    final local = at.toLocal();
    final hh = local.hour.toString().padLeft(2, '0');
    final mm = local.minute.toString().padLeft(2, '0');
    return '$hh:$mm';
  }

  String _currency() =>
      (line['amount'] as Map<String, Object?>?)?['currency'] as String? ??
      'MXN';

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final type = line['type'] as String? ?? '';
    final currency = _currency();
    final minor =
        ((line['amount'] as Map<String, Object?>?)?['minorUnits'] as num?)
            ?.toInt() ??
        0;
    final neutral = _neutral(type);
    final negative = _subtracts(type);
    final detail = _detail();

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: UmiSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _label(l, type),
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (detail.isNotEmpty)
                  Text(
                    detail,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.outline,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: UmiSpacing.md),
          Text(
            neutral
                ? formatMinorUnits(minor, currency)
                : '${negative ? '−' : '+'}${formatMinorUnits(minor, currency)}',
            style: theme.textTheme.bodyLarge?.copyWith(
              fontWeight: FontWeight.w600,
              fontFeatures: const [FontFeature.tabularFigures()],
              color: neutral
                  ? theme.colorScheme.onSurfaceVariant
                  : negative
                  ? theme.colorScheme.error
                  : theme.colorScheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}
