import 'dart:math';

import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/errors/app_error.dart';
import '../../core/theme/umi_theme.dart';
import '../cart/cart_controller.dart';
import '../cash/money_input.dart';
import 'checkout_controller.dart';

Future<void> showPartialCheckout(
  BuildContext context, {
  required CheckoutController checkout,
  required CartController cart,
  required String operatorSessionId,
  String? operatorName,
  required bool canConfirmManualTerminal,
  required String? cashShiftId,
  Future<void> Function()? prepare,
  required Future<bool?> Function(int amountMinor, bool selected)
  onShowBankTransferDetails,
}) => Navigator.of(context).push(
  PosPageRoute<void>(
    fullscreenDialog: true,
    builder: (_) => PartialCheckoutSurface(
      checkout: checkout,
      cart: cart,
      operatorSessionId: operatorSessionId,
      operatorName: operatorName,
      canConfirmManualTerminal: canConfirmManualTerminal,
      cashShiftId: cashShiftId,
      prepare: prepare,
      onShowBankTransferDetails: onShowBankTransferDetails,
    ),
  ),
);

/// Each press records one payment on the server. The server's ledger supplies
/// both the balance and the exact drafts used when the account is closed.
final class PartialCheckoutSurface extends StatefulWidget {
  const PartialCheckoutSurface({
    required this.checkout,
    required this.cart,
    required this.operatorSessionId,
    this.operatorName,
    required this.canConfirmManualTerminal,
    required this.cashShiftId,
    this.prepare,
    required this.onShowBankTransferDetails,
    super.key,
  });

  final CheckoutController checkout;
  final CartController cart;
  final String operatorSessionId;
  final String? operatorName;
  final bool canConfirmManualTerminal;
  final String? cashShiftId;
  final Future<void> Function()? prepare;
  final Future<bool?> Function(int amountMinor, bool selected)
  onShowBankTransferDetails;

  @override
  State<PartialCheckoutSurface> createState() => _PartialCheckoutSurfaceState();
}

final class _PartialCheckoutSurfaceState extends State<PartialCheckoutSurface> {
  final principal = TextEditingController();
  final tip = TextEditingController(text: '0.00');
  final cashReceived = TextEditingController();
  Map<String, Object?>? ledger;
  Map<String, Object?>? pendingCommand;
  bool busy = false;
  bool _ledgerLoading = false;
  bool _ledgerVerified = false;
  bool uncertain = false;
  bool finalizationUnknown = false;
  bool retryReady = false;
  bool cashReceivedEdited = false;
  String? _seededPrincipal;
  String? _seededTip;
  int? _selectedTipBasisPoints;
  bool _settingTip = false;
  bool _prepared = false;
  String? error;
  String method = 'cash';

  Cart get cart => widget.cart.state.cart!;
  String get operatorSessionId => widget.operatorSessionId;
  String get currency =>
      (cart.totals['grandTotal'] as Map<String, Object?>)['currency'] as String;
  bool get es => Localizations.localeOf(context).languageCode == 'es';
  String label(String spanish, String english) => es ? spanish : english;
  String? get tableLabel {
    final name = cart.tableName?.trim();
    if (name == null || name.isEmpty) return null;
    if (RegExp(r'^(mesa|table)\b', caseSensitive: false).hasMatch(name)) {
      return name;
    }
    return '${label('Mesa', 'Table')} $name';
  }

  String money(int minor) => formatMinorUnits(minor, currency);
  int amount(Object? raw) =>
      raw is Map ? ((raw['minorUnits'] as num?)?.toInt() ?? 0) : 0;
  int get due => amount(ledger?['amountDue']);
  int get paid => amount(ledger?['appliedAmount']);
  int get remaining => amount(ledger?['remainingBalance']);
  int get tipsPaid => amount(ledger?['tipAmount']);
  int? get principalMinor => parseMinorUnits(principal.text);
  int? get tipMinor => parseMinorUnits(tip.text);
  int? get receivedMinor => parseMinorUnits(cashReceived.text);
  int get charge => (principalMinor ?? 0) + (tipMinor ?? 0);
  int get _netBeforeTaxTotal {
    final subtotal = amount(cart.totals['subtotal']);
    final tax = amount(cart.totals['tax']);
    final discounts = amount(
      cart.totals['discounts'] is Map
          ? (cart.totals['discounts']! as Map)['total']
          : null,
    );
    return max(0, subtotal - tax - discounts);
  }

  int get tipBaseMinor {
    final portion = principalMinor ?? 0;
    final grandTotal = amount(cart.totals['grandTotal']);
    if (portion <= 0 || grandTotal <= 0) return 0;
    return ((portion * _netBeforeTaxTotal) / grandTotal).round();
  }

  String get _tipAttribution =>
      widget.checkout.policy?.tip['attribution'] as String? ?? 'account_owner';

