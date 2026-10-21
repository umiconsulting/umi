import 'dart:async';
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

  /// LAS ESTACIONES DE ESTA COCINA, TODAS — con trabajo o sin él.
  ///
  /// The board's tabs come from here and not from the tickets on the rail: a station is a
  /// tab at eight in the morning, before its first order, and a merchant with two stations
  /// sees both. It is also what lets a screen be fixed to its station before service.
  Future<List<KitchenStation>> stations(
    String merchantId,
    PosKitchenOrderQuery query,
  );
}

abstract interface class KitchenUnassignedRepository {
  Future<List<KitchenUnassignedOrderProjection>> unassigned(
    String merchantId,
    PosKitchenOrderQuery query,
  );
  Future<KitchenUnassignedCommandResult> resolveUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  );
  Future<KitchenUnassignedCommandResult> discardUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  );
}

final class ApiKitchenBoardRepository
    implements KitchenBoardRepository, KitchenUnassignedRepository {
  const ApiKitchenBoardRepository(this._api);

  final ApiClient _api;

  @override
  Future<List<KitchenUnassignedOrderProjection>> unassigned(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    final response = KitchenUnassignedResponse.fromJson(
      await _api.request(
        method: ApiMethod.get,
        path: Uri(
          path: UmiRoutes.posKitchenUnassigned(merchantId),
          queryParameters: query.toJson().map(
            (key, value) => MapEntry(key, '$value'),
          ),
        ).toString(),
      ),
    );
    return response.data
        .map(KitchenUnassignedOrderProjection.fromJson)
        .toList();
  }

  @override
  Future<KitchenUnassignedCommandResult> resolveUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  ) async => KitchenUnassignedCommandResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posKitchenResolveUnassigned(merchantId),
      body: {
        for (final entry in request.toJson().entries)
          if (entry.value != null) entry.key: entry.value,
      },
    ),
  );

  @override
  Future<KitchenUnassignedCommandResult> discardUnassigned(
    String merchantId,
    PosKitchenUnassignedCommandRequest request,
  ) async => KitchenUnassignedCommandResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posKitchenDiscardUnassigned(merchantId),
      body: {
        for (final entry in request.toJson().entries)
          if (entry.value != null) entry.key: entry.value,
      },
    ),
  );

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
  Future<List<KitchenStation>> stations(
    String merchantId,
    PosKitchenOrderQuery query,
  ) async {
    final response = await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posKitchenStations(merchantId),
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    );
    final parsed = KitchenStationListResponse.fromJson(response);
    return parsed.data.map(KitchenStation.fromJson).toList(growable: false);
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

/// One local kitchen intent that has not reached the server yet.
///
/// The board is a local work surface first. A tap paints the new state at once,
/// and commands leave this queue in order. A stale poll can replace the server
/// base, but it cannot remove an intent that is still waiting here.
final class _PendingKitchenCommand {
  _PendingKitchenCommand({
    required this.commandId,
    required this.idempotencyKey,
    required this.correlationId,
    required this.commandType,
    required this.target,
    required this.itemIds,
    required this.completed,
    this.courseNumber,
    this.reasonCode,
    this.reasonNote,
  });

  final String commandId;
  final String idempotencyKey;
  final String correlationId;
  final String commandType;
  final String target;
  final List<String> itemIds;
  final Completer<bool> completed;
  final int? courseNumber;
  final String? reasonCode;
  final String? reasonNote;

  /// True while this exact intent is on the wire. A read that already contains
  /// its effect must not remove it before the answer arrives.
  bool sending = false;
}

@immutable
final class KitchenBoardState {
  const KitchenBoardState({
    this.phase = KitchenBoardPhase.idle,
    this.orders = const [],
    this.allDay = const {},
    this.stations = const [],
    this.businessDate,
    this.errorCode,
    this.errorReference,
    this.busyTarget,
  });
  final KitchenBoardPhase phase;
  final List<KitchenOrderProjection> orders;

