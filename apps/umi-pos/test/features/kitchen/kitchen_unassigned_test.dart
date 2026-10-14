import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_controller.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_surface.dart';
import 'package:umi_pos/features/kitchen/kitchen_unassigned_surface.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';

import '../../support/fakes.dart';
import 'kitchen_board_test.dart'
    show
        FakeBoardRepository,
        FakeCommandRepository,
        order,
        itemJson,
        merchantId,
        locationId,
        operatorSessionId,
        orderId,
        itemLatte,
        itemToast,
        query,
        serverClock;

const _stationId = '00000000-0000-4000-8000-0000000000e1';
const _fingerprint =
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const _nextFingerprint =
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

KitchenUnassignedOrderProjection _ticket({
  bool cancelled = false,
  bool partial = false,
  String fingerprint = _fingerprint,
  int version = 1,
}) => KitchenUnassignedOrderProjection.fromJson({
  ...order(
    reference: 'Cuenta 004 · Mesa 1',
    status: cancelled ? 'cancelled' : 'exception',
    version: version,
    businessDate: '2026-09-15',
  ).toJson(),
  'stationId': null,
  'stationName': 'Sin estación',
  'routingFingerprint': fingerprint,
  'items': [
    itemJson(itemLatte, 'Latte', status: cancelled ? 'cancelled' : 'exception'),
    itemJson(itemToast, 'Toast', status: cancelled ? 'cancelled' : 'exception'),
  ],
  'proposedRoutes': [
    {
      'itemId': itemLatte,
      'productName': 'Latte',
      'stationId': _stationId,
      'stationName': 'Barra',
    },
    {
      'itemId': itemToast,
      'productName': 'Toast',
      'stationId': partial ? null : _stationId,
      'stationName': partial ? null : 'Barra',
    },
  ],
});

KitchenUnassignedCommandResult _result({
  int resolved = 2,
  int remaining = 0,
  int discarded = 0,
}) => KitchenUnassignedCommandResult(
  kitchenOrderId: orderId,
  status: discarded > 0
      ? 'cancelled'
      : remaining > 0
      ? 'exception'
      : 'queued',
  version: 2,
  sequence: 4,
  updatedAt: serverClock,
  resolvedItems: resolved,
  remainingItems: remaining,
  discardedItems: discarded,
);

class _Repository
    implements KitchenBoardRepository, KitchenUnassignedRepository {
  final board = FakeBoardRepository();
  List<KitchenUnassignedOrderProjection> tickets = [_ticket()];
  final resolved = <PosKitchenUnassignedCommandRequest>[];
  final discarded = <PosKitchenUnassignedCommandRequest>[];
  Object? commandFailure;
  Object? readFailure;
  Completer<KitchenUnassignedCommandResult>? commandGate;
  Future<List<KitchenUnassignedOrderProjection>> Function()? onUnassigned;
  KitchenUnassignedCommandResult result = _result();
  int unassignedReads = 0;
  bool removeAfterWrite = true;
  @override
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  ) => board.snapshot(merchantId, query);
  @override
  Future<KitchenAllDayCounts> allDay(
    String merchantId,
    PosKitchenAllDayQuery query,
  ) => board.allDay(merchantId, query);
  @override
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query) =>
      board.watch(merchantId, query);
  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) =>
      board.prepList(merchantId, query);
  @override
  Future<List<KitchenStation>> stations(
    String merchantId,
    PosKitchenOrderQuery query,
  ) => board.stations(merchantId, query);
  @override
  Future<List<KitchenUnassignedOrderProjection>> unassigned(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    unassignedReads++;
    if (onUnassigned != null) return onUnassigned!();
    if (readFailure != null) throw readFailure!;
    return tickets;
  }

  Future<KitchenUnassignedCommandResult> _write() async {
    if (commandFailure != null) throw commandFailure!;
    if (commandGate != null) return commandGate!.future;
    if (removeAfterWrite) tickets = [];
    return result;
  }

  @override
  Future<KitchenUnassignedCommandResult> resolveUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  ) {
    resolved.add(request);
    return _write();
  }

  @override
  Future<KitchenUnassignedCommandResult> discardUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  ) {
    discarded.add(request);
    return _write();
  }
}

