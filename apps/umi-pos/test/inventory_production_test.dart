import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/features/inventory/inventory_controller.dart';
import 'package:umi_pos/features/inventory/inventory_repository.dart';
import 'package:umi_pos/features/inventory/inventory_surface.dart';

const scope = InventoryScope(
  merchantId: '00000000-0000-4000-8000-000000000001',
  locationId: '00000000-0000-4000-8000-000000000002',
  operatorSessionId: '00000000-0000-4000-8000-000000000003',
);

const outputItemId = '00000000-0000-4000-8000-000000000005';
const inventoryLocationId = '00000000-0000-4000-8000-000000000004';
final policyFingerprint = List.filled(64, 'a').join();

Map<String, Object?> outputItem() => {
  'id': outputItemId,
  'displayName': 'Salsa de la casa',
  'publicReference': 'SALSA-01',
  'baseUnit': 'gram',
  'scale': 0,
  'trackingPolicy': 'tracked',
  'version': 1,
};

/// A recipe-less but tracked item. The server refuses it with
/// INVENTORY_RECIPE_REQUIRED, which the till must state in operator words.
class _ProductionFake implements InventoryRepository {
  _ProductionFake({this.refuseWithRecipeRequired = false});

  final bool refuseWithRecipeRequired;
  ProductionRecord? command;

  @override
  Future<InventoryOverview> overview(
    String merchantId,
    InventoryQuery query,
  ) async => InventoryOverview(
    policy: {
      'version': 'pilot-3e',
      'fingerprint': policyFingerprint,
      'offlineMutationsAllowed': false,
    },
    locations: [
      {'id': inventoryLocationId, 'displayName': 'Cocina', 'version': 1},
    ],
    items: [outputItem()],
    balances: [
      {
        'inventoryItemId': outputItemId,
        'onHand': 0,
        'reserved': 0,
        'available': 0,
        'version': 7,
      },
    ],
    restockReviews: const [],
    activeCount: null,
    page: const {'limit': 100, 'hasMore': false, 'nextCursor': null},
  );

  @override
  Future<InventoryHistoryResult> history(
    String merchantId,
    InventoryQuery query,
  ) async => InventoryHistoryResult(
    entries: const [],
    page: const {'limit': 100, 'hasMore': false, 'nextCursor': null},
  );

  @override
  Future<ProductionResult> produce(
    String merchantId,
    ProductionRecord value,
  ) async {
    if (refuseWithRecipeRequired) {
      throw const AppException(
        category: AppErrorCategory.conflict,
        code: 'INVENTORY_RECIPE_REQUIRED',
        recoverable: false,
      );
    }
    command = value;
    return ProductionResult(
      commandId: value.commandId,
      lotId: '00000000-0000-4000-8000-000000000010',
      lotReference: 'LOTE-20260917',
      outputItemId: value.outputItemId,
      declaredQuantity: const {'value': 100, 'scale': 0, 'unit': 'gram'},
      producedQuantity: value.quantity,
      yieldLossQuantity: const {'value': 10, 'scale': 0, 'unit': 'gram'},
      unitCostMinor: 25,
      totalCostMinor: 2250,
      expiresOn: value.expiresOn,
      consumed: const [
        {
          'inventoryItemId': '00000000-0000-4000-8000-000000000020',
          'publicReference': 'TOMATE-01',
          'displayName': 'Tomate',
          'quantity': {'value': 500, 'scale': 0, 'unit': 'gram'},
          'unitCostMinor': 5,
          'lineCostMinor': 2500,
        },
        {
          'inventoryItemId': '00000000-0000-4000-8000-000000000021',
          'publicReference': 'CEBOLLA-01',
          'displayName': 'Cebolla',
          'quantity': {'value': 200, 'scale': 0, 'unit': 'gram'},
          'unitCostMinor': 4,
          'lineCostMinor': 800,
        },
      ],
      incompleteCost: false,
      correlationId: 'production-test',
    );
  }

