import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/cart/cart_command_queue.dart';
import 'package:umi_pos/features/cart/cart_controller.dart';
import 'package:umi_pos/features/cart/cart_optimism.dart';
import 'package:umi_pos/features/cart/cart_repository.dart';
import 'package:umi_pos/features/kitchen/hub_command_forwarder.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';
import 'package:umi_pos/features/offline/offline_journal.dart';
import 'package:umi_pos/features/offline/replay_engine.dart';

const _merchantId = '00000000-0000-4000-8000-000000000002';
const _locationId = '00000000-0000-4000-8000-000000000003';
const _operatorSessionId = '00000000-0000-4000-8000-000000000004';
const _deviceId = '00000000-0000-4000-8000-000000000005';
const _productA = '00000000-0000-4000-8000-00000000000a';
const _productB = '00000000-0000-4000-8000-00000000000b';

Map<String, Object?> _money(int value) => {
  'minorUnits': value,
  'currency': 'MXN',
};

Map<String, Object?> _line({
  required String id,
  required String productId,
  required String name,
  int quantity = 1,
}) => {
  'id': id,
  'productId': productId,
  'productName': name,
  'saleAction': 'merchandise',
  'quantity': quantity,
  'courseNumber': 1,
  'variant': null,
  'modifiers': <Object?>[],
  'note': null,
  'fired': false,
  'price': {
    'unitPrice': _money(4500),
    'lineSubtotal': _money(4500 * quantity),
    'tax': _money(621 * quantity),
    'lineTotal': _money(4500 * quantity),
    'taxRateBasisPoints': 1600,
  },
};

Cart _cart({
  String id = '00000000-0000-4000-8000-000000000001',
  int version = 1,
  List<Map<String, Object?>> items = const [],
  bool fired = false,
}) => Cart(
  id: id,
  merchantId: _merchantId,
  locationId: _locationId,
  operatorSessionId: _operatorSessionId,
  status: 'draft',
  version: version,
  firedOrderId: fired ? '00000000-0000-4000-8000-0000000000f1' : null,
  fulfillmentType: 'dine_in',
  items: fired
      ? [
          for (final item in items) {...item, 'fired': true},
        ]
      : items,
  totals: const {
    'subtotal': {'minorUnits': 0, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Map<String, Object?>>[],
    },
    'grandTotal': {'minorUnits': 0, 'currency': 'MXN'},
    'businessDate': '2026-10-16',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CHECKOUT_GATE_NOT_AVAILABLE',
  updatedAt: '2026-10-16T12:00:00Z',
);

const _provisionalA = ProvisionalLine(
  productId: _productA,
  productName: 'Americano',
  saleAction: 'merchandise',
  unitMinorUnits: 4500,
  currency: 'MXN',
  taxRateBasisPoints: 1600,
);

const _provisionalB = ProvisionalLine(
  productId: _productB,
  productName: 'Latte',
  saleAction: 'merchandise',
  unitMinorUnits: 5800,
  currency: 'MXN',
  taxRateBasisPoints: 1600,
);

final class _QueuedRepository implements CartRepository {
  final IntList expectedVersions = IntList();
  final List<Completer<Cart>> requests = [];
  Object? addFailure;
  Cart current = _cart();
  int creates = 0;
  String? lastUpdatedLineId;
  int? lastUpdatedVersion;

  @override
  Future<Cart> create(String merchantId, CreateCartRequest request) async {
    creates += 1;
    return current;
  }

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    expectedVersions.add(input.expectedVersion);
    if (addFailure != null) {
      final failure = addFailure;
      addFailure = null;
      throw failure!;
    }
    final request = Completer<Cart>();
    requests.add(request);
    return request.future;
  }

  void answer(int index, List<Map<String, Object?>> items) {
    current = _cart(version: current.version + 1, items: items);
    requests[index].complete(current);
  }

  @override
  Future<Cart> read(String merchantId, CartQuery query) async => current;

  @override
  Future<Cart> update(
    String merchantId,
    String lineId,
    CartLineInput input,
  ) async {
    lastUpdatedLineId = lineId;
    lastUpdatedVersion = input.expectedVersion;
    current = _cart(version: current.version + 1, items: current.items);
    return current;
  }

  @override
  Future<Cart> remove(
    String merchantId,
    String lineId,
    RemoveCartLineRequest input,
  ) async => current;

  @override
  Future<Cart> prepare(String merchantId, PrepareSaleRequest input) async =>
      current;

  @override
  Future<Cart> clear(String merchantId, ClearCartRequest input) async {
    current = _cart(version: current.version + 1);
    return current;
  }

  @override
  Future<PosIncomingOrders> incomingOrders(
    String merchantId,
    CartQuery query,
  ) => throw UnimplementedError();

  @override
  Future<Cart> bindOrigin(String merchantId, BindCartOriginRequest input) =>
      throw UnimplementedError();

  @override
  Future<FireOrderResult> fire(String merchantId, FireOrderRequest request) =>
      throw UnimplementedError();

  @override
  Future<Cart> setFulfillment(
    String merchantId,
    SetCartFulfillmentRequest input,
  ) async => current;
}

