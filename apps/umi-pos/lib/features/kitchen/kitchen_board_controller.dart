import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';
import '../inventory/inventory_repository.dart';
import '../offline/connectivity_controller.dart';
import 'kitchen_status_repository.dart';

/// The whole-location kitchen board, served to the POS-role device's unified KDS
/// mode by `GET /api/v1/pos/merchants/:merchantId/kitchen/board`.
/// The all-day counts for one trading day, as the board needs them.
///
/// The generated response model keeps `data` as raw maps (one array of objects
/// in the contract), so the typing happens here, once, rather than at every
/// place the board reads a count.
typedef KitchenAllDayCounts = ({
  String businessDate,
  List<KitchenAllDayItem> items,
});

abstract interface class KitchenBoardRepository {
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  );

  /// The all-day counts for the same location (§8H step 6).
  Future<KitchenAllDayCounts> allDay(
    String merchantId,
    PosKitchenAllDayQuery query,
  );

  /// Hold a request open until this location's kitchen changes (§8H step 8).
  ///
  /// `true` means "re-read the board now"; `false` means the hold expired with nothing to say,
  /// which is the poll kept as the floor. The server bound (12 s) sits inside the till's own
  /// 15 s HTTP timeout, so an idle watch is a normal answer rather than a timeout.
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query);

  /// The prep list for the board's own Preparacion tab (§8.4).
  ///
  /// It reads through the inventory route, on the same session and the same
  /// location as the board. The till repeats no forecast math: the server
  /// subtracts the on-hand and the forecast usage from the par (plan D13).
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query);
}

final class ApiKitchenBoardRepository implements KitchenBoardRepository {
  const ApiKitchenBoardRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<KitchenOrderProjection>> snapshot(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    final response = await _api.request(
      method: ApiMethod.get,
      path: Uri(
        // Declared in the contract's route table (`pos.kitchenBoard`), not typed
        // here: the path used to live only in this file, which is the one place
        // a route can hide from the contract, the permission table and the
        // generated bindings at the same time.
        path: UmiRoutes.posKitchenBoard(merchantId),
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    );
    final data = (response['data'] as List<Object?>? ?? const <Object?>[])
        .cast<Map<String, Object?>>();
    return data.map(KitchenOrderProjection.fromJson).toList(growable: false);
  }

  @override
  Future<KitchenAllDayCounts> allDay(
    String merchantId,
    PosKitchenAllDayQuery query,
  ) async {
    final response = await _api.request(
      method: ApiMethod.get,
      path: Uri(
        // `pos.kitchenAllDay`, from the route table like the board above: the
        // path is declared once, next to the permission it needs.
        path: UmiRoutes.posKitchenAllDay(merchantId),
        // The generated query carries `businessDate: null` when the caller did
        // not name a day, and a null in a query string arrives as the TEXT
        // "null" — which the route's own date validation would refuse. Asking
        // the server which day it is, is the point of this read, so the till
        // sends only the fields it actually has.
        queryParameters: {
          for (final entry in query.toJson().entries)
            if (entry.value != null) entry.key: '${entry.value}',
        },
      ).toString(),
    );
    final parsed = KitchenAllDayResponse.fromJson(response);
    return (
      businessDate: parsed.businessDate,
      items: parsed.data
          .map(KitchenAllDayItem.fromJson)
          .toList(growable: false),
    );
  }

  @override
  Future<bool> watch(String merchantId, PosKitchenOrderQuery query) async {
    final response = await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posKitchenBoardWatch(merchantId),
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    );
    return KitchenBoardWatchResponse.fromJson(response).changed;
  }

  @override
  Future<PrepList> prepList(String merchantId, PosPrepListQuery query) =>
      requestPrepList(_api, merchantId, query);
}

enum KitchenBoardPhase { idle, loading, ready, failure }

@immutable
final class KitchenBoardState {
  const KitchenBoardState({
    this.phase = KitchenBoardPhase.idle,
    this.orders = const [],
    this.allDay = const {},
    this.errorCode,
    this.errorReference,
    this.busyTarget,
  });
  final KitchenBoardPhase phase;
  final List<KitchenOrderProjection> orders;

