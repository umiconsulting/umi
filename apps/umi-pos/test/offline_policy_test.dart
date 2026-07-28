import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_checkout_service.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/offline_policy.dart';

void main() {
  test('encrypted policy validates scope and exact cash limits', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final cache = OfflinePolicyCache(journal, web: false);
    final now = DateTime.now().toUtc();
    final policy = _policy(now);
    await cache.save(policy, now);
    final authority = _authority();
    final validatedAt = DateTime.now().toUtc();
    final validated = await cache.validated(
      authority: authority,
      now: validatedAt,
    );
    expect(validated.cash.enabled, isTrue);
    expect(validated.limits.maxSingleSaleMinorUnits, 10000);
    final eligible = const OfflineCheckoutEligibilityEngine().evaluate(
      authority: authority,
      policy: validated,
      journal: await journal.load(),
      facts: OfflineCheckoutFacts(
        amountMinorUnits: 10000,
        catalogSnapshotAt: now,
        pricingSnapshotAt: now,
        taxSnapshotAt: now,
        connectivity: PosConnectivity.offline,
        paymentMethod: 'cash',
      ),
      trustedNow: validatedAt,
    );
    expect(eligible.status, 'eligible');
    final over = const OfflineCheckoutEligibilityEngine().evaluate(
      authority: authority,
      policy: validated,
      journal: await journal.load(),
      facts: OfflineCheckoutFacts(
        amountMinorUnits: 10001,
        catalogSnapshotAt: now,
        pricingSnapshotAt: now,
        taxSnapshotAt: now,
        connectivity: PosConnectivity.offline,
        paymentMethod: 'cash',
      ),
      trustedNow: validatedAt,
    );
    expect(over.reason, 'single_sale_limit');
  });

  test('expired, wrong branch, and web policy fail closed', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final now = DateTime.now().toUtc();
    await OfflinePolicyCache(journal, web: false).save(_policy(now), now);
    await expectLater(
      OfflinePolicyCache(journal, web: false).validated(
        authority: _authority(branchId: _id(99)),
        now: now,
      ),
      throwsA(
        isA<OfflineJournalException>().having(
          (error) => error.category,
          'category',
          'branch_mismatch',
        ),
      ),
    );
    await expectLater(
      OfflinePolicyCache(journal, web: false).validated(
        authority: _authority(),
        now: now.add(const Duration(minutes: 11)),
      ),
      throwsA(isA<OfflineJournalException>()),
    );
    await expectLater(
      OfflinePolicyCache(
        journal,
        web: true,
      ).validated(authority: _authority(), now: now),
      throwsA(
        isA<OfflineJournalException>().having(
          (error) => error.category,
          'category',
          'secure_offline_unsupported_on_web',
        ),
      ),
    );
  });

  test(
    'eligible cash checkout appends one encrypted provisional sale',
    () async {
      final store = _MemoryCipherStore();
      final journal = EncryptedOfflineJournal(store, web: false);
      final now = DateTime.now().toUtc();
      final cache = OfflinePolicyCache(journal, web: false);
      await cache.save(_policy(now), now);
      final cart = Cart(
        id: _id(20),
        tenantId: _id(1),
        branchId: _id(2),
        operatorSessionId: _id(4),
        status: 'prepared',
        version: 2,
        items: const [],
        totals: _totals(),
        checkoutEnabled: true,
        checkoutMessageCode: 'ready',
        updatedAt: now.toIso8601String(),
      );
      final confirmation = TotalsConfirmation(
        cartVersion: 2,
        fingerprint: List.filled(64, 'a').join(),
        totals: _totals(),
        taxes: const {'groups': <Object?>[]},
        discounts: const {
          'total': <String, Object?>{'currency': 'MXN', 'minorUnits': 0},
        },
        catalogVersion: 'catalog-1',
        pricingVersion: 'price-1',
        taxVersion: 'tax-1',
        snapshotAt: now.toIso8601String(),
        confirmedAt: now.toIso8601String(),
      );
      final service = OfflineCheckoutService(
        journal: journal,
        policyCache: cache,
        eligibility: const OfflineCheckoutEligibilityEngine(),
      );
      final request = OfflineCheckoutRequest(
        commandId: _id(21),
        idempotencyKey: _id(22),
        provisionalSaleId: _id(23),
        authority: _authority(),
        checkoutCommand: CheckoutCommand(
          cartId: cart.id,
          branchId: cart.branchId,
          operatorSessionId: cart.operatorSessionId,
          expectedCartVersion: cart.version,
          paymentMethod: 'cash',
          totalsFingerprint: confirmation.fingerprint,
          idempotencyKey: _id(24),
        ),
        cart: cart,
        totals: confirmation,
        catalogVersion: 'catalog-1',
        pricingVersion: 'price-1',
        taxVersion: 'tax-1',
        catalogSnapshotAt: now,
        pricingSnapshotAt: now,
        taxSnapshotAt: now,
        amountReceivedMinorUnits: 5000,
        businessDate: '2026-07-28',
        branchName: 'Branch',
        operatorName: 'Operator',
      );
      final facts = OfflineCheckoutFacts(
        amountMinorUnits: 5000,
        catalogSnapshotAt: now,
        pricingSnapshotAt: now,
        taxSnapshotAt: now,
        connectivity: PosConnectivity.offline,
        paymentMethod: 'cash',
      );
      final receipt = await service.checkout(
        request,
        facts: facts,
        now: DateTime.now().toUtc(),
      );
      await service.checkout(
        request,
        facts: facts,
        now: DateTime.now().toUtc(),
      );
      expect(receipt.status, 'pending_sync');
      expect((await journal.load()).entries, hasLength(1));
      expect(store.ciphertext, isNot(contains('catalog-1')));
      expect(receipt.officialReceipt, isNull);
    },
  );
}

