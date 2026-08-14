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
    this.pointsAdjustmentPreview,
    this.pendingPointsAdjustment,
    this.pointsAdjustmentResult,
    this.giftCardIssuance,
    this.giftCardIssuancePreview,
    this.pendingGiftCardIssuance,
    this.rewardAuthorization,
    this.rewardApprovalId,
    this.pendingRewardApprovalPermission,
    this.pendingRewardApprovalFingerprint,
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
  final PointsAdjustmentPreview? pointsAdjustmentPreview;
  final PointsAdjustmentRequest? pendingPointsAdjustment;
  final PointsAdjustmentResult? pointsAdjustmentResult;
  final GiftCardIssuanceResult? giftCardIssuance;
  final GiftCardIssuancePreview? giftCardIssuancePreview;
  final GiftCardIssuanceRequest? pendingGiftCardIssuance;
  final RewardAuthorization? rewardAuthorization;
  final String? rewardApprovalId;
  final String? pendingRewardApprovalPermission;
  final String? pendingRewardApprovalFingerprint;
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
    CustomerProfile customer, {
    String category = 'all',
  }) async {
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
        CustomerHistoryQuery(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          limit: 20,
          category: category,
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

  Future<void> loadMoreHistory(
    CustomerValueScope scope, {
    String category = 'all',
  }) async {
    final selected = _state.selected;
    final current = _state.history;
    if (selected == null || current?.nextCursor == null || _state.busy) return;
    _set(_copyState(busy: true));
    try {
      final page = await _repository.history(
        scope.merchantId,
        selected.id,
        CustomerHistoryQuery(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          cursor: current!.nextCursor,
          limit: 20,
          category: category,
        ),
      );
      _set(
        _copyState(
          history: CustomerHistoryPage(
            entries: [...current.entries, ...page.entries],
            nextCursor: page.nextCursor,
            loyaltyAccount: page.loyaltyAccount ?? current.loyaltyAccount,
            pointsBalance: page.pointsBalance ?? current.pointsBalance,
          ),
          busy: false,
        ),
      );
    } on AppException catch (error) {
      _set(_copyState(busy: false, errorCode: error.code));
    }
  }

  Future<void> loadPreview(
    CustomerValueScope scope, {
    required String saleId,
    required int saleVersion,
    required String? customerId,
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
    String? storedValueFingerprint,
    String? approvalId,
    String? approvalFingerprint,
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
          storedValueFingerprint: storedValueFingerprint,
          approvalId: approvalId,
          approvalFingerprint: approvalFingerprint,
        ),
      );
      _set(
        _copyState(
          rewardAuthorization: value,
          rewardApprovalId: approvalId,
          clearPendingRewardApproval: true,
          errorCode: null,
        ),
      );
      return value;
    } on AppException catch (error) {
      final permission = _firstField(error.fieldErrors, 'approvalPermission');
      final fingerprint = _firstField(error.fieldErrors, 'approvalFingerprint');
      _set(
        _copyState(
          pendingRewardApprovalPermission: permission,
          pendingRewardApprovalFingerprint: fingerprint,
          errorCode: error.code,
        ),
      );
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
    required String accountPublicReference,
  }) async {
    final preview = _state.preview;
    if (preview == null || amountMinorUnits <= 0) return null;
    final commandId = _uuid();
    final allocationId = _uuid();
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
          allocationId: allocationId,
          allocationOrder: _state.storedValueAuthorizations.length,
          accountPublicReference: accountPublicReference,
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
      final result = await _repository.giftCardLookup(
        scope.merchantId,
        GiftCardLookupRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          code: code.trim(),
        ),
      );
      final card = result.card == null ? null : GiftCard.fromJson(result.card!);
      _set(
        _copyState(
          giftCard: card,
          errorCode: result.found ? null : result.reasonCode,
        ),
      );
      return card;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<PointsAdjustmentPreview?> previewPointsAdjustment(
    CustomerValueScope scope, {
    required String direction,
    required int points,
    required String reason,
    String? note,
  }) async {
    final customer = _state.selected;
    final account =
        _state.history?.loyaltyAccount ??
        _state.preview?.summary['loyaltyAccount'] as Map<String, Object?>?;
    if (customer == null || account == null || points <= 0) return null;
    final commandId = _uuid();
    final command = PointsAdjustmentRequest(
      locationId: scope.locationId,
      operatorSessionId: scope.operatorSessionId,
      commandId: commandId,
      idempotencyKey: commandId,
      customerId: customer.id,
      accountId: account['id']! as String,
      direction: direction,
      points: points,
      reason: reason,
      note: note,
    );
    try {
      final value = await _repository.previewPointsAdjustment(
        scope.merchantId,
        command,
      );
      _set(
        _copyState(
          pointsAdjustmentPreview: value,
          pendingPointsAdjustment: command,
          errorCode: null,
        ),
      );
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<PointsAdjustmentResult?> commitPointsAdjustment(
    CustomerValueScope scope, {
    String? approvalId,
    String? approvalFingerprint,
  }) async {
    final pending = _state.pendingPointsAdjustment;
    if (pending == null) return null;
    final command = PointsAdjustmentRequest(
      locationId: pending.locationId,
      operatorSessionId: pending.operatorSessionId,
      commandId: pending.commandId,
      idempotencyKey: pending.idempotencyKey,
      customerId: pending.customerId,
      accountId: pending.accountId,
      direction: pending.direction,
      points: pending.points,
      reason: pending.reason,
      note: pending.note,
      approvalId: approvalId,
      approvalFingerprint: approvalFingerprint,
    );
    try {
      final value = await _repository.commitPointsAdjustment(
        scope.merchantId,
        command,
      );
      _set(_copyState(pointsAdjustmentResult: value, errorCode: null));
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<GiftCardIssuancePreview?> previewGiftCardIssuance(
    CustomerValueScope scope, {
    required int valueMinorUnits,
    required String currency,
    String source = 'promotion',
    String? saleId,
    String? saleLineId,
  }) async {
    if (valueMinorUnits <= 0) return null;
    final commandId = _uuid();
    try {
      final command = GiftCardIssuanceRequest(
        locationId: scope.locationId,
        operatorSessionId: scope.operatorSessionId,
        commandId: commandId,
        idempotencyKey: commandId,
        currency: currency,
        initialValueMinorUnits: valueMinorUnits,
        source: source,
        saleId: saleId,
        saleLineId: saleLineId,
        customerId: _state.selected?.id,
      );
      final value = await _repository.previewGiftCardIssuance(
        scope.merchantId,
        command,
      );
      _set(
        _copyState(
          giftCardIssuancePreview: value,
          pendingGiftCardIssuance: command,
          errorCode: null,
        ),
      );
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<GiftCardIssuanceResult?> issueGiftCard(
    CustomerValueScope scope, {
    String? approvalId,
    String? approvalFingerprint,
  }) async {
    final pending = _state.pendingGiftCardIssuance;
    if (pending == null) return null;
    final command = GiftCardIssuanceRequest(
      locationId: pending.locationId,
      operatorSessionId: pending.operatorSessionId,
      commandId: pending.commandId,
      idempotencyKey: pending.idempotencyKey,
      currency: pending.currency,
      initialValueMinorUnits: pending.initialValueMinorUnits,
      source: pending.source,
      saleId: pending.saleId,
      saleLineId: pending.saleLineId,
      customerId: pending.customerId,
      approvalId: approvalId,
      approvalFingerprint: approvalFingerprint,
    );
    try {
      final value = await _repository.issueGiftCard(scope.merchantId, command);
      _set(_copyState(giftCardIssuance: value, errorCode: null));
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  Future<GiftCardSecretRevealResult?> revealGiftCardSecret(
    CustomerValueScope scope,
    String deliveryToken,
  ) async {
    final commandId = _uuid();
    try {
      final value = await _repository.revealGiftCardSecret(
        scope.merchantId,
        GiftCardSecretRevealRequest(
          locationId: scope.locationId,
          operatorSessionId: scope.operatorSessionId,
          commandId: commandId,
          idempotencyKey: commandId,
          deliveryToken: deliveryToken,
        ),
      );
      _set(_copyState(errorCode: null));
      return value;
    } on AppException catch (error) {
      _set(_copyState(errorCode: error.code));
      return null;
    }
  }

  CustomerValueSelection? selection() {
    final preview = _state.preview;
    final fundingAssignment = _state.giftCardIssuance?.fundingAssignment;
    if (preview == null) return null;
    return CustomerValueSelection(
      previewFingerprint: preview.fingerprint,
      rewardAuthorizationId: _state.rewardAuthorization?.id,
      rewardApprovalId: _state.rewardApprovalId,
      storedValueAuthorizationIds: _state.storedValueAuthorizations
          .map((item) => item.id)
          .toList(),
      fundedGiftCards: fundingAssignment == null ? null : [fundingAssignment],
    );
  }

  void clear() => _set(const CustomerValueState());

  void deselect() => _set(CustomerValueState(customers: _state.customers));

  void _set(CustomerValueState value) {
    _state = value;
    notifyListeners();
  }

  CustomerValueState _copyState({
    bool? busy,
    CustomerHistoryPage? history,
    GiftCard? giftCard,
    PointsAdjustmentPreview? pointsAdjustmentPreview,
    PointsAdjustmentRequest? pendingPointsAdjustment,
    PointsAdjustmentResult? pointsAdjustmentResult,
    GiftCardIssuanceResult? giftCardIssuance,
    GiftCardIssuancePreview? giftCardIssuancePreview,
    GiftCardIssuanceRequest? pendingGiftCardIssuance,
    RewardAuthorization? rewardAuthorization,
    String? rewardApprovalId,
    String? pendingRewardApprovalPermission,
    String? pendingRewardApprovalFingerprint,
    bool clearPendingRewardApproval = false,
    bool clearRewardAuthorization = false,
    List<StoredValueAuthorization>? storedValueAuthorizations,
    String? errorCode,
  }) => CustomerValueState(
    busy: busy ?? false,
    customers: _state.customers,
    selected: _state.selected,
    history: history ?? _state.history,
    preview: _state.preview,
    giftCard: giftCard ?? _state.giftCard,
    pointsAdjustmentPreview:
        pointsAdjustmentPreview ?? _state.pointsAdjustmentPreview,
    pendingPointsAdjustment:
        pendingPointsAdjustment ?? _state.pendingPointsAdjustment,
    pointsAdjustmentResult:
        pointsAdjustmentResult ?? _state.pointsAdjustmentResult,
    giftCardIssuance: giftCardIssuance ?? _state.giftCardIssuance,
    giftCardIssuancePreview:
        giftCardIssuancePreview ?? _state.giftCardIssuancePreview,
    pendingGiftCardIssuance:
        pendingGiftCardIssuance ?? _state.pendingGiftCardIssuance,
    rewardAuthorization: clearRewardAuthorization
        ? null
        : rewardAuthorization ?? _state.rewardAuthorization,
    rewardApprovalId: clearRewardAuthorization
        ? null
        : rewardApprovalId ?? _state.rewardApprovalId,
    pendingRewardApprovalPermission: clearPendingRewardApproval
        ? null
        : pendingRewardApprovalPermission ??
              _state.pendingRewardApprovalPermission,
    pendingRewardApprovalFingerprint: clearPendingRewardApproval
        ? null
        : pendingRewardApprovalFingerprint ??
              _state.pendingRewardApprovalFingerprint,
    storedValueAuthorizations:
        storedValueAuthorizations ?? _state.storedValueAuthorizations,
    ambiguous: _state.ambiguous,
    errorCode: errorCode,
  );

  String? _firstField(Map<String, Object?>? fields, String key) {
    final value = fields?[key];
    if (value is List && value.isNotEmpty) return value.first.toString();
    return value?.toString();
  }

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
