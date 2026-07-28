import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/observability/telemetry.dart';
import 'checkout_repository.dart';

enum CheckoutPhase {
  idle,
  repricing,
  confirmationRequired,
  processing,
  paymentUnknown,
  completed,
  failure,
}

final class CheckoutState {
  const CheckoutState({
    this.phase = CheckoutPhase.idle,
    this.result,
    this.errorCode,
  });
  final CheckoutPhase phase;
  final CheckoutResult? result;
  final String? errorCode;
}

final class CheckoutController extends ChangeNotifier {
  CheckoutController({
    required CheckoutRepository repository,
    required Telemetry telemetry,
  }) : _repository = repository,
       _telemetry = telemetry;

  final CheckoutRepository _repository;
  final Telemetry _telemetry;
  CheckoutState _state = const CheckoutState();
  CheckoutState get state => _state;
  String? _tenantId;
  String? _branchId;
  String? _operatorSessionId;
  String? _cartId;
  int? _cartVersion;
  String _paymentMethod = 'cash';

  Future<void> preview({
    required String tenantId,
    required String branchId,
    required String operatorSessionId,
    required String cartId,
    required int cartVersion,
    required String paymentMethod,
  }) async {
    _tenantId = tenantId;
    _branchId = branchId;
    _operatorSessionId = operatorSessionId;
    _cartId = cartId;
    _cartVersion = cartVersion;
    _paymentMethod = paymentMethod;
    _set(const CheckoutState(phase: CheckoutPhase.repricing));
    _event('checkout_opened');
    await _submit(null);
  }

  Future<void> confirm() async {
    final fingerprint = _state.result?.confirmation['fingerprint'] as String?;
    if (fingerprint == null) return;
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