final class _QueuedAccountsRepository extends _QueuedRepository
    implements OpenAccountCartRepository {
  Cart? openedCart;
  int openTableCalls = 0;
  String? lastTableId;
  int? lastPartySize;
  CartLineInput? lastLine;
  AppException? tableFailure;

  @override
  Future<Cart> add(String merchantId, CartLineInput input) async {
    lastLine = input;
    current = _cart(id: input.cartId, version: current.version + 1);
    return current;
  }

  @override
  Future<Cart> openTableAccount(
    String merchantId, {
    required CartQuery query,
    required String tableId,
    int? partySize,
    required String idempotencyKey,
  }) async {
    openTableCalls += 1;
    lastTableId = tableId;
    lastPartySize = partySize;
    if (tableFailure != null) throw tableFailure!;
    current = openedCart ?? _cart(id: '00000000-0000-4000-8000-000000000080');
    return current;
  }

  @override
  Future<List<Cart>> openAccounts(String merchantId, CartQuery query) async =>
      const [];

  @override
  Future<Cart> account(
    String merchantId,
    String cartId,
    CartQuery query,
  ) async => current;

  @override
  Future<Cart> suspendAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
    String? accountName,
    bool updateName = false,
  }) async => cart;

  @override
  Future<Cart> resumeAccount(
    String merchantId, {
    required Cart cart,
    required CartQuery query,
    required String idempotencyKey,
  }) async => cart;
}

final class _QueuedAccountDetailsRepository extends _QueuedRepository
    implements AccountDetailsCartRepository {
  int assignmentCalls = 0;
  String? assignedTableId;
  int? assignedVersion;

  @override
  Future<Cart> setAccountDetails(
    String merchantId,
    String cartId,
    SetCartAccountDetailsRequest request,
  ) async => current;

  @override
  Future<Cart> assignAccountTable(
    String merchantId,
    String cartId,
    AssignCartTableRequest request,
  ) async {
    assignmentCalls += 1;
    assignedTableId = request.tableId;
    assignedVersion = request.expectedVersion;
    current = Cart.fromJson({
      ...current.toJson(),
      'version': request.expectedVersion + 1,
      'tableId': request.tableId,
      'tableName': 'Mesa libre',
      'tableVisitId': '00000000-0000-4000-8000-0000000000f2',
    });
    return current;
  }
}

final class _TestJournalStore implements JournalCipherStore {
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

final class IntList {
  final List<int> values = [];
  void add(int value) => values.add(value);
}

final class _AcceptingGateway implements ReplayGateway {
  OfflinePolicy get _policy => OfflinePolicy(
    cash: OfflineCashPolicy(
      enabled: false,
      version: 'policy-1',
      issuedAt: DateTime.now().toUtc().toIso8601String(),
      expiresAt: DateTime.now()
          .toUtc()
          .add(const Duration(minutes: 10))
          .toIso8601String(),
      maxPolicyAgeSeconds: 600,
      merchantId: _merchantId,
      locationId: _locationId,
      deviceId: _deviceId,
      deviceCredentialVersion: 1,
      currency: 'MXN',
      requiredPermission: 'offline.cash.checkout',
      requiredEntitlement: 'pos.offline_cash',
      managerApprovalThresholdMinorUnits: null,
      allowedDeviceClasses: const ['pos_terminal'],
      limits: OfflinePolicyLimits(
        maxSingleSaleMinorUnits: 10000,
        maxAccumulatedMinorUnits: 30000,
        maxOfflineSaleCount: 3,
        maxActiveQueueDepth: 10,
        maxCommandAgeSeconds: 3600,
        maxCatalogAgeSeconds: 900,
        maxPricingAgeSeconds: 600,
        maxTaxAgeSeconds: 600,
      ).toJson(),
      correlationId: '00000000-0000-4000-8000-000000000099',
      fingerprint: List.filled(64, 'a').join(),
    ).toJson(),
    allowedCommandTypes: const [
      'operational.ack',
      'pos.cart.line.add',
      'pos.cart.line.update',
      'pos.cart.line.remove',
    ],
    maxBatchSize: 20,
    webSensitiveJournalEnabled: false,
  );

  @override
  Future<BeginReplayResponse> begin(ReplayScope scope) async =>
      BeginReplayResponse(
        replaySessionId: '00000000-0000-4000-8000-000000000091',
        cursor: ReplayCursor(
          deviceId: _deviceId,
          credentialVersion: 1,
          lastAcceptedSequence: 0,
          reconciliationRequired: false,
          updatedAt: DateTime.now().toUtc().toIso8601String(),
        ).toJson(),
        policy: _policy.toJson(),
      );

