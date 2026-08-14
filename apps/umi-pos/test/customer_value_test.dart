import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/features/customer_value/customer_value_controller.dart';
import 'package:umi_pos/features/customer_value/customer_value_repository.dart';

const scope = CustomerValueScope(
  merchantId: '10000000-0000-4000-8000-000000000001',
  locationId: '10000000-0000-4000-8000-000000000002',
  operatorSessionId: '10000000-0000-4000-8000-000000000003',
);

CustomerProfile customer([String name = 'Ana']) => CustomerProfile(
  id: '10000000-0000-4000-8000-000000000004',
  publicReference: 'CUS-ANA',
  displayName: name,
  status: 'active',
  preferredLanguage: 'es',
  version: 1,
  contacts: const [
    {
      'id': '10000000-0000-4000-8000-000000000005',
      'type': 'phone',
      'displayValue': '',
      'maskedValue': '••••1234',
      'verification': 'unverified',
      'primary': true,
    },
  ],
  consents: const [],
  privacy: const {
    'dataMinimized': true,
    'contactVisibility': 'limited',
    'version': 1,
  },
  createdAt: '2026-08-05T18:00:00.000Z',
  updatedAt: '2026-08-05T18:00:00.000Z',
);

final class FakeCustomerValueRepository implements CustomerValueRepository {
  CreateCustomerRequest? created;
  RewardAuthorizationRequest? rewardCommand;
  StoredValueAuthorizationRequest? storedCommand;
  PointsAdjustmentRequest? adjustmentCommand;
  GiftCardIssuanceRequest? issuanceCommand;

  @override
  Future<CustomerSearchResult> search(
    String merchantId,
    CustomerSearchRequest query,
  ) async => CustomerSearchResult(
    nextCursor: null,
    customers: [customer().toJson()],
    ambiguous: false,
  );

  @override
  Future<CustomerProfile> create(
    String merchantId,
    CreateCustomerRequest command,
  ) async {
    created = command;
    return customer(command.displayName);
  }

  @override
  Future<CustomerHistoryPage> history(
    String merchantId,
    String customerId,
    CustomerHistoryQuery query,
  ) async => const CustomerHistoryPage(
    nextCursor: null,
    entries: [],
    loyaltyAccount: {
      'id': '10000000-0000-4000-8000-000000000030',
      'customerId': '10000000-0000-4000-8000-000000000004',
      'programReference': 'pilot',
      'status': 'active',
      'pointsScale': 0,
      'ledgerSequence': 1,
      'version': 1,
      'enrolledAt': '2026-08-05T18:00:00.000Z',
    },
    pointsBalance: {'available': 600, 'pending': 20},
  );

  @override
  Future<CustomerValuePreview> preview(
    String merchantId,
    CustomerValuePreviewRequest command,
  ) async => CustomerValuePreview(
    summary: customer().toJson(),
    earn: const {'expectedPoints': 10, 'status': 'pending'},
    rewards: const [],
    selectedReward: null,
    storedValueAuthorizations: const [],
    remainingBalance: const {'minorUnits': 1000, 'currency': 'MXN'},
    policyVersions: const {'loyalty': 'pilot'},
    fingerprint: List.filled(64, 'a').join(),
  );

  @override
  Future<GiftCardLookupResult> giftCardLookup(
    String merchantId,
    GiftCardLookupRequest command,
  ) => throw UnimplementedError();

  @override
  Future<PointsAdjustmentPreview> previewPointsAdjustment(
    String merchantId,
    PointsAdjustmentRequest command,
  ) async {
    adjustmentCommand = command;
    return PointsAdjustmentPreview(
      accountId: command.accountId,
      currentAvailable: 600,
      projectedAvailable: command.direction == 'increase' ? 700 : 500,
      approvalPermission: 'loyalty.adjust.approve',
      fingerprint: List.filled(64, 'e').join(),
    );
  }

  @override
  Future<PointsAdjustmentResult> commitPointsAdjustment(
    String merchantId,
    PointsAdjustmentRequest command,
  ) async {
    adjustmentCommand = command;
    return PointsAdjustmentResult(
      ledgerEntry: {
        'id': '10000000-0000-4000-8000-000000000031',
        'accountId': command.accountId,
        'customerId': command.customerId,
        'sequence': 2,
        'type': 'manual_points_adjustment',
        'points': command.points,
        'direction': 'credit',
        'commandId': command.commandId,
        'businessDate': '2026-08-05',
        'occurredAt': '2026-08-05T18:00:00.000Z',
      },
      balance: const {'available': 700},
      recovered: false,
    );
  }

  @override
  Future<GiftCardIssuancePreview> previewGiftCardIssuance(
    String merchantId,
    GiftCardIssuanceRequest command,
  ) async {
    issuanceCommand = command;
    return GiftCardIssuancePreview(
      currency: command.currency,
      valueMinorUnits: command.initialValueMinorUnits,
      maximumValueMinorUnits: 10000000,
      approvalPermission: 'gift_card.issue.approve',
      fingerprint: List.filled(64, 'f').join(),
    );
  }