Map<String, Object?> _totals() => {
  'subtotal': {'currency': 'MXN', 'minorUnits': 5000},
  'tax': {'currency': 'MXN', 'minorUnits': 0},
  'discounts': {'currency': 'MXN', 'minorUnits': 0},
  'grandTotal': {'currency': 'MXN', 'minorUnits': 5000},
  'businessDate': '2026-07-28',
};

OfflineAuthorityContext _authority({String? branchId}) =>
    OfflineAuthorityContext(
      tenantId: _id(1),
      branchId: branchId ?? _id(2),
      deviceId: _id(3),
      credentialVersion: 1,
      operatorSessionId: _id(4),
      permissions: const {'offline.cash.checkout'},
      entitlements: const {'pos.offline_cash'},
      currency: 'MXN',
      deviceTrusted: true,
    );

OfflinePolicy _policy(DateTime now) {
  final cash = <String, Object?>{
    'enabled': true,
    'version': 'policy-1',
    'issuedAt': now.toIso8601String(),
    'expiresAt': now.add(const Duration(minutes: 10)).toIso8601String(),
    'maxPolicyAgeSeconds': 600,
    'tenantId': _id(1),
    'branchId': _id(2),
    'deviceId': _id(3),
    'deviceCredentialVersion': 1,
    'currency': 'MXN',
    'requiredPermission': 'offline.cash.checkout',
    'requiredEntitlement': 'pos.offline_cash',
    'managerApprovalThresholdMinorUnits': null,
    'allowedDeviceClasses': <String>['pos_terminal'],
    'limits': {
      'maxSingleSaleMinorUnits': 10000,
      'maxAccumulatedMinorUnits': 30000,
      'maxOfflineSaleCount': 3,
      'maxActiveQueueDepth': 10,
      'maxCommandAgeSeconds': 3600,
      'maxCatalogAgeSeconds': 900,
      'maxPricingAgeSeconds': 600,
      'maxTaxAgeSeconds': 600,
    },
    'correlationId': _id(9),
  };
  cash['fingerprint'] = sha256
      .convert(utf8.encode(jsonEncode(_canonical(cash))))
      .toString();
  return OfflinePolicy(
    cash: OfflineCashPolicy.fromJson(cash).toJson(),
    allowedCommandTypes: const ['operational.ack', 'pos.checkout.cash'],
    maxBatchSize: 20,
    webSensitiveJournalEnabled: false,
  );
}

Object? _canonical(Object? value) {
  if (value is Map<String, Object?>) {
    final keys = value.keys.toList()..sort();
    return {for (final key in keys) key: _canonical(value[key])};
  }
  if (value is List<Object?>) return value.map(_canonical).toList();
  return value;
}

String _id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

final class _MemoryCipherStore implements JournalCipherStore {
  String? ciphertext;
  String? key;
  @override
  Future<String?> readCiphertext() async => ciphertext;
  @override
  Future<String?> readKey() async => key;
  @override
  Future<void> writeCiphertext(String value) async => ciphertext = value;
  @override
  Future<void> writeKey(String value) async => key = value;
}
