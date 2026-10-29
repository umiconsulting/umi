import 'dart:async';

import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart' show FontLoader, rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/localization/app_localizations_en.dart';
import 'package:umi_pos/core/localization/app_localizations_es.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/display_preferences.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_controller.dart';
import 'package:umi_pos/features/kitchen/kitchen_board_surface.dart';
import 'package:umi_pos/features/kitchen/kitchen_status_repository.dart';
import 'package:umi_pos/features/offline/connectivity_controller.dart';

import '../../support/fakes.dart';

const merchantId = '00000000-0000-4000-8000-0000000000a1';
const locationId = '00000000-0000-4000-8000-0000000000a2';
const operatorSessionId = '00000000-0000-4000-8000-0000000000a3';
const orderId = '00000000-0000-4000-8000-0000000000b1';
const itemLatte = '00000000-0000-4000-8000-0000000000c1';
const itemToast = '00000000-0000-4000-8000-0000000000c2';
const serverClock = '2026-09-16T18:00:00.000Z';

Map<String, Object?> itemJson(
  String id,
  String productName, {
  String status = 'queued',
  int quantity = 1,
  int courseNumber = 1,
  bool fired = true,
  List<Map<String, Object?>> allergens = const <Map<String, Object?>>[],
}) => {
  'id': id,
  'status': status,
  'productName': productName,
  'variantName': null,
  // §8.5: the allergen labels the product's recipe yields. The contract requires the
  // key, because a server that stopped sending it would leave the board unable to
  // tell a guest with an allergy anything. A fixture without it is not an older
  // ticket — it is a ticket that cannot exist.
  'allergens': allergens,
  'modifiers': const <String>[],
  'quantity': quantity,
  'preparationNote': null,
  'displayOrder': 0,
  'targetSeconds': null,
  // §8H step 4: every line carries the course it is served in, and whether the
  // kitchen has been told to start it. Both are required by the contract, so a
  // fixture without them is not an older ticket — it is a ticket that cannot
  // exist, and the board should throw on it rather than draw a guess.
  'courseNumber': courseNumber,
  'fired': fired,
  'version': 1,
};

KitchenOrderProjection order({
  String status = 'queued',
  int version = 1,
  int firedThroughCourse = 1,
  String reference = 'A-101',
  List<Map<String, Object?>>? items,
  String station = '00000000-0000-4000-8000-0000000000e1',
  String? stationName,
  String businessDate = '2026-09-16',
}) => KitchenOrderProjection.fromJson({
  'id': orderId,
  'sourceOrderId': '00000000-0000-4000-8000-0000000000d1',
  'publicReference': reference,
  'merchantId': merchantId,
  'locationId': locationId,
  'stationId': station,
  'stationName': ?stationName,
  'source': 'pos',
  'status': status,
  'priority': 'normal',
  'businessDate': businessDate,
  'queuedAt': '2026-09-16T17:58:00.000Z',
  'preparationStartedAt': null,
  'updatedAt': serverClock,
  'version': version,
  'lastEventSequence': 3,
  'firedThroughCourse': firedThroughCourse,
  'items':
      items ??
      [
        itemJson(
          itemLatte,
          'Latte',
          status: status == 'ready' ? 'ready' : 'queued',
        ),
        itemJson(
          itemToast,
          'Toast',
          quantity: 2,
          status: status == 'ready' ? 'ready' : 'queued',
        ),
      ],
});

final class FakeBoardRepository implements KitchenBoardRepository {
  List<KitchenOrderProjection> orders = const [];
  int reads = 0;
  Object? failure;
  Future<List<KitchenOrderProjection>> Function()? onSnapshot;

  /// Today's counts, as the all-day route answers them.
  List<KitchenAllDayItem> allDayItems = const [];
  String businessDate = '2026-09-16';
  int allDayReads = 0;

  /// When set, only the COUNT route fails — the case where the board must keep
  /// working without it.
  Object? allDayFailure;

  /// LAS ESTACIONES DE LA COCINA. Empty by default, which is the till whose list read has
  /// not answered: the tabs then fall back to the stations the tickets mention.
  List<KitchenStation> kitchenStations = const [];
  Object? stationsFailure;

  @override
  Future<List<KitchenStation>> stations(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    if (stationsFailure != null) throw stationsFailure!;
    return kitchenStations;
  }

  /// What the next watch calls answer, in order. A watch with nothing queued HOLDS,
  /// exactly like the server's held request, so the loop parks instead of spinning.
  final List<bool> watchAnswers = [];
  int watchReads = 0;
  Future<bool> Function()? onWatch;

  @override
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query) async {
    watchReads += 1;
    if (onWatch != null) return onWatch!();
    if (watchAnswers.isNotEmpty) return watchAnswers.removeAt(0);
    await Completer<void>().future;
    return false;
  }

  @override
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    reads += 1;
    if (onSnapshot != null) return onSnapshot!();
    final failure = this.failure;
    if (failure != null) throw failure;
    return orders;
  }

  @override
  Future<KitchenAllDayCounts> allDay(
    String merchantId,
    PosKitchenAllDayQuery query,
  ) async {
    allDayReads += 1;
    final failure = allDayFailure;
    if (failure != null) throw failure;
    return (businessDate: businessDate, items: allDayItems);
  }

  /// The prep list the Preparacion tab reads (§8.4). It records the scope, so a
  /// test can prove the tab asked with the till's own merchant and location.
  PrepList prepListResult = PrepList(
    items: const [],
    locationId: locationId,
    from: '2026-09-01',
    to: '2026-09-28',
    asOf: serverClock,
    correlationId: '00000000-0000-4000-8000-0000000000f1',
  );
  int prepListReads = 0;
  String? lastPrepListMerchantId;
  PosPrepListQuery? lastPrepListQuery;
  Object? prepListFailure;

  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) async {
    prepListReads += 1;
    lastPrepListMerchantId = merchantId;
    lastPrepListQuery = query;
    final failure = prepListFailure;
    if (failure != null) throw failure;
    return prepListResult;
  }
}

/// One prep-list row, in the contract's scaled-quantity shape.
Map<String, Object?> prepItem(
  String id,
  String displayName, {
  String reference = 'REF-01',
  String unit = 'kilogram',
  int scale = 3,
  int? par = 5000,
  int onHand = 1000,
  int forecast = 2000,
  int prep = 2000,
}) => {
  'inventoryItemId': id,
  'publicReference': reference,
  'displayName': displayName,
  'unit': unit,
  'quantityScale': scale,
  'parQuantity': par == null
      ? null
      : {'value': par, 'scale': scale, 'unit': unit},
  'onHandQuantity': {'value': onHand, 'scale': scale, 'unit': unit},
  'forecastUsageQuantity': {'value': forecast, 'scale': scale, 'unit': unit},
  'prepQuantity': {'value': prep, 'scale': scale, 'unit': unit},
  'shelfLifeDays': 3,
  'expiresOn': '2026-09-19',
};

final class FakeCommandRepository implements KitchenCommandRepository {
  final List<PosKitchenCommandRequest> sent = [];
  String? lastMerchantId;
  Object? failure;

  /// Held commands wait on this, so a test can look at the board mid-flight.
  Completer<void>? gate;

  @override
  Future<KitchenCommandResult> command(
    String merchantId,
    PosKitchenCommandRequest request,
  ) async {
    lastMerchantId = merchantId;
    sent.add(request);
    final gate = this.gate;
    if (gate != null) await gate.future;
    final failure = this.failure;
    if (failure != null) throw failure;
    return KitchenCommandResult(
      kitchenOrderId: request.kitchenOrderId,
      status: 'ready',
      version: request.expectedVersion + 1,
      sequence: 4,
      updatedAt: serverClock,
    );
  }
}

PosKitchenOrderQuery get query => const PosKitchenOrderQuery(
  locationId: locationId,
  operatorSessionId: operatorSessionId,
);

/// A controller whose board already holds one queued ticket.
Future<
  ({
    KitchenBoardController board,
    FakeBoardRepository room,
    FakeCommandRepository kitchen,
    ConnectivityController connectivity,
  })
>
loadedBoard({List<KitchenOrderProjection>? orders}) async {
  final room = FakeBoardRepository()..orders = orders ?? [order()];
  final kitchen = FakeCommandRepository();
  final connectivity = ConnectivityController();
  final board = KitchenBoardController(
    room,
    commands: kitchen,
    connectivity: connectivity,
  );
  await board.load(merchantId, query);
  return (
    board: board,
    room: room,
    kitchen: kitchen,
    connectivity: connectivity,
  );
}

