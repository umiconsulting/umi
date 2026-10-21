import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/money.dart';
import '../../shared/widgets/inline_notice.dart';
import 'exception_controller.dart';

Future<void> showSaleExceptionDialog(
  BuildContext context, {
  required SaleExceptionController controller,
  required String saleId,
}) => showPosDialog<void>(
  context: context,
  builder: (_) => PosDialog(
    clipBehavior: Clip.antiAlias,
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 920, maxHeight: 760),
      child: _SaleExceptionSurface(controller: controller, saleId: saleId),
    ),
  ),
);

final class _SaleExceptionSurface extends StatefulWidget {
  const _SaleExceptionSurface({required this.controller, required this.saleId});
  final SaleExceptionController controller;
  final String saleId;

  @override
  State<_SaleExceptionSurface> createState() => _SaleExceptionSurfaceState();
}

final class _SaleExceptionSurfaceState extends State<_SaleExceptionSurface> {
  String? _exceptionType;
  String _reason = 'customer_changed_mind';
  final _note = TextEditingController();
  final _managerPin = TextEditingController();

  /// The manager PIN as the contract spells it: four to eight digits, nothing else. The field is
  /// obscure and numeric, but a person can still leave it empty and press the action, so the action
  /// asks this first.
  bool get _managerPinLooksValid =>
      RegExp(r'^\d{4,8}$').hasMatch(_managerPin.text.trim());
  final Map<String, int> _quantities = {};
  final Map<String, String> _restock = {};
  String _fullRestock = 'restock';