  @override
  Future<InventoryMutationResult> adjust(
    String merchantId,
    InventoryAdjustment command,
  ) => throw UnimplementedError();
  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) =>
      throw UnimplementedError();
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
  Future<InventoryMutationResult> restock(
    String merchantId,
    RestockCommand command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryMutationResult> waste(
    String merchantId,
    WasteRecord command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryRecoveryResult> recover(
    String merchantId,
    String commandId,
    InventoryRecoveryQuery query,
  ) => throw UnimplementedError();
  @override
  Future<InventoryCountResult> createCount(
    String merchantId,
    CreateInventoryCountRequest command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryCountResult> submitCount(
    String merchantId,
    SubmitInventoryCountRequest command,
  ) => throw UnimplementedError();
  @override
  Future<InventoryCountResult> reconcileCount(
    String merchantId,
    InventoryReconciliation command,
  ) => throw UnimplementedError();
}

Widget _app(
  Iterable<String> permissions, {
  required InventoryController controller,
}) => MaterialApp(
  locale: const Locale('es'),
  supportedLocales: const [Locale('es'), Locale('en')],
  localizationsDelegates: const [
    AppLocalizations.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  home: InventorySurface(
    controller: controller,
    scope: scope,
    permissions: OperatorPermissions(permissions),
  ),
);

void main() {
  test(
    'Production carries the same command context as the other actions',
    () async {
      final fake = _ProductionFake();
      final controller = InventoryController(fake);
      await controller.load(scope);

      await controller.produce(
        scope,
        item: outputItem(),
        quantity: 90,
        lotCode: 'LOTE-A',
        expiresOn: '2026-09-25',
      );

      final command = fake.command!;
      final uuid = RegExp(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      );
      expect(command.locationId, scope.locationId);
      expect(command.inventoryLocationId, inventoryLocationId);
      expect(command.operatorSessionId, scope.operatorSessionId);
      expect(command.expectedVersion, 7);
      expect(command.policyFingerprint, policyFingerprint);
      expect(command.businessDate, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(command.commandId, matches(uuid));
      expect(command.idempotencyKey, matches(uuid));
      expect(command.commandId, isNot(command.idempotencyKey));
      expect(command.approvalId, isNull);
      expect(command.approvalFingerprint, isNull);
      expect(command.outputItemId, outputItemId);
      expect(command.quantity, {'value': 90, 'scale': 0, 'unit': 'gram'});
      expect(command.lotCode, 'LOTE-A');
      expect(command.expiresOn, '2026-09-25');
      expect(controller.state.errorCode, isNull);
      expect(controller.state.production?.consumed, hasLength(2));
    },
  );

  testWidgets(
    'Surface produces a prep and shows the consumed lines and the cost',
    (tester) async {
      final fake = _ProductionFake();
      final controller = InventoryController(fake);
      await tester.pumpWidget(
        _app(const [
          'inventory.read',
          'inventory.history.read',
          'inventory.production.produce',
        ], controller: controller),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Producir'));
      await tester.pumpAndSettle();
      expect(find.text('Producir preparación'), findsOneWidget);

      await tester.enterText(find.byType(TextField).first, '90');
      await tester.enterText(find.byType(TextField).at(2), '2026-09-25');
      await tester.tap(find.text('Confirmar'));
      await tester.pumpAndSettle();

      expect(fake.command?.quantity, {'value': 90, 'scale': 0, 'unit': 'gram'});
      expect(fake.command?.expiresOn, '2026-09-25');
      expect(find.text('Lote producido'), findsOneWidget);
      expect(find.text('Insumos consumidos'), findsOneWidget);
      expect(find.text('Tomate'), findsOneWidget);
      expect(find.text('Cebolla'), findsOneWidget);
      expect(find.textContaining('500 gram'), findsOneWidget);
      expect(find.textContaining('25.00'), findsOneWidget);
      expect(find.textContaining('22.50'), findsOneWidget);
    },
  );

  testWidgets(
    'A missing recipe is refused in operator words and asks for no approval',
    (tester) async {
      final fake = _ProductionFake(refuseWithRecipeRequired: true);
      final controller = InventoryController(fake);
      await tester.pumpWidget(
        _app(const [
          'inventory.read',
          'inventory.history.read',
          'inventory.production.produce',
        ], controller: controller),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Producir'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Confirmar'));
      await tester.pumpAndSettle();

      expect(controller.state.errorCode, 'INVENTORY_RECIPE_REQUIRED');
      expect(controller.state.pendingOperation, isNull);
      expect(
        find.text('Este artículo no tiene receta de producción.'),
        findsOneWidget,
      );
      expect(
        find.text('Se requiere una aprobación independiente'),
        findsNothing,
      );
    },
  );
}