  @override
  Future<ReplayBatchResult> submit(ReplayScope scope, ReplayBatch batch) async {
    final results = [
      for (final encoded in batch.commands)
        ReplayResult(
          commandId: OfflineCommand.fromJson(encoded).commandId,
          deviceSequence: OfflineCommand.fromJson(encoded).deviceSequence,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
    ];
    return ReplayBatchResult(
      replaySessionId: batch.replaySessionId,
      results: results.map((result) => result.toJson()).toList(),
      cursor: ReplayCursor(
        deviceId: _deviceId,
        credentialVersion: 1,
        lastAcceptedSequence: results.last.deviceSequence,
        reconciliationRequired: false,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      ).toJson(),
      stopped: false,
    );
  }

  @override
  Future<ReconciliationSummary> reconcile(
    ReplayScope scope,
    ReconcileRequest request,
  ) async => ReconciliationSummary(
    reconciliationId: '00000000-0000-4000-8000-000000000092',
    deviceId: _deviceId,
    credentialVersion: 1,
    localLastAllocatedSequence: request.localLastAllocatedSequence,
    localLastAcknowledgedSequence: request.localLastAcknowledgedSequence,
    serverLastAcceptedSequence: 0,
    missingSequences: const [],
    duplicates: const [],
    conflicts: const [],
    provisionalMappings: const [],
    reconciliationRequired: false,
  );

  @override
  Future<void> acknowledge(ReplayScope scope, String reconciliationId) async {}

  @override
  Future<ConflictSummary> conflicts(ReplayScope scope) async =>
      const ConflictSummary(items: []);

  @override
  Future<ResolvedReplayConflict> resolveConflict(
    ReplayScope scope,
    String commandId,
  ) async => ResolvedReplayConflict(
    resolved: true,
    commandId: commandId,
    deviceSequence: 1,
    nextAcceptedSequence: 1,
  );

  @override
  Future<ReplayCursor> cursor(ReplayScope scope) async => ReplayCursor(
    deviceId: _deviceId,
    credentialVersion: 1,
    lastAcceptedSequence: 2,
    reconciliationRequired: false,
    updatedAt: DateTime.now().toUtc().toIso8601String(),
  );

  @override
  Future<SafeReplayDiagnostic> diagnostics(ReplayScope scope) =>
      throw UnimplementedError();

  @override
  Future<OfflinePolicy> policy(ReplayScope scope) async => _policy;

  @override
  Future<ReplayResult?> resultFor(ReplayScope scope, String commandId) async =>
      null;
}

({
  CartController controller,
  _QueuedRepository repository,
  ConnectivityController connectivity,
  EncryptedOfflineJournal journal,
})
_setup({
  _QueuedRepository? repository,
  ConnectivityController? connectivity,
  EncryptedOfflineJournal? journal,
  OfflineRecoveryController? recovery,
}) {
  repository ??= _QueuedRepository();
  connectivity ??= ConnectivityController();
  journal ??= EncryptedOfflineJournal(_TestJournalStore(), web: false);
  final controller = CartController(
    repository: repository,
    telemetry: const SafeTelemetry(
      enabled: false,
      context: TelemetryContext(
        environment: 'test',
        appVersion: 'test',
        platform: 'test',
      ),
      exporter: NoopTelemetryExporter(),
    ),
    offlineJournal: journal,
    deviceIdentity: () =>
        const CartDeviceIdentity(deviceId: _deviceId, credentialVersion: 1),
    connectivity: connectivity,
    recovery: recovery,
  );
  return (
    controller: controller,
    repository: repository,
    connectivity: connectivity,
    journal: journal,
  );
}

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  test(
    'sync preserves exact line IDs for different notes on one product',
    () async {
      final repository = _SyncReadRepository();
      final value = _setup(repository: repository);
      addTearDown(value.controller.dispose);
      addTearDown(value.connectivity.dispose);
      final original = {
        ..._line(
          id: '00000000-0000-4000-8000-0000000000c1',
          productId: _productA,
          name: 'Americano',
        ),
        'note': 'normal',
      };
      value.controller.restore(_cart(items: [original]));
      await _settle();
      value.connectivity.networkDown();
      await value.controller.add(
        productId: _productA,
        quantity: 3,
        note: 'sin azúcar',
        provisional: _provisionalA,
      );
      await _settle();
      final command = (await value.journal.load()).entries.single.command;
      final added = CartItem.fromJson(
        value.controller.state.cart!.items.singleWhere(
          (item) => item['note'] == 'sin azúcar',
        ),
      );
      repository.current = Cart.fromJson({
        ..._serverSnapshot(version: 2).toJson(),
        'items': [
          original,
          {
            ..._line(
              id: added.id,
              productId: _productA,
              name: 'Americano',
              quantity: 3,
            ),
            'note': 'sin azúcar',
          },
        ],
      });
      repository.wait = Completer<Cart>();
      await value.journal.apply(
        ReplayResult(
          commandId: command.commandId,
          deviceSequence: command.deviceSequence,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      );
      await _settle();
      await value.controller.remove(added);
      await _settle();
      repository.wait!.complete(repository.current);
      await _settle();
      final remaining = value.controller.state.cart!.items.single;
      expect(remaining['id'], '00000000-0000-4000-8000-0000000000c1');
      expect(remaining['quantity'], 1);
      expect((await value.journal.load()).pendingCount, 1);
    },
  );

  test(
    'a later manual sync retries a failed read without repeating a write',
    () async {
      final repository = _SyncReadRepository();
      final journal = EncryptedOfflineJournal(_TestJournalStore(), web: false);
      final connectivity = ConnectivityController()..networkDown();
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: _AcceptingGateway(),
        connectivity: connectivity,
      );
      final value = _setup(
        repository: repository,
        journal: journal,
        connectivity: connectivity,
        recovery: recovery,
      );
      addTearDown(value.controller.dispose);
      addTearDown(connectivity.dispose);
      addTearDown(recovery.dispose);
      value.controller.restore(_cart());
      await _settle();
      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();
      final command = (await journal.load()).entries.single.command;
      repository.failure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
      await journal.apply(
        ReplayResult(
          commandId: command.commandId,
          deviceSequence: command.deviceSequence,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      );
      await _settle();
      expect(value.controller.hasPendingLocalWrites, isTrue);
      repository.failure = null;
      repository.current = _serverSnapshot(version: 7);
      await recovery.recover(
        const ReplayScope(
          deviceId: _deviceId,
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorSessionId,
          credentialVersion: 1,
        ),
      );
      await _settle();
      expect(value.controller.state.cart!.version, 7);
      expect(value.controller.hasPendingLocalWrites, isFalse);
      expect(
        (await journal.load()).entries.single.status,
        JournalStatus.accepted,
      );
      expect(repository.accountIds, hasLength(2));
      expect(repository.requests, isEmpty);
    },
  );

  test('sync reads the official account after an offline open', () async {
    final repository = _SyncReadRepository();
    final value = _setup(repository: repository);
    addTearDown(value.controller.dispose);
    addTearDown(value.connectivity.dispose);
    value.connectivity.networkDown();
    await value.controller.open(_merchantId, _locationId, _operatorSessionId);
    await _settle();
    final provisionalId = value.controller.state.cart!.id;
    final open = (await value.journal.load()).entries.single.command;
    repository.current = _serverSnapshot(version: 6);
    await value.journal.apply(
      ReplayResult(
        commandId: open.commandId,
        deviceSequence: open.deviceSequence,
        status: 'accepted',
        officialId: repository.current.id,
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      ),
    );
    await _settle();
    expect(repository.accountIds, [repository.current.id]);
    expect(value.controller.state.cart!.id, isNot(provisionalId));
    expect(value.controller.state.cart!.id, repository.current.id);
    expect(value.controller.state.cart!.version, 6);
    expect(
      value.controller.state.cart!.items.single['id'],
      '00000000-0000-4000-8000-0000000000c1',
    );
    expect(
      (value.controller.state.cart!.totals['grandTotal']! as Map)['minorUnits'],
      4500,
    );
    expect(value.controller.hasPendingLocalWrites, isFalse);
  });

  test('sync preserves a tap while the API snapshot is pending', () async {
    final repository = _SyncReadRepository();
    final value = _setup(repository: repository);
    addTearDown(value.controller.dispose);
    addTearDown(value.connectivity.dispose);
    value.controller.restore(_cart());
    await _settle();
    value.connectivity.networkDown();
    await value.controller.add(
      productId: _productA,
      provisional: _provisionalA,
    );
    await _settle();
    final command = (await value.journal.load()).entries.single.command;
    repository.current = _serverSnapshot(version: 2);
    repository.wait = Completer<Cart>();
    await value.journal.apply(
      ReplayResult(
        commandId: command.commandId,
        deviceSequence: command.deviceSequence,
        status: 'accepted',
        officialId: null,
        officialCommit: null,
        serverConflictReference: null,
        failure: null,
      ),
    );
    await _settle();
    expect(repository.accountIds, hasLength(1));
    value.connectivity.apiReachable(authorityValid: true);
    value.connectivity.apiReachable(authorityValid: true);
    await value.controller.add(
      productId: _productB,
      provisional: _provisionalB,
    );
    await _settle();
    repository.wait!.complete(repository.current);
    await _settle();
    expect(value.controller.state.cart!.items, hasLength(2));
    expect(
      (value.controller.state.cart!.totals['grandTotal']! as Map)['minorUnits'],
      10300,
    );
    expect(value.controller.hasPendingLocalWrites, isTrue);
    expect((await value.journal.load()).pendingCount, 1);
    expect(repository.requests, isEmpty);
  });

  for (final changeAccount in [true, false]) {
    test(
      'late sync cannot replace a newer selection: $changeAccount',
      () async {
        final repository = _SyncReadRepository();
        final value = _setup(repository: repository);
        addTearDown(value.controller.dispose);
        addTearDown(value.connectivity.dispose);
        value.controller.restore(_cart());
        await _settle();
        value.connectivity.networkDown();
        await value.controller.add(
          productId: _productA,
          provisional: _provisionalA,
        );
        await _settle();
        final command = (await value.journal.load()).entries.single.command;
        repository.current = _serverSnapshot(version: 2);
        repository.wait = Completer<Cart>();
        await value.journal.apply(
          ReplayResult(
            commandId: command.commandId,
            deviceSequence: command.deviceSequence,
            status: 'accepted',
            officialId: null,
            officialCommit: null,
            serverConflictReference: null,
            failure: null,
          ),
        );
        await _settle();
        final selected = _serverSnapshot(
          id: changeAccount
              ? '00000000-0000-4000-8000-000000000088'
              : repository.current.id,
          version: 9,
        );
        value.controller.clearLocal();
        value.controller.restore(selected);
        repository.wait!.complete(repository.current);
        await _settle();
        expect(value.controller.state.cart!.id, selected.id);
        expect(value.controller.state.cart!.version, 9);
      },
    );
  }

  test(
    'failed sync retains the local projection and confirmed history',
    () async {
      final repository = _SyncReadRepository();
      final value = _setup(repository: repository);
      addTearDown(value.controller.dispose);
      addTearDown(value.connectivity.dispose);
      value.controller.restore(_cart());
      await _settle();
      value.connectivity.networkDown();
      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();
      final command = (await value.journal.load()).entries.single.command;
      repository.failure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
      await value.journal.apply(
        ReplayResult(
          commandId: command.commandId,
          deviceSequence: command.deviceSequence,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      );
      await _settle();
      expect(value.controller.state.cart!.items, hasLength(1));
      expect(value.controller.hasPendingLocalWrites, isTrue);
      final snapshot = await value.journal.load();
      expect(snapshot.pendingCount, 0);
      expect(snapshot.entries.single.status, JournalStatus.accepted);
      expect(repository.requests, isEmpty);
    },
  );

  test(
    'resolved history does not keep accepted cart commands pending',
    () async {
      final value = _setup();
      addTearDown(value.controller.dispose);
      addTearDown(value.connectivity.dispose);
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);
      await _settle();
      final historical = await value.journal.append(
        commandId: cartCommandId(),
        deviceId: _deviceId,
        credentialVersion: 1,
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        idempotencyKey: cartCommandId(),
        commandType: 'pos.cart.line.update',
        payload: {'cartId': '00000000-0000-4000-8000-000000000099'},
      );
      await value.journal.apply(
        ReplayResult(
          commandId: historical.commandId,
          deviceSequence: historical.deviceSequence,
          status: 'conflict',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: {'classification': 'version_conflict'},
        ),
      );
      await value.journal.resolveConflictAndRetryFollowing(
        historical.commandId,
      );
      value.connectivity.networkDown();
      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();
      final pending = (await value.journal.load()).entries.last.command;
      value.repository.current = _cart(
        version: 2,
        items: [
          _line(
            id: '00000000-0000-4000-8000-0000000000c1',
            productId: _productA,
            name: 'Americano',
          ),
        ],
      );
      await value.journal.apply(
        ReplayResult(
          commandId: pending.commandId,
          deviceSequence: pending.deviceSequence,
          status: 'accepted',
          officialId: null,
          officialCommit: null,
          serverConflictReference: null,
          failure: null,
        ),
      );
      await _settle();

      final snapshot = await value.journal.load();
      expect(snapshot.pendingCount, 0);
      expect(snapshot.entries.first.status, JournalStatus.resolved);
      expect(snapshot.entries, hasLength(2));
      expect(value.controller.hasPendingLocalWrites, isFalse);
      expect(value.controller.hasPendingForCurrentCart, isFalse);
      expect(value.controller.state.cart!.version, 2);
    },
  );

  test('a second tap paints while the first request is still open', () async {
    final value = _setup();
    await value.controller.open(_merchantId, _locationId, _operatorSessionId);

    expect(
      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      ),
      isTrue,
    );
    await _settle();
    expect(value.controller.state.cart!.items, hasLength(1));
    expect(value.repository.expectedVersions.values, [1]);

    expect(
      await value.controller.add(
        productId: _productB,
        provisional: _provisionalB,
      ),
      isTrue,
    );
    expect(value.controller.state.cart!.items, hasLength(2));
    await _settle();

    value.repository.answer(0, [
      _line(
        id: '00000000-0000-4000-8000-0000000000c1',
        productId: _productA,
        name: 'Americano',
      ),
    ]);
    await _settle();
    expect(value.repository.expectedVersions.values, [1, 2]);
    expect(
      value.controller.state.cart!.items,
      hasLength(2),
      reason: 'the second local command stays painted',
    );

    value.repository.answer(1, [
      _line(
        id: '00000000-0000-4000-8000-0000000000c1',
        productId: _productA,
        name: 'Americano',
      ),
      _line(
        id: '00000000-0000-4000-8000-0000000000c2',
        productId: _productB,
        name: 'Latte',
      ),
    ]);
    await _settle();
    expect(value.controller.isWriting, isFalse);
    expect(value.controller.state.cart!.version, 3);
    expect(value.controller.state.cart!.items, hasLength(2));
    value.controller.dispose();
  });

