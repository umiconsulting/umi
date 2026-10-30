import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/inventory/inventory_controller.dart';
import 'package:umi_pos/features/inventory/inventory_repository.dart';
import 'package:umi_pos/features/inventory/inventory_surface.dart';

import 'support/pos_finders.dart';

const scope = InventoryScope(
  merchantId: '00000000-0000-4000-8000-000000000001',
  locationId: '00000000-0000-4000-8000-000000000002',
  operatorSessionId: '00000000-0000-4000-8000-000000000003',
  canReadHistory: true,
);

class _InventoryFake implements InventoryRepository {
  _InventoryFake({
    this.withRestock = false,
    this.paginatedHistory = false,
    this.recoverCreateCount = false,
    this.recoverSubmitCount = false,
    this.recoverReconcileCount = false,
    this.withActiveCount = false,
    this.quantityScale = 0,
    this.withOutsideCountItems = false,
    this.refuseRestockOnce = false,
    this.refuseCreateCount = false,
    this.historyError,
    this.overviewError,
  });

  final bool withRestock;
  final bool paginatedHistory;
  final bool recoverCreateCount;
  final bool recoverSubmitCount;
  final bool recoverReconcileCount;
  final bool withActiveCount;
  final int quantityScale;
  final bool withOutsideCountItems;

  /// Refuses the first restock the way the server does when the operation needs
  /// an independent approval: 409 `APPROVAL_REQUIRED`, recoverable, carrying the
  /// permission and the fingerprint the client must hand back with the approval.
  final bool refuseRestockOnce;