  String get tipOwnerLabel {
    if (_tipAttribution == 'payment_processor') {
      final name = widget.operatorName?.trim();
      return name == null || name.isEmpty
          ? label(
              'Propina para quien procesa el cobro',
              'Tip for the payment processor',
            )
          : label(
              'Propina para $name, quien procesa el cobro',
              'Tip for $name, the payment processor',
            );
    }
    final name = cart.operatorName?.trim();
    return name == null || name.isEmpty
        ? label(
            'Propina para el dueño de la cuenta',
            'Tip for the account owner',
          )
        : label(
            'Propina para $name, dueño de la cuenta',
            'Tip for $name, the account owner',
          );
  }

  Map<String, Object?> _localLedger() {
    final total = Map<String, Object?>.from(cart.totals['grandTotal']! as Map);
    return <String, Object?>{
      'cartId': cart.id,
      'cartVersion': cart.version,
      'amountDue': total,
      'appliedAmount': {'minorUnits': 0, 'currency': currency},
      'remainingBalance': total,
      'tipAmount': {'minorUnits': 0, 'currency': currency},
      'tenderDrafts': <Object?>[],
      'confirmationReferences': <String, String>{},
      'blockedByUnknown': false,
      'unresolvedTender': null,
      'canFinalize': false,
    };
  }

  bool get manualAllowed =>
      widget.checkout.policy?.manualTerminalEnabled == true &&
      widget.canConfirmManualTerminal;
  bool get bankAllowed =>
      widget.checkout.policy?.bankTransferEnabled == true &&
      widget.checkout.policy?.bankTransferDetails != null;
  String? get lockedMethod =>
      widget.checkout.policy?.mixedTenderEnabled == false &&
          tenderDrafts.isNotEmpty
      ? tenderDrafts.first['type'] as String?
      : null;
  bool get methodAvailable =>
      (lockedMethod == null || lockedMethod == method) &&
      switch (method) {
        'cash' => widget.cashShiftId != null,
        'manual_terminal' => manualAllowed,
        'bank_transfer' => bankAllowed,
        _ => false,
      };
  bool get hasUnknown =>
      tenderDrafts.any(
        (draft) =>
            draft['status'] == 'outcome_unknown' ||
            draft['status'] == 'awaiting_operator_confirmation',
      ) ||
      ledger?['blockedByUnknown'] == true;
  bool get canFinalize =>
      ledger?['canFinalize'] == true && remaining == 0 && !hasUnknown;

  List<Map<String, Object?>> get tenderDrafts =>
      (ledger?['tenderDrafts'] as List? ?? const [])
          .whereType<Map>()
          .map((item) => Map<String, Object?>.from(item))
          .toList(growable: false);
  Map<String, Object?>? get unresolvedTender =>
      ledger?['unresolvedTender'] is Map
      ? Map<String, Object?>.from(ledger!['unresolvedTender']! as Map)
      : null;

  bool get canCollect {
    if (busy ||
        ledger == null ||
        !_ledgerVerified ||
        uncertain ||
        hasUnknown ||
        canFinalize ||
        !methodAvailable) {
      return false;
    }
    final principalValue = principalMinor;
    final tipValue = tipMinor;
    if (principalValue == null ||
        principalValue <= 0 ||
        principalValue > remaining ||
        tipValue == null ||
        tipValue < 0) {
      return false;
    }
    if (tipValue > 0 && !(widget.checkout.policy?.tip['enabled'] == true)) {
      return false;
    }
    final maximumTip = amount(widget.checkout.policy?.tip['maximumTip']);
    if (tipValue > maximumTip) return false;
    if (method == 'cash') {
      return receivedMinor != null && receivedMinor! >= charge;
    }
    return true;
  }

  @override
  void initState() {
    super.initState();
    if (widget.cashShiftId == null) {
      method = 'none';
    }
    principal.addListener(_principalChanged);
    tip.addListener(_tipChanged);
    cashReceived.addListener(_inputChanged);
    widget.checkout.addListener(_checkoutChanged);
    ledger = _localLedger();
    _seedRemaining(ledger!);
    _refresh();
  }

  @override
  void dispose() {
    widget.checkout.removeListener(_checkoutChanged);
    principal.dispose();
    tip.dispose();
    cashReceived.dispose();
    super.dispose();
  }

  void _inputChanged() {
    if (mounted) setState(() {});
  }

  void _checkoutChanged() {
    if (mounted) setState(() {});
  }

  String _errorMessage(AppException failure) => switch (failure.code) {
    'CASH_SHIFT_REQUIRED' => label(
      'Abre el turno de caja antes de recibir efectivo.',
      'Open the cash shift before accepting cash.',
    ),
    'OPTIMISTIC_VERSION_CONFLICT' => label(
      'La comanda cambió. Actualiza el saldo antes de cobrar.',
      'The order changed. Refresh the balance before charging.',
    ),
    _ => failure.code,
  };

