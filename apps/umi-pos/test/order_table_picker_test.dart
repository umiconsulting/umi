import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/tables/floor_plan_surface.dart';
import 'package:umi_pos/features/tables/order_table_picker.dart';
import 'package:umi_pos/features/tables/table_state_controller.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

import 'features/tables/table_state_surface_test.dart'
    show RoomRepository, entryJson, merchantId, locationId, operatorSessionId;

FloorPlanElement _table(String id, String label, {double x = 60}) =>
    FloorPlanElement(
      id: id,
      kind: 'table',
      shape: 'square',
      label: label,
      capacity: 4,
      x: x,
      y: 60,
      width: 80,
      height: 80,
      rotation: 0,
    );

FloorPlanArea _area(List<FloorPlanElement> tables) => FloorPlanArea(
  id: 'patio',
  name: 'Terraza',
  width: 500,
  height: 400,
  elements: tables.map((table) => table.toJson()).toList(),
);

Future<TableStateController> _room(RoomRepository repository) async {
  final room = TableStateController(repository);
  await room.load(merchantId, locationId, operatorSessionId);
  addTearDown(room.dispose);
  return room;
}

class _PendingRoomRepository implements TableStateRepository {
  final pending = Completer<TableStateMap>();
  bool delay = false;

  @override
  Future<TableStateMap> read(String merchantId, PosTableStateQuery query) =>
      delay ? pending.future : RoomRepository().read(merchantId, query);

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<void> _open(
  WidgetTester tester, {
  List<FloorPlanArea> areas = const [],
  CreateOrderTables? createTables,
  AddOrderTable? addTable,
  TableStateController? room,
  bool canManage = false,
  String? assigningAccountId,
  Future<void> Function()? refreshRoom,
  double textScale = 1,
  required ValueChanged<FloorPlanElement?> result,
}) async {
  await tester.pumpWidget(
    PosApp(
      locale: const Locale('es'),
      supportedLocales: const [Locale('es')],
      localizationsDelegates: const [AppLocalizations.delegate],
      themeMode: PosThemeMode.midnight,
      midnightTheme: PosThemeData(brightness: Brightness.dark, midnight: true),
      home: Builder(
        builder: (context) => PosPage(
          body: PosButton(
            onPressed: () async => result(
              await showOrderTablePicker(
                context,
                areas: areas,
                createTables: createTables,
                addTable: addTable,
                room: room,
                canManage: canManage,
                assigningAccountId: assigningAccountId,
                refreshRoom: refreshRoom,
              ),
            ),
            child: const Text('Abrir'),
          ),
        ),
      ),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
    ),
  );
  await tester.tap(find.text('Abrir'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('confirmation is blocked while a room poll is still pending', (
    tester,
  ) async {
    final repository = _PendingRoomRepository();
    final room = TableStateController(repository);
    addTearDown(room.dispose);
    await room.load(merchantId, locationId, operatorSessionId);
    var returned = false;
    await _open(
      tester,
      areas: [
        _area([_table('table', 'Mesa 1')]),
      ],
      room: room,
      refreshRoom: () => room.load(merchantId, locationId, operatorSessionId),
      result: (_) => returned = true,
    );
    await tester.tap(find.byKey(const ValueKey('floor-plan-element-table')));
    await tester.pumpAndSettle();
    repository.delay = true;
    final poll = room.load(merchantId, locationId, operatorSessionId);
    await tester.pump();
    expect(
      tester
          .widget<PosButton>(find.byKey(const ValueKey('confirm-table')))
          .onPressed,
      isNull,
    );
    expect(returned, isFalse);
    repository.pending.complete(RoomRepository().map);
    await poll;
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<PosButton>(find.byKey(const ValueKey('confirm-table')))
          .onPressed,
      isNotNull,
    );
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
  });
  testWidgets('repeated confirmation waits for one refresh and returns once', (
    tester,
  ) async {
    final refresh = Completer<void>();
    var reads = 0;
    var returned = 0;
    await _open(
      tester,
      areas: [
        _area([_table('table', 'Mesa 1')]),
      ],
      refreshRoom: () {
        reads++;
        return refresh.future;
      },
      result: (_) => returned++,
    );
    await tester.tap(find.byKey(const ValueKey('floor-plan-element-table')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('confirm-table')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('confirm-table')));
    expect(reads, 1);
    expect(returned, 0);
    refresh.complete();
    await tester.pumpAndSettle();
    expect(returned, 1);
  });
  testWidgets('table count saves once then selects persisted table', (
    tester,
  ) async {
    final pending = Completer<List<FloorPlanArea>?>();
    final calls = <List<int>>[];
    FloorPlanElement? picked;
    await _open(
      tester,
      createTables: (slots) {
        calls.add(slots);
        return pending.future;
      },
      result: (table) => picked = table,
    );
    await tester.tap(find.byKey(const ValueKey('table-count-increase')));
    await tester.pump();
    expect(
      tester
          .widget<PosField>(find.byKey(const ValueKey('table-count')))
          .controller!
          .text,
      '2',
    );
    await tester.tap(find.text('Guardar mesas'));
    await tester.pump();
    await tester.tap(find.text('Guardar mesas'));
    expect(calls, [
      [0, 1],
    ]);
    expect(picked, isNull);
    expect(
      tester
          .widget<PosTextButton>(find.widgetWithText(PosTextButton, 'Cancelar'))
          .onPressed,
      isNull,
    );
    final table = _table('persisted-id', 'Mesa 2', x: 220);
    pending.complete([
      _area([_table('other-id', 'Mesa 1'), table]),
    ]);
    await tester.pumpAndSettle();
    expect(find.text('Elige una mesa'), findsOneWidget);
    await tester.tap(
      find.byKey(const ValueKey('floor-plan-element-persisted-id')),
    );
    await tester.pumpAndSettle();
    expect(picked, isNull);
    await tester.tap(find.byKey(const ValueKey('confirm-table')));
    await tester.pumpAndSettle();
    expect(picked?.id, table.id);
  });

  testWidgets('failure keeps the count for retry and cancel returns null', (
    tester,
  ) async {
    final calls = <List<int>>[];
    var returned = false;
    FloorPlanElement? picked;
    await _open(
      tester,
      createTables: (slots) async {
        calls.add(slots);
        throw StateError('offline');
      },
      result: (table) {
        returned = true;
        picked = table;
      },
    );
    await tester.enterText(find.byKey(const ValueKey('table-count')), '3');
    await tester.pump();
    await tester.tap(find.text('Guardar mesas'));
    await tester.pumpAndSettle();
    expect(
      find.text('No pudimos guardar las mesas. Intenta de nuevo.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<PosField>(find.byKey(const ValueKey('table-count')))
          .controller!
          .text,
      '3',
    );
    await tester.tap(find.text('Guardar mesas'));
    await tester.pumpAndSettle();
    expect(calls, [
      [0, 1, 2],
      [0, 1, 2],
    ]);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(returned, isTrue);
    expect(picked, isNull);
  });

  testWidgets(
    'map selection shows details and requires explicit confirmation',
    (tester) async {
      var calls = 0;
      FloorPlanElement? picked;
      final table = _table('patio-table', 'Mesa 8');
      await _open(
        tester,
        areas: [
          FloorPlanArea(
            id: 'patio',
            name: 'Terraza',
            width: 500,
            height: 400,
            elements: [table.toJson()],
          ),
        ],
        createTables: (_) async {
          calls++;
          return [];
        },
        result: (table) => picked = table,
      );
      expect(find.byType(FloorPlanMap), findsOneWidget);
      expect(find.text('Terraza'), findsOneWidget);
      expect(find.text('Guardar mesas'), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('floor-plan-element-patio-table')),
      );
      await tester.pumpAndSettle();
      expect(picked, isNull);
      expect(find.text('Disponible · 4 lugares'), findsOneWidget);
      expect(find.byKey(const ValueKey('order-table-detail')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(picked?.id, 'patio-table');
      expect(calls, 0);
    },
  );

  testWidgets('phone supports count arrows and typing without a write', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(360, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var calls = 0;
    await _open(
      tester,
      createTables: (_) async {
        calls++;
        return [];
      },
      result: (_) {},
    );
    await tester.tap(find.byKey(const ValueKey('table-count-increase')));
    await tester.pump();
    expect(
      tester
          .widget<PosField>(find.byKey(const ValueKey('table-count')))
          .controller!
          .text,
      '2',
    );
    await tester.tap(find.byKey(const ValueKey('table-count-decrease')));
    await tester.pump();
    expect(
      tester
          .widget<PosField>(find.byKey(const ValueKey('table-count')))
          .controller!
          .text,
      '1',
    );
    await tester.enterText(find.byKey(const ValueKey('table-count')), '50');
    await tester.pump();
    expect(
      tester
          .widget<PosIconButton>(
            find.byKey(const ValueKey('table-count-increase')),
          )
          .onPressed,
      isNull,
    );
    await tester.enterText(find.byKey(const ValueKey('table-count')), '0');
    await tester.pump();
    expect(
      tester
          .widget<PosButton>(find.widgetWithText(PosButton, 'Guardar mesas'))
          .onPressed,
      isNull,
    );
    await tester.enterText(find.byKey(const ValueKey('table-count')), '51');
    await tester.pump();
    expect(
      tester
          .widget<PosButton>(find.widgetWithText(PosButton, 'Guardar mesas'))
          .onPressed,
      isNull,
    );
    tester.testTextInput.hide();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(calls, 0);
  });

  testWidgets(
    'an occupied table keeps service actions behind management permission',
    (tester) async {
      final repository = RoomRepository(
        states: [
          entryJson(
            'paid-table',
            tableStateSeated,
            seatedAt: '2026-09-16T17:58:00.000Z',
            partySize: 2,
          ),
        ],
      );
      final room = await _room(repository);
      await _open(
        tester,
        areas: [
          _area([_table('paid-table', 'Mesa 1')]),
        ],
        room: room,
        result: (_) {},
      );
      await tester.tap(
        find.byKey(const ValueKey('floor-plan-element-paid-table')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Ocupada · 4 lugares'), findsOneWidget);
      expect(find.text('Continuar con estos clientes'), findsOneWidget);
      expect(find.text('Los clientes se fueron'), findsNothing);
      expect(find.text('Marcar limpia'), findsNothing);
      expect(repository.cleared, isNull);
    },
  );

  testWidgets(
    'an open account prevents release and assignment from another account',
    (tester) async {
      final repository = RoomRepository(
        states: [
          {
            ...entryJson(
              'busy-table',
              tableStateSeated,
              seatedAt: '2026-09-16T17:58:00.000Z',
              partySize: 2,
            ),
            'openAccountId': 'other-account',
            'openAccountFolio': 'Cuenta 141',
            'openAccountTableId': 'busy-table',
          },
        ],
      );
      final room = await _room(repository);
      var returned = false;
      await _open(
        tester,
        areas: [
          _area([_table('busy-table', 'Mesa 1')]),
        ],
        room: room,
        canManage: true,
        assigningAccountId: 'current-account',
        result: (_) => returned = true,
      );
      await tester.tap(
        find.byKey(const ValueKey('floor-plan-element-busy-table')),
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('order-table-detail')),
          matching: find.text('Cuenta 141'),
        ),
        findsOneWidget,
      );
      expect(find.text('Mesa con otra cuenta'), findsOneWidget);
      expect(
        tester
            .widget<PosButton>(find.byKey(const ValueKey('confirm-table')))
            .onPressed,
        isNull,
      );
      expect(find.text('Los clientes se fueron'), findsNothing);
      expect(repository.cleared, isNull);
      expect(returned, isFalse);
    },
  );

  testWidgets('a grouped table opens the account on its owning table', (
    tester,
  ) async {
    final repository = RoomRepository(
      states: [
        for (final id in ['owner-table', 'joined-table'])
          {
            ...entryJson(
              id,
              tableStateSeated,
              seatedAt: '2026-09-16T17:58:00.000Z',
              partySize: 2,
              group: 'party',
            ),
            'openAccountId': 'account',
            'openAccountFolio': 'Cuenta 141',
            'openAccountTableId': 'owner-table',
          },
      ],
    );
    final room = await _room(repository);
    FloorPlanElement? picked;
    await _open(
      tester,
      areas: [
        _area([
          _table('owner-table', 'Mesa 1'),
          _table('joined-table', 'Mesa 2', x: 220),
        ]),
      ],
      room: room,
      result: (table) => picked = table,
    );
    await tester.tap(
      find.byKey(const ValueKey('floor-plan-element-joined-table')),
    );
    await tester.pumpAndSettle();
    expect(find.text('Abrir Cuenta 141'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('confirm-table')));
    await tester.pumpAndSettle();
    expect(picked?.id, 'owner-table');
  });

  testWidgets(
    'paid occupied table becomes dirty after confirmation then can be marked clean',
    (tester) async {
      final repository = RoomRepository(
        states: [
          entryJson(
            'paid-table',
            tableStateSeated,
            seatedAt: '2026-09-16T17:58:00.000Z',
            partySize: 2,
          ),
        ],
      );
      final room = await _room(repository);
      FloorPlanElement? picked;
      await _open(
        tester,
        areas: [
          _area([_table('paid-table', 'Mesa 1')]),
        ],
        room: room,
        canManage: true,
        result: (table) => picked = table,
      );
      await tester.tap(
        find.byKey(const ValueKey('floor-plan-element-paid-table')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Los clientes se fueron'));
      await tester.pumpAndSettle();
      expect(repository.cleared, isNull);
      expect(find.text('¿Los clientes ya se fueron?'), findsOneWidget);
      await tester.tap(find.text('Sí, ya se fueron'));
      await tester.pumpAndSettle();
      expect(repository.cleared?.tableId, 'paid-table');
      expect(room.stateOf('paid-table').state, tableStateDirty);
      expect(find.text('Por limpiar · 4 lugares'), findsOneWidget);
      expect(picked, isNull);
      await tester.tap(find.text('Marcar limpia'));
      await tester.pumpAndSettle();
      expect(room.stateOf('paid-table').state, tableStateOpen);
      expect(find.text('Disponible · 4 lugares'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(picked?.id, 'paid-table');
    },
  );

  testWidgets(
    'confirm refresh blocks assignment when another account takes the table',
    (tester) async {
      final repository = RoomRepository();
      final room = await _room(repository);
      var returned = false;
      await _open(
        tester,
        areas: [
          _area([_table('table', 'Mesa 1')]),
        ],
        room: room,
        assigningAccountId: 'my-account',
        refreshRoom: () async {
          repository.map = TableStateMap(
            locationId: locationId,
            serverTime: '2026-09-16T18:00:00.000Z',
            states: [
              {
                ...entryJson(
                  'table',
                  tableStateSeated,
                  seatedAt: '2026-09-16T17:58:00.000Z',
                  partySize: 2,
                ),
                'openAccountId': 'their-account',
                'openAccountFolio': 'Cuenta 142',
                'openAccountTableId': 'table',
              },
            ],
          );
          await room.load(merchantId, locationId, operatorSessionId);
        },
        result: (_) => returned = true,
      );
      await tester.tap(find.byKey(const ValueKey('floor-plan-element-table')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(returned, isFalse);
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('order-table-detail')),
          matching: find.text('Cuenta 142'),
        ),
        findsOneWidget,
      );
      expect(
        tester
            .widget<PosButton>(find.byKey(const ValueKey('confirm-table')))
            .onPressed,
        isNull,
      );
    },
  );

  testWidgets(
    'adding selects its own table when another terminal also added one',
    (tester) async {
      final initial = _table('old-table', 'Mesa 1');
      final created = _table('new-table', 'Mesa extra', x: 220);
      final calls = <(String, String, int)>[];
      FloorPlanElement? picked;
      await _open(
        tester,
        areas: [
          _area([initial]),
        ],
        addTable: (area, label, capacity) async {
          calls.add((area, label, capacity));
          return [
            _area([
              initial,
              _table('other-terminal', 'Mesa 2', x: 140),
              created,
            ]),
          ];
        },
        result: (table) => picked = table,
      );
      await tester.tap(find.byKey(const ValueKey('create-additional-table')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Quedará guardada'), findsOneWidget);
      await tester.enterText(
        find.byKey(const ValueKey('new-table-name')),
        'Mesa extra',
      );
      await tester.enterText(
        find.byKey(const ValueKey('new-table-capacity')),
        '6',
      );
      tester.testTextInput.hide();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Crear mesa'));
      await tester.pumpAndSettle();
      expect(calls, [('patio', 'Mesa extra', 6)]);
      expect(
        find.byKey(const ValueKey('floor-plan-element-old-table')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('floor-plan-element-new-table')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('create-additional-table')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('order-table-detail')), findsOneWidget);
      expect(picked, isNull);
      await tester.tap(find.byKey(const ValueKey('confirm-table')));
      await tester.pumpAndSettle();
      expect(picked?.id, 'new-table');
    },
  );

  testWidgets(
    '360px screen at 200 percent uses readable rows with accessible touch targets',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await _open(
        tester,
        areas: [
          _area([_table('table', 'Mesa 12')]),
        ],
        textScale: 2,
        result: (_) {},
      );
      expect(find.byType(FloorPlanMap), findsNothing);
      final row = find.byKey(const ValueKey('table-choice-table'));
      expect(row, findsOneWidget);
      expect(tester.getSize(row).height, greaterThanOrEqualTo(44));
      expect(tester.getSize(row).width, greaterThanOrEqualTo(44));
      await tester.tap(row);
      await tester.pumpAndSettle();
      expect(find.text('Disponible · 4 lugares'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );
}
