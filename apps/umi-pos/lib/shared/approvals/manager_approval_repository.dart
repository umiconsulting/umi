import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

/// The manager's PIN, turned into a grant the server will spend on ONE act.
///
/// The elevation is not a session and not a role: the server answers with an id, the
/// permission the PIN proved, and the fingerprint of the act it was asked about. The
/// write that follows carries that id back, and the server spends it there — which is
/// why this is a repository of its own instead of four lines inside each surface that
/// needs an approval. Cash movements, cash variances and cancelling a plate the kitchen
/// already started all ask the same question; only the permission and the fingerprint
/// differ, and both are the caller's.
abstract interface class ManagerApprovalRepository {
  Future<ElevationGrantView> approve(ManagerApprovalRequest request);
}

final class ApiManagerApprovalRepository implements ManagerApprovalRepository {
  ApiManagerApprovalRepository(this._api);
  final ApiClient _api;

  @override
  Future<ElevationGrantView> approve(ManagerApprovalRequest request) async =>
      ElevationGrantView.fromJson(
        await _api.request(
          method: ApiMethod.post,
          path: UmiRoutes.managerApproval,
          body: request.toJson(),
        ),
      );
}