  test(
    'a known-offline tap enters the encrypted journal without a request',
    () async {
      final value = _setup();
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);
      value.connectivity.networkDown();

      expect(
        await value.controller.add(
          productId: _productA,
          provisional: _provisionalA,
        ),
        isTrue,
      );
      await _settle();

      expect(value.repository.expectedVersions.values, isEmpty);
      expect(value.controller.state.cart!.items, hasLength(1));
      expect(value.controller.pendingSyncCount, 1);
      expect(await value.controller.fire(), isNotNull);
      await _settle();
      final snapshot = await value.journal.load();
      expect(snapshot.pendingCount, 2);
      expect(snapshot.entries.map((entry) => entry.command.commandType), [
        'pos.cart.line.add',
        'pos.cart.fire',
      ]);
      expect(
        value.controller.state.cart!.items.every(
          (item) => item['fired'] == true,
        ),
        isTrue,
      );
      value.controller.dispose();
    },
  );

  test(
    'the active account stays selectable while its local queue is pending',
    () async {
      final repository = _QueuedAccountsRepository();
      final value = _setup(repository: repository);
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);
      await _settle();
      value.connectivity.networkDown();

      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();
      final active = value.controller.state.cart!;
      expect(value.controller.isWriting, isFalse);
      expect(value.controller.hasPendingLocalWrites, isTrue);
      expect(value.controller.pendingSyncCount, greaterThan(0));

      // Local durability is not a lock: the next line can still be painted and
      // queued behind the first one while the API is unavailable.
      expect(
        await value.controller.add(
          productId: _productB,
          provisional: _provisionalB,
        ),
        isTrue,
      );
      expect(value.controller.state.cart!.items, hasLength(2));

      expect(
        await value.controller.resumeAccount(
          account: active,
          operatorSessionId: _operatorSessionId,
        ),
        isTrue,
      );
      expect(value.controller.state.cart!.id, active.id);
      value.controller.dispose();
    },
  );

  test(
    'table assignment queues behind a line that is already painted',
    () async {
      const tableId = '00000000-0000-4000-8000-000000000042';
      final repository = _QueuedAccountDetailsRepository();
      final value = _setup(repository: repository);
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);

      expect(
        await value.controller.add(
          productId: _productA,
          provisional: _provisionalA,
        ),
        isTrue,
      );
      await _settle();
      expect(value.controller.hasPendingLocalWrites, isTrue);
      expect(value.controller.isWriting, isTrue);

      expect(await value.controller.assignAccountTable(tableId), isTrue);
      expect(value.controller.state.cart!.tableId, tableId);
      expect(repository.assignmentCalls, 0);
      expect(value.controller.state.errorCode, isNull);

      repository.answer(0, [
        _line(
          id: '00000000-0000-4000-8000-0000000000c1',
          productId: _productA,
          name: 'Americano',
        ),
      ]);
      await _settle();

      expect(repository.assignmentCalls, 1);
      expect(repository.assignedTableId, tableId);
      expect(repository.assignedVersion, 2);
      expect(value.controller.state.cart!.tableId, tableId);
      expect(value.controller.state.errorCode, isNull);
      value.controller.dispose();
    },
  );

  test(
    'switching accounts preserves a painted command before clearing',
    () async {
      final value = _setup();
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);

      expect(
        await value.controller.add(
          productId: _productA,
          provisional: _provisionalA,
        ),
        isTrue,
      );
      await _settle();
      expect(value.controller.hasPendingLocalWrites, isTrue);

      expect(await value.controller.preserveForAccountSwitch(), isTrue);
      final snapshot = await value.journal.load();
      expect(snapshot.pendingCount, 1);
      expect(snapshot.entries.single.command.commandType, 'pos.cart.line.add');

      value.controller.clearLocal();
      expect(value.controller.state.cart, isNull);
      expect((await value.journal.load()).pendingCount, 1);
      value.controller.dispose();
    },
  );

  test(
    'a new offline account opens locally before the API can answer',
    () async {
      final value = _setup();
      value.connectivity.networkDown();

      await value.controller.open(_merchantId, _locationId, _operatorSessionId);
      expect(value.repository.creates, 0);
      expect(value.controller.state.cart, isNotNull);

      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();

      expect(value.repository.creates, 0);
      expect(value.controller.state.cart!.items, hasLength(1));
      final snapshot = await value.journal.load();
      expect(snapshot.pendingCount, 2);
      expect(snapshot.entries.map((entry) => entry.command.commandType), [
        'pos.cart.open',
        'pos.cart.line.add',
      ]);
      value.controller.dispose();
    },
  );

  test('an offline table account is one durable command group', () async {
    final repository = _QueuedAccountsRepository();
    final value = _setup(repository: repository);
    value.connectivity.networkDown();

    expect(
      await value.controller.openTableAccount(
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        tableId: '00000000-0000-4000-8000-000000000042',
        tableName: 'Mesa 2',
        partySize: 4,
      ),
      isTrue,
    );
    await _settle();

    final snapshot = await value.journal.load();
    expect(snapshot.entries, hasLength(1));
    final command = snapshot.entries.single.command;
    expect(command.commandType, 'pos.command.group');
    expect(command.provisionalId, value.controller.state.cart!.id);
    expect(command.payload['groupId'], command.idempotencyKey);
    expect(command.payload['aggregateKeys'], [
      'account:${value.controller.state.cart!.id}',
      'table:00000000-0000-4000-8000-000000000042',
    ]);
    expect(
      (command.payload['effects'] as List<Object?>).single,
      containsPair('partySize', 4),
    );
    expect(repository.creates, 0);
    expect(repository.openTableCalls, 0);
    value.controller.dispose();
  });

  test('a server-confirmed busy table is not queued as local work', () async {
    final repository = _QueuedAccountsRepository()
      ..tableFailure = const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_ACTOR_BUSY',
        recoverable: true,
      );
    final value = _setup(repository: repository);

    expect(
      await value.controller.openTableAccount(
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        tableId: '00000000-0000-4000-8000-000000000042',
        tableName: 'Mesa 2',
      ),
      isFalse,
    );

    expect(value.controller.state.cart, isNull);
    expect(value.controller.state.errorCode, 'CART_ACTOR_BUSY');
    expect((await value.journal.load()).pendingCount, 0);
    value.controller.dispose();
  });

  test('a command group maps its provisional cart to later commands', () async {
    const provisionalCartId = '00000000-0000-4000-8000-000000000001';
    const officialCartId = '00000000-0000-4000-8000-000000000080';
    final repository = _QueuedAccountsRepository();
    final journal = EncryptedOfflineJournal(_TestJournalStore(), web: false);
    final queue = CartCommandQueue(
      repository: repository,
      journal: journal,
      scope: () => const CartCommandScope(
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        deviceId: _deviceId,
        credentialVersion: 1,
      ),
      onCart: (_) {},
      onError: (error) => fail(error.code),
      onEvent: (_) {},
      onBusy: (_) {},
    );
    queue.initialize(_cart());
    final groupId = cartCommandId();
    queue.submit(
      QueuedCartCommand(
        commandId: groupId,
        commandType: 'pos.command.group',
        idempotencyKey: groupId,
        payload: {
          'groupId': groupId,
          'aggregateKeys': [
            'account:$provisionalCartId',
            'table:00000000-0000-4000-8000-000000000042',
          ],
          'effects': [
            {
              'type': 'open_table_account',
              'provisionalCartId': provisionalCartId,
              'tableId': '00000000-0000-4000-8000-000000000042',
              'partySize': 4,
            },
          ],
        },
        event: 'table_account_opened',
        predict: (base, _) => base,
      ),
    );
    await _settle();

    expect(repository.openTableCalls, 1);
    expect(repository.lastTableId, '00000000-0000-4000-8000-000000000042');
    expect(repository.lastPartySize, 4);

    final lineId = cartCommandId();
    queue.submit(
      QueuedCartCommand(
        commandId: lineId,
        commandType: 'pos.cart.line.add',
        idempotencyKey: lineId,
        payload: CartLineInput(
          cartId: provisionalCartId,
          locationId: _locationId,
          operatorSessionId: _operatorSessionId,
          productId: _productA,
          variantId: null,
          modifierSelections: const [],
          quantity: 1,
          courseNumber: 1,
          note: null,
          expectedVersion: 1,
          idempotencyKey: lineId,
        ).toJson(),
        event: 'cart_line_added',
        predict: (base, _) => base,
      ),
    );
    await _settle();

    expect(repository.lastLine?.cartId, officialCartId);
    queue.dispose();
  });

  test(
    'a quantity command waits for the added line id and uses the next version',
    () async {
      final value = _setup();
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);

      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();
      final provisional = CartItem.fromJson(
        value.controller.state.cart!.items.single,
      );
      await value.controller.quantity(provisional, 2);

      value.repository.answer(0, [
        _line(
          id: '00000000-0000-4000-8000-0000000000c1',
          productId: _productA,
          name: 'Americano',
        ),
      ]);
      await _settle();

      expect(
        value.repository.lastUpdatedLineId,
        '00000000-0000-4000-8000-0000000000c1',
      );
      expect(value.repository.lastUpdatedVersion, 2);
      value.controller.dispose();
    },
  );

  test('a LAN peer journals before it forwards to the hub', () async {
    final repository = _QueuedRepository();
    final journal = EncryptedOfflineJournal(_TestJournalStore(), web: false);
    final gateway = _HubGateway();
    final forwarder = HubCommandForwarder(journal: journal, gateway: gateway);
    final queue = CartCommandQueue(
      repository: repository,
      journal: journal,
      scope: () => const CartCommandScope(
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        deviceId: _deviceId,
        credentialVersion: 1,
      ),
      onCart: (_) {},
      onError: (error) => fail(error.code),
      onEvent: (_) {},
      onBusy: (_) {},
      hub: forwarder,
    );
    queue.initialize(_cart());
    final commandId = cartCommandId();
    queue.submit(
      QueuedCartCommand(
        commandId: commandId,
        commandType: 'pos.cart.line.add',
        idempotencyKey: commandId,
        payload: CartLineInput(
          cartId: _cart().id,
          locationId: _locationId,
          operatorSessionId: _operatorSessionId,
          productId: _productA,
          variantId: null,
          modifierSelections: const [],
          quantity: 1,
          courseNumber: 1,
          note: null,
          expectedVersion: 1,
          idempotencyKey: commandId,
        ).toJson(),
        event: 'cart_line_added',
        predict: (base, _) => base,
      ),
    );
    await _settle();

    var entry = (await journal.load()).entries.single;
    expect(entry.command.hubOwned, isTrue);
    expect(entry.hubDeliveryState, 'queued');
    expect(repository.expectedVersions.values, isEmpty);
    expect(gateway.submits, 1);

    await forwarder.forwardNow();
    await _settle();

    entry = (await journal.load()).entries.single;
    expect(entry.status, JournalStatus.accepted);
    expect((await journal.load()).pendingCount, 0);
    expect(repository.expectedVersions.values, isEmpty);
    queue.dispose();
    forwarder.dispose();
  });

  test('a lost response journals every painted command once', () async {
    final value = _setup();
    await value.controller.open(_merchantId, _locationId, _operatorSessionId);
    value.repository.addFailure = const AppException(
      category: AppErrorCategory.transport,
      code: 'TRANSPORT_FAILURE',
      recoverable: true,
    );

    await value.controller.add(
      productId: _productA,
      provisional: _provisionalA,
    );
    await value.controller.add(
      productId: _productB,
      provisional: _provisionalB,
    );
    await _settle();

    final snapshot = await value.journal.load();
    expect(snapshot.pendingCount, 2);
    expect(snapshot.entries.map((entry) => entry.command.commandType), [
      'pos.cart.line.add',
      'pos.cart.line.add',
    ]);
    expect(value.controller.state.cart!.items, hasLength(2));
    value.controller.dispose();
  });

  test(
    'a gateway error keeps a command that may have reached the API',
    () async {
      final value = _setup();
      await value.controller.open(_merchantId, _locationId, _operatorSessionId);
      value.repository.addFailure = const AppException(
        category: AppErrorCategory.server,
        code: 'INVALID_ERROR_RESPONSE',
        recoverable: false,
      );

      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      );
      await _settle();

      expect((await value.journal.load()).pendingCount, 1);
      expect(value.controller.state.cart!.items, hasLength(1));
      value.controller.dispose();
    },
  );

  test(
    'reconnect replays the journal and replaces the local projection',
    () async {
      final repository = _QueuedRepository();
      final connectivity = ConnectivityController();
      final journal = EncryptedOfflineJournal(_TestJournalStore(), web: false);
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: _AcceptingGateway(),
        connectivity: connectivity,
      );
      final controller = CartController(
        repository: repository,
        telemetry: const SafeTelemetry(
          enabled: false,
          context: TelemetryContext(
            environment: 'test',
            appVersion: 'test',
            platform: 'test',
          ),
          exporter: NoopTelemetryExporter(),
        ),
        offlineJournal: journal,
        deviceIdentity: () =>
            const CartDeviceIdentity(deviceId: _deviceId, credentialVersion: 1),
        connectivity: connectivity,
        recovery: recovery,
      );
      await controller.open(_merchantId, _locationId, _operatorSessionId);
      repository.addFailure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
      await controller.add(productId: _productA, provisional: _provisionalA);
      await _settle();
      expect((await journal.load()).pendingCount, 1);

      repository.current = _cart(
        version: 2,
        items: [
          _line(
            id: '00000000-0000-4000-8000-0000000000c1',
            productId: _productA,
            name: 'Americano',
          ),
        ],
      );
      connectivity.apiReachable(authorityValid: true);
      connectivity.apiReachable(authorityValid: true);
      await Future<void>.delayed(const Duration(milliseconds: 80));

      expect((await journal.load()).pendingCount, 0);
      expect(controller.isWriting, isFalse);
      expect(controller.state.cart!.version, 2);
      expect(controller.state.cart!.items, hasLength(1));
      controller.dispose();
      recovery.dispose();
    },
  );

  test(
    'recovery does not repaint a previous-process account over a clean till',
    () async {
      final repository = _QueuedRepository();
      final connectivity = ConnectivityController();
      connectivity.apiReachable(authorityValid: true);
      connectivity.apiReachable(authorityValid: true);
      final journal = EncryptedOfflineJournal(_TestJournalStore(), web: false);
      await journal.append(
        commandId: cartCommandId(),
        deviceId: _deviceId,
        credentialVersion: 1,
        merchantId: _merchantId,
        locationId: _locationId,
        operatorSessionId: _operatorSessionId,
        idempotencyKey: cartCommandId(),
        commandType: 'pos.cart.open',
        payload: {'cartId': '00000000-0000-4000-8000-000000000099'},
      );
      final recovery = OfflineRecoveryController(
        journal: journal,
        gateway: _AcceptingGateway(),
        connectivity: connectivity,
      );
      final controller = CartController(
        repository: repository,
        telemetry: const SafeTelemetry(
          enabled: false,
          context: TelemetryContext(
            environment: 'test',
            appVersion: 'test',
            platform: 'test',
          ),
          exporter: NoopTelemetryExporter(),
        ),
        offlineJournal: journal,
        deviceIdentity: () =>
            const CartDeviceIdentity(deviceId: _deviceId, credentialVersion: 1),
        connectivity: connectivity,
        recovery: recovery,
      );

      await recovery.recover(
        const ReplayScope(
          deviceId: _deviceId,
          merchantId: _merchantId,
          locationId: _locationId,
          operatorSessionId: _operatorSessionId,
          credentialVersion: 1,
        ),
      );
      await _settle();

      expect((await journal.load()).pendingCount, 0);
      expect(controller.state.cart, isNull);
      controller.dispose();
      recovery.dispose();
    },
  );

  test('a fire is journaled before the fired cart is painted', () async {
    final value = _setup();
    await value.controller.open(_merchantId, _locationId, _operatorSessionId);
    expect(
      await value.controller.add(
        productId: _productA,
        provisional: _provisionalA,
      ),
      isTrue,
    );
    await _settle();

    final result = await value.controller.fire();

    expect(result, isNotNull);
    final snapshot = await value.journal.load();
    final fire = snapshot.entries.firstWhere(
      (entry) => entry.command.commandType == 'pos.cart.fire',
    );
    expect(fire.status, JournalStatus.pending);
    expect(value.controller.state.cart!.items.single['fired'], isTrue);
    value.controller.dispose();
  });
}