  /// Why the last preview attempt was refused. It is shown under the button
  /// that refused it rather than in a bar at the bottom of the screen, which is
  /// a different part of the surface from the lines that have to be picked.
  String? _validation;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    widget.controller.load(widget.saleId);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _note.dispose();
    _managerPin.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    final eligibility = widget.controller.state.eligibility;
    if (eligibility != null && _exceptionType == null) {
      _exceptionType = eligibility.allowedTypes.isEmpty
          ? null
          : eligibility.allowedTypes.first;
    }
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.controller.state;
    return SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              UmiSpacing.lg,
              UmiSpacing.lg,
              UmiSpacing.sm,
              UmiSpacing.md,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l.saleExceptionTitle,
                    style: PosTheme.of(context).textTheme.headlineSmall,
                  ),
                ),
                PosIconButton(
                  tooltip: l.closeAction,
                  onPressed: () => Navigator.pop(context),
                  icon: const PosIcon(PosGlyphs.close),
                ),
              ],
            ),
          ),
          const PosDivider(height: 1),
          Expanded(
            child: Semantics(
              liveRegion: true,
              label: _phaseLabel(l, state.phase),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(UmiSpacing.lg),
                child: switch (state.phase) {
                  SaleExceptionPhase.loading || SaleExceptionPhase.committing =>
                    const Center(child: PosSpinner()),
                  SaleExceptionPhase.blocked => _blocked(l, state),
                  SaleExceptionPhase.failure => _failure(l, state),
                  SaleExceptionPhase.committed ||
                  SaleExceptionPhase.recovered => _receipt(l, state.result),
                  SaleExceptionPhase.outcomeUnknown => _unknown(l, state),
                  SaleExceptionPhase.previewReady ||
                  SaleExceptionPhase.approvalRequired ||
                  SaleExceptionPhase.terminalRequired => _preview(l, state),
                  SaleExceptionPhase.eligible => _selection(
                    l,
                    state.eligibility!,
                  ),
                  _ => const SizedBox.shrink(),
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _blocked(AppLocalizations l, SaleExceptionState state) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final refund = state.eligibility?.refund;
    // Each block code names WHY the sale cannot be refunded. Show the specific
    // reason and the next step, never the same sentence as the title.
    final reasons = (refund?['blockCodes'] as List<Object?>? ?? const [])
        .map((code) => _blockDetail(spanish, '$code'))
        .join('\n');
    return _status(
      PosGlyphs.blockOutlined,
      spanish
          ? 'No se puede reembolsar esta venta'
          : 'This sale cannot be refunded',
      reasons.isEmpty
          ? (spanish
                ? 'Pide una revisión de soporte para continuar.'
                : 'Ask support to review this sale before you continue.')
          : reasons,
    );
  }

  Widget _failure(AppLocalizations l, SaleExceptionState state) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    // Title is a fixed heading; the body carries the specific cause and the
    // next step for the returned error code — the two must never be identical.
    return _status(
      PosGlyphs.errorOutline,
      l.refundOperationFailedMessage,
      _errorDetail(spanish, state.errorCode),
    );
  }

  Widget _unknown(AppLocalizations l, SaleExceptionState state) {
    final correlation =
        state.terminalOutcome?.correlationReference ??
        state.preview?.correlationReference;
    final guidance = correlation == null
        ? l.verifyTerminalAction
        : '${l.verifyTerminalAction}\n${l.correlationLabel}: $correlation';
    return _status(
      PosGlyphs.helpOutline,
      l.paymentOutcomeUnknownMessage,
      guidance,
    );
  }

  Widget _status(PosGlyph icon, String title, String message) => Center(
    child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 560),
      child: Column(
        children: [
          PosIcon(icon, size: 52),
          const SizedBox(height: UmiSpacing.md),
          Text(title, style: PosTheme.of(context).textTheme.titleLarge),
          const SizedBox(height: UmiSpacing.sm),
          Text(message, textAlign: TextAlign.center),
        ],
      ),
    ),
  );

  Widget _selection(AppLocalizations l, SaleExceptionEligibility eligibility) {
    final sale = eligibility.sale;
    final refund = eligibility.refund;
    final lines = (refund['lines']! as List<Object?>)
        .cast<Map<String, Object?>>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _moneyRow(
          l.refundableAmountLabel,
          sale['remainingRefundable']! as Map<String, Object?>,
        ),
        const SizedBox(height: UmiSpacing.lg),
        Wrap(
          spacing: UmiSpacing.sm,
          runSpacing: UmiSpacing.sm,
          children: eligibility.allowedTypes
              .map(
                (type) => PosChoice(
                  selected: _exceptionType == type,
                  label: Text(_typeLabel(l, type)),
                  onSelected: (_) => setState(() {
                    _exceptionType = type;
                    _reason = type == 'void'
                        ? 'operator_error'
                        : 'customer_changed_mind';
                    _note.clear();
                  }),
                ),
              )
              .toList(),
        ),
        if (_exceptionType == 'partial_refund') ...[
          const SizedBox(height: UmiSpacing.lg),
          ...lines.map((line) => _lineSelector(l, line)),
        ] else if (_exceptionType == 'full_refund' ||
            _exceptionType == 'void') ...[
          const SizedBox(height: UmiSpacing.lg),
          Text(
            l.restockIntentLabel,
            style: PosTheme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          PosSegmented<String>(
            segments: [
              PosSegment(value: 'restock', label: Text(l.restockAction)),
              PosSegment(
                value: 'do_not_restock',
                label: Text(l.doNotRestockAction),
              ),
              PosSegment(
                value: 'inspection_required',
                label: Text(l.inspectionRequiredAction),
              ),
            ],
            selected: {_fullRestock},
            onSelectionChanged: (value) =>
                setState(() => _fullRestock = value.first),
            showSelectedIcon: false,
          ),
        ],
        const SizedBox(height: UmiSpacing.lg),
        PosSelectFormField<String>(
          key: ValueKey(_exceptionType == 'void'),
          initialValue: _reasons(_exceptionType == 'void').contains(_reason)
              ? _reason
              : _reasons(_exceptionType == 'void').first,
          decoration: PosFieldDecoration(labelText: l.refundReasonLabel),
          items: _reasons(_exceptionType == 'void')
              .map(
                (reason) => PosSelectItem(
                  value: reason,
                  child: Text(_reasonLabel(l, reason)),
                ),
              )
              .toList(),
          onChanged: (value) => setState(() {
            _reason = value ?? _reason;
            if (_reason != 'other_approved_reason') _note.clear();
          }),
        ),
        if (_reason == 'other_approved_reason') ...[
          const SizedBox(height: UmiSpacing.md),
          PosField(
            controller: _note,
            maxLength: 160,
            decoration: PosFieldDecoration(labelText: l.otherReasonDetailLabel),
            onChanged: (_) => setState(() {}),
          ),
        ],
        const SizedBox(height: UmiSpacing.md),
        if (_validation != null) ...[
          InlineNotice(message: _validation!),
          const SizedBox(height: UmiSpacing.md),
        ],
        PosButton.icon(
          onPressed:
              _reason == 'other_approved_reason' && _note.text.trim().isEmpty
              ? null
              : _createPreview,
          icon: const PosIcon(PosGlyphs.previewOutlined),
          label: Text(l.refundPreviewAction),
        ),
        if (widget.controller.state.history?.entries.isNotEmpty ?? false) ...[
          const SizedBox(height: UmiSpacing.lg),
          Text(
            l.exceptionHistoryLabel,
            style: PosTheme.of(context).textTheme.titleMedium,
          ),
          ...widget.controller.state.history!.entries.map(
            (entry) => PosListRow(
              leading: const PosIcon(PosGlyphs.history),
              title: Text(_typeLabel(l, '${entry['exceptionType']}')),
              subtitle: Text(_reasonLabel(l, '${entry['reason']}')),
              trailing: Text(_money(entry['amount']! as Map<String, Object?>)),
            ),
          ),
        ],
      ],
    );
  }

  Widget _lineSelector(AppLocalizations l, Map<String, Object?> line) {
    final id = line['saleLineId']! as String;
    final quantity = line['quantity']! as Map<String, Object?>;
    final remaining = quantity['remaining']! as int;
    final selected = _quantities[id] ?? 0;
    final service = line['isService']! as bool;
    return PosCard(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                PosCheck(
                  value: selected > 0,
                  onChanged: (value) => setState(() {
                    _quantities[id] = value ?? false ? 1 : 0;
                    _restock[id] = service ? 'not_applicable' : 'restock';
                  }),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${line['displayName']}'),
                      Text('${l.remainingRefundableQuantityLabel}: $remaining'),
                    ],
                  ),
                ),
                PosIconButton(
                  tooltip: l.decreaseRefundQuantityTooltip,
                  onPressed: selected > 0
                      ? () => setState(() => _quantities[id] = selected - 1)
                      : null,
                  icon: const PosIcon(PosGlyphs.remove),
                ),
                Semantics(
                  label: '${l.remainingRefundableQuantityLabel}: $selected',
                  child: Text('$selected'),
                ),
                PosIconButton(
                  tooltip: l.increaseRefundQuantityTooltip,
                  onPressed: selected < remaining
                      ? () => setState(() => _quantities[id] = selected + 1)
                      : null,
                  icon: const PosIcon(PosGlyphs.add),
                ),
              ],
            ),
            if (selected > 0 && !service)
              PosSegmented<String>(
                segments: [
                  PosSegment(value: 'restock', label: Text(l.restockAction)),
                  PosSegment(
                    value: 'do_not_restock',
                    label: Text(l.doNotRestockAction),
                  ),
                  PosSegment(
                    value: 'inspection_required',
                    label: Text(l.inspectionRequiredAction),
                  ),
                ],
                selected: {_restock[id] ?? 'restock'},
                onSelectionChanged: (value) =>
                    setState(() => _restock[id] = value.first),
                showSelectedIcon: false,
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _createPreview() async {
    final type = _exceptionType;
    if (type == null) {
      return;
    }
    final eligibilityLines =
        (widget.controller.state.eligibility?.refund['lines']
                    as List<Object?>? ??
                const [])
            .cast<Map<String, Object?>>();
    final lines = type == 'partial_refund'
        ? _quantities.entries
              .where((entry) => entry.value > 0)
              .map(
                (entry) => <String, Object?>{
                  'saleLineId': entry.key,
                  'quantity': entry.value,
                  'restockDecision': _restock[entry.key] ?? 'restock',
                },
              )
              .toList()
        : eligibilityLines.map((line) {
            final quantity = line['quantity']! as Map<String, Object?>;
            return <String, Object?>{
              'saleLineId': line['saleLineId'],
              'quantity': quantity['remaining'],
              'restockDecision': line['isService']! as bool
                  ? 'not_applicable'
                  : _fullRestock,
            };
          }).toList();
    if (type == 'partial_refund' && lines.isEmpty) {
      setState(
        () =>
            _validation = AppLocalizations.of(context).selectRefundLinesMessage,
      );
      return;
    }
    setState(() => _validation = null);
    await widget.controller.createPreview(
      exceptionType: type,
      reason: _reason,
      lines: lines,
      note: _reason == 'other_approved_reason' ? _note.text : null,
    );
  }

  Widget _preview(AppLocalizations l, SaleExceptionState state) {
    final preview = state.preview!;
    final providerBacked = preview.manualTerminal?['providerBacked'] == true;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _typeLabel(l, preview.exceptionType),
          style: PosTheme.of(context).textTheme.titleLarge,
        ),
        if (state.errorCode != null) ...[
          const SizedBox(height: UmiSpacing.md),
          Text(
            _errorDetail(
              Localizations.localeOf(context).languageCode == 'es',
              state.errorCode,
            ),
            style: PosTheme.of(context).textTheme.bodyMedium?.copyWith(
              color: PosTheme.of(context).colorScheme.error,
            ),
          ),
        ],
        if (state.errorCode == 'REFUND_PREVIEW_EXPIRED')
          PosOutlineButton(
            onPressed: widget.controller.refreshPreview,
            child: Text(
              Localizations.localeOf(context).languageCode == 'es'
                  ? 'Actualizar revisión'
                  : 'Refresh review',
            ),
          ),
        const SizedBox(height: UmiSpacing.md),
        _moneyRow(
          l.taxRefundLabel,
          preview.tax['amount']! as Map<String, Object?>,
        ),
        _moneyRow(
          l.discountAllocationLabel,
          preview.discount['amount']! as Map<String, Object?>,
        ),
        _moneyRow(
          l.tipRefundLabel,
          preview.tip['amount']! as Map<String, Object?>,
        ),
        const PosDivider(),
        // THE REFUND'S OWN AMOUNT, NOT WHAT IS LEFT TO REFUND. This row used to wear
        // `refundableAmountLabel` — "Importe restante reembolsable" — so the preview and the
        // confirmation read "remaining refundable MXN 64.99" about the money being handed back.
        // Measured on the iMin on 2026-10-11: the committed dialog showed `Importe restante
        // reembolsable MXN 64.99` for a sale with MXN 150.01 still refundable.
        _moneyRow(
          l.refundAmountLabel,
          preview.allocation['total']! as Map<String, Object?>,
        ),
        const SizedBox(height: UmiSpacing.md),
        ...preview.tenders.map(
          (tender) => PosListRow(
            leading: PosIcon(
              tender['tenderType'] == 'cash'
                  ? PosGlyphs.paymentsOutlined
                  : PosGlyphs.creditCard,
            ),
            title: Text(
              tender['tenderType'] == 'cash'
                  ? l.cashRefundLabel
                  : providerBacked
                  ? l.cardTerminalRefundLabel
                  : l.manualTerminalRefundLabel,
            ),
            trailing: Text(_money(tender['amount']! as Map<String, Object?>)),
          ),
        ),
        const SizedBox(height: UmiSpacing.sm),
        Text(
          l.restockIntentLabel,
          style: PosTheme.of(context).textTheme.titleMedium,
        ),
        ...preview.lines.map(
          (line) => PosListRow(
            dense: true,
            title: Text(
              '${line['quantity']} × ${_restockLabel(l, '${line['restockDecision']}')}',
            ),
          ),
        ),
        if (preview.manualTerminal != null &&
            !providerBacked &&
            (state.terminalOutcome == null ||
                state.terminalOutcome?.status ==
                    'operator_reported_failure')) ...[
          Text(
            l.manualTerminalRefundProviderNotice,
            style: PosTheme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: UmiSpacing.sm),
          Wrap(
            spacing: UmiSpacing.sm,
            runSpacing: UmiSpacing.sm,
            children: [
              PosButton.tonal(
                onPressed: () => widget.controller.recordTerminalOutcome(
                  'confirmed_success',
                ),
                child: Text(l.terminalRefundSuccessAction),
              ),
              PosOutlineButton(
                onPressed: () => widget.controller.recordTerminalOutcome(
                  'operator_reported_failure',
                ),
                child: Text(l.terminalRefundFailureAction),
              ),
              PosOutlineButton(
                onPressed: () =>
                    widget.controller.recordTerminalOutcome('outcome_unknown'),
                child: Text(l.terminalRefundUnknownAction),
              ),
            ],
          ),
        ],
        if (preview.manualTerminal != null && providerBacked) ...[
          Text(
            l.manualTerminalRefundOnCommitNotice,
            style: PosTheme.of(context).textTheme.titleMedium,
          ),
        ],
        if (preview.approvalRequired && state.approval == null) ...[
          const SizedBox(height: UmiSpacing.lg),
          PosField(
            controller: _managerPin,
            obscureText: true,
            keyboardType: TextInputType.number,
            autofillHints: const [],
            decoration: PosFieldDecoration(labelText: l.managerPinLabel),
            onSubmitted: _approve,
            // The action's enabled state depends on what is in here, so every keystroke rebuilds.
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: UmiSpacing.sm),
          PosButton.tonal(
            // THE PIN IS A CREDENTIAL, NOT A TEXT FIELD THE API VALIDATES LATER. The contract
            // requires `managerPin` to match `^\d{4,8}$`, and an empty field used to be sent
            // anyway: the API answered `400 VALIDATION_FAILED` ("The request does not match the
            // public contract"), which the surface shows as "Vuelve a intentar… (Código:
            // VALIDATION_FAILED)" — advice to retry, about a field nobody named. Measured on the
            // iMin on 2026-10-11 at 09:42:52. A control that cannot succeed is disabled, the way
            // the sign-in keypad disables `Continuar` until four digits have landed.
            onPressed:
                _managerPinLooksValid &&
                    state.errorCode != 'REFUND_PREVIEW_EXPIRED'
                ? () => _approve(_managerPin.text)
                : null,
            child: Text(l.approvalRequiredMessage),
          ),
        ],
        if ((!preview.approvalRequired || state.approval != null) &&
            (preview.manualTerminal == null ||
                providerBacked ||
                state.terminalOutcome?.status == 'confirmed_success')) ...[
          const SizedBox(height: UmiSpacing.lg),
          PosButton.icon(
            onPressed: () => _confirmCommit(l),
            icon: const PosIcon(PosGlyphs.checkCircleOutline),
            label: Text(l.commitRefundAction),
          ),
        ],
      ],
    );
  }

  Future<void> _confirmCommit(AppLocalizations l) async {
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(l.refundConfirmationTitle),
        content: Text(l.refundConfirmationBody),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l.closeAction),
          ),
          PosButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l.commitRefundAction),
          ),
        ],
      ),
    );
    if (accepted ?? false) await widget.controller.commit();
  }

  Future<void> _approve(String pin) async {
    try {
      await widget.controller.approve(pin);
    } finally {
      _managerPin.clear();
    }
  }

  Widget _receipt(AppLocalizations l, SaleExceptionResult? result) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    if (result == null) {
      return _status(
        PosGlyphs.receiptLongOutlined,
        l.compensatingReceiptTitle,
        l.recoveredRefundMessage,
      );
    }
    final receipt = result.receipt;
    final voided = result.exceptionType == 'void';
    return Column(
      children: [
        const PosIcon(PosGlyphs.checkCircleOutline, size: 56),
        const SizedBox(height: UmiSpacing.md),
        Text(
          voided
              ? (spanish ? 'Anulación confirmada' : 'Sale voided')
              : l.compensatingReceiptTitle,
          style: PosTheme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: UmiSpacing.sm),
        Text(
          receipt?['publicReference'] as String? ??
              result.exceptionId.substring(0, 8),
        ),
        const SizedBox(height: UmiSpacing.lg),
        _moneyRow(
          voided
              ? (spanish ? 'Importe anulado' : 'Voided amount')
              : l.refundAmountLabel,
          result.allocation['total']! as Map<String, Object?>,
        ),
        Text(
          voided
              ? (spanish
                    ? 'La venta quedó anulada.'
                    : 'The sale has been voided.')
              : l.refundCommittedMessage,
        ),
      ],
    );
  }

  Widget _moneyRow(String label, Map<String, Object?> value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: UmiSpacing.xs),
    child: Row(
      children: [
        Expanded(child: Text(label)),
        Text(
          _money(value),
          style: const TextStyle(fontFeatures: [FontFeature.tabularFigures()]),
        ),
      ],
    ),
  );

  String _money(Map<String, Object?> value) => formatMinorUnits(
    value['minorUnits']! as int,
    value['currency'] as String? ?? '',
  );

  String _typeLabel(AppLocalizations l, String type) => switch (type) {
    'void' => l.voidSaleAction,
    'full_refund' => l.fullRefundAction,
    'partial_refund' => l.partialRefundAction,
    _ => l.supportRequiredMessage,
  };

  String _restockLabel(AppLocalizations l, String decision) =>
      switch (decision) {
        'restock' => l.restockAction,
        'do_not_restock' => l.doNotRestockAction,
        'inspection_required' => l.inspectionRequiredAction,
        'not_applicable' => l.restockNotApplicableLabel,
        _ => l.restockInventoryReviewLabel,
      };

  String _reasonLabel(AppLocalizations l, String reason) => switch (reason) {
    'customer_changed_mind' => l.refundReasonCustomerChangedMind,
    'product_defect' => l.refundReasonProductDefect,
    'incorrect_item' => l.refundReasonIncorrectItem,
    'incorrect_quantity' => l.refundReasonIncorrectQuantity,
    'duplicate_charge' => l.refundReasonDuplicateCharge,
    'quality_issue' => l.refundReasonQualityIssue,
    'order_preparation_error' => l.refundReasonOrderPreparationError,
    'pricing_error' => l.refundReasonPricingError,
    'operator_error' => l.voidReasonOperatorError,
    'duplicate_sale' => l.voidReasonDuplicateSale,
    'incorrect_tender' => l.voidReasonIncorrectTender,
    'sale_entered_by_mistake' => l.voidReasonSaleEnteredByMistake,
    _ => l.otherApprovedReasonLabel,
  };

  List<String> _reasons(bool voidReason) => voidReason
      ? const [
          'operator_error',
          'duplicate_sale',
          'incorrect_tender',
          'sale_entered_by_mistake',
          'other_approved_reason',
        ]
      : const [
          'customer_changed_mind',
          'product_defect',
          'incorrect_item',
          'incorrect_quantity',
          'duplicate_charge',
          'quality_issue',
          'order_preparation_error',
          'pricing_error',
          'other_approved_reason',
        ];

  // Server eligibility block codes -> a specific reason plus what to do next.
  String _blockDetail(bool spanish, String code) => switch (code) {
    'policy_window_expired' =>
      spanish
          ? 'El periodo permitido para el reembolso venció.'
          : 'The allowed refund period has ended.',
    'policy_disabled' =>
      spanish
          ? 'Los reembolsos y anulaciones están desactivados en esta sucursal. Pide al dueño que los active.'
          : 'Refunds and voids are disabled for this branch. Ask the owner to enable them.',
    'fully_refunded' =>
      spanish
          ? 'Esta venta ya se reembolsó por completo.'
          : 'This sale is already fully refunded.',
    'void_not_eligible' =>
      spanish
          ? 'Esta venta ya no se puede anular. Usa un reembolso.'
          : 'This sale can no longer be voided. Use a refund instead.',
    'payment_outcome_unknown' =>
      spanish
          ? 'Se desconoce el resultado del pago original. Verifícalo antes de reembolsar.'
          : 'The original payment outcome is unknown. Verify it before you refund.',
    'bank_transfer_refund_requires_support' =>
      spanish
          ? 'Los reembolsos de transferencia bancaria requieren soporte. Abre el Centro de recuperación y comparte la referencia de la venta.'
          : 'Bank-transfer refunds require support. Open the Recovery centre and share the sale reference.',
    'other_operator_permission_required' =>
      spanish
          ? 'La venta la cobró otro operador. Pide a un gerente que la revise y autorice.'
          : 'Another operator took this sale. Ask a manager to review and authorize it.',
    _ =>
      spanish
          ? 'Esta venta no cumple una regla del reembolso. Pide apoyo a un gerente.'
          : 'This sale fails a refund rule. Ask a manager for help.',
  };

  // Server error codes on a failed commit -> a specific cause plus what to do
  // next. The default keeps the code visible so support can trace it.
  String _errorDetail(bool spanish, String? code) => switch (code) {
    'REFUND_PREVIEW_EXPIRED' =>
      spanish
          ? 'La revisión de la devolución venció. Actualízala antes de pedir autorización. Se conserva tu selección.'
          : 'The refund review expired. Refresh it before requesting approval. Your selection is preserved.',
    'PERMISSION_DENIED' || 'PERMISSION_REVOKED' =>
      spanish
          ? 'No tienes permiso para esta acción. Pide a un gerente que la autorice.'
          : 'You do not have permission for this action. Ask a manager to authorize it.',
    'APPROVAL_REQUIRED' =>
      spanish
          ? 'Se requiere la aprobación de un gerente. Pide el PIN del gerente.'
          : 'A manager approval is required. Ask for the manager PIN.',
    'APPROVAL_EXPIRED' =>
      spanish
          ? 'La aprobación venció. Solicita una aprobación nueva.'
          : 'The approval expired. Request a new approval.',
    'APPROVAL_FINGERPRINT_MISMATCH' || 'APPROVAL_REUSED' =>
      spanish
          ? 'La aprobación ya no es válida. Solicita una aprobación nueva con un gerente distinto al operador.'
          : 'The approval is no longer valid. Request a new one from a manager other than the operator.',
    'CASH_REFUND_NOT_AVAILABLE' =>
      spanish
          ? 'No hay efectivo disponible para el reembolso. Abre un turno de caja o usa otro método.'
          : 'No cash is available for the refund. Open a cash shift or use another method.',
    'CASH_SHIFT_NOT_ELIGIBLE' =>
      spanish
          ? 'El turno de caja no permite este reembolso. Abre un turno válido en esta caja.'
          : 'The cash shift does not allow this refund. Open a valid shift on this register.',
    'INSUFFICIENT_EXPECTED_CASH' =>
      spanish
          ? 'No hay suficiente efectivo en la caja para el reembolso.'
          : 'There is not enough cash in the drawer for this refund.',
    'REFUND_NOT_ELIGIBLE' =>
      spanish
          ? 'Esta venta no es elegible para el reembolso.'
          : 'This sale is not eligible for a refund.',
    'SALE_NOT_FOUND' ||
    'ORIGINAL_RECEIPT_NOT_FOUND' ||
    'SALE_EXCEPTION_NOT_FOUND' =>
      spanish
          ? 'No se encontró la venta original. Actualiza la lista e intenta de nuevo.'
          : 'The original sale was not found. Refresh the list and try again.',
    'REFUND_AMOUNT_OUT_OF_RANGE' ||
    'REFUND_QUANTITY_EXCEEDS_REMAINING' ||
    'REFUND_TOTAL_INVALID' ||
    'REFUND_SELECTION_INVALID' =>
      spanish
          ? 'La cantidad del reembolso no es válida. Revisa las líneas y el importe.'
          : 'The refund amount is not valid. Check the lines and the amount.',
    'STALE_PREVIEW' ||
    'STALE_SALE' ||
    'SALE_EXCEPTION_CONTEXT_CHANGED' ||
    'SALE_EXCEPTION_CONFLICT' ||
    'OPTIMISTIC_VERSION_CONFLICT' =>
      spanish
          ? 'La venta cambió. Cierra esta ventana y vuelve a abrir el reembolso.'
          : 'The sale changed. Close this window and open the refund again.',
    'PAYMENT_OUTCOME_UNKNOWN' =>
      spanish
          ? 'Se desconoce el resultado de la terminal. Verifica la operación original.'
          : 'The terminal outcome is unknown. Verify the original operation.',
    'TERMINAL_REFUND_CONFIRMATION_REQUIRED' =>
      spanish
          ? 'Confirma el resultado del reembolso en la terminal.'
          : 'Confirm the refund outcome on the terminal.',
    _ =>
      spanish
          ? 'Vuelve a intentar. Si el problema sigue, pide apoyo a un gerente.${code == null ? '' : ' (Código: $code)'}'
          : 'Try again. If it keeps failing, ask a manager for help.${code == null ? '' : ' (Code: $code)'}',
  };

  String _phaseLabel(AppLocalizations l, SaleExceptionPhase phase) =>
      switch (phase) {
        SaleExceptionPhase.committed => l.refundCommittedMessage,
        SaleExceptionPhase.recovered => l.recoveredRefundMessage,
        SaleExceptionPhase.outcomeUnknown => l.paymentOutcomeUnknownMessage,
        SaleExceptionPhase.blocked => l.refundBlockedMessage,
        _ => l.saleExceptionTitle,
      };
}
