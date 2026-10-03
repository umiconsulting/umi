import 'package:flutter/material.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import 'money_input.dart';

/// The drawer's account, rebuilt from the shift's own journal.
///
/// The backend computes the same equation from the same append-only ledger. The
/// till recomputes it for one reason: a blind policy withholds the *expected
/// total* until the operator counts, and this screen used to answer that by
/// hiding the whole card, leaving a hole where the operator's first question
/// used to be answered. The terms are not a secret — every one of them is
/// already a line in the journal below — so the card can stand in every state
/// and mask only the number the policy protects.
///
/// The arithmetic mirrors `calculateExpectedCash` in the API: a cash sale moves
/// the drawer by what was received minus the change handed back, a refund leaves
/// through the paid-out term, and the three observing entry types move nothing.
final class CashDrawerAccount {
  const CashDrawerAccount({
    required this.currency,
    required this.openingFloat,
    required this.netCashSales,
    required this.paidIn,
    required this.paidOut,
    required this.safeDrops,
    required this.adjustments,
    required this.sequence,
  });

  factory CashDrawerAccount.fromLedger(
    List<Map<String, Object?>> lines, {
    String currency = 'MXN',
  }) {
    var openingFloat = 0;
    var netCashSales = 0;
    var paidIn = 0;
    var paidOut = 0;
    var safeDrops = 0;
    var adjustments = 0;
    var sequence = 0;

    int minor(Map<String, Object?> line, String key) =>
        ((line[key] as Map<String, Object?>?)?['minorUnits'] as num?)
            ?.toInt() ??
        0;

    for (final line in lines) {
      final amount = minor(line, 'amount');
      sequence = (line['sequence'] as num?)?.toInt() ?? sequence + 1;
      switch (line['type']) {
        case 'opening_float':
          openingFloat += amount;
        case 'cash_sale':
          netCashSales +=
              minor(line, 'cashReceived') - minor(line, 'changeGiven');
        case 'paid_in':
          paidIn += amount;
        case 'paid_out':
          paidOut += amount;
        case 'safe_drop':
          safeDrops += amount;
        case 'cash_refund':
          paidOut += amount;
        case 'drawer_correction':
        case 'close_adjustment':
          adjustments += amount;
        default:
          // `handoff_transfer`, `count_observation` and `variance_resolution`
          // record that the drawer changed hands or was observed. None of them
          // moves money, so none of them is a term.
          break;
      }
    }

    return CashDrawerAccount(
      currency: currency,
      openingFloat: openingFloat,
      netCashSales: netCashSales,
      paidIn: paidIn,
      paidOut: paidOut,
      safeDrops: safeDrops,
      adjustments: adjustments,
      sequence: sequence,
    );
  }

  final String currency;
  final int openingFloat;
  final int netCashSales;
  final int paidIn;
  final int paidOut;
  final int safeDrops;
  final int adjustments;

  /// The ledger sequence of the newest fact folded into this account.
  final int sequence;

  /// What the counter should hold, in minor units.
  int get expectedDrawerCash =>
      openingFloat + netCashSales + paidIn - paidOut - safeDrops + adjustments;
}

/// The figures a card is made of, and the one number they add up to.
///
/// Side by side when the card can hold both: the answer sitting beside its
/// evidence is the whole point of the drawer's account. Stacked when it cannot —
/// at 390 px the panel was taking two thirds of the row and squeezing the
/// figures into a column narrow enough that "MXN 1,500.00" broke over two lines,
/// so the card read as two numbers instead of one amount.
///
/// Stacked, the total becomes the foot of the card and runs the whole width, the
/// way a receipt ends in its total.
Widget cashFiguresAndTotal({required Widget figures, required Widget total}) =>
    LayoutBuilder(
      builder: (context, constraints) => constraints.maxWidth >= 600
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(child: figures),
                const SizedBox(width: UmiSpacing.lg),
                total,
              ],
            )
          : Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                figures,
                const SizedBox(height: UmiSpacing.md),
                total,
              ],
            ),
    );