  /// Today's counts, keyed by the same pair a ticket line carries.
  ///
  /// Keyed on the NAME and variant rather than an id because that is what the
  /// kitchen projector stores on a ticket line — there is no catalogue id to
  /// join on — and because two lines with the same name and variant ARE the same
  /// dish to the person cooking them.
  final Map<(String, String?), KitchenAllDayItem> allDay;

  /// How many of this line's dish the kitchen was asked for today, or null when
  /// the count is not available (an older server, or a refusal on the count
  /// route). Null renders nothing rather than a zero, because a zero is a claim.
  KitchenAllDayItem? allDayFor(KitchenOrderItem item) =>
      allDay[(item.productName, item.variantName)];

  /// The code of the last refusal the operator has not dismissed.
  final String? errorCode;

  /// The ticket that refusal was about, by the reference the cook can read on
  /// the card, so the message names a ticket and not an internal id.
  final String? errorReference;

  /// The item id (`mark_item_ready`) or ticket id whose command is in flight.
  /// One at a time: a cook's second tap waits for the first answer rather than
  /// racing it, and the surface can show which line is working.
  final String? busyTarget;

  bool get busy => busyTarget != null;
}

/// One course of a ticket, split by whether the kitchen may work it yet (§8H
/// step 4).
///
/// A held line is not a slower line: it is not work at all yet. Keeping the two
/// lists apart here — rather than leaving the surface to filter them at paint
/// time — is what makes "a held dish cannot be started by a distracted tap" a
/// property of the board rather than of one widget's code.
@immutable
final class KitchenCourseGroup {
  const KitchenCourseGroup({
    required this.courseNumber,
    required this.fired,
    required this.held,
  });

  final int courseNumber;

  /// Lines the kitchen has been told to start (`fired == true`).
  final List<KitchenOrderItem> fired;

  /// Lines the kitchen has NOT been told to start. They are on the ticket so the
  /// cook can read the whole order, and they are not work.
  final List<KitchenOrderItem> held;

  /// The whole course is still waiting, so the board draws it as one held block.
  bool get isHeld => fired.isEmpty && held.isNotEmpty;

  /// How many LINES the course is holding.
  int get heldCount => held.length;

  /// How many PORTIONS it is holding — the number the cook reads.
  ///
  /// This is a quantity, not a line count, because that is the notation the rest
  /// of the ticket already uses: a line prints `2×`, and the all-day rail counts
  /// portions. A held block that said `Held · 1` beside a `2×` line would be
  /// answering a different question from the one the cook is asking.
  int get heldQuantity => held.fold(0, (total, item) => total + item.quantity);
}

/// A ticket's lines grouped by course, lowest course first.
///
/// Both the course and the flag come from the server's own read: `fired` is
/// derived from the ticket's watermark, never from a client guess, so two
/// tablets looking at the same ticket cannot disagree about what is work.
///
/// Items whose course is missing or malformed are not dropped — `fromJson`
/// throws and the board's own error line catches it, which is the same handling
/// every other read of a ticket line already has.
List<KitchenCourseGroup> groupCourses(KitchenOrderProjection order) {
  final byCourse =
      <int, ({List<KitchenOrderItem> fired, List<KitchenOrderItem> held})>{};
  for (final raw in order.items) {
    final item = KitchenOrderItem.fromJson(raw);
    final bucket = byCourse.putIfAbsent(
      item.courseNumber,
      () => (fired: <KitchenOrderItem>[], held: <KitchenOrderItem>[]),
    );
    (item.fired ? bucket.fired : bucket.held).add(item);
  }
  final courses = byCourse.keys.toList()..sort();
  return [
    for (final course in courses)
      KitchenCourseGroup(
        courseNumber: course,
        fired: byCourse[course]!.fired,
        held: byCourse[course]!.held,
      ),
  ];
}

/// The lowest course the kitchen has not been told to start, or null when the
/// whole ticket is fired.
///
/// This is the single course one `fire_course` removes: firing past a gap would
/// start a later course while an earlier one is still waiting, which is the
/// mistake the watermark exists to make impossible.
int? nextHeldCourse(KitchenOrderProjection order) {
  int? next;
  for (final raw in order.items) {
    final item = KitchenOrderItem.fromJson(raw);
    if (item.fired) continue;
    if (next == null || item.courseNumber < next) next = item.courseNumber;
  }
  return next;
}

