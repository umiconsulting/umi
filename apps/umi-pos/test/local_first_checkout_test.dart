import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/checkout/checkout_controller.dart';
import 'package:umi_pos/features/checkout/checkout_repository.dart';
import 'package:umi_pos/features/offline/offline_checkout_service.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/offline_policy.dart';

const _merchant = '00000000-0000-4000-8000-000000000001';
const _location = '00000000-0000-4000-8000-000000000002';
const _device = '00000000-0000-4000-8000-000000000003';
const _operator = '00000000-0000-4000-8000-000000000004';
const _cartId = '00000000-0000-4000-8000-000000000005';
const _shift = '00000000-0000-4000-8000-000000000006';

void main() {
  test(
    'a simple online cash sale reaches paid locally and journals once',
    () async {
      final store = _MemoryCipherStore();
      final journal = EncryptedOfflineJournal(store, web: false);
      final policyCache = OfflinePolicyCache(journal, web: false);
      final now = DateTime.now().toUtc();
      await policyCache.save(_policy(now), now);
      final repository = _NeverCheckout();
      var preserveCalls = 0;
      final checkout = CheckoutController(
        repository: repository,
        offlineCheckout: OfflineCheckoutService(
          journal: journal,
          policyCache: policyCache,
          eligibility: const OfflineCheckoutEligibilityEngine(),
        ),
        telemetry: const SafeTelemetry(
          enabled: false,
          context: TelemetryContext(
            appVersion: 'test',
            environment: 'test',
            platform: 'test',
          ),
          exporter: NoopTelemetryExporter(),
        ),
        preserveLocalCommands: () async {
          preserveCalls++;
          return true;
        },
        localFirstFastPathEnabled: true,
      );
      final cart = _cart(now);
      final authority = _authority();

      await checkout.preview(
        merchantId: _merchant,
        locationId: _location,
        operatorSessionId: _operator,
        cartId: _cartId,
        cartVersion: cart.version,
        paymentMethod: 'cash',
        cashShiftId: _shift,
        cart: cart,
        authority: authority,
        locationName: 'ONCA',
        operatorName: 'Ana',
        cashReceivedMinorUnits: 5000,
        tenderDrafts: const [
          {
            'id': '00000000-0000-4000-8000-000000000007',
            'type': 'cash',
            'amount': {'minorUnits': 5000, 'currency': 'MXN'},
            'amountReceived': {'minorUnits': 5000, 'currency': 'MXN'},
          },
        ],
      );

      expect(checkout.state.phase, CheckoutPhase.confirmationRequired);
      expect(repository.checkouts, 0);

      await checkout.confirm();
      expect(checkout.state.phase, CheckoutPhase.provisional);
      expect(preserveCalls, 1);
      expect(repository.checkouts, 0);
      final first = await journal.load();
      expect(first.pendingCount, 1);
      expect(first.entries.single.command.commandType, 'pos.checkout.cash');

      await checkout.confirm();
      final repeated = await journal.load();
      expect(repeated.pendingCount, 1);
      expect(repeated.entries, hasLength(1));
      expect(
        repeated.entries.single.command.commandId,
        first.entries.single.command.commandId,
      );
      expect(repository.checkouts, 0);
      checkout.dispose();
    },
  );

  test('a missing local policy falls back to the online checkout', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final repository = _CompletedCheckout();
    final checkout = CheckoutController(
      repository: repository,
      offlineCheckout: OfflineCheckoutService(
        journal: journal,
        policyCache: OfflinePolicyCache(journal, web: false),
        eligibility: const OfflineCheckoutEligibilityEngine(),
      ),
      telemetry: const SafeTelemetry(
        enabled: false,
        context: TelemetryContext(
          appVersion: 'test',
          environment: 'test',
          platform: 'test',
        ),
        exporter: NoopTelemetryExporter(),
      ),
      localFirstFastPathEnabled: true,
    );
    final cart = _cart(DateTime.now().toUtc());

    await checkout.preview(
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      cartId: _cartId,
      cartVersion: cart.version,
      paymentMethod: 'cash',
      cashShiftId: _shift,
      cart: cart,
      authority: _authority(),
      cashReceivedMinorUnits: 5000,
      tenderDrafts: const [
        {
          'id': '00000000-0000-4000-8000-000000000007',
          'type': 'cash',
          'amount': {'minorUnits': 5000, 'currency': 'MXN'},
          'amountReceived': {'minorUnits': 5000, 'currency': 'MXN'},
        },
      ],
    );
    await checkout.confirm();

    expect(repository.checkouts, 1);
    expect(checkout.state.phase, CheckoutPhase.completed);
    expect((await journal.load()).pendingCount, 0);
    checkout.dispose();
  });

  test('a cart that cannot reach the journal stops before money', () async {
    final journal = EncryptedOfflineJournal(_MemoryCipherStore(), web: false);
    final repository = _NeverCheckout();
    var preserveCalls = 0;
    final checkout = CheckoutController(
      repository: repository,
      offlineCheckout: OfflineCheckoutService(
        journal: journal,
        policyCache: OfflinePolicyCache(journal, web: false),
        eligibility: const OfflineCheckoutEligibilityEngine(),
      ),
      preserveLocalCommands: () async {
        preserveCalls++;
        return false;
      },
      telemetry: const SafeTelemetry(
        enabled: false,
        context: TelemetryContext(
          appVersion: 'test',
          environment: 'test',
          platform: 'test',
        ),
        exporter: NoopTelemetryExporter(),
      ),
      localFirstFastPathEnabled: true,
    );
    final cart = _cart(DateTime.now().toUtc());

    await checkout.preview(
      merchantId: _merchant,
      locationId: _location,
      operatorSessionId: _operator,
      cartId: _cartId,
      cartVersion: cart.version,
      paymentMethod: 'cash',
      cashShiftId: _shift,
      cart: cart,
      authority: _authority(),
      cashReceivedMinorUnits: 5000,
      tenderDrafts: const [
        {
          'id': '00000000-0000-4000-8000-000000000007',
          'type': 'cash',
          'amount': {'minorUnits': 5000, 'currency': 'MXN'},
          'amountReceived': {'minorUnits': 5000, 'currency': 'MXN'},
        },
      ],
    );
    await checkout.confirm();

    expect(preserveCalls, 1);
    expect(repository.checkouts, 0);
    expect(checkout.state.phase, CheckoutPhase.failure);
    expect(checkout.state.errorCode, 'OFFLINE_SYNC_PENDING');
    expect((await journal.load()).pendingCount, 0);
    checkout.dispose();
  });
}

