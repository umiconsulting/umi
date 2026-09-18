import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/localization/app_localizations_en.dart';
import 'package:umi_pos/core/localization/app_localizations_es.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
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
}) => KitchenOrderProjection.fromJson({
  'id': orderId,
  'sourceOrderId': '00000000-0000-4000-8000-0000000000d1',
  'publicReference': reference,
  'merchantId': merchantId,
  'locationId': locationId,
  'stationId': '00000000-0000-4000-8000-0000000000e1',
  'source': 'pos',
  'status': status,
  'priority': 'normal',
  'businessDate': '2026-09-16',
  'queuedAt': '2026-09-16T17:58:00.000Z',
  'preparationStartedAt': null,
  'updatedAt': serverClock,
  'version': version,
  'lastEventSequence': 3,
  'firedThroughCourse': firedThroughCourse,
  'items':
      items ??
      [itemJson(itemLatte, 'Latte'), itemJson(itemToast, 'Toast', quantity: 2)],
});

final class FakeBoardRepository implements KitchenBoardRepository {
  List<KitchenOrderProjection> orders = const [];
  int reads = 0;
  Object? failure;

  /// Today's counts, as the all-day route answers them.
  List<KitchenAllDayItem> allDayItems = const [];
  String businessDate = '2026-09-16';
  int allDayReads = 0;

  /// When set, only the COUNT route fails — the case where the board must keep
  /// working without it.
  Object? allDayFailure;

  /// What the next watch calls answer, in order. A watch with nothing queued HOLDS,
  /// exactly like the server's held request, so the loop parks instead of spinning.
  final List<bool> watchAnswers = [];
  int watchReads = 0;

