import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import 'connectivity_controller.dart';
import 'offline_journal.dart';

final class OfflineAuthorityContext {
  const OfflineAuthorityContext({
    required this.merchantId,
    required this.locationId,
    required this.deviceId,
    required this.credentialVersion,
    required this.operatorSessionId,
    required this.permissions,
    required this.entitlements,
    required this.currency,
    required this.deviceTrusted,
  });
  final String merchantId;
  final String locationId;
  final String deviceId;
  final int credentialVersion;
  final String operatorSessionId;
  final Set<String> permissions;
  final Set<String> entitlements;
  final String currency;
  final bool deviceTrusted;
}

final class OfflineCheckoutFacts {
  const OfflineCheckoutFacts({
    required this.amountMinorUnits,
    required this.catalogSnapshotAt,
    required this.pricingSnapshotAt,
    required this.taxSnapshotAt,
    required this.connectivity,
    required this.paymentMethod,
    this.ambiguousPayment = false,
    this.reconciliationRequired = false,
    this.storagePressure = false,
  });
  final int amountMinorUnits;
  final DateTime catalogSnapshotAt;
  final DateTime pricingSnapshotAt;
  final DateTime taxSnapshotAt;
  final PosConnectivity connectivity;
  final String paymentMethod;
  final bool ambiguousPayment;
  final bool reconciliationRequired;
  final bool storagePressure;
}

final class ValidatedOfflinePolicy {
  const ValidatedOfflinePolicy(this.policy, this.cash, this.limits);
  final OfflinePolicy policy;
  final OfflineCashPolicy cash;
  final OfflinePolicyLimits limits;
}

final class OfflinePolicyCache {
  OfflinePolicyCache(this._journal, {bool? web}) : _web = web ?? kIsWeb;
  final EncryptedOfflineJournal _journal;
  final bool _web;

  Future<void> save(OfflinePolicy policy, DateTime trustedServerTime) =>
      _journal.cachePolicy(policy, trustedServerTime);

  Future<ValidatedOfflinePolicy> validated({
    required OfflineAuthorityContext authority,
    required DateTime now,
  }) async {
    if (_web) {
      throw const OfflineJournalException('secure_offline_unsupported_on_web');
    }
    final snapshot = await _journal.load();
    final raw = snapshot.cachedPolicy;
    if (raw == null) {
      throw const OfflineJournalException('policy_missing');
    }
    final policy = OfflinePolicy.fromJson(raw);
    final cash = OfflineCashPolicy.fromJson(policy.cash);
    final limits = OfflinePolicyLimits.fromJson(cash.limits);
    if (_fingerprint(cash) != cash.fingerprint) {
      throw const OfflineJournalException('policy_invalid');
    }
    if (!cash.enabled) {
      throw const OfflineJournalException('policy_disabled');
    }
    if (cash.merchantId != authority.merchantId) {
      throw const OfflineJournalException('tenant_mismatch');
    }
    if (cash.locationId != authority.locationId) {
      throw const OfflineJournalException('branch_mismatch');
    }
    if (cash.deviceId != authority.deviceId) {
      throw const OfflineJournalException('device_untrusted');
    }
    if (cash.deviceCredentialVersion != authority.credentialVersion) {
      throw const OfflineJournalException('credential_rotated');
    }
    if (cash.currency != authority.currency) {
      throw const OfflineJournalException('currency_mismatch');
    }
    if (!authority.deviceTrusted) {
      throw const OfflineJournalException('device_untrusted');
    }
    if (!authority.permissions.contains(cash.requiredPermission) &&
        !authority.permissions.contains('*')) {
      throw const OfflineJournalException('permission_denied');
    }
    if (!authority.entitlements.contains(cash.requiredEntitlement)) {
      throw const OfflineJournalException('entitlement_disabled');
    }
    final trustedServer = snapshot.lastTrustedServerTime;
    final trustedLocal = snapshot.lastTrustedLocalTime;
    if (trustedServer == null ||
        trustedLocal == null ||
        now.isBefore(trustedLocal)) {
      throw const OfflineJournalException('trusted_time_unavailable');
    }
    final elapsed = now.difference(trustedLocal);
    final conservativeServerNow = trustedServer.add(elapsed);
    final issuedAt = DateTime.parse(cash.issuedAt);
    if (conservativeServerNow.isAfter(DateTime.parse(cash.expiresAt)) ||
        conservativeServerNow.difference(issuedAt) >
            Duration(seconds: cash.maxPolicyAgeSeconds)) {
      throw const OfflineJournalException('policy_expired');
    }
    return ValidatedOfflinePolicy(policy, cash, limits);
  }

