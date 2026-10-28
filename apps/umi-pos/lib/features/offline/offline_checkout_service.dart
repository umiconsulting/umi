import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:umi_contract/umi_contract.dart';

import 'offline_journal.dart';
import 'offline_policy.dart';

final class OfflineCheckoutRequest {
  const OfflineCheckoutRequest({
    required this.commandId,
    required this.idempotencyKey,
    required this.localCommitId,
    required this.authority,
    required this.checkoutCommand,
    required this.cart,
    required this.totals,
    required this.catalogVersion,
    required this.pricingVersion,
    required this.taxVersion,
    required this.catalogSnapshotAt,
    required this.pricingSnapshotAt,
    required this.taxSnapshotAt,
    required this.amountReceivedMinorUnits,
    required this.businessDate,
  });
  final String commandId;
  final String idempotencyKey;
  final String localCommitId;
  final OfflineAuthorityContext authority;
  final CheckoutCommand checkoutCommand;
  final Cart cart;
  final TotalsConfirmation totals;
  final String catalogVersion;
  final String pricingVersion;
  final String taxVersion;
  final DateTime catalogSnapshotAt;
  final DateTime pricingSnapshotAt;
  final DateTime taxSnapshotAt;
  final int amountReceivedMinorUnits;
  final String businessDate;
}

/// A cash sale saved on this device and waiting for the server.
///
/// This is a journal identity, not a receipt. Nothing may turn it into paper
/// or an on-screen receipt; the API issues the only receipt this product shows.
final class OfflineCashCommit {
  const OfflineCashCommit({required this.localCommitId});

  final String localCommitId;
}

final class OfflineCheckoutService {
  OfflineCheckoutService({
    required EncryptedOfflineJournal journal,
    required OfflinePolicyCache policyCache,
    required OfflineCheckoutEligibilityEngine eligibility,
  }) : _journal = journal,
       _policyCache = policyCache,
       _eligibility = eligibility;
  final EncryptedOfflineJournal _journal;
  final OfflinePolicyCache _policyCache;
  final OfflineCheckoutEligibilityEngine _eligibility;

  Future<OfflineCashCommit> checkout(
    OfflineCheckoutRequest request, {
    required OfflineCheckoutFacts facts,
    required DateTime now,
  }) async {
    final policy = await _policyCache.validated(
      authority: request.authority,
      now: now,
    );
    final journal = await _journal.load();
    final result = _eligibility.evaluate(
      authority: request.authority,
      policy: policy,
      journal: journal,
      facts: facts,
      trustedNow: now,
    );
    if (result.status != 'eligible') {
      throw OfflineJournalException(
        result.reason ?? 'offline_checkout_blocked',
      );
    }
    final amountDue =
        request.totals.totals['grandTotal']! as Map<String, Object?>;
    final due = (amountDue['minorUnits']! as num).toInt();
    if (request.amountReceivedMinorUnits < due) {
      throw const OfflineJournalException('cash_received_insufficient');
    }
    final snapshot = OfflineCheckoutSnapshot(
      checkoutCommand: request.checkoutCommand.toJson(),
      cartSnapshot: request.cart.toJson(),
      totals: request.totals.toJson(),
      catalogVersion: request.catalogVersion,
      pricingVersion: request.pricingVersion,
      taxVersion: request.taxVersion,
      catalogSnapshotAt: request.catalogSnapshotAt.toUtc().toIso8601String(),
      pricingSnapshotAt: request.pricingSnapshotAt.toUtc().toIso8601String(),
      taxSnapshotAt: request.taxSnapshotAt.toUtc().toIso8601String(),
      currency: policy.cash.currency,
      amountDueMinorUnits: due,
      amountReceivedMinorUnits: request.amountReceivedMinorUnits,
      changeDueMinorUnits: request.amountReceivedMinorUnits - due,
      businessDate: request.businessDate,
    );
    final payload = OfflineCheckoutCommand(
      policyVersion: policy.cash.version,
      policyFingerprint: policy.cash.fingerprint,
      checkoutIdentity: _checkoutIdentity(request),
      snapshot: snapshot.toJson(),
    );
    final persisted = await _journal.append(
      commandId: request.commandId,
      deviceId: request.authority.deviceId,
      credentialVersion: request.authority.credentialVersion,
      merchantId: request.authority.merchantId,
      locationId: request.authority.locationId,
      operatorSessionId: request.authority.operatorSessionId,
      idempotencyKey: request.idempotencyKey,
      payload: payload.toJson(),
      commandType: 'pos.checkout.cash',
      provisionalId: request.localCommitId,
      deduplicationKey: payload.checkoutIdentity,
      maxPendingCashCount: policy.limits.maxOfflineSaleCount,
      maxPendingCashMinorUnits: policy.limits.maxAccumulatedMinorUnits,
      cashAmountMinorUnits: due,
    );
    return OfflineCashCommit(localCommitId: persisted.provisionalId!);
  }

  String _checkoutIdentity(OfflineCheckoutRequest request) {
    final canonical = <String, Object?>{
      'merchantId': request.authority.merchantId,
      'locationId': request.authority.locationId,
      'operatorSessionId': request.authority.operatorSessionId,
      'deviceId': request.authority.deviceId,
      'credentialVersion': request.authority.credentialVersion,
      'cartId': request.cart.id,
      'cartVersion': request.cart.version,
      'totalsFingerprint': request.totals.fingerprint,
      'paymentMethod': 'cash',
    };
    return sha256.convert(utf8.encode(jsonEncode(canonical))).toString();
  }
}
