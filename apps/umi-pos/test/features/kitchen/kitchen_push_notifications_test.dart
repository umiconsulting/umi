import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/features/kitchen/kitchen_push_notifications.dart';

void main() {
  const first = (merchantId: 'merchant-1', operatorSessionId: 'operator-1');
  const second = (merchantId: 'merchant-1', operatorSessionId: 'operator-2');

  test(
    'registers the current operator and refreshes a rotated token',
    () async {
      final api = _FakeApi();
      final transport = _FakeTransport();
      final service = KitchenPushNotifications(
        api: api,
        transport: transport,
        onNotice: (_) {},
      );

      await service.updateSession(first);
      expect(api.calls, hasLength(1));
      expect(api.calls.single.method, ApiMethod.post);
      expect(api.calls.single.body, {
        'token': 'token-1',
        'platform': 'android',
        'operatorSessionId': 'operator-1',
      });

      await service.updateSession(first);
      expect(api.calls, hasLength(1));
      transport.tokens.add('token-2');
      await Future<void>.delayed(Duration.zero);
      expect(api.calls, hasLength(2));
      expect(api.calls.last.body?['token'], 'token-2');

      service.dispose();
      await transport.dispose();
    },
  );

  test(
    'lock keeps registration; logout removes it before JWT clears',
    () async {
      final api = _FakeApi();
      final transport = _FakeTransport();
      final service = KitchenPushNotifications(
        api: api,
        transport: transport,
        onNotice: (_) {},
      );

      await service.updateSession(first);
      await service.updateSession(null);
      expect(
        api.calls.where((call) => call.method == ApiMethod.delete),
        isEmpty,
      );

      await service.updateSession(second);
      expect(api.calls.last.body?['operatorSessionId'], 'operator-2');
      await service.unregister();
      expect(api.calls.last.method, ApiMethod.delete);
      expect(api.calls.last.body, {
        'token': 'token-1',
        'operatorSessionId': 'operator-2',
      });

      service.dispose();
      await transport.dispose();
    },
  );

  test('only ready kitchen events notify an active operator', () async {
    final api = _FakeApi();
    final transport = _FakeTransport();
    final notices = <KitchenPushNotice>[];
    final service = KitchenPushNotifications(
      api: api,
      transport: transport,
      onNotice: notices.add,
    );

    await service.updateSession(first);
    transport.messages.add({
      'type': 'kitchen_item_ready',
      'sourceOrderId': 'order-1',
      'notificationBody': 'Pizza está lista para entregar',
    });
    transport.messages.add({'type': 'other', 'sourceOrderId': 'order-1'});
    await Future<void>.delayed(Duration.zero);
    expect(notices, hasLength(1));
    expect(notices.single.sourceOrderId, 'order-1');
    expect(notices.single.message, 'Pizza está lista para entregar');

    await service.updateSession(null);
    transport.messages.add({
      'type': 'kitchen_order_ready',
      'sourceOrderId': 'order-1',
    });
    await Future<void>.delayed(Duration.zero);
    expect(notices, hasLength(1));

    service.dispose();
    await transport.dispose();
  });

  test('registration retries after notification permission changes', () async {
    final api = _FakeApi();
    final transport = _FakeTransport()..allowed = false;
    final service = KitchenPushNotifications(
      api: api,
      transport: transport,
      onNotice: (_) {},
    );

    await service.updateSession(first);
    expect(api.calls, isEmpty);
    transport.allowed = true;
    await service.updateSession(first);
    expect(api.calls, hasLength(1));

    service.dispose();
    await transport.dispose();
  });

  test(
    'opening a system notification carries its account to the till',
    () async {
      final api = _FakeApi();
      final transport = _FakeTransport()
        ..initial = {
          'type': 'kitchen_item_ready',
          'sourceOrderId': 'order-initial',
          'cartId': 'account-initial',
        };
      final opened = <KitchenPushNotice>[];
      final service = KitchenPushNotifications(
        api: api,
        transport: transport,
        onNotice: (_) {},
        onOpen: opened.add,
      );

      await service.updateSession(first);
      transport.opened.add({
        'type': 'kitchen_order_ready',
        'sourceOrderId': 'order-next',
        'cartId': 'account-next',
      });
      await Future<void>.delayed(Duration.zero);
      expect(opened.map((notice) => notice.cartId), [
        'account-initial',
        'account-next',
      ]);

      service.dispose();
      await transport.dispose();
    },
  );
}

final class _Call {
  const _Call(this.method, this.path, this.body);
  final ApiMethod method;
  final String path;
  final Map<String, Object?>? body;
}

final class _FakeApi implements ApiClient {
  final calls = <_Call>[];

  @override
  Future<Map<String, Object?>> request({
    required ApiMethod method,
    required String path,
    Map<String, Object?>? body,
    CancellationToken? cancellation,
    bool idempotent = false,
    bool authRefresh = true,
    Map<String, String>? extraHeaders,
  }) async {
    calls.add(_Call(method, path, body));
    return {};
  }

  @override
  void dispose() {}
}

final class _FakeTransport implements KitchenPushTransport {
  final tokens = StreamController<String>.broadcast();
  final messages = StreamController<Map<String, String>>.broadcast();
  final opened = StreamController<Map<String, String>>.broadcast();
  Map<String, String>? initial;
  bool allowed = true;

  @override
  Future<bool> initializeAndAuthorize() async => allowed;

  @override
  Future<String?> getToken() async => 'token-1';

  @override
  Stream<String> get tokenChanges => tokens.stream;

  @override
  Stream<Map<String, String>> get foregroundMessages => messages.stream;

  @override
  Stream<Map<String, String>> get openedMessages => opened.stream;

  @override
  Future<Map<String, String>?> getInitialMessage() async => initial;

  Future<void> dispose() async {
    await tokens.close();
    await messages.close();
    await opened.close();
  }
}
