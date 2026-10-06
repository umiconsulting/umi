import 'package:umi_contract/umi_contract.dart';

import '../../core/network/api_client.dart';

abstract interface class CustomerValueRepository {
  Future<CustomerSearchResult> search(
    String merchantId,
    CustomerSearchRequest query,
  );
  Future<CustomerProfile> create(
    String merchantId,
    CreateCustomerRequest command,
  );
  Future<CustomerHistoryPage> history(
    String merchantId,
    String customerId,
    CustomerHistoryQuery query,
  );
  Future<CustomerValuePreview> preview(
    String merchantId,
    CustomerValuePreviewRequest command,
  );
  Future<RewardAuthorization> authorizeReward(
    String merchantId,
    RewardAuthorizationRequest command,
  );
  Future<RewardRelease> releaseReward(
    String merchantId,
    ValueReleaseRequest command,
  );
  Future<StoredValueAuthorization> authorizeStoredValue(
    String merchantId,
    StoredValueAuthorizationRequest command,
  );
  Future<StoredValueRelease> releaseStoredValue(
    String merchantId,
    ValueReleaseRequest command,
  );
  Future<GiftCardLookupResult> giftCardLookup(
    String merchantId,
    GiftCardLookupRequest command,
  );
  Future<PointsAdjustmentPreview> previewPointsAdjustment(
    String merchantId,
    PointsAdjustmentRequest command,
  );
  Future<PointsAdjustmentResult> commitPointsAdjustment(
    String merchantId,
    PointsAdjustmentRequest command,
  );
  Future<GiftCardIssuanceResult> issueGiftCard(
    String merchantId,
    GiftCardIssuanceRequest command,
  );
  Future<GiftCardIssuancePreview> previewGiftCardIssuance(
    String merchantId,
    GiftCardIssuanceRequest command,
  );
  Future<GiftCardSecretRevealResult> revealGiftCardSecret(
    String merchantId,
    GiftCardSecretRevealRequest command,
  );
}

final class ApiCustomerValueRepository implements CustomerValueRepository {
  const ApiCustomerValueRepository(this._api);
  final ApiClient _api;

  @override
  Future<CustomerSearchResult> search(
    String merchantId,
    CustomerSearchRequest query,
  ) async => CustomerSearchResult.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCustomers(merchantId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
          'query': query.query ?? '',
          'recent': '${query.recent ?? false}',
          'limit': '${query.limit ?? 20}',
          if (query.cursor != null) 'cursor': query.cursor!,
        },
      ).toString(),
    ),
  );

  @override
  Future<CustomerProfile> create(
    String merchantId,
    CreateCustomerRequest command,
  ) async => CustomerProfile.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCustomerCreate(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<CustomerHistoryPage> history(
    String merchantId,
    String customerId,
    CustomerHistoryQuery query,
  ) async => CustomerHistoryPage.fromJson(
    await _api.request(
      method: ApiMethod.get,
      path: Uri(
        path: UmiRoutes.posCustomerHistory(merchantId, customerId),
        queryParameters: {
          'locationId': query.locationId,
          'operatorSessionId': query.operatorSessionId,
          'category': query.category ?? 'all',
          'limit': '${query.limit ?? 20}',
          if (query.cursor != null) 'cursor': query.cursor!,
          if (query.eventLocationId != null)
            'eventLocationId': query.eventLocationId!,
          if (query.businessDateFrom != null)
            'businessDateFrom': query.businessDateFrom!,
          if (query.businessDateTo != null)
            'businessDateTo': query.businessDateTo!,
        },
      ).toString(),
    ),
  );

  @override
  Future<CustomerValuePreview> preview(
    String merchantId,
    CustomerValuePreviewRequest command,
  ) async => CustomerValuePreview.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posCustomerValuePreview(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<RewardAuthorization> authorizeReward(
    String merchantId,
    RewardAuthorizationRequest command,
  ) async => RewardAuthorization.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posRewardAuthorize(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<RewardRelease> releaseReward(
    String merchantId,
    ValueReleaseRequest command,
  ) async => RewardRelease.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posRewardRelease(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<StoredValueAuthorization> authorizeStoredValue(
    String merchantId,
    StoredValueAuthorizationRequest command,
  ) async => StoredValueAuthorization.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posStoredValueAuthorize(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<StoredValueRelease> releaseStoredValue(
    String merchantId,
    ValueReleaseRequest command,
  ) async => StoredValueRelease.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posStoredValueRelease(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<GiftCardLookupResult> giftCardLookup(
    String merchantId,
    GiftCardLookupRequest command,
  ) async => GiftCardLookupResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posGiftCardLookup(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<PointsAdjustmentPreview> previewPointsAdjustment(
    String merchantId,
    PointsAdjustmentRequest command,
  ) async => PointsAdjustmentPreview.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posPointsAdjustmentPreview(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<PointsAdjustmentResult> commitPointsAdjustment(
    String merchantId,
    PointsAdjustmentRequest command,
  ) async => PointsAdjustmentResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posPointsAdjustmentCommit(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<GiftCardIssuanceResult> issueGiftCard(
    String merchantId,
    GiftCardIssuanceRequest command,
  ) async => GiftCardIssuanceResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posGiftCardIssue(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );

  @override
  Future<GiftCardIssuancePreview> previewGiftCardIssuance(
    String merchantId,
    GiftCardIssuanceRequest command,
  ) async => GiftCardIssuancePreview.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posGiftCardIssuePreview(merchantId),
      body: command.toJson(),
    ),
  );

  @override
  Future<GiftCardSecretRevealResult> revealGiftCardSecret(
    String merchantId,
    GiftCardSecretRevealRequest command,
  ) async => GiftCardSecretRevealResult.fromJson(
    await _api.request(
      method: ApiMethod.post,
      path: UmiRoutes.posGiftCardSecretReveal(merchantId),
      body: command.toJson(),
      idempotent: true,
    ),
  );
}
