import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/features/inventory/inventory_controller.dart';
import 'package:umi_pos/features/inventory/inventory_repository.dart';
import 'package:umi_pos/features/inventory/inventory_surface.dart';

const scope = InventoryScope(
  merchantId: '00000000-0000-4000-8000-000000000001',
  locationId: '00000000-0000-4000-8000-000000000002',
  operatorSessionId: '00000000-0000-4000-8000-000000000003',
);

class _InventoryFake implements InventoryRepository {
  _InventoryFake({
    this.withRestock = false,
    this.paginatedHistory = false,
    this.recoverCreateCount = false,
    this.recoverSubmitCount = false,
    this.recoverReconcileCount = false,
    this.withActiveCount = false,
  });

  final bool withRestock;
  final bool paginatedHistory;
  final bool recoverCreateCount;
  final bool recoverSubmitCount;
  final bool recoverReconcileCount;
  final bool withActiveCount;
  int historyCalls = 0;
  RestockCommand? restockCommand;

  @override
  Future<InventoryOverview> overview(
    String merchantId,
    InventoryQuery query,
  ) async => InventoryOverview(
    policy: {
      'version': 'pilot-3e',
      'fingerprint': List.filled(64, 'a').join(),
      'offlineMutationsAllowed': false,
    },
    locations: [
      {
        'id': '00000000-0000-4000-8000-000000000004',
        'displayName': 'Almacén principal',
        'version': 1,
      },
    ],
    items: [
      {
        'id': '00000000-0000-4000-8000-000000000005',
        'displayName': 'Café en grano',
        'publicReference': 'CAFE-01',
        'baseUnit': 'gram',
        'scale': 0,
        'version': 1,
      },
    ],
    balances: [
      {
        'inventoryItemId': '00000000-0000-4000-8000-000000000005',
        'onHand': 1000,
        'reserved': 100,
        'available': 900,
        'version': 1,
      },
    ],
    restockReviews: withRestock
        ? [
            {
              'restockIntentId': '00000000-0000-4000-8000-000000000010',
              'exceptionId': '00000000-0000-4000-8000-000000000011',
              'saleLineId': '00000000-0000-4000-8000-000000000012',
              'decision': 'unknown_until_inventory_review',
              'quantity': 1,
              'version': 1,
              'status': 'review_required',
              'components': [
                {
                  'inventoryItemId': '00000000-0000-4000-8000-000000000013',
                  'displayName': 'Botella retornable',
                  'publicReference': 'BOT-RET',
                  'maximum': {'value': 1, 'scale': 0, 'unit': 'unit'},
                  'recipeEffect': false,
                },
                {
                  'inventoryItemId': '00000000-0000-4000-8000-000000000014',
                  'displayName': 'Café en grano',
                  'publicReference': 'CAFE-GRA',
                  'maximum': {'value': 10, 'scale': 0, 'unit': 'gram'},
                  'recipeEffect': true,
                },
              ],
            },
          ]
        : const [],
    activeCount: withActiveCount
        ? _countResult(
            merchantId: merchantId,
            locationId: query.locationId,
            inventoryLocationId: '00000000-0000-4000-8000-000000000004',
          ).toJson()
        : null,
    page: const {'limit': 100, 'hasMore': false, 'nextCursor': null},
  );

  @override
  Future<InventoryHistoryResult> history(
    String merchantId,
    InventoryQuery query,
  ) async {
    historyCalls += 1;
    if (!paginatedHistory) {
      return InventoryHistoryResult(
        entries: const [],
        page: const {'limit': 100, 'hasMore': false, 'nextCursor': null},
      );
    }
    final first = query.cursor == null;
    return InventoryHistoryResult(
      entries: [_historyEntry(first ? 1 : 2)],
      page: {
        'limit': 100,
        'hasMore': first,
        'nextCursor': first ? '100' : null,
      },
    );
  }