/// Loads, refreshes and *works* the kitchen board for the KDS mode.
///
/// The board used to be a read-only view, and that is why the kitchen filled
/// up: every ticket that ever reached it stayed, because a cook had no way to
/// say a dish was done (§8H step 3, defect D33). A bump is one item at a time —
/// `mark_item_ready` with that line's id — and the ticket-level moves
/// (`start_preparation`, `complete`, `recall`) use the same route.
///
/// The read and the write are independent: the poll keeps refreshing while a
/// command is in flight, and a command never blanks the board.
final class KitchenBoardController extends ChangeNotifier {
  KitchenBoardController(
    this._repository, {
    required this.commands,
    required this.connectivity,
  });

  final KitchenBoardRepository _repository;

  /// The board's read client. The surface uses it for the board's own tabs, so
  /// the prep list reads with the session the board already carries.
  KitchenBoardRepository get repository => _repository;

  /// The write side. Held separately so the board can keep reading a ticket
  /// while the same ticket has a bump in flight.
  final KitchenCommandRepository commands;

  /// The till's view of the network, which this board is the best evidence for.
  final ConnectivityController connectivity;
  KitchenBoardState _state = const KitchenBoardState();
  KitchenBoardState get state => _state;
  bool _disposed = false;
  bool _watching = false;

  /// How long to wait after a REFUSED watch before asking again.
  ///
  /// Only a failing watch waits: a normal answer, changed or not, is followed by the next watch
  /// immediately, because the server has already applied its own hold. Two seconds keeps a broken
  /// route from becoming a request loop while still recovering on its own.
  static const _watchRetryDelay = Duration(seconds: 2);

  int _generation = 0;
  String? _merchantId;
  PosKitchenOrderQuery? _query;

  /// Pass on what the board's own traffic just learned about the network.
  ///
  /// A kitchen till is the busiest API client in the café — a read every eight
  /// seconds, a held watch in between, a command per bump — so its traffic is the
  /// best evidence the till has about whether the API is reachable. Until now
  /// nothing passed that evidence on: the connectivity state moved only when some
  /// OTHER screen happened to call the API, which meant the board's offline pill
  /// could stay dark while every one of the board's own requests was failing.
  ///
  /// The vocabulary is deliberately narrow. Reaching the API and getting an answer
  /// is `apiReachable`. A transport failure or a timeout is `apiFailure` — those
  /// are the two categories that mean "no answer". Everything else is SILENCE: a
  /// permission refusal or a 5xx says something about the server's mood, not about
  /// the wire, and guessing would make this state less trustworthy than the
  /// requests it is derived from.
  void _reportReachability({Object? failure}) {
    if (failure == null) {
      connectivity.apiReachable(authorityValid: true);
      return;
    }
    if (failure is AppException &&
        (failure.category == AppErrorCategory.transport ||
            failure.category == AppErrorCategory.timeout)) {
      connectivity.apiFailure();
    }
  }

  Future<void> load(String merchantId, PosKitchenOrderQuery query) async {
    _merchantId = merchantId;
    _query = query;
    final generation = ++_generation;
    _state = KitchenBoardState(
      phase: KitchenBoardPhase.loading,
      orders: _state.orders,
      allDay: _state.allDay,
      // A refusal from a command outlives the read that follows it: the
      // conflict message is only useful next to the refreshed board.
      errorCode: _state.errorCode,
      errorReference: _state.errorReference,
      busyTarget: _state.busyTarget,
    );
    notifyListeners();
    try {
      final orders = await _repository.snapshot(merchantId, query);
      if (_disposed || generation != _generation) return;
      _reportReachability();
      _state = KitchenBoardState(
        phase: KitchenBoardPhase.ready,
        orders: orders,
        allDay: _state.allDay,
        errorCode: _state.errorCode,
        errorReference: _state.errorReference,
        busyTarget: _state.busyTarget,
      );
      notifyListeners();
      // The counts come AFTER the rail is on screen: the board is the job and
      // the count is a reading aid, so a slow or refusing count route must not
      // hold up the tickets a cook is working from.
      await _refreshAllDay(merchantId, query, generation);
      return;
    } catch (error) {
      if (_disposed || generation != _generation) return;
      _reportReachability(failure: error);
      _state = KitchenBoardState(
        phase: KitchenBoardPhase.failure,
        orders: _state.orders,
        allDay: _state.allDay,
        errorCode: _codeOf(error),
        errorReference: _state.errorReference,
        busyTarget: _state.busyTarget,
      );
    }
    notifyListeners();
  }