  @override
  Future<GiftCardIssuanceResult> issueGiftCard(
    String merchantId,
    GiftCardIssuanceRequest command,
  ) async {
    issuanceCommand = command;
    return GiftCardIssuanceResult(
      card: {
        'id': '10000000-0000-4000-8000-000000000040',
        'publicReference': 'GFT-TEST',
        'status': command.source == 'sale' ? 'inactive' : 'active',
      },
      deliveryToken: 'delivery-token',
      deliveryExpiresAt: '2026-08-05T18:10:00.000Z',
      recovered: false,
      fundingAssignment: command.source == 'sale'
          ? {
              'assignmentId': '10000000-0000-4000-8000-000000000041',
              'giftCardId': '10000000-0000-4000-8000-000000000040',
              'saleLineId': command.saleLineId,
              'purchasedValue': {
                'minorUnits': command.initialValueMinorUnits,
                'currency': command.currency,
              },
              'policyId': 'gift-card-sale-funding',
              'policyVersion': 'pilot-v1',
              'fingerprint': List.filled(64, '9').join(),
            }
          : null,
    );
  }

  @override
  Future<GiftCardSecretRevealResult> revealGiftCardSecret(
    String merchantId,
    GiftCardSecretRevealRequest command,
  ) async => const GiftCardSecretRevealResult(
    maskedReference: 'GFT-••••1234',
    code: 'TEST-ONLY-CODE',
    expiresAt: '2026-08-05T18:10:00.000Z',
  );

  @override
  Future<RewardAuthorization> authorizeReward(
    String merchantId,
    RewardAuthorizationRequest command,
  ) async {
    rewardCommand = command;
    return RewardAuthorization(
      id: '10000000-0000-4000-8000-000000000020',
      customerId: command.customerId,
      accountId: '10000000-0000-4000-8000-000000000021',
      rewardId: command.rewardId,
      saleId: command.saleId,
      checkoutVersion: command.checkoutVersion,
      points: 100,
      benefit: const {'minorUnits': 1000, 'currency': 'MXN'},
      rewardVersion: 1,
      policyVersion: 'pilot',
      fingerprint: List.filled(64, 'c').join(),
      status: 'authorized',
      createdAt: '2026-08-05T18:00:00.000Z',
      expiresAt: '2026-08-05T18:05:00.000Z',
    );
  }

  @override
  Future<RewardRelease> releaseReward(
    String merchantId,
    ValueReleaseRequest command,
  ) async => RewardRelease(
    authorizationId: command.authorizationId,
    status: 'released',
    releasedAt: '2026-08-05T18:01:00.000Z',
  );

  @override
  Future<StoredValueAuthorization> authorizeStoredValue(
    String merchantId,
    StoredValueAuthorizationRequest command,
  ) async {
    storedCommand = command;
    return StoredValueAuthorization(
      id: '10000000-0000-4000-8000-000000000022',
      accountType: command.accountType,
      accountId: command.accountId,
      customerId: command.customerId,
      currency: command.amount['currency']! as String,
      saleId: command.saleId,
      checkoutVersion: command.checkoutVersion,
      amountMinorUnits: command.amount['minorUnits']! as int,
      fingerprint: List.filled(64, 'd').join(),
      status: 'authorized',
      remainingBalanceMinorUnits: 4000,
      allocationId: command.allocationId,
      allocationOrder: command.allocationOrder,
      allocationFingerprint: List.filled(64, 'e').join(),
      createdAt: '2026-08-05T18:00:00.000Z',
      expiresAt: '2026-08-05T18:05:00.000Z',
      correlationId: 'customer-value-test',
    );
  }

  @override
  Future<StoredValueRelease> releaseStoredValue(
    String merchantId,
    ValueReleaseRequest command,
  ) async => StoredValueRelease(
    authorizationId: command.authorizationId,
    status: 'released',
    releasedAt: '2026-08-05T18:01:00.000Z',
  );
}