/// The drawer's account, term by term.
///
/// The backend already computes this from the append-only ledger. The screen used
/// to show only the total, so an operator who saw a number they did not expect
/// had no way to find the line that produced it. This is that line, in the order
/// the ledger applies it: the float, what the cash sales left, what went in from
/// outside, what left, and the adjustments.
///
/// Money stays in minor units all the way to the label; the division by 100
/// happens once, here, and never in the arithmetic.
final class CashEquation extends StatelessWidget {
  const CashEquation({
    required this.account,
    required this.expectedCash,
    super.key,
  });

  /// The terms, rebuilt from the journal, so the card stands in every state.
  final CashDrawerAccount account;

  /// The `ExpectedCash` payload from the cash-centre snapshot, or null while a
  /// blind policy withholds the total.
  final Map<String, Object?>? expectedCash;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final currency = expectedCash?['currency'] as String? ?? account.currency;

    final terms = <({String label, int amount, bool subtract})>[
      (
        label: l.openingFloatLabel,
        amount: account.openingFloat,
        subtract: false,
      ),
      (label: l.cashSalesLabel, amount: account.netCashSales, subtract: false),
      (label: l.cashPaidInLabel, amount: account.paidIn, subtract: false),
      (label: l.cashPaidOutLabel, amount: account.paidOut, subtract: true),
      (label: l.cashSafeDropLabel, amount: account.safeDrops, subtract: true),
      (
        label: l.cashAdjustmentsLabel,
        amount: account.adjustments,
        subtract: false,
      ),
    ];
    // While the policy withholds the total, the card shows its own arithmetic so
    // the operator still sees the shape of the account — the terms are already
    // in the journal — and masks only the number the count is meant to test.
    final hidden = expectedCash == null;
    final expected =
        ((expectedCash?['expectedDrawerCash']
                    as Map<String, Object?>?)?['minorUnits']
                as num?)
            ?.toInt() ??
        account.expectedDrawerCash;
    final sequence =
        (expectedCash?['ledgerSequence'] as num?)?.toInt() ?? account.sequence;