final class _HubGateway implements HubCommandGateway {
  int submits = 0;

  @override
  Future<HubCommandReceipt> submit(OfflineCommand command) async {
    submits += 1;
    return const HubCommandReceipt(
      commandId: '00000000-0000-4000-8000-0000000000d1',
      deviceSequence: 12,
      queued: true,
      duplicate: false,
    );
  }

  @override
  Future<HubCommandState> status(OfflineCommand command) async =>
      const HubCommandState(
        status: 'accepted',
        errorCode: null,
        officialId: null,
        officialCommit: null,
        failure: null,
        deviceSequence: 12,
      );

  @override
  Future<HubConflictResolution> resolveConflict(OfflineCommand command) async =>
      const HubConflictResolution(resolved: true, status: 'resolved');
}

final class _SyncReadRepository extends _QueuedRepository
    implements OpenAccountCartRepository {
  final accountIds = <String>[];
  Completer<Cart>? wait;
  Object? failure;

  @override
  Future<Cart> account(
    String merchantId,
    String cartId,
    CartQuery query,
  ) async {
    accountIds.add(cartId);
    if (cartId != current.id) {
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'CART_NOT_FOUND',
        recoverable: true,
      );
    }
    if (failure != null) throw failure!;
    return wait?.future ?? current;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Cart _serverSnapshot({
  String id = '00000000-0000-4000-8000-000000000001',
  int version = 2,
}) => Cart.fromJson({
  ..._cart(
    id: id,
    version: version,
    items: [
      _line(
        id: '00000000-0000-4000-8000-0000000000c1',
        productId: _productA,
        name: 'Americano',
      ),
    ],
  ).toJson(),
  'totals': {
    'subtotal': _money(4500),
    'tax': _money(621),
    'discounts': {'total': _money(0), 'entries': <Map<String, Object?>>[]},
    'grandTotal': _money(4500),
    'businessDate': '2026-10-27',
  },
});
