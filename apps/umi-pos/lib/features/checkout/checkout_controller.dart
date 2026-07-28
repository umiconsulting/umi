import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_checkout_service.dart';
import '../offline/offline_journal.dart';
import '../offline/offline_policy.dart';
import 'checkout_repository.dart';

enum CheckoutPhase {
  idle,
  repricing,
  confirmationRequired,
  processing,
  paymentUnknown,
  completed,
  provisional,
  failure,
}

final class CheckoutState {
  const CheckoutState({
    this.phase = CheckoutPhase.idle,
    this.result,
    this.errorCode,
    this.provisionalReceipt,
  });
  final CheckoutPhase phase;
  final CheckoutResult? result;
  final String? errorCode;
  final ProvisionalReceipt? provisionalReceipt;
}

final class CheckoutController extends ChangeNotifier {
  CheckoutController({
    required CheckoutRepository repository,
    OfflineCheckoutService? offlineCheckout,
    ConnectivityController? connectivity,
    required Telemetry telemetry,
  }) : _repository = repository,
       _offlineCheckout = offlineCheckout,
       _connectivity = connectivity,
       _telemetry = telemetry;

  final CheckoutRepository _repository;
  final OfflineCheckoutService? _offlineCheckout;
  final ConnectivityController? _connectivity;
  final Telemetry _telemetry;
  CheckoutState _state = const CheckoutState();
  CheckoutState get state => _state;
  String? _tenantId;
  String? _branchId;
  String? _operatorSessionId;
  String? _cartId;
  int? _cartVersion;
  String _paymentMethod = 'cash';
  Cart? _cart;
  OfflineAuthorityContext? _authority;
  String _branchName = '';
  String _operatorName = '';
  int? _cashReceivedMinorUnits;
  final Map<String, CheckoutResult> _confirmationCache = {};

  Future<void> preview({
    required String tenantId,
    required String branchId,
    required String operatorSessionId,
    required String cartId,
    required int cartVersion,
    required String paymentMethod,
    Cart? cart,
    OfflineAuthorityContext? authority,
    String branchName = '',
    String operatorName = '',
    int? cashReceivedMinorUnits,
  }) async {
    _tenantId = tenantId;
    _branchId = branchId;
    _operatorSessionId = operatorSessionId;
    _cartId = cartId;
    _cartVersion = cartVersion;
    _paymentMethod = paymentMethod;
    _cart = cart;
    _authority = authority;
    _branchName = branchName;
    _operatorName = operatorName;
    _cashReceivedMinorUnits = cashReceivedMinorUnits;
    _set(const CheckoutState(phase: CheckoutPhase.repricing));
    _event('checkout_opened');
    if ((_connectivity?.state ?? PosConnectivity.online) !=
        PosConnectivity.online) {
      if (cart == null || authority == null) {
        _set(
          const CheckoutState(
            phase: CheckoutPhase.failure,
            errorCode: 'OFFLINE_CONTEXT_UNAVAILABLE',
          ),
        );
        return;
      }
      final cached = _confirmationCache['${cart.id}:${cart.version}'];
      if (cached == null) {
        _set(
          const CheckoutState(
            phase: CheckoutPhase.failure,
            errorCode: 'OFFLINE_SNAPSHOT_REFRESH_REQUIRED',
          ),
        );
        return;
      }
      _set(
        CheckoutState(
          phase: CheckoutPhase.confirmationRequired,
          result: cached,
        ),
      );
      return;
    }
    await _submit(null);
  }

  Future<void> confirm() async {
    final fingerprint = _state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
    if ((_connectivity?.state ?? PosConnectivity.online) !=
        PosConnectivity.online) {
      await _submitOffline(fingerprint);
      return;
    }
    _set(CheckoutState(phase: CheckoutPhase.processing, result: _state.result));
    _event('checkout_confirmed');
    _event('payment_started');
    await _submit(fingerprint);
  }