  /// Refuses the count the way the contract does when the body does not match
  /// it: 400 `VALIDATION_FAILED`, not recoverable, nothing to retry blindly.
  final bool refuseCreateCount;
  final AppException? historyError;
  final AppException? overviewError;
  InventoryAdjustment? adjustment;
  bool countCancelled = false;
  CancelInventoryCountRequest? cancelledCount;
  CreateInventoryCountRequest? createdCount;
  SubmitInventoryCountRequest? submittedCount;
  int historyCalls = 0;
  RestockCommand? restockCommand;
  int restockCalls = 0;
  int prepListCalls = 0;
  String? prepListMerchantId;
  PosPrepListQuery? prepListQuery;

  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) async {
    prepListCalls += 1;
    prepListMerchantId = merchantId;
    prepListQuery = query;
    return PrepList(
      items: const [],
      locationId: query.locationId,
      from: '2026-09-01',
      to: '2026-09-28',
      asOf: '2026-09-18T10:00:00.000Z',
      correlationId: 'prep-list-test',
    );
  }

  @override
  Future<InventoryOverview> overview(
    String merchantId,
    InventoryQuery query,
  ) async => overviewError != null
      ? throw overviewError!
      : InventoryOverview(
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
              'scale': quantityScale,
              'active': true,
              'version': 1,
            },
            if (withOutsideCountItems)
              for (final entry in [
                (
                  '00000000-0000-4000-8000-000000000040',
                  'Sin saldo en el almacén',
                  true,
                ),
                (
                  '00000000-0000-4000-8000-000000000041',
                  'Artículo archivado',
                  false,
                ),
                (
                  '00000000-0000-4000-8000-000000000042',
                  'Saldo de otro almacén',
                  true,
                ),
              ])
                {
                  'id': entry.$1,
                  'displayName': entry.$2,
                  'publicReference': entry.$1,
                  'baseUnit': 'gram',
                  'scale': quantityScale,
                  'active': entry.$3,
                  'version': 1,
                },
          ],
          balances: [
            {
              'inventoryItemId': '00000000-0000-4000-8000-000000000005',
              'inventoryLocationId': '00000000-0000-4000-8000-000000000004',
              'onHand': 1000,
              'reserved': 100,
              'available': 900,
              'version': 1,
            },
            if (withOutsideCountItems)
              for (final entry in [
                (
                  '00000000-0000-4000-8000-000000000041',
                  '00000000-0000-4000-8000-000000000004',
                ),
                (
                  '00000000-0000-4000-8000-000000000042',
                  '00000000-0000-4000-8000-000000000043',
                ),
              ])
                {
                  'inventoryItemId': entry.$1,
                  'inventoryLocationId': entry.$2,
                  'onHand': 10,
                  'reserved': 0,
                  'available': 10,
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
                        'inventoryItemId':
                            '00000000-0000-4000-8000-000000000013',
                        'displayName': 'Botella retornable',
                        'publicReference': 'BOT-RET',
                        'maximum': {'value': 1, 'scale': 0, 'unit': 'unit'},
                        'recipeEffect': false,
                      },
                      {
                        'inventoryItemId':
                            '00000000-0000-4000-8000-000000000014',
                        'displayName': 'Café en grano',
                        'publicReference': 'CAFE-GRA',
                        'maximum': {'value': 10, 'scale': 0, 'unit': 'gram'},
                        'recipeEffect': true,
                      },
                    ],
                  },
                ]
              : const [],
          activeCount: withActiveCount && !countCancelled
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
    if (historyError != null) throw historyError!;
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
  ) async {
    adjustment = command;
    return InventoryMutationResult(
      commandId: command.commandId,
      entries: const [],
      balances: const [],
      recovered: false,
      correlationId: 'adjustment-test',
    );
  }

  @override
  Future<InventoryMutationResult> restock(
    String merchantId,
    RestockCommand command,
  ) async {
    restockCalls += 1;
    restockCommand = command;
    if (refuseRestockOnce && restockCalls == 1 && command.approvalId == null) {
      throw AppException(
        category: AppErrorCategory.conflict,
        code: 'APPROVAL_REQUIRED',
        recoverable: true,
        fieldErrors: {
          'approvalPermission': const ['inventory.restock.approve'],
          'approvalFingerprint': [List.filled(64, 'a').join()],
        },
      );
    }
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
    createdCount = command;
    if (refuseCreateCount) {
      throw const AppException(
        category: AppErrorCategory.unknown,
        code: 'VALIDATION_FAILED',
        recoverable: false,
      );
    }
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
  Future<ProductionResult> produce(
    String merchantId,
    ProductionRecord command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryCountResult> cancelCount(
    String merchantId,
    CancelInventoryCountRequest command,
  ) async {
    cancelledCount = command;
    countCancelled = true;
    final initial = _countResult(
      merchantId: merchantId,
      locationId: command.locationId,
      inventoryLocationId: command.inventoryLocationId,
    );
    return InventoryCountResult(
      count: {...initial.count, 'status': 'cancelled', 'version': 2},
      variances: const [],
      entries: const [],
      recovered: false,
      correlationId: 'cancel-test',
    );
  }

  @override
  Future<InventoryCountResult> submitCount(
    String merchantId,
    SubmitInventoryCountRequest command,
  ) async {
    submittedCount = command;
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
    'version': 1,
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

Widget _app(
  Iterable<String> permissions, {
  _InventoryFake? fake,
  double textScale = 1,
}) => PosApp(
  theme: UmiTheme.light(),
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(
      context,
    ).copyWith(textScaler: TextScaler.linear(textScale)),
    child: child!,
  ),
  locale: const Locale('es'),
  supportedLocales: const [Locale('es'), Locale('en')],
  localizationsDelegates: const [
    AppLocalizations.delegate,

    GlobalWidgetsLocalizations.delegate,
  ],
  home: InventorySurface(
    controller: InventoryController(fake ?? _InventoryFake()),
    scope: InventoryScope(
      merchantId: scope.merchantId,
      locationId: scope.locationId,
      operatorSessionId: scope.operatorSessionId,
      canReadHistory: OperatorPermissions(
        permissions,
      ).allows('inventory.history.read'),
    ),
    permissions: OperatorPermissions(permissions),
  ),
);

void main() {
  testWidgets(
    'an authorized operator can cancel an active count before a fresh count',
    (tester) async {
      final fake = _InventoryFake(withActiveCount: true);
      await tester.pumpWidget(
        _app(const ['inventory.read', 'inventory.count.create'], fake: fake),
      );
      await tester.pumpAndSettle();
      final cancel = find.text('Cancelar conteo activo');
      expect(cancel, findsOneWidget);
      await tester.ensureVisible(cancel);
      await tester.tap(cancel);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancelar y volver a contar'));
      await tester.pumpAndSettle();
      expect(fake.cancelledCount!.expectedVersion, 1);
      expect(fake.cancelledCount!.attempt, 1);
      expect(find.text('Conteo ciego activo'), findsNothing);
      expect(find.text('Iniciar conteo ciego'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );

  testWidgets('Inventory read does not request restricted history', (
    tester,
  ) async {
    final fake = _InventoryFake(
      historyError: const AppException(
        code: 'PERMISSION_DENIED',
        category: AppErrorCategory.permission,
        recoverable: false,
      ),
    );
    await tester.pumpWidget(_app(const ['inventory.read'], fake: fake));
    await tester.pumpAndSettle();
    expect(find.text('Café en grano'), findsOneWidget);
    expect(find.text('Historial inmutable'), findsNothing);
    expect(fake.historyCalls, 0);
  });

  test('History failure preserves inventory and exposes the error', () async {
    final fake = _InventoryFake(
      historyError: const AppException(
        code: 'NETWORK_UNAVAILABLE',
        category: AppErrorCategory.transport,
        recoverable: true,
      ),
    );
    final controller = InventoryController(fake);
    await controller.load(scope);
    expect(controller.state.overview?.items, isNotEmpty);
    expect(controller.state.history, isNull);
    expect(controller.state.errorCode, 'NETWORK_UNAVAILABLE');
  });

  test('Overview failure remains a visible read error', () async {
    final controller = InventoryController(
      _InventoryFake(
        overviewError: const AppException(
          code: 'PERMISSION_REVOKED',
          category: AppErrorCategory.permission,
          recoverable: false,
        ),
      ),
    );
    await controller.load(scope);
    expect(controller.state.overview, isNull);
    expect(controller.state.errorCode, 'PERMISSION_REVOKED');
  });

  test('History is cleared when its permission is absent on refresh', () async {
    final fake = _InventoryFake(paginatedHistory: true);
    final controller = InventoryController(fake);
    await controller.load(scope);
    expect(controller.state.history?.entries, isNotEmpty);
    final readOnlyScope = InventoryScope(
      merchantId: scope.merchantId,
      locationId: scope.locationId,
      operatorSessionId: scope.operatorSessionId,
    );
    await controller.load(readOnlyScope);
    await controller.loadMoreHistory(readOnlyScope);
    expect(controller.state.overview?.items, isNotEmpty);
    expect(controller.state.history, isNull);
    expect(fake.historyCalls, 1);
  });

  testWidgets('blind count requests only active items in its own warehouse', (
    tester,
  ) async {
    final fake = _InventoryFake(
      quantityScale: 3,
      withActiveCount: true,
      withOutsideCountItems: true,
    );
    await tester.pumpWidget(
      _app(const ['inventory.read', 'inventory.count.submit'], fake: fake),
    );
    await tester.pumpAndSettle();
    expect(find.byType(PosField), findsOneWidget);
    expect(find.text('Cancelar conteo activo'), findsNothing);
    expect(find.text('Sin saldo en el almacén'), findsNothing);
    expect(find.text('Artículo archivado'), findsNothing);
    expect(find.text('Saldo de otro almacén'), findsNothing);
    await tester.enterText(find.byType(PosField), '1.25');
    await tester.ensureVisible(find.text('Enviar conteo'));
    await tester.tap(find.text('Enviar conteo'));
    await tester.pumpAndSettle();
    expect(fake.submittedCount!.lines, hasLength(1));
    expect(
      fake.submittedCount!.lines.single['inventoryItemId'],
      '00000000-0000-4000-8000-000000000005',
    );
    expect(fake.submittedCount!.lines.single['counted'], {
      'value': 1250,
      'scale': 3,
      'unit': 'gram',
    });
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets(
    'stock adjustment uses visible decimals and refuses silent rounding',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final fake = _InventoryFake(quantityScale: 3);
      await tester.pumpWidget(
        _app(const ['inventory.read', 'inventory.adjust.increase'], fake: fake),
      );
      await tester.pumpAndSettle();
      expect(find.text('Disponible 0.9'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Aumentar existencias de Café en grano'),
        findsOneWidget,
      );
      await tester.tap(find.text('Aumentar'));
      await tester.pumpAndSettle();
      final field = find.descendant(
        of: find.byType(PosAlertDialog),
        matching: find.byType(PosField),
      );
      await tester.enterText(field, '1.2345');
      await tester.pump();
      final confirm = find.widgetWithText(PosButton, 'Confirmar');
      expect(tester.widget<PosButton>(confirm).onPressed, isNull);
      expect(fake.adjustment, isNull);
      await tester.enterText(field, '1.25');
      await tester.pump();
      await tester.tap(confirm);
      await tester.pumpAndSettle();
      expect(fake.adjustment!.quantity, {
        'value': 1250,
        'scale': 3,
        'unit': 'gram',
      });
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      semantics.dispose();
    },
  );

  testWidgets('blind count validates decimals and keeps exact item units', (
    tester,
  ) async {
    final fake = _InventoryFake(quantityScale: 3, withActiveCount: true);
    await tester.pumpWidget(
      _app(const ['inventory.read', 'inventory.count.submit'], fake: fake),
    );
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(PosField).first, '1.2345');
    await tester.ensureVisible(find.text('Enviar conteo'));
    await tester.tap(find.text('Enviar conteo'));
    await tester.pumpAndSettle();
    expect(fake.submittedCount, isNull);
    expect(
      find.text('Registra una cantidad válida, incluido cero.'),
      findsOneWidget,
    );
    await tester.enterText(find.byType(PosField).first, '1.25');
    await tester.tap(find.text('Enviar conteo'));
    await tester.pumpAndSettle();
    expect(fake.submittedCount!.lines.first['counted'], {
      'value': 1250,
      'scale': 3,
      'unit': 'gram',
    });
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  setUpAll(() async {
    final body = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      body.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await body.load();
    final heading = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      heading.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await heading.load();
  });
  for (final size in [const Size(375, 812), const Size(812, 375)]) {
    for (final activeCount in [false, true]) {
      testWidgets(
        'inventory actions and content remain reachable at 200% $size count=$activeCount',
        (tester) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = size;
          addTearDown(tester.view.resetDevicePixelRatio);
          addTearDown(tester.view.resetPhysicalSize);
          await tester.pumpWidget(
            _app(
              const [
                'inventory.read',
                'inventory.history.read',
                'inventory.count.create',
                'inventory.count.submit',
                'inventory.count.reconcile',
                'inventory.production.produce',
                'inventory.adjust.increase',
                'inventory.adjust.decrease',
                'inventory.waste.create',
              ],
              fake: _InventoryFake(withActiveCount: activeCount),
              textScale: 2,
            ),
          );
          await tester.pumpAndSettle();
          expect(
            MediaQuery.textScalerOf(
              tester.element(find.byType(InventorySurface)),
            ).scale(16),
            32,
          );
          expect(tester.takeException(), isNull);
          final target = find.text(
            activeCount ? 'Enviar conteo' : 'Historial inmutable',
          );
          await tester.scrollUntilVisible(
            target,
            150,
            scrollable: find.byType(Scrollable).last,
          );
          await tester.pumpAndSettle();
          expect(target.hitTestable(), findsOneWidget);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox.shrink());
        },
      );
    }
  }
  test('The prep list read uses the till own scope', () async {
    final fake = _InventoryFake();
    final controller = InventoryController(fake);

    final list = await controller.loadPrepList(scope);

    expect(fake.prepListCalls, 1);
    expect(fake.prepListMerchantId, scope.merchantId);
    expect(fake.prepListQuery?.locationId, scope.locationId);
    expect(fake.prepListQuery?.includeAbovePar, isFalse);
    expect(list.locationId, scope.locationId);
  });

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
    expect(find.text('Aumentar'), findsNothing);
    expect(find.byPosGlyph(PosGlyphs.deleteSweepOutlined), findsNothing);
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

    expect(find.text('Aumentar'), findsOneWidget);
    expect(find.text('Reducir'), findsOneWidget);
    expect(find.byPosGlyph(PosGlyphs.deleteSweepOutlined), findsOneWidget);
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

    await tester.enterText(find.byType(PosField).first, '0');
    await tester.tap(find.text('Enviar conteo'));
    await tester.pumpAndSettle();
    expect(find.text('Varianza del conteo'), findsOneWidget);
    expect(find.textContaining('-1000'), findsOneWidget);

    var reconcile = tester.widget<PosButton>(
      find.widgetWithText(PosButton, 'Solicitar reconciliación'),
    );
    expect(reconcile.onPressed, isNull);
    await tester.tap(find.byType(PosSelectFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Error de conteo').last);
    await tester.pumpAndSettle();
    reconcile = tester.widget<PosButton>(
      find.widgetWithText(PosButton, 'Solicitar reconciliación'),
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
    expect(find.text('Café en grano · CAFE-GRA · 10 g'), findsOneWidget);
    expect(find.textContaining('00000000-0000-4000'), findsNothing);
    expect(find.byType(PosSelectFormField<String>), findsNWidgets(2));

    await tester.tap(find.byType(PosSelectFormField<String>).last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Enviar a inspección').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(PosButton, 'Confirmar'));
    await tester.pumpAndSettle();

    final decisions = fake.restockCommand!.componentDecisions!;
    expect(decisions, hasLength(2));
    expect(decisions.first['outcome'], 'not_restocked');
    expect(decisions.last['outcome'], 'inspection_queued');
  });

  test(
    'a restock refused for approval survives a refresh and is re-sent approved',
    () async {
      // Walked on the iMin D3-504 on 2026-10-11: the refund disposition came
      // back `409 APPROVAL_REQUIRED` with the permission and the fingerprint, the
      // manager approved, and the command was never re-sent — the screen kept
      // `Esta operación requiere una aprobación vinculada.` over a pending
      // decision that stayed pending. This is the state machine in isolation.
      final fake = _InventoryFake(withRestock: true, refuseRestockOnce: true);
      final controller = InventoryController(fake);
      await controller.load(scope);
      final review = controller.state.overview!.restockReviews.single;

      await controller.resolveRestock(scope, review, {
        for (final component
            in (review['components']! as List<Object?>)
                .cast<Map<String, Object?>>())
          component['inventoryItemId']! as String: 'restocked',
      });
      expect(fake.restockCalls, 1);
      expect(controller.state.pendingOperation, isNotNull);
      expect(controller.state.approvalPermission, 'inventory.restock.approve');
      expect(controller.state.approvalFingerprint, List.filled(64, 'a').join());

      // The screen refreshes while the approver types the PIN — the till polls
      // the overview on every visit and after every recovery attempt.
      await controller.load(scope);
      expect(
        controller.state.pendingOperation,
        isNotNull,
        reason:
            'a refresh must not forget the command that is waiting for approval',
      );

      await controller.approvePendingOperation(scope, 'approval-1');
      expect(
        fake.restockCalls,
        2,
        reason: 'the approval must re-send the command',
      );
      expect(fake.restockCommand!.approvalId, 'approval-1');
      expect(
        fake.restockCommand!.approvalFingerprint,
        List.filled(64, 'a').join(),
      );
    },
  );

  test('a blind count names its item scope instead of sending null', () async {
    // Walked on the iMin D3-504 on 2026-10-11: `Iniciar conteo ciego` answered
    // `400 VALIDATION_FAILED` and the till said only `No fue posible completar la
    // operación de inventario.` The contract types `itemIds` as an array with an
    // empty default, and the generated `toJson` writes the field whatever its
    // value — so a null was refused before the command reached the domain.
    final fake = _InventoryFake();
    final controller = InventoryController(fake);
    await controller.load(scope);

    await controller.startCount(scope);

    expect(
      fake.createdCount,
      isNotNull,
      reason: 'the count reached the server',
    );
    expect(fake.createdCount!.itemIds, isNotNull);
    expect(fake.createdCount!.itemIds, isEmpty);
    expect(fake.createdCount!.toJson()['itemIds'], isNotNull);
  });

  testWidgets(
    'a refusal this screen has no words for names what the server said',
    (tester) async {
      // The surface's own switch covers the codes it has something specific to
      // say about; everything else used to collapse into one generic sentence.
      // `VALIDATION_FAILED` reached the operator as `No fue posible completar la
      // operación de inventario.` — three times on the iMin D3-504 on
      // 2026-10-11 — with nothing to act on. The fallback is the shared mapping
      // now, which has an actionable sentence for it.
      final fake = _InventoryFake(refuseCreateCount: true);
      await tester.pumpWidget(
        _app(const ['inventory.read', 'inventory.count.create'], fake: fake),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Iniciar conteo ciego'));
      await tester.pumpAndSettle();

      expect(
        find.textContaining('El servidor no aceptó el formato'),
        findsOneWidget,
      );
      expect(
        find.text('No fue posible completar la operación de inventario.'),
        findsNothing,
      );
      expect(find.textContaining('VALIDATION_FAILED'), findsNothing);
    },
  );
}