  @override
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query) async {
    watchReads += 1;
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
      version: 2,
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
        expect(harness.kitchen.sent.single.itemIds, isEmpty);

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

    test(
      'the board is re-read after a bump, so the ticket shows the server',
      () async {
        final harness = await loadedBoard();
        final ticket = harness.board.state.orders.single;
        expect(harness.room.reads, 1);

        await harness.board.markItemReady(ticket, itemLatte);

        expect(harness.room.reads, 2);
        expect(harness.board.state.phase, KitchenBoardPhase.ready);
      },
    );
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

    test('firing a course names it, and the board only moves on the server '
        'answer', () async {
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

      // NOTHING HAS FIRED YET. `fired` is derived from the ticket's watermark on
      // the server, so a board that lit the course up here would be drawing a
      // rail the kitchen is not working.
      final inFlight = harness.board.state.orders.single;
      expect(nextHeldCourse(inFlight), 2);
      expect(
        inFlight.items
            .map(KitchenOrderItem.fromJson)
            .where((item) => item.fired)
            .length,
        1,
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
      // One command and one re-read: the board did not invent the second state.
      expect(harness.kitchen.sent, hasLength(1));
      expect(harness.room.reads, 2);
    });

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

      // The second tap is refused while the first is unanswered, rather than
      // racing it — the same one-at-a-time rule the bumps already obey.
      expect(await harness.board.markItemReady(ticket, itemLatte), isFalse);
      expect(harness.kitchen.sent, hasLength(1));

      gate.complete();
      expect(await firing, isTrue);
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

    test(
      'anything that is not an AppException still releases the surface',
      () async {
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
        expect(harness.board.state.errorCode, 'KITCHEN_COMMAND_FAILED');
        // And the board accepts the next tap: the cook is not stuck.
        harness.kitchen.failure = null;
        expect(
          await harness.board.markItemReady(
            harness.board.state.orders.single,
            itemToast,
          ),
          isTrue,
        );
      },
    );

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

      // And an answered read is the way back, without anybody else's help.
      harness.room.failure = null;
      await harness.board.load(merchantId, query);
      expect(harness.connectivity.state, isNot(PosConnectivity.offline));
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
  });

  group('the poll and the bump do not fight', () {
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
      expect(harness.room.reads, greaterThanOrEqualTo(3));
    });
  });

  group('the surface', () {
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
      // The board still shows the course held: the surface does not decide, it
      // draws what the server answered, and this fake never advanced the ticket.
      expect(find.text('Held · 1'), findsOneWidget);
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
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);

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

  group('the prep tab (plan 8.4)', () {
    testWidgets('it asks with the till own scope and works the largest first', (
      tester,
    ) async {
      final harness = await pumpBoard(tester);
      harness.room.prepListResult = PrepList(
        items: [
          prepItem(
            '00000000-0000-4000-8000-0000000000c3',
            'Pico de gallo',
            reference: 'PICO-01',
            prep: 500,
          ),
          prepItem(
            '00000000-0000-4000-8000-0000000000c4',
            'Salsa verde',
            reference: 'SALSA-01',
            prep: 4500,
          ),
        ],
        locationId: locationId,
        from: '2026-09-01',
        to: '2026-09-28',
        asOf: serverClock,
        correlationId: '00000000-0000-4000-8000-0000000000f2',
      );

      // The rail is the default view, and the list waits for its own tab.
      expect(find.text('Latte'), findsOneWidget);
      expect(harness.room.prepListReads, 0);

      await tester.tap(find.text('Preparation'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // The till's own scope: its merchant and its location. No other cafe's
      // list can arrive on this screen.
      expect(harness.room.prepListReads, 1);
      expect(harness.room.lastPrepListMerchantId, merchantId);
      expect(harness.room.lastPrepListQuery?.locationId, locationId);
      expect(harness.room.lastPrepListQuery?.includeAbovePar, isFalse);

      // The window is the one the response stated, not a guess.
      expect(find.textContaining('2026-09-28'), findsOneWidget);

      // The kitchen works the largest quantity first.
      final firstRow = tester.getTopLeft(find.text('Salsa verde')).dy;
      final secondRow = tester.getTopLeft(find.text('Pico de gallo')).dy;
      expect(firstRow, lessThan(secondRow));

      // The list is read once when the tab opens. Coming back to it is not a
      // second read.
      await tester.tap(find.text('Tickets'));
      await _settle(tester);
      await tester.tap(find.text('Preparation'));
      await _settle(tester);
      expect(harness.room.prepListReads, 1);

      await harness.dispose(tester);
    });

    testWidgets('an item with no par shows no quantity and says so', (
      tester,
    ) async {
      final harness = await pumpBoard(tester);
      harness.room.prepListResult = PrepList(
        items: [
          prepItem(
            '00000000-0000-4000-8000-0000000000c5',
            'Caldo base',
            reference: 'CALDO-01',
            par: null,
            prep: 0,
          ),
        ],
        locationId: locationId,
        from: '2026-09-01',
        to: '2026-09-28',
        asOf: serverClock,
        correlationId: '00000000-0000-4000-8000-0000000000f3',
      );

      await tester.tap(find.text('Preparation'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text('No par'), findsOneWidget);
      // A zero would be a claim about a work order this item does not have.
      expect(find.text('0 kg'), findsNothing);

      await harness.dispose(tester);
    });

    testWidgets('a failed read shows its own error state, and the rail stays', (
      tester,
    ) async {
      final harness = await pumpBoard(tester);
      harness.room.prepListFailure = AppException.fromApi(
        const ApiError(
          code: 'PREP_LIST_UNREACHABLE',
          message: 'no answer',
          retryable: true,
          correlationId: '00000000-0000-4000-8000-0000000000f4',
        ),
      );

      await tester.tap(find.text('Preparation'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text('Could not load the prep list.'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);

      // The board's own view is untouched by the prep tab's refusal.
      await tester.tap(find.text('Tickets'));
      await _settle(tester);
      expect(find.text('Latte'), findsOneWidget);

      // The retry asks again, and the list renders when the server answers.
      harness.room.prepListFailure = null;
      harness.room.prepListResult = PrepList(
        items: [
          prepItem(
            '00000000-0000-4000-8000-0000000000c6',
            'Salsa verde',
            reference: 'SALSA-01',
          ),
        ],
        locationId: locationId,
        from: '2026-09-01',
        to: '2026-09-28',
        asOf: serverClock,
        correlationId: '00000000-0000-4000-8000-0000000000f5',
      );
      await tester.tap(find.text('Preparation'));
      await _settle(tester);
      await tester.tap(find.text('Retry'));
      await _settle(tester);

      expect(harness.room.prepListReads, 2);
      expect(find.text('Salsa verde'), findsOneWidget);

      await harness.dispose(tester);
    });
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
    permissions: const ['kitchen.prepare'],
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
}) async {
  final entry = EntryController(
    gateway: _SessionGateway(),
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
  final room = FakeBoardRepository()..orders = orders ?? [order()];
  final kitchen = FakeCommandRepository();
  final connectivity = ConnectivityController();
  final board = KitchenBoardController(
    room,
    commands: kitchen,
    connectivity: connectivity,
  );
  await tester.pumpWidget(
    MaterialApp(
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: KitchenBoardSurface(
        controller: board,
        entry: entry,
        connectivity: connectivity,
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