  void _amountChanged() {
    if (!cashReceivedEdited) {
      cashReceived.text = (charge / 100).toStringAsFixed(2);
    }
    _inputChanged();
  }

  void _principalChanged() {
    final basisPoints = _selectedTipBasisPoints;
    if (basisPoints != null) {
      _setTipForBasisPoints(basisPoints);
      return;
    }
    _amountChanged();
  }

  void _tipChanged() {
    if (!_settingTip && _selectedTipBasisPoints != null) {
      _selectedTipBasisPoints = null;
    }
    _amountChanged();
  }

  int tipForBasisPoints(int basisPoints) =>
      ((tipBaseMinor * basisPoints) / 10000).round();

  void _setTipForBasisPoints(int basisPoints) {
    _settingTip = true;
    tip.text = (tipForBasisPoints(basisPoints) / 100).toStringAsFixed(2);
    _settingTip = false;
    if (mounted) {
      setState(() => _selectedTipBasisPoints = basisPoints);
    }
    _amountChanged();
  }

  String _percentageLabel(int basisPoints) {
    final whole = basisPoints ~/ 100;
    final fraction = basisPoints % 100;
    if (fraction == 0) return '$whole%';
    return '$whole.${fraction.toString().padLeft(2, '0')}%';
  }

  void _seedRemaining(Map<String, Object?> next) {
    final left = amount(next['remainingBalance']);
    cashReceivedEdited = false;
    principal.text = (left / 100).toStringAsFixed(2);
    _settingTip = true;
    tip.text = '0.00';
    _settingTip = false;
    _selectedTipBasisPoints = 0;
    _seededPrincipal = principal.text;
    _seededTip = tip.text;
    cashReceived.text = (left / 100).toStringAsFixed(2);
  }

  bool get _amountsAreUntouched =>
      principal.text == _seededPrincipal && tip.text == _seededTip;

