import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/features/kitchen/kitchen_status_repository.dart';

final class _KitchenApi implements ApiClient {
  ApiMethod? method;
  String? path;

  @override
  void dispose() {}

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
  }) async {
    this.method = method;
    this.path = path;
    return {
      'kitchenOrderId': '00000000-0000-4000-8000-000000000010',
      'sourceOrderId': '00000000-0000-4000-8000-000000000011',
      'publicReference': '1024',
      'status': 'ready',
      'priority': 'normal',
      'version': 4,
      'stationIds': ['00000000-0000-4000-8000-000000000012'],
      'updatedAt': '2026-08-09T12:00:00.000Z',
    };
  }
}

void main() {
  test('POS reads the safe authoritative kitchen status', () async {
    final api = _KitchenApi();
    final result = await ApiKitchenStatusRepository(api).status(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000011',
      const PosKitchenOrderQuery(
        locationId: '00000000-0000-4000-8000-000000000002',
        operatorSessionId: '00000000-0000-4000-8000-000000000003',
      ),
    );

    expect(result.status, 'ready');
    expect(api.method, ApiMethod.get);
    expect(api.path, contains('/api/v1/pos/merchants/'));
    expect(api.path, contains('locationId='));
  });
}