    // The covered figure, and the answer it becomes once the count is in.
    // A redacted figure is not a missing one: the shape of the amount stays where
    // the eye expects it, and the line under it says why it is covered.
    final coveredTotal = Column(
      key: const ValueKey('covered'),
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.lock_outline,
              size: 18,
              color: theme.colorScheme.outline,
            ),
            const SizedBox(width: UmiSpacing.sm),
            Text(
              '$currency ••••••',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.w700,
                color: theme.colorScheme.outline,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
        const SizedBox(height: UmiSpacing.xs),
        Text(
          l.cashExpectedHiddenLabel,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.outline,
          ),
        ),
      ],
    );
    final revealedTotal = Text(
      key: const ValueKey('revealed'),
      formatMinorUnits(expected, currency),
      style: theme.textTheme.headlineSmall?.copyWith(
        fontWeight: FontWeight.w700,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.cashEquationLabel, style: theme.textTheme.titleMedium),
            const SizedBox(height: UmiSpacing.md),
            // The terms on the left, the total on its own ground at the right.
            // The total carries the weight: it is the number the operator checks
            // first, and a filled block reads as an answer rather than as one more
            // column in a row of figures.
            cashFiguresAndTotal(
              // The terms are six facts, one node each, so a screen reader walks
              // the account the way the eye does. They used to be merged into a
              // single node whose label was the total — which read the masked
              // placeholder twice and shouted fourteen lines of labels.
              figures: LayoutBuilder(
                builder: (context, constraints) {
                  final width = constraints.maxWidth;
                  // The breakpoints are about how much *text* a column can
                  // hold, so a larger text scale buys fewer columns. At
                  // 200 % three columns left a cell too narrow for
                  // "−MXN 1,000.00", and the figure split across two lines
                  // in the middle of an equation.
                  final scale = MediaQuery.textScalerOf(context).scale(1);
                  final room = scale > 1 ? width / scale : width;
                  final columns = room >= 1000
                      ? 6
                      : room >= 560
                      ? 3
                      : room >= 320
                      ? 2
                      : 1;
                  const gap = UmiSpacing.lg;
                  final cell = (width - gap * (columns - 1)) / columns;
                  return Wrap(
                    spacing: gap,
                    runSpacing: UmiSpacing.md,
                    children: [
                      for (final term in terms)
                        SizedBox(
                          width: cell,
                          child: _Term(
                            label: term.label,
                            amount: term.amount,
                            subtract: term.subtract,
                            currency: currency,
                            // An adjustment can be negative at the source;
                            // the sign is in the number, not in the term.
                            signed: term.label == l.cashAdjustmentsLabel,
                          ),
                        ),
                    ],
                  );
                },
              ),
              // The answer is one node with one sentence: read out, the card
              // ends on "Efectivo esperado: MXN 1,460.00" instead of on a
              // placeholder and a bare "#3".
              total: Semantics(
                container: true,
                liveRegion: true,
                label: hidden
                    ? '${l.expectedCashLabel}: ${l.cashExpectedHiddenLabel}'
                    : '${l.expectedCashLabel}: ${formatMinorUnits(expected, currency)}',
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(UmiRadius.control),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: UmiSpacing.lg,
                      vertical: UmiSpacing.md,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ExcludeSemantics(
                          child: Text(
                            l.expectedCashLabel.toUpperCase(),
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.outline,
                              letterSpacing: 0.7,
                            ),
                          ),
                        ),
                        const SizedBox(height: UmiSpacing.xs),
                        // The count turns the covered figure into the answer. A
                        // cross-fade says "this is the number you were working
                        // toward" without a toast; it is the one motion on this
                        // screen, and it happens once a shift.
                        ExcludeSemantics(
                          child: AnimatedSwitcher(
                            // The design language asks the product to respect the
                            // reduced-motion preference. The reveal still
                            // happens — the covered figure becomes the answer —
                            // it just does not travel to get there.
                            duration: MediaQuery.disableAnimationsOf(context)
                                ? Duration.zero
                                : UmiMotion.standard,
                            switchInCurve: Curves.easeOut,
                            switchOutCurve: Curves.easeIn,
                            child: hidden ? coveredTotal : revealedTotal,
                          ),
                        ),
                        const SizedBox(height: UmiSpacing.xs),
                        Semantics(
                          label: '${l.cashLedgerSequenceLabel} $sequence',
                          excludeSemantics: true,
                          child: Text(
                            '#$sequence',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.outline,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final class _Term extends StatelessWidget {
  const _Term({
    required this.label,
    required this.amount,
    required this.subtract,
    required this.currency,
    required this.signed,
  });

  final String label;
  final int amount;
  final bool subtract;
  final String currency;
  final bool signed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final labelStyle = theme.textTheme.labelSmall?.copyWith(
      color: theme.colorScheme.outline,
      letterSpacing: 0.7,
    );
    // The terms of an equation are read by position, so the figures have to sit
    // on one line across a row. At a large text scale the labels wrap, and a term
    // whose label takes two lines pushes its own figure down — measured at 200 %,
    // which the design language requires of the critical flows. At the usual
    // scale one line is enough and the card stays short.
    final scaler = MediaQuery.textScalerOf(context);
    final labelLines = scaler.scale(1) > 1.3 ? 2 : 1;
    final labelHeight =
        scaler.scale(labelStyle?.fontSize ?? 11) *
        (labelStyle?.height ?? 1.45) *
        labelLines;
    // A term that moved nothing gets no sign: "−MXN 0.00" reads as a mistake and
    // makes the eye stop on a line that carries no information.
    final negative = amount != 0 && (signed ? amount < 0 : subtract);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: labelHeight,
          child: Align(
            alignment: Alignment.topLeft,
            child: Text(
              label.toUpperCase(),
              maxLines: labelLines,
              overflow: TextOverflow.ellipsis,
              style: labelStyle,
            ),
          ),
        ),
        const SizedBox(height: UmiSpacing.xs),
        Text(
          '${negative ? '−' : ''}${formatMinorUnits(amount.abs(), currency)}',
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
            fontFeatures: const [FontFeature.tabularFigures()],
          ),
        ),
      ],
    );
  }
}