  Future<void> _refresh() async {
    if (busy) return;
    setState(() {
      busy = true;
      _ledgerLoading = true;
      _ledgerVerified = false;
      error = null;
    });
    try {
      final prepare = _prepared
          ? Future<void>.value()
          : widget.prepare?.call() ?? Future<void>.value();
      final ledgerRead = widget.checkout.partialPayments(
        merchantId: cart.merchantId,
        cartId: cart.id,
        locationId: cart.locationId,
        operatorSessionId: operatorSessionId,
      );
      // Attach an error listener to both reads immediately. Letting the ledger
      // future reject while the policy request is still pending produced an
      // unhandled 404 even though the method awaited that future a few hundred
      // milliseconds later.
      final values = await Future.wait<Object?>([prepare, ledgerRead]);
      _prepared = true;
      if (!mounted) return;
      if (widget.checkout.state.phase == CheckoutPhase.completed) {
        Navigator.of(context).pop();
        return;
      }
      if (finalizationUnknown) {
        await widget.checkout.recover(
          merchantId: cart.merchantId,
          locationId: cart.locationId,
          operatorSessionId: operatorSessionId,
          cartId: cart.id,
          cartVersion: cart.version,
        );
        if (!mounted) return;
        if (widget.checkout.state.phase == CheckoutPhase.completed) {
          Navigator.of(context).pop();
          return;
        }
        if (widget.checkout.state.phase != CheckoutPhase.paymentUnknown) {
          finalizationUnknown = false;
        }
      }
      final next = Map<String, Object?>.from(values[1]! as Map);
      if (!mounted) return;
      final drafts = (next['tenderDrafts'] as List? ?? const [])
          .whereType<Map>();
      final pendingTender = pendingCommand?['tender'] as Map<String, Object?>?;
      final recorded = drafts.any(
        (draft) => draft['id'] == pendingTender?['id'],
      );
      final resolvedFailure =
          pendingTender?['status'] == 'operator_reported_failure' &&
          next['blockedByUnknown'] == false;
      setState(() {
        ledger = next;
        _ledgerVerified = true;
        if (next['tenderDrafts'] is List &&
            (next['tenderDrafts'] as List).isNotEmpty &&
            widget.checkout.policy?.mixedTenderEnabled == false) {
          method =
              ((next['tenderDrafts'] as List).first as Map)['type'] as String;
        }
        if (recorded || resolvedFailure) {
          pendingCommand = null;
          uncertain = false;
          retryReady = false;
          _seedRemaining(next);
        } else if (uncertain) {
          // The GET is authoritative. The same command can be retried, with
          // the same key and tender id, without creating a second payment.
          retryReady = true;
        } else if (principal.text.isEmpty || _amountsAreUntouched) {
          _seedRemaining(next);
        }
      });
    } on AppException catch (failure) {
      if (!mounted) return;
      if (failure.code == 'RESOURCE_NOT_FOUND') {
        setState(() {
          ledger = null;
          _ledgerVerified = false;
          pendingCommand = null;
          retryReady = false;
          error = label(
            'Esta cuenta ya se cerró o se guardó desde otra pantalla. Vuelve a Cuentas para abrirla de nuevo.',
            'This account was already closed or saved from another screen. Return to Accounts to open it again.',
          );
        });
      } else {
        setState(() => error = _errorMessage(failure));
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => error = label(
            'No pudimos consultar los pagos. Intenta actualizar.',
            'We could not load the payments. Refresh to try again.',
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          busy = false;
          _ledgerLoading = false;
        });
      }
    }
  }

  Future<String?> _confirmExternal() async {
    final reference = TextEditingController();
    final policy = widget.checkout.policy;
    final details = policy?.bankTransferDetails;
    final result = await showPosDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, update) => PosAlertDialog(
          title: Text(
            method == 'bank_transfer'
                ? label('Confirmar transferencia', 'Confirm bank transfer')
                : label(
                    'Confirmar terminal externa',
                    'Confirm external terminal',
                  ),
          ),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label(
                    'Confirma en el banco o la terminal que se cobró ${money(charge)}.',
                    'Confirm at the bank or terminal that ${money(charge)} was paid.',
                  ),
                ),
                if (method == 'bank_transfer' && details != null) ...[
                  const SizedBox(height: UmiSpacing.md),
                  Text(
                    '${details['bankName'] ?? ''} · ${details['holderName'] ?? ''}',
                  ),
                  if (details['clabe'] != null)
                    Text('CLABE ${details['clabe']}'),
                  if (details['accountNumber'] != null)
                    Text('${details['accountNumber']}'),
                ],
                const SizedBox(height: UmiSpacing.md),
                PosField(
                  controller: reference,
                  decoration: PosFieldDecoration(
                    labelText: label(
                      'Folio del comprobante',
                      'Receipt reference',
                    ),
                  ),
                  onChanged: (_) => update(() {}),
                ),
              ],
            ),
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(label('Cancelar', 'Cancel')),
            ),
            PosButton(
              onPressed: reference.text.trim().isEmpty
                  ? null
                  : () =>
                        Navigator.of(dialogContext).pop(reference.text.trim()),
              child: Text(label('Sí, se cobró', 'Yes, paid')),
            ),
          ],
        ),
      ),
    );
    reference.dispose();
    return result;
  }

  Future<void> _resolveUnknown(bool paid) async {
    final unknown = unresolvedTender;
    if (busy || unknown == null) return;
    final reference = TextEditingController();
    final evidence = await showPosDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, update) => PosAlertDialog(
          title: Text(
            paid
                ? label('Confirmar pago', 'Confirm payment')
                : label('Confirmar rechazo', 'Confirm failure'),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                paid
                    ? label(
                        'Confirma que el comprobante muestra el cobro de ${money(amount(unknown['amount']))}.',
                        'Confirm the receipt shows the ${money(amount(unknown['amount']))} charge.',
                      )
                    : label(
                        'Confirma que la terminal o el banco rechazó el cargo. El saldo seguirá pendiente.',
                        'Confirm the terminal or bank declined the charge. The balance will remain due.',
                      ),
              ),
              const SizedBox(height: UmiSpacing.md),
              PosField(
                controller: reference,
                decoration: PosFieldDecoration(
                  labelText: label(
                    'Referencia o evidencia',
                    'Reference or evidence',
                  ),
                ),
                onChanged: (_) => update(() {}),
              ),
            ],
          ),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: Text(label('Volver', 'Back')),
            ),
            PosButton(
              key: const ValueKey('partial-unknown-confirm'),
              onPressed: reference.text.trim().isEmpty
                  ? null
                  : () =>
                        Navigator.of(dialogContext).pop(reference.text.trim()),
              child: Text(
                paid
                    ? label('Sí se cobró', 'It was paid')
                    : label('No se cobró', 'It was not paid'),
              ),
            ),
          ],
        ),
      ),
    );
    reference.dispose();
    if (evidence == null || !mounted) return;
    pendingCommand = {
      'locationId': cart.locationId,
      'operatorSessionId': operatorSessionId,
      'expectedCartVersion': ledger?['cartVersion'] ?? cart.version,
      'cashShiftId': widget.cashShiftId,
      'approvalIds': <String>[],
      'idempotencyKey': _newId(),
      'tender': {
        ...unknown,
        'status': paid ? 'confirmed_success' : 'operator_reported_failure',
      },
      'confirmationReference': evidence,
    };
    await _postPending();
  }

  Future<void> _collect() async {
    if (!canCollect || !mounted) return;
    String? reference;
    if (method != 'cash') {
      reference = await _confirmExternal();
      if (reference == null || !mounted) return;
    }
    final tender = <String, Object?>{
      'id': _newId(),
      'type': method,
      'amount': {'minorUnits': charge, 'currency': currency},
      'amountReceived': method == 'cash'
          ? {'minorUnits': receivedMinor, 'currency': currency}
          : null,
      'status': method == 'cash' ? 'draft' : 'confirmed_success',
      'correlationId': null,
      if ((tipMinor ?? 0) > 0)
        'tipAmount': {'minorUnits': tipMinor, 'currency': currency},
    };
    final command = <String, Object?>{
      'locationId': cart.locationId,
      'operatorSessionId': operatorSessionId,
      'expectedCartVersion': ledger?['cartVersion'] ?? cart.version,
      'cashShiftId': widget.cashShiftId,
      'approvalIds': <String>[],
      'idempotencyKey': _newId(),
      'tender': tender,
      'confirmationReference': ?reference,
    };
    pendingCommand = command;
    await _postPending();
  }

  Future<void> _postPending() async {
    final command = pendingCommand;
    if (busy || command == null) return;
    setState(() {
      busy = true;
      error = null;
      retryReady = false;
    });
    try {
      final next = await widget.checkout.collectPartialPayment(
        merchantId: cart.merchantId,
        cartId: cart.id,
        command: command,
      );
      if (!mounted) return;
      setState(() {
        ledger = next;
        if (widget.checkout.policy?.mixedTenderEnabled == false) {
          method = tenderDrafts.first['type'] as String;
        }
        pendingCommand = null;
        uncertain = false;
        _seedRemaining(next);
      });
    } on AppException catch (failure) {
      if (mounted) {
        setState(() {
          // A transport or server failure may hide a successful write. A typed
          // business refusal is final and can be corrected without retrying it.
          uncertain =
              failure.category == AppErrorCategory.transport ||
              failure.category == AppErrorCategory.timeout ||
              failure.category == AppErrorCategory.server;
          if (!uncertain) pendingCommand = null;
          error = _errorMessage(failure);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          uncertain = true;
          error = label(
            'No llegó la respuesta del pago. Consulta el estado antes de continuar.',
            'The payment response did not arrive. Check its status first.',
          );
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> _finalize() async {
    if (busy || !canFinalize) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await widget.checkout.preview(
        merchantId: cart.merchantId,
        locationId: cart.locationId,
        operatorSessionId: operatorSessionId,
        cartId: cart.id,
        cartVersion: (ledger?['cartVersion'] as num?)?.toInt() ?? cart.version,
        paymentMethod: 'cash',
        partialLedgerFinalization: true,
        cashShiftId: widget.cashShiftId,
        cart: cart,
        tenderDrafts: tenderDrafts,
      );
      if (!mounted) return;
      if (widget.checkout.state.phase == CheckoutPhase.confirmationRequired) {
        await widget.checkout.confirm();
      }
      if (!mounted) return;
      if (widget.checkout.state.phase == CheckoutPhase.completed) {
        Navigator.of(context).pop();
      } else {
        setState(() {
          finalizationUnknown = true;
          error = label(
            'No se confirmó el cierre. Consulta el estado antes de volver a cerrar la cuenta.',
            'The close was not confirmed. Check its status before closing the account again.',
          );
        });
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final blocked = hasUnknown || uncertain || finalizationUnknown;
    return PosPage(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(UmiSpacing.lg),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          label('Cobro dividido', 'Split payment'),
                          style: theme.textTheme.headlineSmall,
                        ),
                      ),
                      PosTextButton(
                        onPressed: busy ? null : _refresh,
                        child: Text(label('Actualizar', 'Refresh')),
                      ),
                      PosIconButton(
                        tooltip: label('Cerrar', 'Close'),
                        onPressed: busy
                            ? null
                            : () => Navigator.of(context).pop(),
                        icon: const PosIcon(PosGlyphs.close),
                      ),
                    ],
                  ),
                  Text(
                    [cart.accountFolio, tableLabel]
                        .whereType<String>()
                        .where((value) => value.isNotEmpty)
                        .join(' · '),
                    key: const ValueKey('partial-account-context'),
                    style: theme.textTheme.titleMedium,
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(
                  UmiSpacing.lg,
                  0,
                  UmiSpacing.lg,
                  UmiSpacing.xl,
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 900),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (ledger == null && busy)
                          const Center(child: PosSpinner()),
                        if (error != null) ...[
                          _notice(error!),
                          const SizedBox(height: UmiSpacing.md),
                        ],
                        if (ledger != null) ...[
                          Wrap(
                            spacing: UmiSpacing.md,
                            runSpacing: UmiSpacing.md,
                            children: [
                              _BalanceTile(
                                label: label('Total consumo', 'Order total'),
                                value: money(due),
                              ),
                              _BalanceTile(
                                label: label('Pagado', 'Paid'),
                                value: money(paid),
                              ),
                              _BalanceTile(
                                label: label(
                                  'Consumo de esta persona',
                                  'This portion',
                                ),
                                value: money(principalMinor ?? 0),
                              ),
                              _BalanceTile(
                                label: label('Propina de este pago', 'Tip'),
                                value: money(tipMinor ?? 0),
                              ),
                              _BalanceTile(
                                label: label('Cobrar ahora', 'Charge now'),
                                value: money(charge),
                              ),
                              _BalanceTile(
                                label: label('Falta', 'Remaining'),
                                value: money(remaining),
                                emphasized: true,
                              ),
                            ],
                          ),
                          if (tipsPaid > 0)
                            Text(
                              '${label('Propinas cobradas', 'Tips collected')}: ${money(tipsPaid)}',
                            ),
                          const SizedBox(height: UmiSpacing.lg),
                          if (tenderDrafts.isNotEmpty) _history(theme),
                          if (blocked) ...[
                            const SizedBox(height: UmiSpacing.md),
                            _notice(
                              hasUnknown
                                  ? label(
                                      'Hay un pago sin confirmar. Consulta su estado antes de cobrar otra vez.',
                                      'A payment is unresolved. Check its status before charging again.',
                                    )
                                  : finalizationUnknown
                                  ? label(
                                      'El cierre no está confirmado. Actualiza para consultar la cuenta.',
                                      'The close is not confirmed. Refresh to check the account.',
                                    )
                                  : label(
                                      'No sabemos si el último pago se registró. Actualiza antes de repetirlo.',
                                      'The last payment may have been recorded. Refresh before retrying.',
                                    ),
                            ),
                            if (hasUnknown && unresolvedTender != null) ...[
                              const SizedBox(height: UmiSpacing.sm),
                              Wrap(
                                spacing: UmiSpacing.sm,
                                children: [
                                  PosButton.tonal(
                                    key: const ValueKey('partial-unknown-paid'),
                                    onPressed: busy
                                        ? null
                                        : () => _resolveUnknown(true),
                                    child: Text(
                                      label('Sí se cobró', 'It was paid'),
                                    ),
                                  ),
                                  PosButton.tonal(
                                    key: const ValueKey(
                                      'partial-unknown-failed',
                                    ),
                                    onPressed: busy
                                        ? null
                                        : () => _resolveUnknown(false),
                                    child: Text(
                                      label('No se cobró', 'It was not paid'),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            if (uncertain && retryReady)
                              PosTextButton(
                                key: const ValueKey(
                                  'partial-retry-same-payment',
                                ),
                                onPressed: _postPending,
                                child: Text(
                                  label(
                                    'Reintentar el mismo pago',
                                    'Retry the same payment',
                                  ),
                                ),
                              ),
                          ],
                          if (!canFinalize && !blocked) ...[
                            const SizedBox(height: UmiSpacing.lg),
                            Text(
                              label(
                                'Cobrar a esta persona',
                                'Charge this guest',
                              ),
                              style: theme.textTheme.titleLarge,
                            ),
                            const SizedBox(height: UmiSpacing.sm),
                            Wrap(
                              spacing: UmiSpacing.sm,
                              children: [
                                for (final parts in [1, 2, 3, 4])
                                  PosTextButton(
                                    key: ValueKey('partial-equal-$parts'),
                                    onPressed: busy
                                        ? null
                                        : () => setState(() {
                                            final suggested =
                                                (remaining / parts).ceil();
                                            principal.text = (suggested / 100)
                                                .toStringAsFixed(2);
                                            if (method == 'cash') {
                                              cashReceived.text =
                                                  ((suggested +
                                                              (tipMinor ?? 0)) /
                                                          100)
                                                      .toStringAsFixed(2);
                                            }
                                          }),
                                    child: Text(
                                      parts == 1
                                          ? label('Todo', 'All')
                                          : label(
                                              'Entre $parts',
                                              'Split $parts ways',
                                            ),
                                    ),
                                  ),
                              ],
                            ),
                            PosField(
                              key: const ValueKey('partial-principal'),
                              controller: principal,
                              keyboardType:
                                  const TextInputType.numberWithOptions(
                                    decimal: true,
                                  ),
                              inputFormatters: cashAmountFormatters,
                              decoration: PosFieldDecoration(
                                labelText: label(
                                  'Consumo de esta persona',
                                  'This guest’s portion',
                                ),
                                errorText:
                                    principalMinor == null ||
                                        principalMinor! <= 0 ||
                                        principalMinor! > remaining
                                    ? label(
                                        'Escribe un importe entre cero y el saldo.',
                                        'Enter an amount up to the remaining balance.',
                                      )
                                    : null,
                              ),
                            ),
                            const SizedBox(height: UmiSpacing.md),
                            if (widget.checkout.policy?.tip['enabled'] ==
                                true) ...[
                              Text(
                                tipOwnerLabel,
                                key: const ValueKey('partial-tip-owner'),
                                style: theme.textTheme.titleMedium,
                              ),
                              const SizedBox(height: UmiSpacing.xs),
                              Text(
                                '${label('Base sugerida', 'Suggested base')} · '
                                '${money(tipBaseMinor)} '
                                '${label('antes de impuestos', 'before tax')}',
                                key: const ValueKey('partial-tip-base'),
                              ),
                              const SizedBox(height: UmiSpacing.sm),
                              Wrap(
                                spacing: UmiSpacing.sm,
                                runSpacing: UmiSpacing.sm,
                                children: [
                                  PosButton.tonal(
                                    key: const ValueKey('partial-tip-zero'),
                                    selected: _selectedTipBasisPoints == 0,
                                    onPressed: busy
                                        ? null
                                        : () => _setTipForBasisPoints(0),
                                    child: Text(label('Sin propina', 'No tip')),
                                  ),
                                  for (final raw
                                      in widget
                                                  .checkout
                                                  .policy
                                                  ?.tip['presetBasisPoints']
                                              as List? ??
                                          const [])
                                    if (raw is num && raw.toInt() > 0)
                                      PosButton.tonal(
                                        key: ValueKey(
                                          'partial-tip-bp-${raw.toInt()}',
                                        ),
                                        selected:
                                            _selectedTipBasisPoints ==
                                            raw.toInt(),
                                        onPressed: busy
                                            ? null
                                            : () => _setTipForBasisPoints(
                                                raw.toInt(),
                                              ),
                                        child: Text(
                                          '${_percentageLabel(raw.toInt())} · '
                                          '${money(tipForBasisPoints(raw.toInt()))}',
                                        ),
                                      ),
                                ],
                              ),
                              const SizedBox(height: UmiSpacing.sm),
                              PosField(
                                key: const ValueKey('partial-tip'),
                                controller: tip,
                                readOnly:
                                    widget
                                        .checkout
                                        .policy
                                        ?.tip['customFixedEnabled'] !=
                                    true,
                                keyboardType:
                                    const TextInputType.numberWithOptions(
                                      decimal: true,
                                    ),
                                inputFormatters: cashAmountFormatters,
                                decoration: PosFieldDecoration(
                                  labelText: label(
                                    'Propina de este pago',
                                    'Tip for this payment',
                                  ),
                                  helperText:
                                      widget
                                              .checkout
                                              .policy
                                              ?.tip['customFixedEnabled'] ==
                                          true
                                      ? null
                                      : label(
                                          'Selecciona una opción de propina.',
                                          'Choose a tip option.',
                                        ),
                                ),
                              ),
                            ],
                            const SizedBox(height: UmiSpacing.md),
                            Text(
                              label('Método de pago', 'Payment method'),
                              style: theme.textTheme.titleMedium,
                            ),
                            if (lockedMethod != null)
                              Text(
                                label(
                                  'Esta cuenta continúa con el mismo método. El local no permite combinar métodos.',
                                  'This account keeps the same method. This location does not allow mixed methods.',
                                ),
                              ),
                            const SizedBox(height: UmiSpacing.sm),
                            Wrap(
                              spacing: UmiSpacing.sm,
                              runSpacing: UmiSpacing.sm,
                              children: [
                                if (widget.cashShiftId != null &&
                                    (lockedMethod == null ||
                                        lockedMethod == 'cash'))
                                  _methodButton(
                                    'cash',
                                    label('Efectivo', 'Cash'),
                                  ),
                                if (manualAllowed &&
                                    (lockedMethod == null ||
                                        lockedMethod == 'manual_terminal'))
                                  _methodButton(
                                    'manual_terminal',
                                    label(
                                      'Terminal externa',
                                      'External terminal',
                                    ),
                                  ),
                                if (bankAllowed &&
                                    (lockedMethod == null ||
                                        lockedMethod == 'bank_transfer'))
                                  _methodButton(
                                    'bank_transfer',
                                    label('Transferencia', 'Bank transfer'),
                                  ),
                              ],
                            ),
                            if (method == 'bank_transfer')
                              PosTextButton(
                                key: const ValueKey(
                                  'partial-bank-view-details',
                                ),
                                onPressed:
                                    (busy && !_ledgerLoading) ||
                                        pendingCommand != null
                                    ? null
                                    : () => widget.onShowBankTransferDetails(
                                        charge,
                                        true,
                                      ),
                                child: Text(
                                  label(
                                    'Ver datos bancarios',
                                    'View bank details',
                                  ),
                                ),
                              ),
                            if (!methodAvailable)
                              _notice(
                                label(
                                  'Abre un turno de caja o habilita un método de pago para dividir esta cuenta.',
                                  'Open a cash shift or enable a payment method to split this account.',
                                ),
                              ),
                            const SizedBox(height: UmiSpacing.md),
                            Text(
                              '${label('Consumo', 'Portion')} ${money(principalMinor ?? 0)} + '
                              '${label('propina', 'tip')} ${money(tipMinor ?? 0)} = '
                              '${label('cargo', 'charge')} ${money(charge)}',
                              key: const ValueKey('partial-exact-charge'),
                              style: theme.textTheme.titleMedium,
                            ),
                          ],
                        ],
                      ],
                    ),
                  ),
                ),
              ),
            ),
            if (ledger != null)
              Padding(
                padding: const EdgeInsets.all(UmiSpacing.lg),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1400),
                  child: _checkoutBar(),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _checkoutBar() {
    final action = PosButton(
      key: ValueKey(canFinalize ? 'partial-finalize' : 'partial-charge'),
      onPressed: canFinalize && !busy && !finalizationUnknown
          ? _finalize
          : canCollect
          ? _collect
          : null,
      child: Text(
        canFinalize
            ? label('Cerrar cuenta', 'Close account')
            : '${label('Cobrar', 'Charge')} ${money(charge)}',
      ),
    );
    final blockedHere = hasUnknown || uncertain || finalizationUnknown;
    if (canFinalize || blockedHere || method != 'cash') return action;

    final received = receivedMinor;
    final difference = received == null ? null : received - charge;
    final cash = PosField(
      key: const ValueKey('partial-cash-received'),
      controller: cashReceived,
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      inputFormatters: cashAmountFormatters,
      decoration: PosFieldDecoration(
        labelText: label('Efectivo recibido', 'Cash received'),
      ),
      onChanged: (_) => cashReceivedEdited = true,
    );
    final change = Column(
      key: const ValueKey('partial-cash-change'),
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          difference != null && difference < 0
              ? label('Falta', 'Amount due')
              : label('Cambio', 'Change'),
          style: PosTheme.of(context).textTheme.bodySmall?.copyWith(
            color: PosTheme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          difference == null ? '—' : money(difference.abs()),
          style: PosTheme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
        ),
      ],
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 760) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              cash,
              const SizedBox(height: UmiSpacing.sm),
              change,
              const SizedBox(height: UmiSpacing.sm),
              action,
            ],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            SizedBox(width: 280, child: cash),
            const SizedBox(width: UmiSpacing.lg),
            SizedBox(width: 180, child: change),
            const SizedBox(width: UmiSpacing.lg),
            Expanded(child: action),
          ],
        );
      },
    );
  }

  Widget _methodButton(String value, String title) => PosButton.tonal(
    key: ValueKey('partial-method-$value'),
    selected: method == value,
    onPressed: (busy && !_ledgerLoading) || pendingCommand != null
        ? null
        : () async {
            if (value == 'bank_transfer') {
              final accepted = await widget.onShowBankTransferDetails(
                charge,
                method == value,
              );
              if (accepted != true || !mounted) return;
            }
            setState(() {
              method = value;
              if (value == 'cash' && cashReceived.text.isEmpty) {
                cashReceived.text = (charge / 100).toStringAsFixed(2);
              }
            });
          },
    child: Text(title),
  );

  Widget _history(PosThemeData theme) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        label('Pagos registrados', 'Recorded payments'),
        style: theme.textTheme.titleMedium,
      ),
      const SizedBox(height: UmiSpacing.sm),
      for (var index = 0; index < tenderDrafts.length; index++)
        Padding(
          padding: const EdgeInsets.only(bottom: UmiSpacing.xs),
          child: Text(
            '${index + 1}. ${_methodName(tenderDrafts[index]['type'] as String?)} · '
            '${money(amount(tenderDrafts[index]['amount']))}'
            '${amount(tenderDrafts[index]['tipAmount']) > 0 ? ' '
                      '(${label('incluye propina', 'includes tip')} '
                      '${money(amount(tenderDrafts[index]['tipAmount']))})' : ''}',
            key: ValueKey('partial-payment-$index'),
          ),
        ),
    ],
  );

  String _methodName(String? value) => switch (value) {
    'cash' => label('Efectivo', 'Cash'),
    'manual_terminal' => label('Terminal externa', 'External terminal'),
    'bank_transfer' => label('Transferencia', 'Bank transfer'),
    _ => label('Pago', 'Payment'),
  };

  Widget _notice(String message) => Container(
    padding: const EdgeInsets.all(UmiSpacing.md),
    decoration: BoxDecoration(
      color: PosTheme.of(context).colorScheme.errorContainer,
      borderRadius: BorderRadius.circular(UmiRadius.control),
    ),
    child: Text(message),
  );
}

final class _BalanceTile extends StatelessWidget {
  const _BalanceTile({
    required this.label,
    required this.value,
    this.emphasized = false,
  });
  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Container(
      constraints: const BoxConstraints(minWidth: 180),
      padding: const EdgeInsets.all(UmiSpacing.md),
      decoration: BoxDecoration(
        color: emphasized
            ? theme.colorScheme.primaryContainer
            : theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(UmiRadius.control),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: theme.textTheme.labelMedium),
          Text(value, style: theme.textTheme.headlineSmall),
        ],
      ),
    );
  }
}

String _newId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
