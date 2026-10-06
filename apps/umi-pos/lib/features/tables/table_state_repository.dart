import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

/// The POS client for the room itself (`merchant.table_state`, plan §8D steps 3
/// to 5). The floor plan is the LAYOUT and this is the ROOM: who is sitting
/// where, for how long, and which tables one party has taken.
///
/// Reads and writes are separate routes on purpose. A read is the whole room
/// with the server's clock, so every turn timer on the board is anchored to
/// `serverTime`. A write is an idempotent POS command that answers with the
/// tables it changed, not with the room: a replayed command returns the first
/// attempt's own outcome, and drawing a whole-room snapshot from that would
/// redraw the board backwards.
abstract interface class TableStateRepository {
  Future<TableStateMap> read(String merchantId, PosTableStateQuery query);
  Future<TableStateChangeResult> seat(
    String merchantId,
    SeatTableRequest request,
  );
  Future<TableStateChangeResult> move(
    String merchantId,
    MovePartyRequest request,
  );
  Future<TableStateChangeResult> merge(
    String merchantId,
    MergeTablesRequest request,
  );
  Future<TableStateChangeResult> split(
    String merchantId,
    SplitPartyRequest request,
  );
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  );
  Future<TableStateChangeResult> markReady(
    String merchantId,
    OpenTableRequest request,
  );
  Future<TableStateChangeResult> markOrdered(
    String merchantId,
    MarkTableOrderedRequest request,
  );
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  );
  Future<TableStateChangeResult> markAwaitingPayment(
    String merchantId,
    MarkTableAwaitingPaymentRequest request,
  );
}

final class ApiTableStateRepository implements TableStateRepository {
  const ApiTableStateRepository(this._api);
  final ApiClient _api;

  @override
  Future<TableStateMap> read(
    String merchantId,
    PosTableStateQuery query,
  ) async => TableStateMap.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posTableState(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
        },
      ).toString(),
    ),
  );

  @override
  Future<TableStateChangeResult> seat(
    String merchantId,
    SeatTableRequest request,
  ) => _command(UmiRoutes.posTableStateSeat(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> move(
    String merchantId,
    MovePartyRequest request,
  ) => _command(UmiRoutes.posTableStateMove(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> merge(
    String merchantId,
    MergeTablesRequest request,
  ) => _command(UmiRoutes.posTableStateMerge(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> split(
    String merchantId,
    SplitPartyRequest request,
  ) => _command(UmiRoutes.posTableStateSplit(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  ) => _command(UmiRoutes.posTableStateClear(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> markReady(
    String merchantId,
    OpenTableRequest request,
  ) => _command(UmiRoutes.posTableStateOpen(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> markOrdered(
    String merchantId,
    MarkTableOrderedRequest request,
  ) => _command(UmiRoutes.posTableStateOrdered(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  ) => _command(UmiRoutes.posTableStateServed(merchantId), request.toJson());

  @override
  Future<TableStateChangeResult> markAwaitingPayment(
    String merchantId,
    MarkTableAwaitingPaymentRequest request,
  ) => _command(
    UmiRoutes.posTableStateAwaitingPayment(merchantId),
    request.toJson(),
  );

  Future<TableStateChangeResult> _command(
    String path,
    Map<String, Object?> body,
  ) async => TableStateChangeResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: path,
      body: body,
      idempotent: true,
    ),
  );
}