void main() {
  test('generated Dart contract reads the canonical fingerprint vector', () {
    final vector =
        jsonDecode(
              File(
                '../../packages/contract/test-vectors/customer-value-fingerprint-v1.json',
              ).readAsStringSync(),
            )
            as Map<String, Object?>;
    final input = StoredValueFingerprintInput.fromJson(
      vector['input']! as Map<String, Object?>,
    );
    expect(input.allocations, hasLength(2));
    expect(vector['expectedFingerprint'], hasLength(64));
  });

  test('search keeps the merchant-scoped masked customer projection', () async {
    final controller = CustomerValueController(FakeCustomerValueRepository());
    await controller.search(scope, 'Ana');
    expect(controller.state.customers.single.displayName, 'Ana');
    expect(
      controller.state.customers.single.contacts.single['displayValue'],
      '',
    );
    expect(
      controller.state.customers.single.contacts.single['maskedValue'],
      '••••1234',
    );
  });

  test('minimal customer creation does not infer consent', () async {
    final repository = FakeCustomerValueRepository();
    final controller = CustomerValueController(repository);
    await controller.create(scope, displayName: 'Ana', language: 'es');
    expect(repository.created?.contacts, isEmpty);
    expect(repository.created?.consents, isEmpty);
    expect(controller.state.selected?.displayName, 'Ana');
  });

  test('value preview stays server-authoritative', () async {
    final controller = CustomerValueController(FakeCustomerValueRepository());
    await controller.loadPreview(
      scope,
      saleId: '10000000-0000-4000-8000-000000000006',
      saleVersion: 1,
      customerId: customer().id,
      checkoutFingerprint: List.filled(64, 'b').join(),
    );
    expect(controller.state.preview?.earn?['expectedPoints'], 10);
  });

  test(
    'reward and wallet authorizations build one checkout selection',
    () async {
      final repository = FakeCustomerValueRepository();
      final controller = CustomerValueController(repository);
      const saleId = '10000000-0000-4000-8000-000000000006';
      await controller.loadPreview(
        scope,
        saleId: saleId,
        saleVersion: 1,
        customerId: customer().id,
        checkoutFingerprint: List.filled(64, 'b').join(),
      );
      expect(
        controller.selection()?.previewFingerprint,
        List.filled(64, 'a').join(),
      );
      await controller.authorizeReward(
        scope,
        saleId: saleId,
        saleVersion: 1,
        customerId: customer().id,
        rewardId: '10000000-0000-4000-8000-000000000007',
      );
      await controller.authorizeStoredValue(
        scope,
        accountType: 'wallet',
        accountId: '10000000-0000-4000-8000-000000000008',
        customerId: customer().id,
        saleId: saleId,
        saleVersion: 1,
        amountMinorUnits: 1000,
        currency: 'MXN',
        accountPublicReference: 'WAL-TEST',
      );
      expect(controller.selection()?.rewardAuthorizationId, isNotNull);
      expect(controller.selection()?.storedValueAuthorizationIds, hasLength(1));
      expect(
        repository.rewardCommand?.previewFingerprint,
        List.filled(64, 'a').join(),
      );
      expect(
        repository.storedCommand?.checkoutFingerprint,
        List.filled(64, 'a').join(),
      );
      final stored = controller.state.storedValueAuthorizations.single;
      await controller.releaseAuthorization(
        scope,
        authorizationId: stored.id,
        accountType: stored.accountType,
        fingerprint: stored.fingerprint,
      );
      expect(controller.selection()?.storedValueAuthorizationIds, isEmpty);
    },
  );

  test(
    'manual points adjustment keeps the preview command and exact approval binding',
    () async {
      final repository = FakeCustomerValueRepository();
      final controller = CustomerValueController(repository);
      await controller.select(scope, customer());
      final preview = await controller.previewPointsAdjustment(
        scope,
        direction: 'increase',
        points: 100,
        reason: 'customer_service_correction',
      );
      expect(preview?.projectedAvailable, 700);
      final commandId = repository.adjustmentCommand!.commandId;
      await controller.commitPointsAdjustment(
        scope,
        approvalId: '10000000-0000-4000-8000-000000000032',
        approvalFingerprint: preview!.fingerprint,
      );
      expect(repository.adjustmentCommand!.commandId, commandId);
      expect(
        repository.adjustmentCommand!.approvalFingerprint,
        preview.fingerprint,
      );
    },
  );

  test(
    'gift-card issuance recovers one card and reveals through a separate boundary',
    () async {
      final repository = FakeCustomerValueRepository();
      final controller = CustomerValueController(repository);
      final preview = await controller.previewGiftCardIssuance(
        scope,
        valueMinorUnits: 50000,
        currency: 'MXN',
      );
      final commandId = repository.issuanceCommand!.commandId;
      final issued = await controller.issueGiftCard(
        scope,
        approvalId: '10000000-0000-4000-8000-000000000032',
        approvalFingerprint: preview!.fingerprint,
      );
      expect(repository.issuanceCommand!.commandId, commandId);
      final secret = await controller.revealGiftCardSecret(
        scope,
        issued!.deliveryToken,
      );
      expect(secret?.code, 'TEST-ONLY-CODE');
      expect(controller.state.toString(), isNot(contains('TEST-ONLY-CODE')));
    },
  );

  test(
    'sale-funded issuance remains inactive until checkout selection',
    () async {
      final repository = FakeCustomerValueRepository();
      final controller = CustomerValueController(repository);
      await controller.loadPreview(
        scope,
        saleId: '10000000-0000-4000-8000-000000000006',
        saleVersion: 1,
        customerId: null,
        checkoutFingerprint: List.filled(64, 'b').join(),
      );
      final preview = await controller.previewGiftCardIssuance(
        scope,
        valueMinorUnits: 50000,
        currency: 'MXN',
        source: 'sale',
        saleId: '10000000-0000-4000-8000-000000000006',
        saleLineId: '10000000-0000-4000-8000-000000000042',
      );
      final issued = await controller.issueGiftCard(
        scope,
        approvalId: '10000000-0000-4000-8000-000000000032',
        approvalFingerprint: preview!.fingerprint,
      );
      expect(issued?.card['status'], 'inactive');
      expect(controller.selection()?.fundedGiftCards, hasLength(1));
      expect(repository.issuanceCommand?.saleLineId, isNotNull);
    },
  );
}
