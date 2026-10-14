import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../../core/network/api_client.dart';

typedef PushSession = ({String merchantId, String operatorSessionId});

final class KitchenPushNotice {
  const KitchenPushNotice({
    required this.type,
    required this.sourceOrderId,
    this.cartId,
    this.message,
  });

  final String type;
  final String sourceOrderId;
  final String? cartId;
  final String? message;

  static KitchenPushNotice? fromData(Map<String, String> data) {
    final type = data['type'];
    final sourceOrderId = data['sourceOrderId'];
    if ((type != 'kitchen_item_ready' && type != 'kitchen_order_ready') ||
        sourceOrderId == null ||
        sourceOrderId.isEmpty) {
      return null;
    }
    return KitchenPushNotice(
      type: type!,
      sourceOrderId: sourceOrderId,
      cartId: data['cartId'],
      message: data['notificationBody'],
    );
  }
}

abstract interface class KitchenPushTransport {
  Future<bool> initializeAndAuthorize();
  Future<String?> getToken();
  Stream<String> get tokenChanges;
  Stream<Map<String, String>> get foregroundMessages;
  Stream<Map<String, String>> get openedMessages;
  Future<Map<String, String>?> getInitialMessage();
}

/// Android entrega la notificación del sistema cuando la app está en segundo
/// plano o cerrada. Flutter sólo presenta el aviso cuando está en primer plano.
final class FirebaseKitchenPushTransport implements KitchenPushTransport {
  FirebaseMessaging? _messaging;

  @override
  Future<bool> initializeAndAuthorize() async {
    await Firebase.initializeApp();
    final messaging = _messaging = FirebaseMessaging.instance;
    final settings = await messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  @override
  Future<String?> getToken() => _messaging!.getToken();

  @override
  Stream<String> get tokenChanges => _messaging!.onTokenRefresh;

  @override
  Stream<Map<String, String>> get foregroundMessages =>
      FirebaseMessaging.onMessage.map(_messageData);

  @override
  Stream<Map<String, String>> get openedMessages =>
      FirebaseMessaging.onMessageOpenedApp.map(_messageData);

  @override
  Future<Map<String, String>?> getInitialMessage() async {
    final message = await _messaging!.getInitialMessage();
    return message == null ? null : _messageData(message);
  }

  static Map<String, String> _messageData(RemoteMessage message) {
    final data = message.data.map(
      (key, value) => MapEntry(key, value.toString()),
    );
    final body = message.notification?.body;
    if (body != null) data['notificationBody'] = body;
    return data;
  }
}

/// Vincula el token al operador presente. El bloqueo automático conserva el
/// registro para avisar con la pantalla apagada; cerrar sesión lo retira.
final class KitchenPushNotifications {
  KitchenPushNotifications({
    required ApiClient api,
    required KitchenPushTransport transport,
    required void Function(KitchenPushNotice) onNotice,
    this.onOpen,
  }) : _api = api,
       _transport = transport,
       _onNotice = onNotice;

  final ApiClient _api;
  final KitchenPushTransport _transport;
  final void Function(KitchenPushNotice) _onNotice;
  final void Function(KitchenPushNotice)? onOpen;
  Future<void> _pending = Future.value();
  Future<bool>? _initialized;
  StreamSubscription<String>? _tokens;
  StreamSubscription<Map<String, String>>? _messages;
  StreamSubscription<Map<String, String>>? _openedMessages;
  PushSession? _desired;
  PushSession? _registered;
  String? _token;
  String? _registeredToken;
  bool _disposed = false;

  Future<void> updateSession(PushSession? session) {
    if (_disposed) return Future.value();
    _desired = session;
    if (session == null) return Future.value();
    return _enqueue(_registerDesired);
  }

  Future<void> _registerDesired() async {
    final session = _desired;
    if (session == null || !await _ensureInitialized()) return;
    final token = _token ?? await _transport.getToken();
    if (token == null || token.isEmpty || _desired != session || _disposed) {
      return;
    }
    _token = token;
    if (_registered == session && _registeredToken == token) return;
    await _api.request(
      method: ApiMethod.post,
      path: _path(session.merchantId),
      body: {
        'token': token,
        'platform': 'android',
        'operatorSessionId': session.operatorSessionId,
      },
      idempotent: true,
    );
    _registered = session;
    _registeredToken = token;
    debugPrint('push.token registration=ok');
  }

  Future<bool> _ensureInitialized() async {
    final allowed = await (_initialized ??= _initialize());
    if (!allowed) _initialized = null;
    return allowed;
  }

  Future<bool> _initialize() async {
    try {
      final allowed = await _transport.initializeAndAuthorize();
      if (!allowed || _disposed) return false;
      _tokens = _transport.tokenChanges.listen((token) {
        _token = token;
        unawaited(_enqueue(_registerDesired).catchError((Object _) {}));
      });
      _messages = _transport.foregroundMessages.listen((data) {
        if (_desired == null || _disposed) return;
        final notice = KitchenPushNotice.fromData(data);
        if (notice != null) _onNotice(notice);
      });
      _openedMessages = _transport.openedMessages.listen((data) {
        final notice = KitchenPushNotice.fromData(data);
        if (notice != null) onOpen?.call(notice);
      });
      final initial = await _transport.getInitialMessage();
      if (initial != null) {
        final notice = KitchenPushNotice.fromData(initial);
        if (notice != null) onOpen?.call(notice);
      }
      return true;
    } catch (error) {
      debugPrint('push.initialization failed=$error');
      return false;
    }
  }

  /// Se llama antes de borrar el JWT. No borra el token de Firebase: otra
  /// persona puede iniciar sesión en el mismo dispositivo después.
  Future<void> unregister() {
    _desired = null;
    return _enqueue(() async {
      final session = _registered;
      final token = _registeredToken;
      _registered = null;
      _registeredToken = null;
      if (session == null || token == null) return;
      await _api.request(
        method: ApiMethod.delete,
        path: _path(session.merchantId),
        body: {'token': token, 'operatorSessionId': session.operatorSessionId},
        idempotent: true,
      );
      debugPrint('push.token registration=removed');
    });
  }

  Future<void> _enqueue(Future<void> Function() action) {
    final next = _pending.then((_) => action());
    _pending = next.catchError((Object _) {});
    return next;
  }

  String _path(String merchantId) =>
      '/api/v1/pos/merchants/${Uri.encodeComponent(merchantId)}/push-tokens';

  void dispose() {
    _disposed = true;
    _desired = null;
    unawaited(_tokens?.cancel());
    unawaited(_messages?.cancel());
    unawaited(_openedMessages?.cancel());
  }
}