/// The drawer's policy, stated where the operator can read it as a rule.
///
/// The thresholds are the owner's settings. The operator does not change them,
/// but the operator has to understand why a PIN is asked for and why a count is
/// blind, so each rule gets a line: the name on the left, the number on the
/// right. A row of chips in the state strip stated the same facts as fragments
/// and clipped them on a 1280 px terminal.
final class CashPolicyTable extends StatelessWidget {
  const CashPolicyTable({required this.policy, super.key});

  final Map<String, Object?> policy;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final currency = policy['currency'] as String? ?? 'MXN';

    int minor(String key) =>
        ((policy[key] as Map<String, Object?>?)?['minorUnits'] as num?)
            ?.toInt() ??
        0;

    // A policy that does not say something has not said zero.
    //
    // Every threshold below used to fall back to `MXN 0.00` and every switch to
    // its "off" name, so a policy payload missing a field read as a rule the
    // owner never set: no tolerance at all, a count that is never blind, a
    // drawer that needs no PIN. The checklist asks this screen to handle "a
    // missing policy"; the honest answer is that the value is not set.
    String moneyOrUndefined(String key) {
      final value = policy[key];
      if (value is! Map || value['minorUnits'] is! num) {
        return l.cashPolicyUndefinedLabel;
      }
      return formatMinorUnits(minor(key), currency);
    }

    String switchOrUndefined(
      String key, {
      required String on,
      required String off,
    }) {
      final value = policy[key];
      if (value is! bool) return l.cashPolicyUndefinedLabel;
      return value ? on : off;
    }

    final rows = <({String label, String value})>[
      (
        label: l.cashPolicyCountLabel,
        value: switchOrUndefined(
          'blindCountRequired',
          on: l.cashBlindCountOnLabel,
          off: l.cashBlindCountOffLabel,
        ),
      ),
      (
        label: l.cashToleranceLabel,
        value: moneyOrUndefined('varianceTolerance'),
      ),
      // Only when the policy sets a ceiling. A missing ceiling rendered as
      // "MXN 0.00" would read as a rule that forbids the float altogether.
      if (policy['maximumOpeningFloat'] != null)
        (
          label: l.cashPolicyMaxFloatLabel,
          value: formatMinorUnits(minor('maximumOpeningFloat'), currency),
        ),
      (
        label: l.cashMovementApprovalLabel,
        value: moneyOrUndefined('movementApprovalThreshold'),
      ),
      (
        label: l.cashCloseApprovalLabel,
        value: moneyOrUndefined('closeApprovalThreshold'),
      ),
      // The row answers the operator's question — "does cash survive a dropped
      // connection?" — and the answer is the *terminal's*, not the policy's.
      //
      // `offlineCashShiftAllowed` is stored, projected and read by nothing but
      // this card: no cash command runs without the API (deep-design finding
      // 5.3). A policy that sets it true made this row promise a capability the
      // till does not have, which is the false promise the checklist forbids. If
      // a policy ever allows it, the row says the feature is not here yet.
      (
        label: l.cashOfflineLabel,
        value: policy['offlineCashShiftAllowed'] == true
            ? l.cashOfflineUnavailableLabel
            : l.cashOfflineRequiredLabel,
      ),
    ];

    return Semantics(
      label: l.cashPolicyLabel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, row) in rows.indexed) ...[
            if (index > 0)
              Divider(height: 1, color: theme.colorScheme.outlineVariant),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: UmiSpacing.sm),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      row.label,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(width: UmiSpacing.md),
                  Text(
                    row.value,
                    textAlign: TextAlign.right,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
