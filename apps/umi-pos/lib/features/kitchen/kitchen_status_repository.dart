import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/network/api_client.dart';

abstract interface class KitchenStatusRepository {
  Future<PosKitchenStatusResult> status(
    String merchantId,
    String sourceOrderId,
    PosKitchenOrderQuery query,
  );
}

/// The write side of the kitchen: the POS-role device's unified KDS mode tells
/// the station what happened. Separate from the read so the board can keep
/// refreshing while a command is in flight (plan §8H step 3).
///
/// Every command — the per-item bump (`mark_item_ready`), `start_preparation`,
/// `complete`, `recall` — travels the same route with its own `commandType`;
/// the ticket is named by `kitchenOrderId` and the individual lines by
/// `itemIds`, which is what makes "one item is done" different from "the
/// ticket is done".
abstract interface class KitchenCommandRepository {
  /// The till's own command route.
  ///
  /// The iPad route (`POST /api/kds/command`) scopes a ticket by the DEVICE's
  /// own station, and a POS terminal is station-less: the live call answered
  /// `404 ticket_not_found` for a ticket this very board was displaying.
  /// `POST …/kitchen/command` scopes by the LOCATION the operator is signed
  /// into and by their operator session, which is exactly what the board above
  /// it shows. Recorded as defect D33.
  Future<KitchenCommandResult> command(
    String merchantId,
    PosKitchenCommandRequest request,
  );
}

final class ApiKitchenStatusRepository
    implements KitchenStatusRepository, KitchenCommandRepository {
  const ApiKitchenStatusRepository(this._api);
  final ApiClient _api;

  @override
  Future<PosKitchenStatusResult> status(
    String merchantId,
    String sourceOrderId,
    PosKitchenOrderQuery query,
  ) async => PosKitchenStatusResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posKitchenOrder(merchantId, sourceOrderId),
        queryParameters: query.toJson().map(
          (key, value) => MapEntry(key, value.toString()),
        ),
      ).toString(),
    ),
  );

  @override
  Future<KitchenCommandResult> command(
    String merchantId,
    PosKitchenCommandRequest request,
  ) async {
    final response = await _api.request(
      method: ApiMethod.post,
      // No extra header: this route authenticates the way every other POS
      // route does, with the session the ApiClient already carries.
      path: UmiRoutes.posKitchenCommand(merchantId),
      body: request.toJson(),
      // The till may retry a lost response: `commandId` and `idempotencyKey`
      // are the same, so the server replays its own outcome instead of
      // bumping the same dish twice.
      idempotent: true,
    );
    final data = response['data'];
    if (data is! Map<String, Object?>) {
      throw const AppException(
        category: AppErrorCategory.server,
        code: 'KITCHEN_COMMAND_INVALID_RESPONSE',
        recoverable: true,
      );
    }
    return KitchenCommandResult.fromJson(data);
  }
}