  @override
  Future<InventoryMutationResult> adjust(
    String merchantId,
    InventoryAdjustment command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryMutationResult> restock(
    String merchantId,
    RestockCommand command,
  ) async {
    restockCommand = command;
    return InventoryMutationResult(
      commandId: command.commandId,
      entries: const [],
      balances: const [],
      recovered: false,
      correlationId: 'restock-test',
    );
  }

  @override
  Future<InventoryRecoveryResult> recover(
    String merchantId,
    String commandId,
    InventoryRecoveryQuery query,
  ) async => InventoryRecoveryResult(
    commandId: commandId,
    state: recoverCreateCount || recoverSubmitCount || recoverReconcileCount
        ? 'recovered'
        : 'query_required',
    result: recoverCreateCount || recoverSubmitCount || recoverReconcileCount
        ? _countResult(
            merchantId: merchantId,
            locationId: query.locationId,
            inventoryLocationId: '00000000-0000-4000-8000-000000000004',
            recovered: true,
          ).toJson()
        : null,
    conflict: null,
  );
  @override
  Future<InventoryCountResult> createCount(
    String merchantId,
    CreateInventoryCountRequest command,
  ) async {
    if (recoverCreateCount) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'RESPONSE_LOST',
        recoverable: true,
      );
    }
    return _countResult(
      merchantId: merchantId,
      locationId: command.locationId,
      inventoryLocationId: command.inventoryLocationId,
    );
  }

  @override
  Future<InventoryMutationResult> damage(
    String merchantId,
    DamageRecord command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryMutationResult> quarantine(
    String merchantId,
    QuarantineRecord command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryMutationResult> waste(
    String merchantId,
    WasteRecord command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryCountResult> submitCount(
    String merchantId,
    SubmitInventoryCountRequest command,
  ) async {
    if (recoverSubmitCount) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'RESPONSE_LOST',
        recoverable: true,
      );
    }
    return InventoryCountResult(
      count: {
        'id': command.countId,
        'merchantId': merchantId,
        'locationId': command.locationId,
        'inventoryLocationId': command.inventoryLocationId,
        'status': 'reconciliation_required',
        'scope': 'full_location',
        'blind': true,
        'snapshotLedgerSequence': command.snapshotLedgerSequence,
        'attempt': command.attempt,
        'lines': command.lines,
        'createdAt': '2026-08-05T10:00:00.000Z',
        'submittedAt': '2026-08-05T10:05:00.000Z',
      },
      variances: [
        {
          'inventoryItemId': '00000000-0000-4000-8000-000000000005',
          'expected': {'value': 1000, 'scale': 0, 'unit': 'gram'},
          'counted': command.lines.first['counted'],
          'signed': {'value': -1000, 'scale': 0, 'unit': 'gram'},
          'absolute': {'value': 1000, 'scale': 0, 'unit': 'gram'},
          'tolerance': {'value': 0, 'scale': 0, 'unit': 'gram'},
          'withinTolerance': false,
          'reasonRequired': true,
          'approvalRequired': true,
          'ledgerSequence': command.snapshotLedgerSequence,
        },
      ],
      entries: const [],
      recovered: false,
      correlationId: 'inventory-count-submit',
    );
  }

  @override
  Future<InventoryCountResult> reconcileCount(
    String merchantId,
    InventoryReconciliation command,
  ) {
    if (recoverReconcileCount) {
      throw const AppException(
        category: AppErrorCategory.transport,
        code: 'RESPONSE_LOST',
        recoverable: true,
      );
    }
    throw UnimplementedError();
  }
}

InventoryCountResult _countResult({
  required String merchantId,
  required String locationId,
  required String inventoryLocationId,
  bool recovered = false,
}) => InventoryCountResult(
  count: {
    'id': '00000000-0000-4000-8000-000000000006',
    'merchantId': merchantId,
    'locationId': locationId,
    'inventoryLocationId': inventoryLocationId,
    'status': 'counting',
    'scope': 'full_location',
    'blind': true,
    'snapshotLedgerSequence': 1,
    'attempt': 1,
    'lines': <Object?>[],
    'createdAt': '2026-08-05T10:00:00.000Z',
    'submittedAt': null,
  },
  variances: const [],
  entries: const [],
  recovered: recovered,
  correlationId: 'inventory-count',
);

Map<String, Object?> _historyEntry(int sequence) => {
  'id': '00000000-0000-4000-8000-0000000000${sequence + 20}',
  'merchantId': scope.merchantId,
  'locationId': scope.locationId,
  'inventoryLocationId': '00000000-0000-4000-8000-000000000004',
  'inventoryItemId': '00000000-0000-4000-8000-000000000005',
  'sequence': sequence,
  'type': 'opening_balance',
  'quantity': {'value': 1, 'scale': 0, 'unit': 'gram'},
  'effects': {
    'onHand': 1,
    'reserved': 0,
    'committed': 0,
    'damaged': 0,
    'quarantine': 0,
    'waste': 0,
    'inTransit': 0,
  },
  'commandId': '00000000-0000-4000-8000-000000000030',
  'sourceType': 'test',
  'sourceId': '00000000-0000-4000-8000-000000000031',
  'saleId': null,
  'saleLineId': null,
  'refundId': null,
  'countId': null,
  'operatorId': '00000000-0000-4000-8000-000000000032',
  'deviceId': '00000000-0000-4000-8000-000000000033',
  'credentialVersion': 1,
  'businessDate': '2026-08-05',
  'correlationId': 'history-$sequence',
  'occurredAt': '2026-08-05T10:00:00.000Z',
};