  /// Every station of this kitchen, in the merchant's own order. The board's tabs come
  /// from here, so they do not appear and disappear with the work.
  final List<KitchenStation> stations;
  final String? businessDate;

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
  }) {
    connectivity.addListener(_connectivityChanged);
  }

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

  /// The last answer the server gave, without local intents.
  List<KitchenOrderProjection> _serverOrders = const [];

  /// Intents the cook has made but the server has not confirmed yet, in order.
  ///
  /// The key is one CARD, not one order id: a till can draw two station cards
  /// for the same kitchen order, and a bump on the bar card must not paint on
  /// the pizza card.
  final Map<String, List<_PendingKitchenCommand>> _pendingByOrder = {};
  final Set<String> _drainingOrders = {};
  String? _scope;

  /// Local intents that still need a server answer. The surface uses no waiting
  /// copy for them; this is diagnostic state and a test seam.
  int get pendingCommandCount => _pendingByOrder.values.fold(
    0,
    (total, pending) => total + pending.length,
  );

  /// How long to wait after a REFUSED watch before asking again.
  ///
  /// Only a failing watch waits: a normal answer, changed or not, is followed by the next watch
  /// immediately, because the server has already applied its own hold. Two seconds keeps a broken
  /// route from becoming a request loop while still recovering on its own.
  static const _watchRetryDelay = Duration(seconds: 2);

  int _generation = 0;
  int _watchGeneration = 0;
  String? _merchantId;
  PosKitchenOrderQuery? _query;
  List<KitchenUnassignedOrderProjection> unassignedOrders = const [];
  bool unassignedLoaded = false;
  bool unassignedLoading = false;
  String? unassignedErrorCode;
  String? unassignedBusyTarget;
  KitchenUnassignedCommandResult? lastUnassignedResult;
  String? _unassignedScope;
  int _unassignedCommandEpoch = 0;
  PosKitchenUnassignedCommandRequest? _unassignedRequest;
  bool? _unassignedRequestDiscard;

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
    // A successful kitchen read can come from the LAN node. It says nothing
    // about the cloud. Only the cloud health probe may restore `online`.
    if (failure == null) return;
    if (failure is AppException &&
        (failure.category == AppErrorCategory.transport ||
            failure.category == AppErrorCategory.timeout)) {
      connectivity.apiFailure();
    }
  }

  /// Load the board once per scope at a time.
  ///
  /// The poll and the held watch both ask for a read, and they can land in the
  /// same tick. Two reads for one board is twice the traffic for one answer, so
  /// a second call with the same scope awaits the read already in flight. A
  /// different scope starts a new read, and [_generation] discards the old one.
  Future<void> load(
    String merchantId,
    PosKitchenOrderQuery query, {
    bool force = false,
  }) {
    final scope = '$merchantId:${query.locationId}:${query.operatorSessionId}';
    final inFlight = _loadInFlight;
    if (!force && inFlight != null && _loadScope == scope) return inFlight;
    _loadScope = scope;
    late final Future<void> future;
    future = _load(merchantId, query).whenComplete(() {
      if (identical(_loadInFlight, future)) {
        _loadInFlight = null;
        _loadScope = null;
      }
    });
    _loadInFlight = future;
    return future;
  }

  Future<void>? _loadInFlight;
  String? _loadScope;

  Future<void> _load(String merchantId, PosKitchenOrderQuery query) async {
    final scope = '$merchantId:${query.locationId}:${query.operatorSessionId}';
    if (_scope != scope) {
      _scope = scope;
      _resetLocalIntents();
    }
    if (_unassignedScope != scope) {
      _unassignedScope = scope;
      _unassignedCommandEpoch++;
      unassignedOrders = const [];
      unassignedLoaded = false;
      unassignedLoading = false;
      unassignedErrorCode = null;
      unassignedBusyTarget = null;
      lastUnassignedResult = null;
      _unassignedRequest = null;
    }
    _merchantId = merchantId;
    _query = query;
    final generation = ++_generation;
    _state = KitchenBoardState(
      phase: KitchenBoardPhase.loading,
      orders: _composedOrders,
      allDay: _state.allDay,
      stations: _state.stations,
      businessDate: _state.businessDate,
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
      _serverOrders = orders;
      _dropSettledPending();
      _state = KitchenBoardState(
        phase: KitchenBoardPhase.ready,
        orders: _composedOrders,
        allDay: _state.allDay,
        stations: _state.stations,
        businessDate: _state.businessDate,
        errorCode: _state.errorCode,
        errorReference: _state.errorReference,
        busyTarget: _state.busyTarget,
      );
      notifyListeners();
      // The counts come AFTER the rail is on screen: the board is the job and
      // the count is a reading aid, so a slow or refusing count route must not
      // hold up the tickets a cook is working from.
      await _refreshAllDay(merchantId, query, generation);
      // The station list rides along with the board the same way the counts do: it is
      // configuration, it changes almost never, and a refusal here must not take the
      // tickets down with it.
      await _refreshStations(merchantId, query, generation);
      await _refreshUnassigned(merchantId, query, generation);
      _drainPending();
      return;
    } catch (error) {
      if (_disposed || generation != _generation) return;
      _reportReachability(failure: error);
      // A full server window is not a failed board. The tickets on screen are
      // still the last answer the server gave, and replacing them with an
      // error would tell the cook the kitchen is broken when it is not.
      if (error is AppException && error.code == 'RATE_LIMITED') return;
      _state = KitchenBoardState(
        phase: KitchenBoardPhase.failure,
        orders: _composedOrders,
        allDay: _state.allDay,
        stations: _state.stations,
        businessDate: _state.businessDate,
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
    final generation = ++_watchGeneration;
    bool current() => _watching && !_disposed && generation == _watchGeneration;
    while (current()) {
      final merchantId = _merchantId;
      final query = _query;
      if (merchantId == null || query == null) break;
      bool changed;
      try {
        changed = await _repository.watch(merchantId, query);
        if (!current()) return;
        _reportReachability();
      } catch (error) {
        if (!current()) return;
        // The watch is a request like any other, so a refused one is evidence
        // about the wire in its own right: a held request that cannot connect is
        // the earliest sign of a drop this till gets, twelve seconds before the
        // poll would have found out.
        _reportReachability(failure: error);
        await Future<void>.delayed(_watchRetryDelay);
        continue;
      }
      if (!current()) break;
      if (changed) await load(merchantId, query);
    }
  }

  /// Stop the surface's watch and pending reads. A closed board cannot publish
  /// stale connection results after another surface has recovered.
  void stopWatching() {
    _watching = false;
    _watchGeneration++;
    _generation++;
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
        orders: _composedOrders,
        allDay: {
          for (final item in counts.items)
            (item.productName, item.variantName): item,
        },
        stations: _state.stations,
        businessDate: counts.businessDate,
        errorCode: _state.errorCode,
        errorReference: _state.errorReference,
        busyTarget: _state.busyTarget,
      );
      notifyListeners();
    } catch (_) {
      // See above: the count is advisory and the board keeps working without it.
    }
  }

  /// The kitchen's stations, read with the board and never in its way: configuration,
  /// not work. A refusal leaves the previous list — or an empty one, which the surface
  /// reads as "the tickets are the only thing that says which stations exist".
  Future<void> _refreshStations(
    String merchantId,
    PosKitchenOrderQuery query,
    int generation,
  ) async {
    try {
      final stations = await _repository.stations(merchantId, query);
      if (_disposed || generation != _generation) return;
      _state = KitchenBoardState(
        phase: _state.phase,
        orders: _composedOrders,
        allDay: _state.allDay,
        stations: stations,
        businessDate: _state.businessDate,
        errorCode: _state.errorCode,
        errorReference: _state.errorReference,
        busyTarget: _state.busyTarget,
      );
      notifyListeners();
    } catch (_) {
      // As above: the rail is the job.
    }
  }

  /// The cook marks ONE line done: the ticket stays, the dish leaves.
  Future<bool> markItemReady(KitchenOrderProjection order, String itemId) =>
      _enqueueCommand(
        order,
        commandType: 'mark_item_ready',
        target: itemId,
        itemIds: [itemId],
      );

  /// The first move of a ticket: the station has begun it.
  Future<bool> startPreparation(KitchenOrderProjection order) =>
      _enqueueCommand(
        order,
        commandType: 'start_preparation',
        target: order.id,
        itemIds: order.items
            .map(KitchenOrderItem.fromJson)
            .where((item) => item.fired && item.status == 'queued')
            .map((item) => item.id)
            .toList(),
      );

  /// The ticket is done and leaves the board.
  Future<bool> complete(KitchenOrderProjection order) => _enqueueCommand(
    order,
    commandType: 'complete',
    target: order.id,
    itemIds: order.items
        .map(KitchenOrderItem.fromJson)
        .where((item) => item.status != 'cancelled')
        .map((item) => item.id)
        .toList(),
  );

  /// Confirma la cancelación sólo para los productos visibles de esta estación.
  Future<bool> discard(KitchenOrderProjection order) => _enqueueCommand(
    order,
    commandType: 'cancel_ack',
    target: order.id,
    itemIds: order.items
        .map(KitchenOrderItem.fromJson)
        .map((item) => item.id)
        .toList(),
  );

  /// Put a finished ticket back on the board. The server refuses a recall with
  /// no reason on it, so a reason code is required here rather than optional.
  Future<bool> recall(
    KitchenOrderProjection order, {
    required String reasonCode,
    String? reasonNote,
  }) => _enqueueCommand(
    order,
    commandType: 'recall',
    target: order.id,
    itemIds: order.items
        .map(KitchenOrderItem.fromJson)
        .where((item) => item.fired && item.status == 'ready')
        .map((item) => item.id)
        .toList(),
    reasonCode: reasonCode,
    reasonNote: reasonNote,
  );

  /// Tells the kitchen to start one whole course (§8H step 4).
  ///
  /// The board paints the course at once and keeps that paint while the command
  /// waits in the local queue. A refusal removes the paint and shows the reason.
  ///
  /// A course at or below the watermark is accepted and changes nothing, which
  /// is why the surface only offers the control for a course the board can
  /// still see held.
  Future<bool> fireCourse(
    KitchenOrderProjection order, {
    required int courseNumber,
  }) => _enqueueCommand(
    order,
    commandType: 'fire_course',
    target: fireTarget(courseNumber),
    courseNumber: courseNumber,
  );

  /// The `busyTarget` a fire in flight is published under. It is diagnostic
  /// state; the surface does not replace the ticket with a waiting message.
  static String fireTarget(int courseNumber) => 'course:$courseNumber';

  /// Clears the refusal banner. The message is not auto-dismissed: it says what
  /// happened to a ticket, and reading it is the operator's decision.
  void dismissError() {
    _state = KitchenBoardState(
      phase: _state.phase,
      orders: _composedOrders,
      allDay: _state.allDay,
      stations: _state.stations,
      businessDate: _state.businessDate,
      busyTarget: _state.busyTarget,
    );
    notifyListeners();
  }

  /// Re-reads the board with the context of the last [load].
  Future<void> refresh() async {
    final merchantId = _merchantId;
    final query = _query;
    if (merchantId == null || query == null) return;
    // This refresh follows a command. It must read the server again, even if a
    // poll is in flight, or the ticket it just changed stays stale on screen.
    await load(merchantId, query, force: true);
  }

  Future<void> _refreshUnassigned(
    String merchantId,
    PosKitchenOrderQuery query,
    int generation,
  ) async {
    final repository = _repository;
    if (repository is! KitchenUnassignedRepository) return;
    final unassigned = repository as KitchenUnassignedRepository;
    if (_disposed || generation != _generation) return;
    unassignedLoading = true;
    notifyListeners();
    try {
      final orders = await unassigned.unassigned(merchantId, query);
      if (_disposed || generation != _generation) return;
      unassignedOrders = orders;
      unassignedLoaded = true;
      if (unassignedErrorCode == 'KITCHEN_UNASSIGNED_UNAVAILABLE') {
        unassignedErrorCode = null;
      }
    } catch (_) {
      if (!_disposed && generation == _generation) {
        unassignedErrorCode = 'KITCHEN_UNASSIGNED_UNAVAILABLE';
      }
    } finally {
      if (!_disposed && generation == _generation) {
        unassignedLoading = false;
        notifyListeners();
      }
    }
  }

  Future<bool> resolveUnassigned(KitchenUnassignedOrderProjection order) =>
      _commandUnassigned(order, discard: false);

  Future<bool> discardUnassigned(KitchenUnassignedOrderProjection order) =>
      _commandUnassigned(order, discard: true);

  Future<bool> _commandUnassigned(
    KitchenUnassignedOrderProjection order, {
    required bool discard,
  }) async {
    final repository = _repository;
    final merchantId = _merchantId;
    final query = _query;
    if (_disposed ||
        repository is! KitchenUnassignedRepository ||
        merchantId == null ||
        query == null ||
        unassignedBusyTarget != null ||
        (discard ? order.status != 'cancelled' : order.status == 'cancelled')) {
      return false;
    }
    final unassigned = repository as KitchenUnassignedRepository;
    final epoch = ++_unassignedCommandEpoch;
    final previous = _unassignedRequest;
    if (previous == null ||
        previous.kitchenOrderId != order.id ||
        previous.expectedVersion != order.version ||
        (!discard && previous.routingFingerprint != order.routingFingerprint) ||
        _unassignedRequestDiscard != discard) {
      _unassignedRequest = PosKitchenUnassignedCommandRequest(
        locationId: query.locationId,
        operatorSessionId: query.operatorSessionId,
        kitchenOrderId: order.id,
        expectedVersion: order.version,
        idempotencyKey: _uuid(),
        routingFingerprint: discard ? null : order.routingFingerprint,
      );
      _unassignedRequestDiscard = discard;
    }
    unassignedBusyTarget = order.id;
    unassignedErrorCode = null;
    lastUnassignedResult = null;
    notifyListeners();
    try {
      final result = await (discard
          ? unassigned.discardUnassigned(merchantId, _unassignedRequest!)
          : unassigned.resolveUnassigned(merchantId, _unassignedRequest!));
      if (_disposed || epoch != _unassignedCommandEpoch) return false;
      lastUnassignedResult = result;
      _unassignedRequest = null;
      unassignedBusyTarget = null;
      await refresh();
      return true;
    } catch (error) {
      if (_disposed || epoch != _unassignedCommandEpoch) return false;
      unassignedErrorCode = error is AppException
          ? error.code
          : 'KITCHEN_COMMAND_FAILED';
      unassignedBusyTarget = null;
      if (error is AppException &&
          error.category == AppErrorCategory.conflict) {
        _unassignedRequest = null;
        await refresh();
      }
      return false;
    } finally {
      if (!_disposed && epoch == _unassignedCommandEpoch) {
        unassignedBusyTarget = null;
        notifyListeners();
      }
    }
  }

  /// Paint an intent now and put it behind every earlier intent for this ticket.
  ///
  /// A cook often marks several lines in one pass. Each tap must survive the
  /// next poll, and it must not wait for the previous network answer. The queue
  /// gives both properties without inventing a second server order model.
  Future<bool> _enqueueCommand(
    KitchenOrderProjection order, {
    required String commandType,
    required String target,
    List<String> itemIds = const [],
    String? reasonCode,
    String? reasonNote,
    int? courseNumber,
  }) {
    if (_disposed) return Future<bool>.value(false);
    final cardKey = _cardKey(order);
    final visible = _visibleOrder(cardKey);
    if (visible == null) return Future<bool>.value(false);
    if (_commandApplied(
      visible,
      commandType,
      itemIds: itemIds,
      courseNumber: courseNumber,
    )) {
      return Future<bool>.value(true);
    }
    if (_state.errorCode != null || _state.errorReference != null) {
      _publishVisible(clearError: true);
    }
    final pending = _PendingKitchenCommand(
      commandId: _uuid(),
      idempotencyKey: _uuid(),
      correlationId: _uuid(),
      commandType: commandType,
      target: target,
      itemIds: List<String>.unmodifiable(itemIds),
      courseNumber: courseNumber,
      reasonCode: reasonCode,
      reasonNote: reasonNote,
      completed: Completer<bool>(),
    );
    _pendingByOrder.putIfAbsent(cardKey, () => []).add(pending);
    _publishVisible();
    unawaited(_drainOrder(cardKey));
    return pending.completed.future;
  }

  void _drainPending() {
    for (final orderId in _pendingByOrder.keys.toList(growable: false)) {
      unawaited(_drainOrder(orderId));
    }
  }

  /// Send one ticket's intents in order. Different tickets drain independently:
  /// a slow bar ticket must not delay the grill.
  Future<void> _drainOrder(String cardKey) async {
    if (_disposed || _drainingOrders.contains(cardKey)) return;
    _drainingOrders.add(cardKey);
    _PendingKitchenCommand? failedAfterDrain;
    try {
      while (!_disposed) {
        final pending = _pendingByOrder[cardKey];
        if (pending == null || pending.isEmpty) {
          _pendingByOrder.remove(cardKey);
          break;
        }
        final command = pending.first;
        final base = _serverOrder(cardKey);
        if (base == null) {
          pending.remove(command);
          _finish(command, _leavesRail(command.commandType));
          continue;
        }
        if (_commandApplied(
          base,
          command.commandType,
          itemIds: command.itemIds,
          courseNumber: command.courseNumber,
        )) {
          pending.remove(command);
          _finish(command, true);
          continue;
        }
        final merchantId = _merchantId;
        final query = _query;
        if (merchantId == null || query == null) {
          _finish(command, false);
          break;
        }
        command.sending = true;
        _publishVisible();
        try {
          final result = await commands.command(
            merchantId,
            _requestFor(base, command, query),
          );
          if (_disposed) {
            _finish(command, false);
            return;
          }
          pending.remove(command);
          if (pending.isEmpty) _pendingByOrder.remove(cardKey);
          _acceptCommand(base, command, result);
          _publishVisible();
          _finish(command, true);
        } on AppException catch (error) {
          command.sending = false;
          if (_isDefiniteRefusal(error)) {
            pending.remove(command);
            if (pending.isEmpty) _pendingByOrder.remove(cardKey);
            _publishVisible();
            if (error.category == AppErrorCategory.conflict) {
              await load(merchantId, query, force: true);
            }
            _fail(error.code, base.publicReference);
            _finish(command, false);
            break;
          }
          // An unknown answer is not proof of refusal. The paint stays, the
          // command stays queued, and the next poll or reconnect retries it.
          _reportReachability(failure: error);
          _publishVisible();
          failedAfterDrain = command;
          break;
        } catch (_) {
          command.sending = false;
          // A decode fault or a dropped connection says nothing about whether
          // the server applied the command. Keep the deterministic command
          // identity and retry it later.
          _publishVisible();
          failedAfterDrain = command;
          break;
        }
      }
    } finally {
      _drainingOrders.remove(cardKey);
      if (failedAfterDrain != null) _finish(failedAfterDrain, false);
      if (!_disposed) _publishVisible();
    }
  }

  PosKitchenCommandRequest _requestFor(
    KitchenOrderProjection base,
    _PendingKitchenCommand command,
    PosKitchenOrderQuery query,
  ) => PosKitchenCommandRequest(
    action: 'command',
    commandId: command.commandId,
    // A fresh key per attempt, so a lost response cannot bump the same dish
    // twice: the server journals the command and replays its own outcome for a
    // repeat of this key.
    idempotencyKey: command.idempotencyKey,
    correlationId: command.correlationId,
    // The version of the last confirmed answer plus every earlier local intent
    // that the server has now accepted.
    expectedVersion: base.version,
    kitchenOrderId: base.id,
    commandType: command.commandType,
    itemIds: command.itemIds,
    reasonCode: command.reasonCode,
    reasonNote: command.reasonNote,
    // Only `fire_course` carries a course, and the contract says so: every other
    // command leaves this null rather than defaulting it to 1, which would look
    // like a request to fire the first course.
    courseNumber: command.courseNumber,
    locationId: query.locationId,
    operatorSessionId: query.operatorSessionId,
  );

  void _acceptCommand(
    KitchenOrderProjection base,
    _PendingKitchenCommand command,
    KitchenCommandResult result,
  ) {
    final baseKey = _cardKey(base);
    final current = _serverOrder(baseKey);
    if (current != null && current.version > result.version) return;
    if (_leavesRail(command.commandType) ||
        result.status == 'completed' ||
        result.status == 'cancelled') {
      _serverOrders = _serverOrders
          .where((order) => order.id != base.id)
          .toList(growable: false);
      return;
    }
    final projected = _projectCommand(
      base,
      commandType: command.commandType,
      itemIds: command.itemIds,
      courseNumber: command.courseNumber,
      clock: DateTime.now().toUtc(),
    );
    final raw = projected.toJson()
      ..['version'] = result.version
      ..['updatedAt'] = result.updatedAt;
    final accepted = KitchenOrderProjection.fromJson(raw);
    _serverOrders = [
      for (final order in _serverOrders)
        _cardKey(order) == baseKey
            ? accepted
            // One kitchen order can have one card per station. A command bumps
            // the shared version, so every sibling card must read that version
            // on its next command even when its own lines did not change.
            : order.id == base.id
            ? _withServerVersion(order, result)
            : order,
    ];
  }

  KitchenOrderProjection _withServerVersion(
    KitchenOrderProjection order,
    KitchenCommandResult result,
  ) {
    final raw = order.toJson()
      ..['version'] = result.version
      ..['updatedAt'] = result.updatedAt;
    return KitchenOrderProjection.fromJson(raw);
  }

  /// Drop queued intents that a fresh server answer already contains.
  ///
  /// A command that is still on the wire stays in the queue: its answer has not
  /// arrived, and removing it early would make the next local paint depend on
  /// which request happened to finish first.
  void _dropSettledPending() {
    for (final entry in _pendingByOrder.entries.toList(growable: false)) {
      final base = _serverOrder(entry.key);
      if (base == null) {
        for (final command in entry.value.where((item) => !item.sending)) {
          _finish(command, _leavesRail(command.commandType));
        }
        entry.value.removeWhere((command) => !command.sending);
      } else {
        entry.value.removeWhere((command) {
          if (command.sending) return false;
          final settled = _commandApplied(
            base,
            command.commandType,
            itemIds: command.itemIds,
            courseNumber: command.courseNumber,
          );
          if (settled) _finish(command, true);
          return settled;
        });
      }
      if (entry.value.isEmpty) _pendingByOrder.remove(entry.key);
    }
  }

  bool _commandApplied(
    KitchenOrderProjection order,
    String commandType, {
    required List<String> itemIds,
    required int? courseNumber,
  }) {
    final selected = itemIds.toSet();
    final items = order.items.map(KitchenOrderItem.fromJson).toList();
    bool selectedHave(bool Function(KitchenOrderItem item) test) =>
        selected.isNotEmpty &&
        items.where((item) => selected.contains(item.id)).every(test);
    return switch (commandType) {
      'mark_item_ready' => selectedHave((item) => item.status == 'ready'),
      'start_preparation' =>
        selected.isEmpty || selectedHave((item) => item.status != 'queued'),
      'complete' => order.status == 'completed',
      // A cancelled ticket is cancelled before the cook acknowledges it. The
      // acknowledgement is the command that removes it from this station, so
      // the server status alone does not prove that the command is done.
      'cancel_ack' => false,
      'recall' =>
        order.status == 'in_preparation' &&
            selectedHave((item) => item.status != 'ready'),
      'fire_course' =>
        courseNumber == null || order.firedThroughCourse >= courseNumber,
      _ => false,
    };
  }

  bool _leavesRail(String commandType) =>
      commandType == 'complete' || commandType == 'cancel_ack';

  String _cardKey(KitchenOrderProjection order) =>
      '${order.id}:${order.stationId}:${order.businessDate}';

  KitchenOrderProjection? _serverOrder(String cardKey) {
    for (final order in _serverOrders) {
      if (_cardKey(order) == cardKey) return order;
    }
    return null;
  }

  KitchenOrderProjection? _visibleOrder(String cardKey) {
    for (final order in _state.orders) {
      if (_cardKey(order) == cardKey) return order;
    }
    return null;
  }

  /// The server's last answer with every queued local intent layered on top.
  List<KitchenOrderProjection> get _composedOrders {
    final orders = <KitchenOrderProjection>[];
    for (final base in _serverOrders) {
      final pending = _pendingByOrder[_cardKey(base)];
      if (pending == null || pending.isEmpty) {
        orders.add(base);
        continue;
      }
      var current = base;
      var leavesRail = false;
      for (final command in pending) {
        if (_leavesRail(command.commandType)) {
          leavesRail = true;
          break;
        }
        current = _projectCommand(
          current,
          commandType: command.commandType,
          itemIds: command.itemIds,
          courseNumber: command.courseNumber,
          clock: DateTime.now().toUtc(),
        );
      }
      if (!leavesRail) orders.add(current);
    }
    return orders;
  }

  String? get _activeTarget {
    for (final pending in _pendingByOrder.values) {
      for (final command in pending) {
        if (command.sending) return command.target;
      }
    }
    return null;
  }

  void _publishVisible({bool clearError = false, KitchenBoardPhase? phase}) {
    if (_disposed) return;
    _state = KitchenBoardState(
      phase: phase ?? _state.phase,
      orders: _composedOrders,
      allDay: _state.allDay,
      stations: _state.stations,
      businessDate: _state.businessDate,
      errorCode: clearError ? null : _state.errorCode,
      errorReference: clearError ? null : _state.errorReference,
      busyTarget: _activeTarget,
    );
    notifyListeners();
  }

  void _resetLocalIntents() {
    for (final pending in _pendingByOrder.values) {
      for (final command in pending) {
        _finish(command, false);
      }
    }
    _pendingByOrder.clear();
    _drainingOrders.clear();
    _serverOrders = const [];
  }

  void _finish(_PendingKitchenCommand command, bool accepted) {
    if (!command.completed.isCompleted) command.completed.complete(accepted);
  }

  bool _isDefiniteRefusal(AppException error) => switch (error.category) {
    AppErrorCategory.permission ||
    AppErrorCategory.conflict ||
    AppErrorCategory.authentication ||
    AppErrorCategory.configuration ||
    AppErrorCategory.unsupported => true,
    _ => const {
      'VALIDATION_FAILED',
      'KITCHEN_ORDER_NOT_FOUND',
      'KITCHEN_ORDER_NOT_ROUTED',
      'KITCHEN_ITEM_NOT_FOUND',
      'KITCHEN_INVALID_TRANSITION',
      'TICKET_NOT_FOUND',
      'RESOURCE_NOT_FOUND',
      'DEVICE_REVOKED',
    }.contains(error.code),
  };

  void _connectivityChanged() {
    if (_disposed) return;
    final state = connectivity.state;
    if (state == PosConnectivity.online ||
        state == PosConnectivity.recovering) {
      _drainPending();
    }
  }

  /// The ticket the cook should see before the LAN or cloud acknowledges the
  /// command. The board already knows the operation and the lines it applies to;
  /// leaving the old ticket under a spinner made a local command look like a
  /// stalled network request.
  KitchenOrderProjection _projectCommand(
    KitchenOrderProjection order, {
    required String commandType,
    required List<String> itemIds,
    required int? courseNumber,
    required DateTime clock,
  }) {
    final raw = order.toJson();
    final items = (raw['items'] as List<Object?>)
        .cast<Map<String, Object?>>()
        .map((item) => Map<String, Object?>.from(item))
        .toList(growable: false);
    final selected = itemIds.toSet();
    var status = order.status;
    switch (commandType) {
      case 'start_preparation':
        status = 'in_preparation';
        raw['preparationStartedAt'] = clock.toIso8601String();
        for (final item in items) {
          if (item['status'] == 'queued') item['status'] = 'preparing';
        }
        break;
      case 'mark_item_ready':
        for (final item in items) {
          if (selected.isEmpty || selected.contains(item['id'])) {
            item['status'] = 'ready';
          }
        }
        final active = items.where((item) => item['status'] != 'cancelled');
        status =
            active.isNotEmpty &&
                active.every((item) => item['status'] == 'ready')
            ? 'ready'
            : 'partially_ready';
        break;
      case 'complete':
        status = 'completed';
        for (final item in items) {
          if (item['status'] != 'cancelled') item['status'] = 'ready';
        }
        break;
      case 'cancel_ack':
        status = 'cancelled';
        for (final item in items) {
          if (selected.isEmpty || selected.contains(item['id'])) {
            item['status'] = 'cancelled';
          }
        }
        break;
      case 'recall':
        status = 'in_preparation';
        for (final item in items) {
          if (selected.isEmpty || selected.contains(item['id'])) {
            if (item['status'] == 'ready') item['status'] = 'preparing';
          }
        }
        break;
      case 'fire_course':
        final through = courseNumber ?? order.firedThroughCourse;
        raw['firedThroughCourse'] = through;
        for (final item in items) {
          if ((item['courseNumber'] as num? ?? 1).toInt() <= through) {
            item['fired'] = true;
          }
        }
        break;
    }
    raw['status'] = status;
    raw['items'] = items;
    raw['updatedAt'] = clock.toIso8601String();
    return KitchenOrderProjection.fromJson(raw);
  }

  void _fail(String code, String reference) {
    _state = KitchenBoardState(
      phase: _state.phase,
      orders: _composedOrders,
      allDay: _state.allDay,
      stations: _state.stations,
      businessDate: _state.businessDate,
      errorCode: code,
      errorReference: reference,
      busyTarget: _activeTarget,
    );
    notifyListeners();
  }

  String _codeOf(Object error) =>
      error is AppException ? error.code : 'KITCHEN_BOARD_UNAVAILABLE';

  @override
  void dispose() {
    _disposed = true;
    connectivity.removeListener(_connectivityChanged);
    _resetLocalIntents();
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