  Future<void> queryUnknownPayment() async {
    final payment = _state.result?.payment;
    if (payment == null ||
        _tenantId == null ||
        _branchId == null ||
        _operatorSessionId == null) {
      return;
    }
    final attempt = PaymentAttempt.fromJson(
      payment['attempt']! as Map<String, Object?>,
    );
    try {
      final outcome = await _repository.paymentStatus(
        _tenantId!,
        attempt.id,
        PaymentStatusQuery(
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
        ),
      );
      if (outcome.attempt['status'] == 'unknown') {
        _event('payment_unknown');
        return;
      }
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: 'PAYMENT_STATUS_CHANGED',
        ),
      );
    } on AppException catch (error) {
      _failure(error);
    }
  }

  void reset() => _set(const CheckoutState());

  Future<void> _submit(String? fingerprint) async {
    if (_tenantId == null ||
        _branchId == null ||
        _operatorSessionId == null ||
        _cartId == null ||
        _cartVersion == null) {
      return;
    }
    try {
      final result = await _repository.checkout(
        _tenantId!,
        CheckoutCommand(
          cartId: _cartId!,
          branchId: _branchId!,
          operatorSessionId: _operatorSessionId!,
          expectedCartVersion: _cartVersion!,
          paymentMethod: _paymentMethod,
          totalsFingerprint: fingerprint,
          idempotencyKey: _uuid(),
        ),
      );
      final phase = switch (result.status) {
        'confirmation_required' => CheckoutPhase.confirmationRequired,
        'payment_unknown' => CheckoutPhase.paymentUnknown,
        'completed' => CheckoutPhase.completed,
        _ => CheckoutPhase.processing,
      };
      _set(CheckoutState(phase: phase, result: result));
      if (phase == CheckoutPhase.confirmationRequired && _cart != null) {
        _confirmationCache['${_cart!.id}:${_cart!.version}'] = result;
      }
      if (phase == CheckoutPhase.completed) {
        _event('payment_completed');
        _event('receipt_created');
      } else if (phase == CheckoutPhase.paymentUnknown) {
        _event('payment_unknown');
      }
    } on AppException catch (error) {
      _failure(error);
    }
  }

  Future<void> _submitOffline(String fingerprint) async {
    final offlineCheckout = _offlineCheckout;
    final cart = _cart;
    final authority = _authority;
    final raw = _state.result?.confirmation;
    if (offlineCheckout == null ||
        cart == null ||
        authority == null ||
        raw == null) {
      return;
    }
    final totals = TotalsConfirmation.fromJson(raw);
    final grandTotal = totals.totals['grandTotal']! as Map<String, Object?>;
    final amount = (grandTotal['minorUnits']! as num).toInt();
    final snapshotAt = DateTime.parse(
      totals.confirmedAt ?? cart.updatedAt,
    ).toUtc();
    _set(CheckoutState(phase: CheckoutPhase.processing, result: _state.result));
    try {
      final commandId = _uuid();
      final receipt = await offlineCheckout.checkout(
        OfflineCheckoutRequest(
          commandId: commandId,
          idempotencyKey: _uuid(),
          provisionalSaleId: 'prov-$commandId',
          authority: authority,
          checkoutCommand: CheckoutCommand(
            cartId: cart.id,
            branchId: cart.branchId,
            operatorSessionId: cart.operatorSessionId,
            expectedCartVersion: cart.version,
            paymentMethod: 'cash',
            totalsFingerprint: fingerprint,
            idempotencyKey: _uuid(),
          ),
          cart: cart,
          totals: totals,
          catalogVersion: totals.catalogVersion,
          pricingVersion: totals.pricingVersion,
          taxVersion: totals.taxVersion,
          catalogSnapshotAt: snapshotAt,
          pricingSnapshotAt: snapshotAt,
          taxSnapshotAt: snapshotAt,
          amountReceivedMinorUnits: _cashReceivedMinorUnits ?? amount,
          businessDate: TotalsPreview.fromJson(totals.totals).businessDate,
          branchName: _branchName,
          operatorName: _operatorName,
        ),
        facts: OfflineCheckoutFacts(
          amountMinorUnits: amount,
          catalogSnapshotAt: snapshotAt,
          pricingSnapshotAt: snapshotAt,
          taxSnapshotAt: snapshotAt,
          connectivity: _connectivity?.state ?? PosConnectivity.unknown,
          paymentMethod: _paymentMethod,
        ),
        now: DateTime.now().toUtc(),
      );
      _set(
        CheckoutState(
          phase: CheckoutPhase.provisional,
          result: _state.result,
          provisionalReceipt: receipt,
        ),
      );
      _event('offline_checkout_journaled');
    } on OfflineJournalException catch (error) {
      _set(
        CheckoutState(
          phase: CheckoutPhase.failure,
          result: _state.result,
          errorCode: error.category,
        ),
      );
    }
  }

  void _failure(AppException error) {
    _event('checkout_failed');
    _set(
      CheckoutState(
        phase: CheckoutPhase.failure,
        result: _state.result,
        errorCode: error.code,
      ),
    );
  }

  void _event(String name) =>
      _telemetry.event(ClientEvent(name: name, values: const {}));
  void _set(CheckoutState value) {
    _state = value;
    notifyListeners();
  }

  String _uuid() {
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
}