  /// Follow the server's wake-up until the board goes away (§8H step 8).
  ///
  /// One held request at a time: `watch` answers the moment a ticket moves on this location's
  /// board, or when the hold expires with `changed: false`. Either way the loop asks again, so the
  /// poll the surface already runs is no longer what makes the rail current — it is the floor for
  /// the case this channel cannot cover (a missed notification, a dropped connection, a ticket
  /// written straight into SQL).
  ///
  /// A watch that FAILS is not a board that fails: the poll is still running, so the loop waits a
  /// beat and tries again rather than raising an error the cook would read as "the kitchen is
  /// broken". `dispose` ends it.
  Future<void> startWatching() async {
    if (_watching) return;
    _watching = true;
    while (_watching && !_disposed) {
      final merchantId = _merchantId;
      final query = _query;
      if (merchantId == null || query == null) break;
      bool changed;
      try {
        changed = await _repository.watch(merchantId, query);
        _reportReachability();
      } catch (error) {
        // The watch is a request like any other, so a refused one is evidence
        // about the wire in its own right: a held request that cannot connect is
        // the earliest sign of a drop this till gets, twelve seconds before the
        // poll would have found out.
        _reportReachability(failure: error);
        await Future<void>.delayed(_watchRetryDelay);
        continue;
      }
      if (!_watching || _disposed) break;
      if (changed) await load(merchantId, query);
    }
  }

  /// Stop following the wake-up. Safe to call from `dispose`.
  void stopWatching() {
    _watching = false;
  }

  /// Today's counts, fetched after the board and kept quiet.
  ///
  /// A refusal here is not the operator's action failing, so it does not raise
  /// the board's error line; the previous counts stay on screen rather than
  /// being replaced by zeros, because a zero reads as "nobody ordered this
  /// today" and that is a claim the till cannot make.
  Future<void> _refreshAllDay(
    String merchantId,
    PosKitchenOrderQuery query,
    int generation,
  ) async {
    try {
      final counts = await _repository.allDay(
        merchantId,
        PosKitchenAllDayQuery(
          locationId: query.locationId,
          operatorSessionId: query.operatorSessionId,
        ),
      );
      if (_disposed || generation != _generation) return;
      _state = KitchenBoardState(
        phase: _state.phase,
        orders: _state.orders,
        allDay: {
          for (final item in counts.items)
            (item.productName, item.variantName): item,
        },
        errorCode: _state.errorCode,
        errorReference: _state.errorReference,
        busyTarget: _state.busyTarget,
      );
      notifyListeners();
    } catch (_) {
      // See above: the count is advisory and the board keeps working without it.
    }
  }

  /// The cook marks ONE line done: the ticket stays, the dish leaves.
  Future<bool> markItemReady(KitchenOrderProjection order, String itemId) =>
      _command(
        order,
        commandType: 'mark_item_ready',
        target: itemId,
        itemIds: [itemId],
      );

  /// The first move of a ticket: the station has begun it.
  Future<bool> startPreparation(KitchenOrderProjection order) =>
      _command(order, commandType: 'start_preparation', target: order.id);

  /// The ticket is done and leaves the board.
  Future<bool> complete(KitchenOrderProjection order) =>
      _command(order, commandType: 'complete', target: order.id);

  /// Put a finished ticket back on the board. The server refuses a recall with
  /// no reason on it, so a reason code is required here rather than optional.
  Future<bool> recall(
    KitchenOrderProjection order, {
    required String reasonCode,
    String? reasonNote,
  }) => _command(
    order,
    commandType: 'recall',
    target: order.id,
    reasonCode: reasonCode,
    reasonNote: reasonNote,
  );

  /// Tells the kitchen to start one whole course (§8H step 4).
  ///
  /// The board does not move the course itself. `fired` is derived from the
  /// ticket's watermark on the server, and a client that lit a course up
  /// optimistically would draw a rail the kitchen is not working — the same
  /// lie as a bump that never landed. So this sends the command and follows it
  /// with a re-read, exactly like every other command here; the answer that
  /// matters is the ticket the server sends back.
  ///
  /// A course at or below the watermark is accepted and changes nothing, which
  /// is why the surface only offers the control for a course the board can
  /// still see held.
  Future<bool> fireCourse(
    KitchenOrderProjection order, {
    required int courseNumber,
  }) => _command(
    order,
    commandType: 'fire_course',
    target: fireTarget(courseNumber),
    courseNumber: courseNumber,
  );