Widget _app(Iterable<String> permissions, {_InventoryFake? fake}) =>
    MaterialApp(
      locale: const Locale('es'),
      supportedLocales: const [Locale('es'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: InventorySurface(
        controller: InventoryController(fake ?? _InventoryFake()),
        scope: scope,
        permissions: OperatorPermissions(permissions),
      ),
    );

void main() {
  test(
    'Controller loads history pages only after an explicit request',
    () async {
      final fake = _InventoryFake(paginatedHistory: true);
      final controller = InventoryController(fake);

      await controller.load(scope);

      expect(fake.historyCalls, 1);
      expect(controller.state.history?.entries.length, 1);

      await controller.loadMoreHistory(scope);

      expect(fake.historyCalls, 2);
      expect(controller.state.history?.entries.length, 2);
    },
  );

  test(
    'Count creation recovers the original response after response loss',
    () async {
      final fake = _InventoryFake(recoverCreateCount: true);
      final controller = InventoryController(fake);
      await controller.load(scope);

      await controller.startCount(scope);

      expect(controller.state.errorCode, isNull);
      expect(controller.state.count?.recovered, isTrue);
    },
  );

  test('Controller restores the active count after restart', () async {
    final controller = InventoryController(
      _InventoryFake(withActiveCount: true),
    );

    await controller.load(scope);

    expect(controller.state.count?.count['status'], 'counting');
  });

  test('Count submission recovers the original response', () async {
    final controller = InventoryController(
      _InventoryFake(recoverSubmitCount: true),
    );
    await controller.load(scope);
    await controller.startCount(scope);

    await controller.submitCount(scope, {
      '00000000-0000-4000-8000-000000000005': 1,
    });

    expect(controller.state.errorCode, isNull);
    expect(controller.state.count?.recovered, isTrue);
  });

  test('Count reconciliation recovers the original response', () async {
    final controller = InventoryController(
      _InventoryFake(recoverReconcileCount: true),
    );
    await controller.load(scope);
    await controller.startCount(scope);
    await controller.submitCount(scope, {
      '00000000-0000-4000-8000-000000000005': 0,
    });

    await controller.reconcileCount(scope, {
      '00000000-0000-4000-8000-000000000005': 'counting_error',
    });

    expect(controller.state.errorCode, isNull);
    expect(controller.state.count?.recovered, isTrue);
  });

  testWidgets('Viewer sees balances and no inventory mutation action', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(const ['inventory.read', 'inventory.history.read']),
    );
    await tester.pumpAndSettle();

    expect(find.text('Café en grano'), findsOneWidget);
    expect(find.text('Disponible 900'), findsOneWidget);
    expect(find.text('+'), findsNothing);
    expect(find.byIcon(Icons.delete_sweep_outlined), findsNothing);
  });

  testWidgets('Manager sees permission-aware inventory actions and count', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(const [
        'inventory.read',
        'inventory.adjust.increase',
        'inventory.adjust.decrease',
        'inventory.waste.create',
        'inventory.damage.create',
        'inventory.count.create',
      ]),
    );
    await tester.pumpAndSettle();

    expect(find.text('+'), findsOneWidget);
    expect(find.text('−'), findsOneWidget);
    expect(find.byIcon(Icons.delete_sweep_outlined), findsOneWidget);
    expect(find.text('Iniciar conteo ciego'), findsOneWidget);
  });

  testWidgets('Blind count hides expected stock until submission', (
    tester,
  ) async {
    await tester.pumpWidget(
      _app(const [
        'inventory.read',
        'inventory.history.read',
        'inventory.count.create',
        'inventory.count.submit',
        'inventory.count.reconcile',
      ]),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Iniciar conteo ciego'));
    await tester.pumpAndSettle();
    expect(find.text('Conteo ciego activo'), findsOneWidget);
    expect(find.textContaining('1000'), findsNothing);

    await tester.enterText(find.byType(TextField).first, '0');
    await tester.tap(find.text('Enviar conteo'));
    await tester.pumpAndSettle();
    expect(find.text('Varianza del conteo'), findsOneWidget);
    expect(find.textContaining('-1000'), findsOneWidget);

    var reconcile = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Solicitar reconciliación'),
    );
    expect(reconcile.onPressed, isNull);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Error de conteo').last);
    await tester.pumpAndSettle();
    reconcile = tester.widget<FilledButton>(
      find.widgetWithText(FilledButton, 'Solicitar reconciliación'),
    );
    expect(reconcile.onPressed, isNotNull);
  });

  testWidgets('Manager selects a distinct refund disposition per component', (
    tester,
  ) async {
    final fake = _InventoryFake(withRestock: true);
    await tester.pumpWidget(
      _app(const ['inventory.read', 'inventory.restock.resolve'], fake: fake),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Revisar componentes'));
    await tester.pumpAndSettle();
    expect(find.text('Destino por componente'), findsOneWidget);
    expect(find.text('Botella retornable · BOT-RET · 1 unit'), findsOneWidget);
    expect(find.text('Café en grano · CAFE-GRA · 10 gram'), findsOneWidget);
    expect(find.textContaining('00000000-0000-4000'), findsNothing);
    expect(find.byType(DropdownButtonFormField<String>), findsNWidgets(2));

    await tester.tap(find.byType(DropdownButtonFormField<String>).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Enviar a inspección').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar'));
    await tester.pumpAndSettle();

    final decisions = fake.restockCommand!.componentDecisions!;
    expect(decisions, hasLength(2));
    expect(decisions.first['outcome'], 'not_restocked');
    expect(decisions.last['outcome'], 'inspection_queued');
  });
}