Future<KitchenBoardController> _loaded(_Repository repository) async {
  final connectivity = ConnectivityController();
  final controller = KitchenBoardController(
    repository,
    commands: FakeCommandRepository(),
    connectivity: connectivity,
  );
  addTearDown(controller.dispose);
  addTearDown(connectivity.dispose);
  await controller.load(merchantId, query);
  return controller;
}

class _Gateway implements EntryGateway {
  _Gateway(this.permissions);
  final List<String> permissions;
  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: operatorSessionId,
    userId: 'user',
    staffId: 'staff',
    merchantId: merchantId,
    locationId: locationId,
    deviceId: 'device',
    state: 'active',
    permissions: permissions,
    entitlements: const [],
    startedAt: serverClock,
    lastActivityAt: serverClock,
    expiresAt: '2026-10-16T18:00:00.000Z',
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<EntryController> _entry(List<String> permissions) async {
  final entry = EntryController(
    gateway: _Gateway(permissions),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    idleTimeout: const Duration(hours: 2),
  );
  await entry.selectTenant(
    EntryMerchant.fromJson({
      'id': merchantId,
      'name': 'Café',
      'roles': [],
      'permissions': [],
      'entitlements': [],
      'locations': [
        {
          'id': locationId,
          'merchantId': merchantId,
          'name': 'Local',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  return entry;
}

Future<EntryController> _mount(
  WidgetTester tester,
  KitchenBoardController controller, {
  List<String> permissions = const [
    'kitchen.read',
    'kitchen.station.manage',
    'kitchen.cancel_ack',
  ],
  bool board = false,
  double textScale = 1,
}) async {
  final entry = await _entry(permissions);
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
  });
  await tester.pumpWidget(
    PosApp(
      locale: const Locale('es'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      home: board
          ? KitchenBoardSurface(
              controller: controller,
              entry: entry,
              connectivity: controller.connectivity,
              clock: () => DateTime.parse(serverClock),
            )
          : KitchenUnassignedSurface(
              controller: controller,
              entry: entry,
              clock: () => DateTime.parse('2026-09-18T18:00:00Z'),
            ),
    ),
  );
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 100));
  return entry;
}

void main() {
  test(
    'board refresh and its existing watch update the queue without any write',
    () async {
      final repository = _Repository();
      final controller = await _loaded(repository);
      expect(controller.unassignedOrders.single.stationId, isNull);
      expect(repository.resolved, isEmpty);
      final wake = Completer<bool>();
      repository.board.onWatch = () => wake.future;
      unawaited(controller.startWatching());
      repository.tickets = [];
      repository.board.onWatch = () => Completer<bool>().future;
      wake.complete(true);
      for (var i = 0; i < 8; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      expect(repository.unassignedReads, 2);
      expect(controller.unassignedOrders, isEmpty);
      expect(repository.resolved, isEmpty);
      expect(repository.discarded, isEmpty);
    },
  );

  test(
    'resolve uses preview fingerprint and retries a lost response with the same identity',
    () async {
      final repository = _Repository();
      final controller = await _loaded(repository);
      final ticket = controller.unassignedOrders.single;
      repository.commandFailure = TimeoutException('response lost');
      expect(await controller.resolveUnassigned(ticket), isFalse);
      final first = repository.resolved.single;
      expect(first.routingFingerprint, _fingerprint);
      expect(first.expectedVersion, ticket.version);
      expect(first.locationId, locationId);
      expect(first.operatorSessionId, operatorSessionId);
      repository.commandFailure = null;
      expect(await controller.resolveUnassigned(ticket), isTrue);
      expect(repository.resolved.last.idempotencyKey, first.idempotencyKey);
      expect(controller.unassignedOrders, isEmpty);
      expect(controller.lastUnassignedResult?.resolvedItems, 2);
      expect(controller.unassignedBusyTarget, isNull);
    },
  );

  test(
    'route changes require a new preview and never retry automatically',
    () async {
      final repository = _Repository();
      final controller = await _loaded(repository);
      final old = controller.unassignedOrders.single;
      repository.tickets = [_ticket(fingerprint: _nextFingerprint)];
      repository.commandFailure = const AppException(
        category: AppErrorCategory.conflict,
        code: 'OPTIMISTIC_VERSION_CONFLICT',
        recoverable: true,
      );
      expect(await controller.resolveUnassigned(old), isFalse);
      expect(repository.resolved, hasLength(1));
      expect(
        controller.unassignedOrders.single.routingFingerprint,
        _nextFingerprint,
      );
      repository.commandFailure = null;
      expect(
        await controller.resolveUnassigned(controller.unassignedOrders.single),
        isTrue,
      );
      expect(repository.resolved.last.routingFingerprint, _nextFingerprint);
      expect(
        repository.resolved.last.idempotencyKey,
        isNot(repository.resolved.first.idempotencyKey),
      );
    },
  );

  test(
    'cancelled tickets cannot resolve and active tickets cannot be discarded',
    () async {
      final repository = _Repository();
      final controller = await _loaded(repository);
      expect(
        await controller.resolveUnassigned(_ticket(cancelled: true)),
        isFalse,
      );
      expect(await controller.discardUnassigned(_ticket()), isFalse);
      expect(repository.resolved, isEmpty);
      expect(repository.discarded, isEmpty);
      repository.result = _result(resolved: 0, discarded: 2);
      expect(
        await controller.discardUnassigned(_ticket(cancelled: true)),
        isTrue,
      );
      expect(repository.discarded.single.routingFingerprint, isNull);
      expect(controller.lastUnassignedResult?.discardedItems, 2);
    },
  );

  test(
    'scope change discards a late queue read and a late command result',
    () async {
      final repository = _Repository();
      final controller = await _loaded(repository);
      final oldRead = Completer<List<KitchenUnassignedOrderProjection>>();
      repository.onUnassigned = () => oldRead.future;
      final read = controller.refresh();
      for (var i = 0; i < 4; i++) {
        await Future<void>.delayed(Duration.zero);
      }
      repository.onUnassigned = () async => [];
      await controller.load(
        merchantId,
        const PosKitchenOrderQuery(
          locationId: 'new-location',
          operatorSessionId: 'new-operator',
        ),
      );
      oldRead.complete([_ticket()]);
      await read;
      expect(controller.unassignedOrders, isEmpty);
      await controller.load(merchantId, query);
      repository.commandGate = Completer<KitchenUnassignedCommandResult>();
      final command = controller.resolveUnassigned(_ticket());
      await controller.load(
        merchantId,
        const PosKitchenOrderQuery(
          locationId: 'next-location',
          operatorSessionId: 'next-operator',
        ),
      );
      repository.commandGate!.complete(_result());
      expect(await command, isFalse);
      expect(controller.lastUnassignedResult, isNull);
      expect(controller.unassignedBusyTarget, isNull);
    },
  );

  testWidgets(
    'active ticket shows old date and proposed destinations and requires explicit confirmation',
    (tester) async {
      final repository = _Repository()
        ..tickets = [_ticket(partial: true)]
        ..removeAfterWrite = false
        ..result = _result(resolved: 1, remaining: 1);
      final controller = await _loaded(repository);
      final entry = await _mount(tester, controller);
      expect(find.text('Fecha: 2026-09-15'), findsOneWidget);
      expect(find.text('Antigüedad: 2 d 0 h'), findsOneWidget);
      expect(find.text('Destino actual: Barra'), findsOneWidget);
      expect(find.textContaining('Sin ruta disponible.'), findsOneWidget);
      expect(find.text('Descartar'), findsNothing);
      await tester.tap(
        find.byKey(const ValueKey('resolve-unassigned-$orderId')),
      );
      await tester.pumpAndSettle();
      expect(repository.resolved, isEmpty);
      expect(find.text('Latte → Barra'), findsOneWidget);
      expect(find.text('Toast → sigue sin estación'), findsOneWidget);
      await tester.tap(find.text('Volver'));
      await tester.pumpAndSettle();
      expect(repository.resolved, isEmpty);
      await tester.tap(
        find.byKey(const ValueKey('resolve-unassigned-$orderId')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('confirm-unassigned-routes')));
      await tester.pumpAndSettle();
      expect(repository.resolved, hasLength(1));
      expect(
        find.text('1 productos enviados a su estación. 1 siguen sin estación.'),
        findsOneWidget,
      );
      entry.dispose();
    },
  );

  testWidgets(
    'cancelled ticket has only dismiss and disappears after acknowledgement',
    (tester) async {
      final repository = _Repository()
        ..tickets = [_ticket(cancelled: true)]
        ..result = _result(resolved: 0, discarded: 2);
      final controller = await _loaded(repository);
      final entry = await _mount(tester, controller);
      expect(find.text('Cancelado'), findsOneWidget);
      expect(find.text('Aplicar rutas actuales'), findsNothing);
      expect(find.textContaining('Destino actual'), findsNothing);
      await tester.tap(find.text('Descartar'));
      await tester.pumpAndSettle();
      expect(repository.discarded, hasLength(1));
      expect(find.text('No hay productos sin estación.'), findsOneWidget);
      expect(find.text('2 productos cancelados descartados.'), findsOneWidget);
      entry.dispose();
    },
  );

  testWidgets(
    'read-only role sees tickets but no management or discard actions',
    (tester) async {
      final repository = _Repository()..tickets = [_ticket()];
      final controller = await _loaded(repository);
      final entry = await _mount(
        tester,
        controller,
        permissions: ['kitchen.read'],
      );
      expect(find.text('Cuenta 004 · Mesa 1'), findsOneWidget);
      expect(find.text('Aplicar rutas actuales'), findsNothing);
      repository.tickets = [_ticket(cancelled: true)];
      await controller.refresh();
      await tester.pumpAndSettle();
      expect(find.text('Cancelado'), findsOneWidget);
      expect(find.text('Descartar'), findsNothing);
      expect(repository.resolved, isEmpty);
      expect(repository.discarded, isEmpty);
      entry.dispose();
    },
  );

  testWidgets('failed queue refresh preserves tickets and blocks routing', (
    tester,
  ) async {
    final repository = _Repository();
    final controller = await _loaded(repository);
    final entry = await _mount(tester, controller);
    repository.readFailure = TimeoutException('offline');
    await controller.refresh();
    await tester.pumpAndSettle();
    expect(find.text('Cuenta 004 · Mesa 1'), findsOneWidget);
    expect(
      find.textContaining('No se pudo actualizar esta bandeja.'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<PosButton>(
            find.byKey(const ValueKey('resolve-unassigned-$orderId')),
          )
          .onPressed,
      isNull,
    );
    repository.readFailure = null;
    await controller.refresh();
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<PosButton>(
            find.byKey(const ValueKey('resolve-unassigned-$orderId')),
          )
          .onPressed,
      isNotNull,
    );
    entry.dispose();
  });

  testWidgets(
    'board always offers the queue even with zero tickets and refreshes the badge',
    (tester) async {
      final repository = _Repository()..tickets = [];
      final controller = await _loaded(repository);
      final entry = await _mount(tester, controller, board: true);
      expect(find.text('Sin estación · 0'), findsOneWidget);
      repository.tickets = [_ticket()];
      await controller.refresh();
      await tester.pump();
      expect(find.text('Sin estación · 1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('open-unassigned-kitchen')));
      await tester.pumpAndSettle();
      expect(find.byType(KitchenUnassignedSurface), findsOneWidget);
      expect(find.text('Cuenta 004 · Mesa 1'), findsOneWidget);
      expect(repository.resolved, isEmpty);
      entry.dispose();
    },
  );

  testWidgets(
    'queue at 360px and 200 percent text remains scrollable without overflow',
    (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final repository = _Repository();
      final controller = await _loaded(repository);
      final entry = await _mount(tester, controller, textScale: 2);
      final action = find.byKey(const ValueKey('resolve-unassigned-$orderId'));
      await tester.scrollUntilVisible(action, 300);
      await tester.pumpAndSettle();
      await tester.tap(action);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('confirm-unassigned-routes')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      entry.dispose();
    },
  );
}