  /// The `busyTarget` a fire in flight is published under, so the surface spins
  /// the button that was tapped instead of the whole ticket.
  static String fireTarget(int courseNumber) => 'course:$courseNumber';

  /// Clears the refusal banner. The message is not auto-dismissed: it says what
  /// happened to a ticket, and reading it is the operator's decision.
  void dismissError() {
    _state = KitchenBoardState(
      phase: _state.phase,
      orders: _state.orders,
      busyTarget: _state.busyTarget,
    );
    notifyListeners();
  }

  /// Re-reads the board with the context of the last [load].
  Future<void> refresh() async {
    final merchantId = _merchantId;
    final query = _query;
    if (merchantId == null || query == null) return;
    await load(merchantId, query);
  }

  Future<bool> _command(
    KitchenOrderProjection order, {
    required String commandType,
    required String target,
    List<String> itemIds = const [],
    String? reasonCode,
    String? reasonNote,
    int? courseNumber,
  }) async {
    if (_disposed || _state.busyTarget != null) return false;
    final merchantId = _merchantId;
    final query = _query;
    if (merchantId == null || query == null) return false;
    _state = KitchenBoardState(
      phase: _state.phase,
      orders: _state.orders,
      busyTarget: target,
    );
    notifyListeners();
    try {
      await commands.command(
        merchantId,
        PosKitchenCommandRequest(
          action: 'command',
          commandId: _uuid(),
          // A fresh key per attempt, so a lost response cannot bump the same
          // dish twice: the server journals the command and replays its own
          // outcome for a repeat of this key.
          idempotencyKey: _uuid(),
          correlationId: _uuid(),
          // The version the cook's screen was drawn from. If the ticket moved
          // since, the server refuses and the board re-reads.
          expectedVersion: order.version,
          kitchenOrderId: order.id,
          commandType: commandType,
          itemIds: itemIds,
          reasonCode: reasonCode,
          reasonNote: reasonNote,
          // Only `fire_course` carries a course, and the contract says so: every
          // other command leaves this null rather than defaulting it to 1,
          // which would look like a request to fire the first course.
          courseNumber: courseNumber,
          // The location and the operator session are what this route scopes
          // by — the same pair the board read above uses, so a cook can command
          // exactly the tickets the board showed them.
          locationId: query.locationId,
          operatorSessionId: query.operatorSessionId,
        ),
      );
      if (_disposed) return false;
      _releaseBusy();
      await refresh();
      return true;
    } on AppException catch (error) {
      if (_disposed) return false;
      // A conflict is not a fault: the ticket moved. Re-read the board first,
      // then leave the typed message for the operator — never retry into a
      // second bump.
      _fail(error.code, order.publicReference);
      if (error.category == AppErrorCategory.conflict) await refresh();
      return false;
    } catch (_) {
      // ANYTHING ELSE STILL HAS TO RELEASE THE SURFACE.
      //
      // A sibling controller caught only `AppException`, so any other failure
      // left `busy` true and the screen spun for ever with no message and no
      // way out (defect D26). Whatever this failure is, the cook gets the board
      // back and a refusal they can read.
      if (_disposed) return false;
      _fail('KITCHEN_COMMAND_FAILED', order.publicReference);
      return false;
    }
  }

  void _releaseBusy() {
    _state = KitchenBoardState(
      phase: _state.phase,
      orders: _state.orders,
      errorCode: _state.errorCode,
      errorReference: _state.errorReference,
    );
  }

  void _fail(String code, String reference) {
    _state = KitchenBoardState(
      phase: _state.phase,
      orders: _state.orders,
      errorCode: code,
      errorReference: reference,
    );
    notifyListeners();
  }

  String _codeOf(Object error) =>
      error is AppException ? error.code : 'KITCHEN_BOARD_UNAVAILABLE';

  @override
  void dispose() {
    _disposed = true;
    // Ends the watch loop at its next await, so a disposed board stops asking.
    stopWatching();
    _generation++;
    super.dispose();
  }

  /// A v4 UUID, minted per command so a retry after a lost response is a new
  /// attempt the server can journal rather than a silent second bump.
  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}
