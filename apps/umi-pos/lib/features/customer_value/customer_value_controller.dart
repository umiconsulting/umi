import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import 'customer_value_repository.dart';

final class CustomerValueScope {
  const CustomerValueScope({
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
  });
  final String merchantId;
  final String locationId;
  final String operatorSessionId;
}

final class CustomerValueState {
  const CustomerValueState({
    this.busy = false,
    this.customers = const [],
    this.selected,
    this.history,
    this.preview,
    this.giftCard,
    this.rewardAuthorization,
    this.storedValueAuthorizations = const [],
    this.ambiguous = false,
    this.errorCode,
  });
  final bool busy;
  final List<CustomerProfile> customers;
  final CustomerProfile? selected;
  final CustomerHistoryPage? history;
  final CustomerValuePreview? preview;
  final GiftCard? giftCard;
  final RewardAuthorization? rewardAuthorization;
  final List<StoredValueAuthorization> storedValueAuthorizations;
  final bool ambiguous;
  final String? errorCode;
}

final class CustomerValueController extends ChangeNotifier {
  CustomerValueController(this._repository);
  final CustomerValueRepository _repository;
  CustomerValueState _state = const CustomerValueState();
  CustomerValueState get state => _state;

  Future<void> search(
    CustomerValueScope scope,
    String query, {
    bool recent = false,
  }) async {
    _set(
      CustomerValueState(
        busy: true,
        customers: _state.customers,
        selected: _state.selected,
      ),
    );
    try {
      final result = await _repository.search(
        scope.merchantId,
        CustomerSearchRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          query: query.trim(),
          recent: recent,
          limit: 20,
        ),
      );
      _set(
        CustomerValueState(
          customers: result.customers.map(CustomerProfile.fromJson).toList(),
          ambiguous: result.ambiguous,
          selected: _state.selected,
        ),
      );
    } on AppException catch (error) {
      _set(
        CustomerValueState(
          customers: _state.customers,
          selected: _state.selected,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<CustomerProfile?> create(
    CustomerValueScope scope, {
    required String displayName,
    String? email,
    String? phone,
    required String language,
  }) async {
    final name = displayName.trim();
    if (name.isEmpty) return null;
    _set(CustomerValueState(busy: true, customers: _state.customers));
    try {
      final contacts = <Map<String, Object?>>[
        if (email?.trim().isNotEmpty ?? false)
          {'type': 'email', 'value': email!.trim(), 'primary': true},
        if (phone?.trim().isNotEmpty ?? false)
          {
            'type': 'phone',
            'value': phone!.trim(),
            'primary': email?.trim().isEmpty ?? true,
          },
      ];
      final commandId = _uuid();
      final customer = await _repository.create(
        scope.merchantId,
        CreateCustomerRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          commandId: commandId,
          idempotencyKey: commandId,
          displayName: name,
          preferredLanguage: language,
          contacts: contacts,
          consents: const [],
        ),
      );
      _set(
        CustomerValueState(
          customers: [customer, ..._state.customers],
          selected: customer,
        ),
      );
      return customer;
    } on AppException catch (error) {
      _set(
        CustomerValueState(customers: _state.customers, errorCode: error.code),
      );
      return null;
    }
  }

  Future<void> select(
    CustomerValueScope scope,
    CustomerProfile customer,
  ) async {
    _set(
      CustomerValueState(
        busy: true,
        customers: _state.customers,
        selected: customer,
      ),
    );
    try {
      final history = await _repository.history(
        scope.merchantId,
        customer.id,
        CustomerSearchRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          query: '',
          limit: 20,
          recent: false,
        ),
      );
      _set(
        CustomerValueState(
          customers: _state.customers,
          selected: customer,
          history: history,
        ),
      );
    } on AppException catch (error) {
      _set(
        CustomerValueState(
          customers: _state.customers,
          selected: customer,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<void> loadPreview(
    CustomerValueScope scope, {
    required String saleId,
    required int saleVersion,
    required String customerId,
    required String checkoutFingerprint,
  }) async {
    try {
      final preview = await _repository.preview(
        scope.merchantId,
        CustomerValuePreviewRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          saleId: saleId,
          checkoutVersion: saleVersion,
          customerId: customerId,
          checkoutFingerprint: checkoutFingerprint,
        ),
      );
      _set(
        CustomerValueState(
          customers: _state.customers,
          selected: _state.selected,
          history: _state.history,
          preview: preview,
        ),
      );
    } on AppException catch (error) {
      _set(
        CustomerValueState(
          customers: _state.customers,
          selected: _state.selected,
          history: _state.history,
          errorCode: error.code,
        ),
      );
    }
  }

  Future<RewardAuthorization?> authorizeReward(
    CustomerValueScope scope, {
    required String saleId,
    required int saleVersion,
    required String customerId,
    required String rewardId,
  }) async {
    final preview = _state.preview;
    if (preview == null) return null;
    final commandId = _uuid();
    try {
      final value = await _repository.authorizeReward(
        scope.merchantId,
        RewardAuthorizationRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          commandId: commandId,
          idempotencyKey: commandId,
          saleId: saleId,
          checkoutVersion: saleVersion,
          customerId: customerId,
          rewardId: rewardId,
          previewFingerprint: preview.fingerprint,
        ),
      );
      _set(_copyState(rewardAuthorization: value, errorCode: null));
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<StoredValueAuthorization?> authorizeStoredValue(
    CustomerValueScope scope, {
    required String accountType,
    required String accountId,
    required String? customerId,
    required String saleId,
    required int saleVersion,
    required int amountMinorUnits,
    required String currency,
  }) async {
    final preview = _state.preview;
    if (preview == null || amountMinorUnits <= 0) return null;
    final commandId = _uuid();
    try {
      final value = await _repository.authorizeStoredValue(
        scope.merchantId,
        StoredValueAuthorizationRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          commandId: commandId,
          idempotencyKey: commandId,
          accountType: accountType,
          accountId: accountId,
          customerId: customerId,
          saleId: saleId,
          checkoutVersion: saleVersion,
          amount: {'minorUnits': amountMinorUnits, 'currency': currency},
          checkoutFingerprint: preview.fingerprint,
        ),
      );
      _set(
        _copyState(
          storedValueAuthorizations: [
            ..._state.storedValueAuthorizations.where(
              (item) => item.accountType != accountType,
            ),
            value,
          ],
          errorCode: null,
        ),
      );
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<bool> releaseAuthorization(
    CustomerValueScope scope, {
    required String authorizationId,
    required String accountType,
    required String fingerprint,
  }) async {
    final commandId = _uuid();
    try {
      final command = ValueReleaseRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandId: commandId,
        idempotencyKey: commandId,
        authorizationId: authorizationId,
        accountType: accountType,
        fingerprint: fingerprint,
      );
      if (accountType == 'loyalty_reward') {
        await _repository.releaseReward(scope.merchantId, command);
        _set(_copyState(clearRewardAuthorization: true, errorCode: null));
      } else {
        await _repository.releaseStoredValue(scope.merchantId, command);
        _set(
          _copyState(
            storedValueAuthorizations: _state.storedValueAuthorizations
                .where((item) => item.id != authorizationId)
                .toList(),
            errorCode: null,
          ),
        );
      }
      return true;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return false;
    }
  }

  Future<GiftCard?> lookupGiftCard(
    CustomerValueScope scope,
    String code,
  ) async {
    try {
      final card = await _repository.giftCardLookup(
        scope.merchantId,
        GiftCardLookupRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          code: code.trim(),
        ),
      );
      _set(_copyState(giftCard: card, errorCode: null));
      return card;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  CustomerValueSelection? selection() {
    final preview = _state.preview;
    if (preview == null ||
        (_state.rewardAuthorization == null &&
            _state.storedValueAuthorizations.isEmpty)) {
      return null;
    }
    return CustomerValueSelection(
      previewFingerprint: preview.fingerprint,
      rewardAuthorizationId: _state.rewardAuthorization?.id,
      storedValueAuthorizationIds: _state.storedValueAuthorizations
          .map((item) => item.id)
          .toList(),
    );
  }

  void clear() => _set(const CustomerValueState());

  void deselect() => _set(CustomerValueState(customers: _state.customers));

  void _set(CustomerValueState value) {
    _state = value;
    notifyListeners();
  }

  CustomerValueState _copyState({
    GiftCard? giftCard,
    RewardAuthorization? rewardAuthorization,
    bool clearRewardAuthorization = false,
    List<StoredValueAuthorization>? storedValueAuthorizations,
    String? errorCode,
  }) => CustomerValueState(
    busy: false,
    customers: _state.customers,
    selected: _state.selected,
    history: _state.history,
    preview: _state.preview,
    giftCard: giftCard ?? _state.giftCard,
    rewardAuthorization: clearRewardAuthorization
        ? null
        : rewardAuthorization ?? _state.rewardAuthorization,
    storedValueAuthorizations:
        storedValueAuthorizations ?? _state.storedValueAuthorizations,
    ambiguous: _state.ambiguous,
    errorCode: errorCode,
  );

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final value = bytes
        .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${value.substring(0, 8)}-${value.substring(8, 12)}-${value.substring(12, 16)}-${value.substring(16, 20)}-${value.substring(20)}';
  }
}