void main() {
  testWidgets(
    'a queued ticket crosses its station threshold without a refresh',
    (tester) async {
      var now = DateTime.parse('2026-09-16T18:02:59Z');
      final ticket = KitchenOrderProjection.fromJson({
        ...order().toJson(),
        'overdueSeconds': 300,
      });
      final harness = await pumpBoard(
        tester,
        orders: [ticket],
        clock: () => now,
        locale: const Locale('es'),
      );
      expect(find.text('Tiempo vencido'), findsNothing);
      now = now.add(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Tiempo vencido'), findsOneWidget);
      final red = PosTheme.of(
        tester.element(find.text('Tiempo vencido')),
      ).colorScheme.error;
      expect(
        find.byWidgetPredicate((w) => w is Container && w.color == red),
        findsWidgets,
      );
      await harness.dispose(tester);
    },
  );
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
  group('the board works the tickets', () {
    test(
      'a per-item bump names that line, and every attempt gets a fresh key',
      () async {
        final harness = await loadedBoard();
        final ticket = harness.board.state.orders.single;

        expect(await harness.board.markItemReady(ticket, itemLatte), isTrue);

        final request = harness.kitchen.sent.single;
        expect(request.commandType, 'mark_item_ready');
        // The line, not the ticket: this is what makes "one dish is done"
        // different from "the table is done".
        expect(request.itemIds, [itemLatte]);
        expect(request.kitchenOrderId, orderId);
        expect(request.action, 'command');
        expect(request.expectedVersion, ticket.version);
        expect(request.commandId, isNot(request.idempotencyKey));
        expect(request.idempotencyKey.length, greaterThanOrEqualTo(8));
        expect(request.correlationId.length, greaterThanOrEqualTo(8));

        await harness.board.markItemReady(ticket, itemToast);
        final second = harness.kitchen.sent.last;
        expect(second.itemIds, [itemToast]);
        // A fresh key per attempt: a lost response must not be able to bump the
        // same dish a second time under the same identity.
        expect(second.idempotencyKey, isNot(request.idempotencyKey));
        expect(second.commandId, isNot(request.commandId));
      },
    );

    test(
      'the ticket moves use the same route with their own command type',
      () async {
        final harness = await loadedBoard();
        final ticket = harness.board.state.orders.single;

        await harness.board.startPreparation(ticket);
        expect(harness.kitchen.sent.single.commandType, 'start_preparation');
        expect(harness.kitchen.sent.single.itemIds, [itemLatte, itemToast]);

        await harness.board.complete(ticket);
        expect(harness.kitchen.sent.last.commandType, 'complete');
        expect(harness.kitchen.sent.last.kitchenOrderId, orderId);
      },
    );

    test('a recall carries the reason the cook gave', () async {
      final harness = await loadedBoard(orders: [order(status: 'ready')]);
      final ticket = harness.board.state.orders.single;

      await harness.board.recall(
        ticket,
        reasonCode: 'wrong_item',
        reasonNote: 'Sin queso',
      );

      final request = harness.kitchen.sent.single;
      expect(request.commandType, 'recall');
      // The server refuses a recall with no reason on it.
      expect(request.reasonCode, 'wrong_item');
      expect(request.reasonNote, 'Sin queso');
    });

    test('an accepted bump stays painted without a blocking re-read', () async {
      final harness = await loadedBoard();
      final ticket = harness.board.state.orders.single;
      expect(harness.room.reads, 1);

      await harness.board.markItemReady(ticket, itemLatte);

      expect(harness.room.reads, 1);
      expect(harness.board.state.phase, KitchenBoardPhase.ready);
      expect(
        KitchenOrderItem.fromJson(
          harness.board.state.orders.single.items.firstWhere(
            (item) => item['id'] == itemLatte,
          ),
        ).status,
        'ready',
      );
    });
  });

  group('courses and staging (§8H step 4)', () {
    test('a ticket is grouped by course, and a held course is not work', () async {
      final harness = await loadedBoard(
        orders: [
          order(
            items: [
              itemJson(itemLatte, 'Latte'),
              itemJson(
                itemToast,
                'Toast',
                courseNumber: 2,
                fired: false,
                quantity: 3,
              ),
            ],
          ),
        ],
      );
      final ticket = harness.board.state.orders.single;

      final groups = groupCourses(ticket);

      // One group per course, lowest first, so the cook reads the ticket in the
      // order the table will be served.
      expect(groups.map((group) => group.courseNumber), [1, 2]);
      expect(groups.first.fired.map((item) => item.productName), ['Latte']);
      // Course 1 is fired and empty of held lines; course 2 is the opposite.
      expect(groups.first.held, isEmpty);
      expect(groups.first.isHeld, isFalse);
      expect(groups.last.held.map((item) => item.productName), ['Toast']);
      expect(groups.last.isHeld, isTrue);
      // One line, three portions: the block counts what is waiting in the same
      // units the rest of the ticket uses.
      expect(groups.last.heldCount, 1);
      expect(groups.last.heldQuantity, 3);
      // The course to call is the lowest one still waiting, never the highest:
      // firing past a gap would start a later round first.
      expect(nextHeldCourse(ticket), 2);
    });

    test(
      'a ticket the kitchen has already been through has nothing to fire',
      () async {
        final harness = await loadedBoard();
        // The everyday sale: every line is course 1 and the watermark starts at 1,
        // which is why an ordinary ticket grows no fire control at all.
        expect(nextHeldCourse(harness.board.state.orders.single), isNull);
      },
    );

    test(
      'firing a course names it and paints locally before the answer',
      () async {
        final harness = await loadedBoard(
          orders: [
            order(
              items: [
                itemJson(itemLatte, 'Latte'),
                itemJson(itemToast, 'Toast', courseNumber: 2, fired: false),
              ],
            ),
          ],
        );
        final ticket = harness.board.state.orders.single;

        // Hold the command open so the board can be looked at mid-flight, before
        // the server has said anything.
        final gate = Completer<void>();
        harness.kitchen.gate = gate;

        final firing = harness.board.fireCourse(ticket, courseNumber: 2);
        await Future<void>.delayed(Duration.zero);

        final request = harness.kitchen.sent.single;
        expect(request.commandType, 'fire_course');
        // The course, not an item: firing is the whole round at once, which is
        // what the ticket-level watermark is for.
        expect(request.courseNumber, 2);
        expect(request.itemIds, isEmpty);
        expect(request.kitchenOrderId, orderId);
        expect(request.expectedVersion, ticket.version);

        // The local node is the authority for the station while the cloud is
        // away, so the course is tappable immediately. The request is still in
        // flight and a refusal will replace this paint with the refreshed board.
        final inFlight = harness.board.state.orders.single;
        expect(nextHeldCourse(inFlight), isNull);
        expect(
          inFlight.items
              .map(KitchenOrderItem.fromJson)
              .where((item) => item.fired)
              .length,
          2,
        );
        // The tap is on the ticket's own spinner, not lost.
        expect(
          harness.board.state.busyTarget,
          KitchenBoardController.fireTarget(2),
        );

        // The server answers, and ITS answer is what moves the board: the same
        // ticket with the watermark advanced.
        harness.room.orders = [
          order(
            version: 2,
            firedThroughCourse: 2,
            items: [
              itemJson(itemLatte, 'Latte'),
              itemJson(itemToast, 'Toast', courseNumber: 2),
            ],
          ),
        ];
        gate.complete();
        expect(await firing, isTrue);

        final after = harness.board.state.orders.single;
        expect(after.firedThroughCourse, 2);
        expect(nextHeldCourse(after), isNull);
        expect(groupCourses(after).last.held, isEmpty);
        // One command and no blocking re-read: the local queue kept the painted
        // course, and the server version was accepted in place.
        expect(harness.kitchen.sent, hasLength(1));
        expect(harness.room.reads, 1);
      },
    );

    test('firing and a per-item bump take turns on the same route', () async {
      final harness = await loadedBoard(
        orders: [
          order(
            items: [
              itemJson(itemLatte, 'Latte'),
              itemJson(itemToast, 'Toast', courseNumber: 2, fired: false),
            ],
          ),
        ],
      );
      final ticket = harness.board.state.orders.single;

      final gate = Completer<void>();
      harness.kitchen.gate = gate;
      final firing = harness.board.fireCourse(ticket, courseNumber: 2);
      await Future<void>.delayed(Duration.zero);

      // The second tap joins the local queue while the first is unanswered.
      final bump = harness.board.markItemReady(ticket, itemLatte);
      expect(harness.kitchen.sent, hasLength(1));

      gate.complete();
      expect(await firing, isTrue);
      expect(await bump, isTrue);
      expect(harness.kitchen.sent, hasLength(2));
      expect(harness.kitchen.sent.last.commandType, 'mark_item_ready');
      expect(harness.kitchen.sent.last.expectedVersion, 2);
    });
  });

  group('a refusal never wedges the board', () {
    test('an AppException is reported with its own code', () async {
      final harness = await loadedBoard();
      harness.kitchen.failure = const AppException(
        category: AppErrorCategory.permission,
        code: 'PERMISSION_DENIED',
        recoverable: false,
      );

      final ok = await harness.board.markItemReady(
        harness.board.state.orders.single,
        itemLatte,
      );

      expect(ok, isFalse);
      expect(harness.board.state.errorCode, 'PERMISSION_DENIED');
      expect(harness.board.state.busy, isFalse);
      // The tickets stay on the screen while the operator reads why.
      expect(harness.board.state.orders, hasLength(1));
    });

    test('an unknown failure keeps the local paint and retries it', () async {
      final harness = await loadedBoard();
      // Exactly the shape that left the sibling cash controller spinning:
      // a failure the controller does not name, so it falls out of the typed
      // catch and lands in the broad one.
      harness.kitchen.failure = const FormatException('decode slipped');

      final ok = await harness.board.markItemReady(
        harness.board.state.orders.single,
        itemLatte,
      );

      expect(ok, isFalse);
      expect(harness.board.state.busy, isFalse);
      expect(harness.board.state.errorCode, isNull);
      expect(harness.board.pendingCommandCount, 1);
      expect(
        KitchenOrderItem.fromJson(
          harness.board.state.orders.single.items.firstWhere(
            (item) => item['id'] == itemLatte,
          ),
        ).status,
        'ready',
      );
      // The next board refresh retries the same intent instead of asking the
      // cook to tap the line again.
      harness.kitchen.failure = null;
      await harness.board.load(merchantId, query);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(harness.kitchen.sent, hasLength(2));
      expect(harness.board.pendingCommandCount, 0);
      expect(harness.board.state.errorCode, isNull);
    });

    test('a version conflict re-reads the board and reports, and does not '
        'retry the bump', () async {
      final harness = await loadedBoard();
      // Built through the same mapping the client uses on a real 409 body, so
      // this test proves the code reaches the conflict bucket too.
      harness.kitchen.failure = AppException.fromApi(
        const ApiError(
          code: 'KITCHEN_VERSION_CONFLICT',
          message: 'the ticket moved',
          retryable: false,
          correlationId: '00000000-0000-4000-8000-0000000000f1',
        ),
      );

      final ok = await harness.board.markItemReady(
        harness.board.state.orders.single,
        itemLatte,
      );

      expect(ok, isFalse);
      expect(harness.board.state.errorCode, 'KITCHEN_VERSION_CONFLICT');
      expect(harness.board.state.errorReference, 'A-101');
      // One command, and one re-read: the load at start plus the reload.
      expect(harness.kitchen.sent, hasLength(1));
      expect(harness.room.reads, 2);
      // The conflict message outlives the reload that follows it.
      expect(harness.board.state.phase, KitchenBoardPhase.ready);
      expect(harness.board.state.errorCode, 'KITCHEN_VERSION_CONFLICT');
    });

    test('a failure to read the board is reported as its own code', () async {
      final harness = await loadedBoard();
      harness.room.failure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );

      await harness.board.load(merchantId, query);

      expect(harness.board.state.phase, KitchenBoardPhase.failure);
      expect(harness.board.state.errorCode, 'TRANSPORT_FAILURE');
    });

    test(
      'command failure and dismissal preserve station and daily metadata',
      () async {
        final harness = await loadedBoard();
        harness.room.allDayItems = const [
          KitchenAllDayItem(
            productName: 'Latte',
            variantName: null,
            ordered: 7,
            outstanding: 2,
          ),
        ];
        await harness.board.load(merchantId, query);
        final counts = harness.board.state.allDay;
        final stations = harness.board.state.stations;
        harness.kitchen.gate = Completer<void>();
        harness.kitchen.failure = const AppException(
          category: AppErrorCategory.transport,
          code: 'NETWORK_UNAVAILABLE',
          recoverable: true,
        );
        final pending = harness.board.markItemReady(
          harness.board.state.orders.single,
          itemLatte,
        );
        expect(harness.board.state.allDay, same(counts));
        expect(harness.board.state.businessDate, '2026-09-16');
        harness.kitchen.gate!.complete();
        expect(await pending, isFalse);
        expect(harness.board.state.allDay, same(counts));
        expect(harness.board.state.stations, same(stations));
        harness.board.dismissError();
        expect(harness.board.state.errorCode, isNull);
        expect(harness.board.state.allDay, same(counts));
        expect(harness.board.state.businessDate, '2026-09-16');
        harness.board.dispose();
      },
    );

    test('the all-day count reaches the line it counts', () async {
      final harness = await loadedBoard();
      harness.room.allDayItems = const [
        KitchenAllDayItem(
          productName: 'Latte',
          variantName: null,
          ordered: 7,
          outstanding: 2,
        ),
      ];

      await harness.board.load(merchantId, query);

      // Keyed on the name and variant the ticket line carries, which is all the
      // kitchen projector stores — there is no catalogue id on a ticket line.
      final latte = KitchenOrderItem.fromJson(
        harness.board.state.orders.first.items.first,
      );
      final count = harness.board.state.allDayFor(latte);
      expect(count?.ordered, 7);
      expect(count?.outstanding, 2);
      // The other line still has none rather than a zero: a dish nobody counted
      // is not the same claim as a dish nobody ordered.
      final toast = KitchenOrderItem.fromJson(
        harness.board.state.orders.first.items.last,
      );
      expect(harness.board.state.allDayFor(toast), isNull);
    });

    test('a refusing count route leaves the board working', () async {
      final harness = await loadedBoard();
      harness.room.allDayFailure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );

      await harness.board.load(merchantId, query);

      // The board is the job; the count is a reading aid. Its failure is not the
      // operator's action failing, so it neither blanks the rail nor raises the
      // error line.
      expect(harness.board.state.phase, KitchenBoardPhase.ready);
      expect(harness.board.state.orders, isNotEmpty);
      expect(harness.board.state.errorCode, isNull);
      expect(harness.board.state.allDay, isEmpty);
    });

    test('the board\'s own traffic is what moves the connectivity state', () async {
      // The board is the busiest API client on a kitchen till. Before this, its
      // requests reached nobody: the connectivity state moved only when another
      // screen happened to call the API, so the board's offline pill could stay
      // dark while every one of the board's own reads was failing.
      final harness = await loadedBoard();
      expect(harness.connectivity.state, isNot(PosConnectivity.offline));

      // A transport failure is "no answer from the API"; three consecutive ones
      // are what the controller calls offline.
      harness.room.failure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
      await harness.board.load(merchantId, query);
      await harness.board.load(merchantId, query);
      await harness.board.load(merchantId, query);
      expect(harness.connectivity.state, PosConnectivity.offline);

      // A kitchen read can come from the LAN node. It is not proof that the
      // cloud returned, so it must not clear the outage by itself.
      harness.room.failure = null;
      await harness.board.load(merchantId, query);
      expect(harness.connectivity.state, PosConnectivity.offline);

      // The cloud health probe is the one signal that restores the lane.
      harness.connectivity.apiReachable(authorityValid: true);
      harness.connectivity.apiReachable(authorityValid: true);
      expect(harness.connectivity.state, PosConnectivity.online);
    });

    test('a typed refusal is not treated as a broken wire', () async {
      // A 403 or a conflict means the API ANSWERED. Reporting those as failures
      // would mark the till offline for a permission problem, which is a
      // different thing and not what this state is for.
      final harness = await loadedBoard();
      harness.room.failure = const AppException(
        category: AppErrorCategory.permission,
        code: 'PERMISSION_DENIED',
        recoverable: false,
      );

      await harness.board.load(merchantId, query);
      await harness.board.load(merchantId, query);
      await harness.board.load(merchantId, query);

      expect(harness.connectivity.state, isNot(PosConnectivity.offline));
    });

    test('a wake-up reloads the board without waiting for the poll', () async {
      final harness = await loadedBoard();
      final readsBefore = harness.room.reads;

      // The held request answers "something moved" — a ticket was bumped, or a
      // new one arrived at this location.
      harness.room.watchAnswers.add(true);
      final watching = harness.board.startWatching();
      for (
        var waited = 0;
        waited < 40 && harness.room.reads == readsBefore;
        waited++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      harness.board.stopWatching();
      // The loop parks on the next held watch; nothing is left running.
      unawaited(watching);

      // At least one watch, and usually a second already parked: the loop re-arms as
      // soon as it has answered a reload rather than waiting for the poll to tick.
      expect(harness.room.watchReads, greaterThanOrEqualTo(1));
      expect(harness.room.reads, readsBefore + 1);
    });

    test('a closed board cannot report a late poll failure', () async {
      final harness = await loadedBoard();
      addTearDown(harness.board.dispose);
      addTearDown(harness.connectivity.dispose);
      harness.connectivity.apiReachable(authorityValid: true);
      harness.connectivity.apiReachable(authorityValid: true);
      final pending = Completer<List<KitchenOrderProjection>>();
      harness.room.onSnapshot = () => pending.future;
      final loading = harness.board.load(merchantId, query);
      harness.board.stopWatching();
      pending.completeError(
        const AppException(
          category: AppErrorCategory.timeout,
          code: 'REQUEST_TIMEOUT',
          recoverable: true,
        ),
      );
      await loading;
      expect(harness.connectivity.state, PosConnectivity.online);
      expect(harness.board.state.orders, hasLength(1));
      expect(harness.board.state.errorCode, isNull);
    });

    test('a stopped watch cannot report a late connection failure', () async {
      final harness = await loadedBoard();
      addTearDown(harness.board.dispose);
      addTearDown(harness.connectivity.dispose);
      harness.connectivity.apiReachable(authorityValid: true);
      harness.connectivity.apiReachable(authorityValid: true);
      final pending = Completer<bool>();
      harness.room.onWatch = () => pending.future;
      final watching = harness.board.startWatching();
      harness.board.stopWatching();
      pending.completeError(
        const AppException(
          category: AppErrorCategory.timeout,
          code: 'REQUEST_TIMEOUT',
          recoverable: true,
        ),
      );
      await watching;
      expect(harness.connectivity.state, PosConnectivity.online);
      expect(harness.room.watchReads, 1);
    });

    test('a stopped watch cannot report a late connection success', () async {
      final harness = await loadedBoard();
      addTearDown(harness.board.dispose);
      addTearDown(harness.connectivity.dispose);
      final pending = Completer<bool>();
      harness.room.onWatch = () => pending.future;
      final watching = harness.board.startWatching();
      harness.board.stopWatching();
      harness.connectivity.networkDown();
      pending.complete(false);
      await watching;
      expect(harness.connectivity.state, PosConnectivity.offline);
      expect(harness.room.watchReads, 1);
    });

    test(
      'a restarted watch ignores the old request and keeps one loop',
      () async {
        final harness = await loadedBoard();
        addTearDown(harness.board.dispose);
        addTearDown(harness.connectivity.dispose);
        final pending = <Completer<bool>>[];
        harness.room.onWatch = () {
          final request = Completer<bool>();
          pending.add(request);
          return request.future;
        };
        final before = harness.room.reads;
        final oldWatch = harness.board.startWatching();
        harness.board.stopWatching();
        final newWatch = harness.board.startWatching();
        pending[0].complete(true);
        await pumpEventQueue();
        expect(harness.room.reads, before);
        expect(harness.room.watchReads, 2);
        harness.board.stopWatching();
        for (final request in pending.where((r) => !r.isCompleted)) {
          request.complete(false);
        }
        await Future.wait([oldWatch, newWatch]);
      },
    );
  });

  group('the poll and the bump do not fight', () {
    test(
      'a read that started before a bump cannot take its mark back',
      () async {
        final harness = await loadedBoard();
        final read = Completer<List<KitchenOrderProjection>>();
        harness.room.onSnapshot = () => read.future;
        final poll = harness.board.load(merchantId, query);
        harness.room.onSnapshot = null;
        final gate = Completer<void>();
        harness.kitchen.gate = gate;

        final bump = harness.board.markItemReady(
          harness.board.state.orders.single,
          itemLatte,
        );
        await Future<void>.delayed(Duration.zero);
        expect(
          KitchenOrderItem.fromJson(
            harness.board.state.orders.single.items.firstWhere(
              (item) => item['id'] == itemLatte,
            ),
          ).status,
          'ready',
        );

        // This is the stale snapshot that used to erase the checkmark: it left
        // the server before the bump and arrives after the local paint.
        read.complete([order()]);
        await poll;
        expect(
          KitchenOrderItem.fromJson(
            harness.board.state.orders.single.items.firstWhere(
              (item) => item['id'] == itemLatte,
            ),
          ).status,
          'ready',
        );

        gate.complete();
        expect(await bump, isTrue);
        expect(
          KitchenOrderItem.fromJson(
            harness.board.state.orders.single.items.firstWhere(
              (item) => item['id'] == itemLatte,
            ),
          ).status,
          'ready',
        );
      },
    );

    test('two quick marks both stay painted and leave in order', () async {
      final harness = await loadedBoard();
      final gate = Completer<void>();
      harness.kitchen.gate = gate;
      final first = harness.board.markItemReady(
        harness.board.state.orders.single,
        itemLatte,
      );
      await Future<void>.delayed(Duration.zero);
      final second = harness.board.markItemReady(
        harness.board.state.orders.single,
        itemToast,
      );
      await Future<void>.delayed(Duration.zero);

      expect(harness.board.pendingCommandCount, 2);
      expect(harness.board.state.orders.single.status, 'ready');
      expect(harness.kitchen.sent, hasLength(1));

      gate.complete();
      expect(await first, isTrue);
      expect(await second, isTrue);
      expect(harness.kitchen.sent, hasLength(2));
      expect(harness.kitchen.sent.last.itemIds, [itemToast]);
      expect(harness.kitchen.sent.last.expectedVersion, 2);
      expect(harness.board.pendingCommandCount, 0);
      expect(harness.board.state.orders.single.status, 'ready');
    });

    test('the board keeps its tickets while a command is in flight', () async {
      final harness = await loadedBoard();
      final gate = Completer<void>();
      harness.kitchen.gate = gate;

      final pending = harness.board.markItemReady(
        harness.board.state.orders.single,
        itemLatte,
      );
      await Future<void>.delayed(Duration.zero);

      expect(harness.board.state.busyTarget, itemLatte);
      expect(harness.board.state.orders, hasLength(1));
      expect(harness.board.state.phase, isNot(KitchenBoardPhase.idle));

      // A poll landing mid-command does not clear the spinner...
      await harness.board.load(merchantId, query);
      expect(harness.board.state.busyTarget, itemLatte);

      gate.complete();
      expect(await pending, isTrue);
      expect(harness.board.state.busy, isFalse);
    });

    test('a poll and a bump in the same tick both land', () async {
      final harness = await loadedBoard();
      harness.room.orders = [order(status: 'in_preparation', version: 2)];

      final poll = harness.board.load(merchantId, query);
      final bump = harness.board.markItemReady(
        harness.board.state.orders.single,
        itemLatte,
      );
      await poll;
      expect(await bump, isTrue);

      expect(harness.board.state.phase, KitchenBoardPhase.ready);
      expect(harness.room.reads, greaterThanOrEqualTo(2));
    });
  });

  group('the surface', () {
    testWidgets(
      'day filter separates older commands and keeps them reachable',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          locale: const Locale('es'),
          orders: [
            order(
              reference: 'Cuenta 004 · Mesa 2',
              items: [itemJson(itemLatte, 'Café de hoy')],
            ),
            order(
              reference: 'Cuenta 004 · Mesa 1',
              businessDate: '2026-09-15',
              items: [itemJson(itemToast, 'Pizza anterior')],
            ),
          ],
        );
        expect(find.text('Café de hoy'), findsOneWidget);
        expect(find.text('Cuenta 004 · Mesa 2'), findsOneWidget);
        expect(find.text('Pizza anterior'), findsNothing);
        expect(find.text('Anteriores (1)'), findsOneWidget);
        await tester.tap(find.text('Anteriores (1)'));
        await tester.pump();
        expect(find.text('Pizza anterior'), findsOneWidget);
        expect(find.text('Cuenta 004 · Mesa 1 · 2026-09-15'), findsOneWidget);
        expect(find.text('Café de hoy'), findsNothing);
        await tester.tap(find.text('Todos (2)'));
        await tester.pump();
        expect(find.text('Pizza anterior'), findsOneWidget);
        expect(find.text('Café de hoy'), findsOneWidget);
        expect(find.text('Cuenta 004 · Mesa 2'), findsOneWidget);
        await tester.pumpWidget(const SizedBox.shrink());
        await harness.dispose(tester);
      },
    );
    testWidgets('station filter narrows orders and Todos restores the pass', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        locale: const Locale('es'),
        orders: [
          order(
            reference: 'Cuenta 019',
            station: '00000000-0000-4000-8000-0000000000e1',
            stationName: 'Barra',
            items: [itemJson(itemLatte, 'Capuccino')],
          ),
          order(
            reference: 'Cuenta 019',
            station: '00000000-0000-4000-8000-0000000000e2',
            stationName: 'Plancha',
            items: [itemJson(itemToast, 'Margarita')],
          ),
        ],
      );

      expect(find.text('Capuccino'), findsOneWidget);
      expect(find.text('Margarita'), findsOneWidget);
      await tester.tap(find.text('Plancha').first);
      await tester.pump();
      expect(find.text('Margarita'), findsOneWidget);
      expect(find.text('Capuccino'), findsNothing);
      await tester.tap(find.text('Todos'));
      await tester.pump();
      expect(find.text('Capuccino'), findsOneWidget);
      expect(find.text('Margarita'), findsOneWidget);
      await harness.dispose(tester);
    });

    // One station is not a filter: a control with a single option cannot narrow
    // anything, and the merchant who never split their kitchen should not have to read
    // a chip row to learn that.
    testWidgets('one station gets no filter at all', (tester) async {
      final harness = await pumpBoard(
        tester,
        locale: const Locale('es'),
        orders: [
          order(stationName: 'Cocina', items: [itemJson(itemLatte, 'Latte')]),
        ],
      );

      expect(find.text('Todos'), findsNothing);
      expect(find.text('Latte'), findsOneWidget);
      await harness.dispose(tester);
    });

    // All stations remain selectable even when one has no tickets.
    testWidgets('configured station filter remains available when empty', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        locale: const Locale('es'),
        kitchenStations: const [
          KitchenStation(
            id: 'barra',
            key: 'barra',
            name: 'Barra',
            sortOrder: 0,
          ),
          KitchenStation(
            id: 'plancha',
            key: 'plancha',
            name: 'Plancha',
            sortOrder: 1,
          ),
        ],
        orders: [
          order(
            reference: 'Cuenta 019',
            station: 'barra',
            stationName: 'Barra',
            items: [itemJson(itemLatte, 'Capuccino')],
          ),
        ],
      );

      expect(find.text('Capuccino'), findsOneWidget);
      expect(find.text('Todos'), findsOneWidget);
      expect(find.text('Plancha'), findsOneWidget);
      await tester.tap(find.text('Plancha'));
      await tester.pump();
      expect(find.text('Capuccino'), findsNothing);
      await tester.tap(find.text('Todos'));
      await tester.pump();
      expect(find.text('Capuccino'), findsOneWidget);
      await harness.dispose(tester);
    });

    // A SCREEN THAT LIVES ON A STATION OPENS ON THAT FILTER.
    testWidgets('a screen remembered as a station opens on it', (tester) async {
      final harness = await pumpBoard(
        tester,
        locale: const Locale('es'),
        screenStationId: '00000000-0000-4000-8000-0000000000e2',
        screenStationName: 'Plancha',
        kitchenStations: const [
          KitchenStation(
            id: '00000000-0000-4000-8000-0000000000e2',
            key: 'plancha',
            name: 'Plancha',
            sortOrder: 1,
          ),
        ],
        orders: [
          order(
            reference: 'Cuenta 019',
            items: [itemJson(itemLatte, 'Capuccino')],
          ),
          order(
            reference: 'Cuenta 020',
            station: '00000000-0000-4000-8000-0000000000e2',
            stationName: 'Plancha',
            items: [itemJson(itemToast, 'Margarita')],
          ),
        ],
      );

      // The device's saved station assignment is respected without rendering
      // user-selectable station filter chips.
      expect(find.text('Margarita'), findsOneWidget);
      expect(find.text('Capuccino'), findsNothing);
      expect(find.text('Todos'), findsOneWidget);
      await tester.tap(find.text('Todos'));
      await tester.pump();
      expect(find.text('Capuccino'), findsOneWidget);
      await harness.dispose(tester);
    });

    testWidgets('a screen assigned to an empty station stays scoped there', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        locale: const Locale('es'),
        screenStationId: '00000000-0000-4000-8000-0000000000e2',
        screenStationName: 'Plancha',
        kitchenStations: const [
          KitchenStation(
            id: '00000000-0000-4000-8000-0000000000e2',
            key: 'plancha',
            name: 'Plancha',
            sortOrder: 1,
          ),
        ],
        orders: [
          order(
            reference: 'Cuenta 019',
            stationName: 'Barra',
            items: [itemJson(itemLatte, 'Capuccino')],
          ),
        ],
      );

      expect(find.text('Capuccino'), findsNothing);
      expect(find.text('Plancha'), findsOneWidget);
      expect(find.text('Todos'), findsOneWidget);
      await tester.tap(find.text('Todos'));
      await tester.pump();
      expect(find.text('Capuccino'), findsOneWidget);
      await harness.dispose(tester);
    });

    testWidgets(
      'a saved station removed from the kitchen opens on the current board',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          locale: const Locale('es'),
          screenStationId: '00000000-0000-4000-8000-0000000000ff',
          screenStationName: 'Barra anterior',
          kitchenStations: const [
            KitchenStation(
              id: 'barra',
              key: 'barra',
              name: 'Barra',
              sortOrder: 0,
            ),
          ],
          orders: [
            order(
              reference: 'Cuenta 021',
              station: 'barra',
              stationName: 'Barra',
              items: [itemJson(itemLatte, 'Capuccino')],
            ),
          ],
        );

        expect(find.text('Capuccino'), findsOneWidget);
        expect(find.text('Barra anterior'), findsNothing);
        await harness.dispose(tester);
      },
    );

    testWidgets('tapping one line bumps that line, not the ticket', (
      tester,
    ) async {
      final harness = await pumpBoard(tester);
      expect(find.text('Latte'), findsOneWidget);

      await tester.tap(find.text('Toast'));
      await tester.pump();

      final request = harness.kitchen.sent.single;
      expect(request.commandType, 'mark_item_ready');
      expect(request.itemIds, [itemToast]);
      await harness.dispose(tester);
    });

    testWidgets(
      'a ready station can finish while the whole order stays partial',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          orders: [
            order(
              status: 'partially_ready',
              items: [itemJson(itemLatte, 'Latte', status: 'ready')],
            ),
          ],
        );
        expect(find.text('Complete'), findsOneWidget);
        await tester.tap(find.text('Complete'));
        await tester.pump();
        expect(harness.kitchen.sent.single.commandType, 'complete');
        expect(harness.kitchen.sent.single.itemIds, [itemLatte]);
        await harness.dispose(tester);
      },
    );

    testWidgets(
      'another station can start its queued item while the whole order stays partial',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          orders: [
            order(
              status: 'partially_ready',
              items: [itemJson(itemToast, 'Toast')],
            ),
          ],
        );
        expect(find.text('Start'), findsOneWidget);
        await tester.tap(find.text('Start'));
        await tester.pump();
        expect(harness.kitchen.sent.single.commandType, 'start_preparation');
        expect(harness.kitchen.sent.single.itemIds, [itemToast]);
        await harness.dispose(tester);
      },
    );

    testWidgets(
      'a routed item can be ready while the whole order has an exception',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          orders: [
            order(
              status: 'exception',
              items: [itemJson(itemToast, 'Toast', status: 'preparing')],
            ),
          ],
        );
        expect(find.text('Whole order: Exception'), findsOneWidget);
        await tester.tap(find.text('Toast'));
        await tester.pump();
        expect(harness.kitchen.sent.single.commandType, 'mark_item_ready');
        expect(harness.kitchen.sent.single.itemIds, [itemToast]);
        await harness.dispose(tester);
      },
    );

    testWidgets(
      'a ready station can finish while another item has an exception',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          orders: [
            order(
              status: 'exception',
              items: [itemJson(itemToast, 'Toast', status: 'ready')],
            ),
          ],
        );
        await tester.tap(find.text('Complete'));
        await tester.pump();
        expect(harness.kitchen.sent.single.commandType, 'complete');
        expect(harness.kitchen.sent.single.itemIds, [itemToast]);
        await harness.dispose(tester);
      },
    );

    testWidgets(
      'cancelled tickets only offer discard and never item preparation',
      (tester) async {
        final harness = await pumpBoard(
          tester,
          orders: [order(status: 'cancelled')],
        );
        expect(find.text('Cancelled'), findsOneWidget);
        expect(find.text('Start'), findsNothing);
        expect(find.text('Complete'), findsNothing);
        expect(find.text('Recall'), findsNothing);
        await tester.tap(find.text('Latte'));
        await tester.pump();
        expect(harness.kitchen.sent, isEmpty);
        await tester.tap(find.text('Discard'));
        await tester.pump();
        expect(harness.kitchen.sent.single.commandType, 'cancel_ack');
        expect(harness.kitchen.sent.single.itemIds, [itemLatte, itemToast]);
        await harness.dispose(tester);
      },
    );

    testWidgets('discard requires kitchen.cancel_ack', (tester) async {
      final harness = await pumpBoard(
        tester,
        orders: [order(status: 'cancelled')],
        permissions: const [
          'kitchen.read',
          'kitchen.prepare',
          'kitchen.ready',
          'kitchen.complete',
        ],
      );
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.text('Discard'), findsNothing);
      expect(find.text('Start'), findsNothing);
      await harness.dispose(tester);
    });

    testWidgets('an unrouted item is an exception, not a void', (tester) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            status: 'exception',
            items: [itemJson(itemToast, 'Toast', status: 'exception')],
          ),
        ],
      );
      expect(find.text('No station assigned'), findsOneWidget);
      expect(find.text('VOIDED'), findsNothing);
      await tester.tap(find.text('Toast'));
      await tester.pump();
      expect(harness.kitchen.sent, isEmpty);
      await harness.dispose(tester);
    });

    testWidgets('a line already marked ready is not tappable again', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            status: 'partially_ready',
            items: [
              itemJson(itemLatte, 'Latte', status: 'ready'),
              itemJson(itemToast, 'Toast'),
            ],
          ),
        ],
      );

      await tester.tap(find.text('Latte'));
      await tester.pump();
      expect(harness.kitchen.sent, isEmpty);

      // The line that is still owed is the one that bumps.
      await tester.tap(find.text('Toast'));
      await tester.pump();
      expect(harness.kitchen.sent.single.itemIds, [itemToast]);
      await harness.dispose(tester);
    });

    testWidgets('a voided line stays visible and is never tappable', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            items: [
              itemJson(itemLatte, 'Latte', status: 'cancelled'),
              itemJson(itemToast, 'Toast'),
            ],
          ),
        ],
      );

      expect(find.text('VOIDED'), findsOneWidget);
      await tester.tap(find.text('Latte'));
      await tester.pump();
      expect(harness.kitchen.sent, isEmpty);
      await harness.dispose(tester);
    });

    testWidgets('a held course is drawn as held, counted, and not startable', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            items: [
              itemJson(itemLatte, 'Latte'),
              itemJson(
                itemToast,
                'Toast',
                courseNumber: 2,
                fired: false,
                quantity: 3,
              ),
            ],
          ),
        ],
      );

      // The ticket is read in courses, and the second one says out loud that it
      // is waiting: a dimmed line among the work is exactly the reading that
      // starts a dessert with the starters.
      expect(find.text('Course 1'), findsOneWidget);
      expect(find.text('Course 2'), findsOneWidget);
      // The count is portions, matching the `3×` on the line inside it.
      expect(find.text('Held · 3'), findsOneWidget);
      expect(find.text('3×'), findsOneWidget);
      expect(find.text('Not cooking yet'), findsOneWidget);

      // And it is not work: the tap asks the kitchen for nothing.
      await tester.tap(find.text('Toast'));
      await tester.pump();
      expect(harness.kitchen.sent, isEmpty);

      // The course that IS work still bumps, so staging did not cost the cook
      // the tap they already had.
      await tester.tap(find.text('Latte'));
      await tester.pump();
      expect(harness.kitchen.sent.single.itemIds, [itemLatte]);
      await harness.dispose(tester);
    });

    testWidgets('the fire action names the next held course and sends it', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            items: [
              itemJson(itemLatte, 'Latte'),
              itemJson(itemToast, 'Toast', courseNumber: 2, fired: false),
            ],
          ),
        ],
      );

      await tester.tap(find.text('Fire course 2'));
      await _settle(tester);

      final request = harness.kitchen.sent.single;
      expect(request.commandType, 'fire_course');
      expect(request.courseNumber, 2);
      // The course leaves the held block at once. The fake server never advanced
      // the ticket, so this result proves the local queue is what keeps the tap
      // painted while the answer is in flight.
      expect(find.text('Held · 1'), findsNothing);
      await harness.dispose(tester);
    });

    testWidgets('an ordinary single-course ticket offers nothing to fire', (
      tester,
    ) async {
      final harness = await pumpBoard(tester);

      // The everyday sale is course 1 and already fired. Course 1 is named
      // because the ticket is read in courses, and there is no fire control
      // because there is nothing waiting — the step must not cost a busy café a
      // tap per ticket.
      expect(find.text('Course 1'), findsOneWidget);
      expect(find.textContaining('Fire course'), findsNothing);
      expect(find.textContaining('Held'), findsNothing);
      await harness.dispose(tester);
    });

    testWidgets('a queued ticket can be started, and the action is per state', (
      tester,
    ) async {
      final harness = await pumpBoard(tester);

      expect(find.text('Start'), findsOneWidget);
      expect(find.text('Complete'), findsNothing);
      await tester.tap(find.text('Start'));
      await tester.pump();
      expect(harness.kitchen.sent.single.commandType, 'start_preparation');
      await harness.dispose(tester);
    });

    testWidgets('a ready ticket can be recalled, and only with a reason', (
      tester,
    ) async {
      final harness = await pumpBoard(tester, orders: [order(status: 'ready')]);

      await tester.tap(find.text('Recall'));
      await _settle(tester);
      // Nothing is sent until a reason is chosen.
      expect(harness.kitchen.sent, isEmpty);
      final confirm = find.byKey(const Key('kitchen-recall-confirm'));
      expect(tester.widget<PosButton>(confirm).onPressed, isNull);

      await tester.tap(find.text('The wrong dish went out'));
      await _settle(tester);
      await tester.tap(confirm);
      await _settle(tester);

      expect(harness.kitchen.sent.single.commandType, 'recall');
      expect(harness.kitchen.sent.single.reasonCode, 'wrong_item');
      await harness.dispose(tester);
    });

    testWidgets('a dropped network is said out loud, and the rail is kept', (
      tester,
    ) async {
      // §8H's acceptance: the board survives a network drop without losing a
      // ticket. Surviving is not only "keeps what it had" — a board that
      // silently shows the last thing it saw looks exactly like a quiet
      // service, so the state is NAMED as well as survived.
      final harness = await pumpBoard(tester);
      expect(find.text('Latte'), findsOneWidget);
      expect(find.text('Offline'), findsNothing);

      // Three consecutive failures are what the connectivity controller calls
      // offline, and the read itself fails with them.
      harness.room.failure = const AppException(
        category: AppErrorCategory.transport,
        code: 'TRANSPORT_FAILURE',
        recoverable: true,
      );
      harness.connectivity.apiFailure();
      harness.connectivity.apiFailure();
      harness.connectivity.apiFailure();
      await harness.board.refresh();
      await tester.pump();

      // The ticket it already had is still on the rail...
      expect(find.text('Latte'), findsOneWidget);
      // ...and the screen says why nothing is moving.
      expect(find.text('Offline'), findsOneWidget);

      // The network comes back: two authoritative successes is what the
      // controller requires, and the rail is read again.
      harness.room.failure = null;
      harness.connectivity.apiReachable(authorityValid: true);
      harness.connectivity.apiReachable(authorityValid: true);
      await harness.board.refresh();
      await tester.pump();

      expect(find.text('Offline'), findsNothing);
      expect(find.text('Latte'), findsOneWidget);
      await harness.dispose(tester);
    });

    testWidgets('a refusal is shown with a recovery action', (tester) async {
      final harness = await pumpBoard(tester);
      harness.kitchen.failure = AppException.fromApi(
        const ApiError(
          code: 'KITCHEN_VERSION_CONFLICT',
          message: 'the ticket moved',
          retryable: false,
          correlationId: '00000000-0000-4000-8000-0000000000f1',
        ),
      );

      await tester.tap(find.text('Toast'));
      await _settle(tester);

      expect(
        find.textContaining('Somebody else already moved ticket A-101'),
        findsOneWidget,
      );
      expect(find.text('Refresh kitchen'), findsOneWidget);
      await harness.dispose(tester);
    });

    testWidgets('a line shows every allergen label it carries', (tester) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            items: [
              itemJson(
                itemLatte,
                'Latte',
                allergens: const [
                  {'code': 'milk', 'label': 'Leche'},
                  // An unknown code still prints the label the API sent.
                  {'code': 'gluten_prueba', 'label': 'Gluten de prueba'},
                ],
              ),
            ],
          ),
        ],
      );

      expect(find.text('Leche'), findsOneWidget);
      expect(find.text('Gluten de prueba'), findsOneWidget);
      expect(find.byType(KitchenAllergenBadge), findsNWidgets(2));
      // The code is an internal key, so it is not what the cook reads.
      expect(find.text('milk'), findsNothing);
      await harness.dispose(tester);
    });

    testWidgets('a long allergen label stays inside its own badge', (
      tester,
    ) async {
      final harness = await pumpBoard(
        tester,
        orders: [
          order(
            items: [
              itemJson(
                itemLatte,
                'Latte',
                allergens: const [
                  {
                    'code': 'long',
                    'label':
                        'Un alérgeno con un nombre mucho más largo que la tarjeta',
                  },
                ],
              ),
            ],
          ),
        ],
      );

      // The badge clips at the line's own width, so it cannot reach the
      // quantity on the left or the status mark on the right.
      expect(find.byType(KitchenAllergenBadge), findsOneWidget);
      await harness.dispose(tester);
    });

    testWidgets('a line with no allergens shows no marker', (tester) async {
      final harness = await pumpBoard(tester);

      // The fixture's lines carry empty lists. Nothing is the honest answer:
      // an empty list means the recipe records no allergen, not that the dish
      // is free of every allergen.
      expect(find.byType(KitchenAllergenBadge), findsNothing);
      await harness.dispose(tester);
    });
  });

  testWidgets('the KDS no longer reads or displays the prep list', (
    tester,
  ) async {
    final harness = await pumpBoard(tester);
    expect(find.text('Latte'), findsOneWidget);
    expect(find.text('Preparation'), findsNothing);
    expect(find.text('Preparación'), findsNothing);
    expect(harness.room.prepListReads, 0);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  test('every failure code becomes a typed message with a recovery action', () {
    final spanish = AppLocalizationsEs();
    final english = AppLocalizationsEn();
    const codes = [
      'OPTIMISTIC_VERSION_CONFLICT',
      'KITCHEN_VERSION_CONFLICT',
      'KITCHEN_FINGERPRINT_CONFLICT',
      'IDEMPOTENCY_CONFLICT',
      'KITCHEN_INVALID_TRANSITION',
      'PERMISSION_DENIED',
      'KITCHEN_PERMISSION_DENIED',
      'KITCHEN_PERMISSION_REQUIRED',
      'TICKET_NOT_FOUND',
      'RESOURCE_NOT_FOUND',
      'DEVICE_REVOKED',
      'AUTHENTICATION_REQUIRED',
      'SOMETHING_THE_SERVER_LEARNED_LATER',
    ];
    final byCode = <String, String>{};
    for (final code in codes) {
      for (final l10n in [spanish, english]) {
        final failure = describeKitchenBoardFailure(
          code,
          l10n,
          reference: 'A-101',
        );
        expect(failure.title, isNotEmpty);
        expect(failure.message, isNotEmpty);
        expect(failure.recovery, isNotEmpty);
      }
      byCode[code] = describeKitchenBoardFailure(
        code,
        english,
        reference: 'A-101',
      ).message;
    }
    // Codes that mean the same thing to a cook share the same words on purpose:
    // the two names for "the ticket moved", the two for "that command identity
    // was reused", the two for a role that may not write, the two for "the
    // ticket is gone", and the two for a device that lost its registration.
    // Twelve codes, five real situations.
    expect(
      byCode['OPTIMISTIC_VERSION_CONFLICT'],
      byCode['KITCHEN_VERSION_CONFLICT'],
    );
    expect(
      byCode['KITCHEN_FINGERPRINT_CONFLICT'],
      byCode['IDEMPOTENCY_CONFLICT'],
    );
    expect(byCode['TICKET_NOT_FOUND'], byCode['RESOURCE_NOT_FOUND']);
    expect(byCode['PERMISSION_DENIED'], byCode['KITCHEN_PERMISSION_DENIED']);
    expect(byCode['PERMISSION_DENIED'], byCode['KITCHEN_PERMISSION_REQUIRED']);
    expect(byCode['DEVICE_REVOKED'], byCode['AUTHENTICATION_REQUIRED']);
    expect(byCode.values.toSet(), hasLength(7));
    expect(
      describeKitchenBoardFailure(
        'OPTIMISTIC_VERSION_CONFLICT',
        spanish,
        reference: 'A-101',
      ).message,
      isNot(
        describeKitchenBoardFailure(
          'OPTIMISTIC_VERSION_CONFLICT',
          english,
          reference: 'A-101',
        ).message,
      ),
    );
    // The kitchen's answer to the same question is not the table's.
    expect(
      describeKitchenBoardFailure(
        'PERMISSION_DENIED',
        english,
        reference: 'A-101',
      ).message,
      'Your role cannot move the kitchen.',
    );
    // A failure with no ticket to name does not leave a hole in the sentence.
    expect(
      describeKitchenBoardFailure('TICKET_NOT_FOUND', english).message,
      "That ticket did not reach this device's station.",
    );
  });

  test('every recall reason is a code the server will accept', () {
    final l10n = AppLocalizationsEn();
    for (final reason in kitchenRecallReasons) {
      expect(reason.code.trim(), isNotEmpty);
      // `reasonCode` is `z.string().min(1).max(100)` in the contract.
      expect(reason.code.length, lessThanOrEqualTo(100));
      expect(reason.label(l10n), isNotEmpty);
    }
    expect(
      kitchenRecallReasons.map((reason) => reason.code).toSet(),
      hasLength(kitchenRecallReasons.length),
    );
  });
  for (final language in ['es', 'en']) {
    for (final size in [const Size(375, 812), const Size(1280, 1000)]) {
      testWidgets(
        'populated ticket keeps reference, quantity and held instruction $language $size at 200%',
        (tester) async {
          tester.view.physicalSize = size;
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final l = language == 'es'
              ? AppLocalizationsEs()
              : AppLocalizationsEn();
          final ticket = KitchenOrderProjection.fromJson({
            ...order(
              reference: 'N26 · Terraza · pedido 0042',
              items: [
                {
                  ...itemJson(itemLatte, 'Latte', quantity: 2),
                  'variantName': 'Grande · leche de avena',
                  'preparationNote':
                      'Sin azúcar. Entregar las dos bebidas juntas.',
                },
                itemJson(
                  itemToast,
                  'Cheesecake',
                  courseNumber: 2,
                  fired: false,
                ),
              ],
            ).toJson(),
            'priority': 'urgent',
          });
          final harness = await pumpBoard(
            tester,
            orders: [ticket],
            locale: Locale(language),
            textScale: 2,
            reservedHeight: size.width < 600 ? 184 : 0,
          );
          final reference = tester.renderObject<RenderParagraph>(
            find.text(ticket.publicReference),
          );
          expect(
            reference.didExceedMaxLines,
            isFalse,
            reason: 'The complete ticket identity must remain readable',
          );
          final quantity = tester.renderObject<RenderParagraph>(
            find.text('2×'),
          );
          final boxes = quantity.getBoxesForSelection(
            const TextSelection(baseOffset: 0, extentOffset: 2),
          );
          expect(
            boxes.map((b) => b.top).toSet(),
            hasLength(1),
            reason: 'The quantity and multiplication mark form one unit',
          );
          final held = tester.renderObject<RenderParagraph>(
            find.text(l.kitchenCourseHeldNote),
          );
          expect(
            held.didExceedMaxLines,
            isFalse,
            reason: 'The instruction explaining a held course must be complete',
          );
          expect(tester.takeException(), isNull);
          await tester.ensureVisible(find.text('Cheesecake'));
          await _settle(tester);
          await tester.tap(find.text('Cheesecake'));
          await _settle(tester);
          expect(
            harness.kitchen.sent,
            isEmpty,
            reason: 'Reading a held line must not mark it ready',
          );
          expect(harness.board.state.orders.single.toJson(), ticket.toJson());
          await harness.dispose(tester);
        },
      );
    }
    testWidgets(
      'populated board retains ticket and recovers failed refresh $language at 200%',
      (tester) async {
        tester.view.physicalSize = const Size(375, 812);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final l = language == 'es'
            ? AppLocalizationsEs()
            : AppLocalizationsEn();
        final harness = await pumpBoard(
          tester,
          locale: Locale(language),
          textScale: 2,
          reservedHeight: 184,
        );
        final original = harness.board.state.orders.single.toJson();
        harness.room.failure = const AppException(
          category: AppErrorCategory.transport,
          code: 'NETWORK_UNAVAILABLE',
          recoverable: true,
        );
        await harness.board.load(
          merchantId,
          const PosKitchenOrderQuery(
            locationId: locationId,
            operatorSessionId: operatorSessionId,
          ),
        );
        await _settle(tester);
        expect(harness.board.state.orders.single.toJson(), original);
        expect(find.textContaining(l.kitchenFailureTitle), findsOneWidget);
        expect(tester.takeException(), isNull);
        harness.room.failure = null;
        await tester.ensureVisible(find.text(l.kitchenFailureRefresh));
        await _settle(tester);
        await tester.tap(find.text(l.kitchenFailureRefresh));
        await _settle(tester);
        expect(harness.board.state.errorCode, isNull);
        expect(harness.board.state.orders.single.toJson(), original);
        expect(harness.kitchen.sent, isEmpty);
        expect(tester.takeException(), isNull);
        await harness.dispose(tester);
      },
    );
  }
  for (final language in ['es', 'en']) {
    testWidgets('daily count is distinct from ticket quantity $language', (
      tester,
    ) async {
      final l = language == 'es' ? AppLocalizationsEs() : AppLocalizationsEn();
      final harness = await pumpBoard(tester, locale: Locale(language));
      harness.room.allDayItems = const [
        KitchenAllDayItem(
          productName: 'Latte',
          variantName: null,
          ordered: 7,
          outstanding: 2,
        ),
      ];
      await harness.board.load(
        merchantId,
        const PosKitchenOrderQuery(
          locationId: locationId,
          operatorSessionId: operatorSessionId,
        ),
      );
      await _settle(tester);
      expect(find.text('1×'), findsOneWidget);
      expect(find.text(l.kitchenAllDayCount(7)), findsOneWidget);
      expect(find.text('×7'), findsNothing);
      expect(find.byTooltip(l.kitchenAllDayTooltip(7, 2)), findsOneWidget);
      expect(harness.kitchen.sent, isEmpty);
      expect(tester.takeException(), isNull);
      await harness.dispose(tester);
    });
  }
  for (final language in ['es', 'en']) {
    for (final status in ['queued', 'ready']) {
      testWidgets(
        'read-only kitchen role has no command affordances $language $status',
        (tester) async {
          final l = language == 'es'
              ? AppLocalizationsEs()
              : AppLocalizationsEn();
          final ticket = order(
            status: status,
            items: [
              itemJson(
                itemLatte,
                'Latte',
                status: status == 'ready' ? 'ready' : 'queued',
              ),
              if (status == 'queued')
                itemJson(itemToast, 'Toast', courseNumber: 2, fired: false),
            ],
          );
          final harness = await pumpBoard(
            tester,
            locale: Locale(language),
            permissions: const ['kitchen.read'],
            orders: [ticket],
          );
          expect(find.text(l.kitchenTicketStartAction), findsNothing);
          expect(find.text(l.kitchenTicketRecallAction), findsNothing);
          expect(find.text(l.kitchenTicketCompleteAction), findsNothing);
          expect(find.byKey(const Key('kitchen-fire-course')), findsNothing);
          await tester.tap(find.text('Latte'));
          await _settle(tester);
          expect(harness.kitchen.sent, isEmpty);
          expect(harness.board.state.orders.single.toJson(), ticket.toJson());
          expect(tester.takeException(), isNull);
          await harness.dispose(tester);
        },
      );
    }
  }
  testWidgets('waiter can inspect both stations without changing tickets', (
    tester,
  ) async {
    final l = AppLocalizationsEs();
    final harness = await pumpBoard(
      tester,
      locale: const Locale('es'),
      permissions: const [
        'cart.write',
        'catalog.read',
        'customer.attach',
        'customer.read',
        'customer.search',
        'loyalty.read',
        'offline.replay',
        'order.fire',
        'kitchen.read',
      ],
      orders: [
        order(
          reference: 'Cuenta 019 · Mesa 2',
          stationName: 'Barra',
          items: [itemJson(itemLatte, 'Capuccino')],
        ),
        order(
          reference: 'Cuenta 019 · Mesa 2',
          station: '00000000-0000-4000-8000-0000000000e2',
          stationName: 'Cocina',
          status: 'ready',
          items: [itemJson(itemToast, 'Margarita', status: 'ready')],
        ),
      ],
    );
    expect(find.text('Capuccino'), findsOneWidget);
    expect(find.text('Margarita'), findsOneWidget);
    expect(find.text('Cuenta 019 · Mesa 2'), findsNWidgets(2));
    await tester.tap(find.text('Barra').first);
    await tester.pump();
    expect(find.text('Capuccino'), findsOneWidget);
    expect(find.text('Margarita'), findsNothing);
    await tester.tap(find.text('Capuccino'));
    await _settle(tester);
    expect(find.text('Margarita'), findsNothing);
    await tester.tap(find.text('Todos'));
    await tester.pump();
    expect(find.text('Capuccino'), findsOneWidget);
    expect(find.text('Margarita'), findsOneWidget);
    await tester.tap(find.text('Margarita'));
    await _settle(tester);
    for (final label in [
      l.kitchenTicketStartAction,
      l.kitchenTicketRecallAction,
      l.kitchenTicketCompleteAction,
    ]) {
      expect(find.text(label), findsNothing);
    }
    expect(harness.kitchen.sent, isEmpty);
    expect(tester.takeException(), isNull);
    await harness.dispose(tester);
  });

  testWidgets('preparation permission does not imply ready permission', (
    tester,
  ) async {
    final harness = await pumpBoard(
      tester,
      permissions: const ['kitchen.read', 'kitchen.prepare'],
    );
    expect(find.text('Start'), findsOneWidget);
    await tester.tap(find.text('Latte'));
    await _settle(tester);
    expect(harness.kitchen.sent, isEmpty);
    await tester.tap(find.text('Start'));
    await _settle(tester);
    expect(harness.kitchen.sent.single.commandType, 'start_preparation');
    await harness.dispose(tester);
  });
}

/// The surface, on a till whose operator session is already open.
final class BoardHarness {
  BoardHarness({
    required this.entry,
    required this.board,
    required this.room,
    required this.kitchen,
    required this.connectivity,
  });

  final EntryController entry;
  final KitchenBoardController board;
  final FakeBoardRepository room;
  final FakeCommandRepository kitchen;
  final ConnectivityController connectivity;

  Future<void> dispose(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump();
    board.dispose();
    entry.dispose();
  }
}

class _SessionGateway implements EntryGateway {
  const _SessionGateway(this.permissions);
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
    startedAt: '2026-09-13T00:00:00Z',
    lastActivityAt: '2026-09-13T00:00:00Z',
    expiresAt: '2026-09-14T00:00:00Z',
  );

  @override
  Future<void> lockOperator(String id) async {}

  @override
  Future<void> logout() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<BoardHarness> pumpBoard(
  WidgetTester tester, {
  List<KitchenOrderProjection>? orders,
  Locale? locale,

  /// The station this SCREEN is, as the device remembers it. Null is the till:
  /// show commands from every station.
  String? screenStationId,
  String? screenStationName,

  /// The kitchen's stations, as the configuration read answers them: every station of the
  /// merchant, whether or not it has work today.
  List<KitchenStation> kitchenStations = const [],
  double textScale = 1,
  DateTime Function()? clock,
  double reservedHeight = 0,
  List<String> permissions = const [
    'kitchen.read',
    'kitchen.prepare',
    'kitchen.ready',
    'kitchen.complete',
    'kitchen.recall',
    'kitchen.cancel_ack',
  ],
}) async {
  final entry = EntryController(
    gateway: _SessionGateway(permissions),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: SafeTelemetry(
      enabled: false,
      context: TelemetryContext.current(testConfig),
      exporter: RecordingExporter(),
    ),
    idleTimeout: const Duration(seconds: 30),
  );
  await entry.selectTenant(
    EntryMerchant.fromJson({
      'id': merchantId,
      'name': 'Test cafe',
      'roles': const <String>[],
      'permissions': const <String>[],
      'entitlements': const <String>[],
      'locations': [
        {
          'id': locationId,
          'merchantId': merchantId,
          'name': 'Test location',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  final room = FakeBoardRepository()
    ..orders = orders ?? [order()]
    ..kitchenStations = kitchenStations;
  final kitchen = FakeCommandRepository();
  final connectivity = ConnectivityController();
  final board = KitchenBoardController(
    room,
    commands: kitchen,
    connectivity: connectivity,
  );
  final preferences = DisplayPreferences(TestPreferences())
    ..busy = false
    ..kitchenStationId = screenStationId
    ..kitchenStationName = screenStationName;
  await tester.pumpWidget(
    PosApp(
      theme: UmiTheme.light(),
      locale: locale,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: DisplayPreferencesScope(
        preferences: preferences,
        child: Column(
          children: [
            Expanded(
              child: KitchenBoardSurface(
                clock: clock ?? () => DateTime.parse(serverClock),
                controller: board,
                entry: entry,
                connectivity: connectivity,
              ),
            ),
            if (reservedHeight > 0) SizedBox(height: reservedHeight),
          ],
        ),
      ),
    ),
  );
  // The surface loads on the first frame; no `pumpAndSettle`, because the
  // board keeps an eight-second poll alive and settling would wait on it.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
  return BoardHarness(
    entry: entry,
    board: board,
    room: room,
    kitchen: kitchen,
    connectivity: connectivity,
  );
}

/// Advances the test clock without `pumpAndSettle`: the board keeps an
/// eight-second poll alive, so settling would wait on a timer that never stops.
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
  await tester.pump();
}