final class _NeverCheckout implements CheckoutRepository {
  int checkouts = 0;

  @override
  Future<CheckoutResult> checkout(String merchantId, CheckoutCommand command) {
    checkouts++;
    throw StateError('online checkout must not run on the fast path');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

final class _CompletedCheckout implements CheckoutRepository {
  int checkouts = 0;

  @override
  Future<CheckoutResult> checkout(
    String merchantId,
    CheckoutCommand command,
  ) async {
    checkouts++;
    return const CheckoutResult(
      status: 'completed',
      confirmation: {
        'cartVersion': 2,
        'fingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'totals': _totals,
        'taxes': {
          'total': {'currency': 'MXN', 'minorUnits': 0},
          'entries': <Object?>[],
        },
        'discounts': {
          'total': {'currency': 'MXN', 'minorUnits': 0},
          'entries': <Object?>[],
        },
        'catalogVersion': 'catalog-1',
        'pricingVersion': 'pricing-1',
        'taxVersion': 'tax-1',
        'snapshotAt': '2026-10-22T12:00:00.000Z',
        'confirmedAt': '2026-10-22T12:00:00.000Z',
      },
      payment: null,
      payments: [],
      reservation: null,
      sale: {'id': '00000000-0000-4000-8000-000000000008'},
      receipt: null,
      failure: null,
      recoveryState: 'none',
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

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

OfflineAuthorityContext _authority() => const OfflineAuthorityContext(
  merchantId: _merchant,
  locationId: _location,
  deviceId: _device,
  credentialVersion: 1,
  operatorSessionId: _operator,
  permissions: {'offline.cash.checkout'},
  entitlements: {'pos.offline_cash'},
  currency: 'MXN',
  deviceTrusted: true,
);

Cart _cart(DateTime now) => Cart(
  id: _cartId,
  merchantId: _merchant,
  locationId: _location,
  operatorSessionId: _operator,
  status: 'prepared',
  lifecycleState: 'ready_for_checkout',
  version: 2,
  firedOrderId: null,
  fulfillmentType: 'takeout',
  items: const [],
  totals: _totals,
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: now.toIso8601String(),
);

const _totals = <String, Object?>{
  'subtotal': {'currency': 'MXN', 'minorUnits': 5000},
  'tax': {'currency': 'MXN', 'minorUnits': 0},
  'discounts': {
    'total': {'currency': 'MXN', 'minorUnits': 0},
    'entries': <Object?>[],
  },
  'grandTotal': {'currency': 'MXN', 'minorUnits': 5000},
  'businessDate': '2026-10-22',
};

OfflinePolicy _policy(DateTime now) {
  final cash = <String, Object?>{
    'enabled': true,
    'version': 'policy-1',
    'issuedAt': now.toIso8601String(),
    'expiresAt': now.add(const Duration(minutes: 10)).toIso8601String(),
    'maxPolicyAgeSeconds': 600,
    'merchantId': _merchant,
    'locationId': _location,
    'deviceId': _device,
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
    'correlationId': '00000000-0000-4000-8000-000000000009',
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
