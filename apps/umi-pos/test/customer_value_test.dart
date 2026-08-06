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
    CustomerSearchRequest query,
  ) async => const CustomerHistoryPage(nextCursor: null, entries: []);

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
  Future<GiftCard> giftCardLookup(
    String merchantId,
    GiftCardLookupRequest command,
  ) => throw UnimplementedError();

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
}