  String _fingerprint(OfflineCashPolicy policy) {
    final value = policy.toJson()..remove('fingerprint');
    return sha256
        .convert(utf8.encode(jsonEncode(_canonical(value))))
        .toString();
  }

  Object? _canonical(Object? value) {
    if (value is Map<String, Object?>) {
      final keys = value.keys.toList()..sort();
      return {for (final key in keys) key: _canonical(value[key])};
    }
    if (value is List<Object?>) return value.map(_canonical).toList();
    return value;
  }
}

final class OfflineCheckoutEligibilityEngine {
  const OfflineCheckoutEligibilityEngine();

  OfflineCheckoutEligibility evaluate({
    required OfflineAuthorityContext authority,
    required ValidatedOfflinePolicy policy,
    required OfflineJournalSnapshot journal,
    required OfflineCheckoutFacts facts,
    required DateTime trustedNow,
  }) {
    OfflineCheckoutEligibility blocked(
      String reason,
      List<String> actions, {
      String status = 'blocked',
      bool retrySafe = false,
    }) => OfflineCheckoutEligibility(
      status: status,
      reason: reason,
      recoveryActions: actions,
      cartPreserved: true,
      retrySafe: retrySafe,
      correlationId: policy.cash.correlationId,
    );

    if (facts.connectivity == PosConnectivity.online) {
      return blocked('policy_invalid', [
        'retry',
      ], status: 'requires_online_refresh');
    }
    if (facts.paymentMethod != 'cash') {
      return blocked('payment_method_unsupported', ['retry']);
    }
    if (facts.ambiguousPayment) {
      return blocked('ambiguous_payment', ['contact_support']);
    }
    if (facts.reconciliationRequired) {
      return blocked('reconciliation_required', [
        'reconcile',
      ], status: 'requires_reconciliation');
    }
    if (facts.storagePressure) {
      return blocked('queue_full', ['reconcile']);
    }
    if (facts.amountMinorUnits > policy.limits.maxSingleSaleMinorUnits) {
      return blocked('single_sale_limit', ['retry']);
    }
    if (journal.pendingCashMinorUnits + facts.amountMinorUnits >
        policy.limits.maxAccumulatedMinorUnits) {
      return blocked('accumulated_amount_limit', ['reconcile']);
    }
    if (journal.pendingCashCount >= policy.limits.maxOfflineSaleCount) {
      return blocked('sale_count_limit', ['reconcile']);
    }
    if (journal.pendingCount >= policy.limits.maxActiveQueueDepth) {
      return blocked('queue_full', ['reconcile']);
    }
    if (trustedNow.difference(facts.catalogSnapshotAt) >
        Duration(seconds: policy.limits.maxCatalogAgeSeconds)) {
      return blocked('catalog_stale', [
        'refresh_data',
      ], status: 'requires_online_refresh');
    }
    if (trustedNow.difference(facts.pricingSnapshotAt) >
        Duration(seconds: policy.limits.maxPricingAgeSeconds)) {
      return blocked('pricing_stale', [
        'refresh_data',
      ], status: 'requires_online_refresh');
    }
    if (trustedNow.difference(facts.taxSnapshotAt) >
        Duration(seconds: policy.limits.maxTaxAgeSeconds)) {
      return blocked('tax_stale', [
        'refresh_data',
      ], status: 'requires_online_refresh');
    }
    final threshold = policy.cash.managerApprovalThresholdMinorUnits;
    if (threshold != null && facts.amountMinorUnits >= threshold) {
      return blocked('manager_approval_required', [
        'manager_review',
      ], status: 'requires_manager_approval');
    }
    return OfflineCheckoutEligibility(
      status: 'eligible',
      reason: null,
      recoveryActions: const [],
      cartPreserved: true,
      retrySafe: false,
      correlationId: policy.cash.correlationId,
    );
  }
}
