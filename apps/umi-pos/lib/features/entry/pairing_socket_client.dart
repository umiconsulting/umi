import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../../core/security/credential_vault.dart';

/// The realtime namespace and the pairing event name.
///
/// The API declares both in `packages/contract/src/realtime.ts`. The contract
/// generator emits models and routes only, so these two strings are mirrored
/// here by hand and must change together with the contract.
const String realtimeNamespace = '/rt';
const String pairingChangedEvent = 'device.pairing.changed';

/// Watches one pairing session for state changes.
///
/// The stream is a nudge channel. An event says only that the pairing state
/// moved; it carries no device and no credential, so the caller must poll to
/// collect one. The poll route stays the single credential-delivery gate.
abstract interface class PairingSocketClient {
  Stream<void> watch({
    required PairingIdentity pairing,
    required String installationId,
  });

  Future<void> close();
}

/// Socket.IO implementation. It speaks to the `/rt` namespace of the UMI API.
final class SocketIoPairingClient implements PairingSocketClient {
  SocketIoPairingClient({required Uri baseUri}) : _baseUri = baseUri;

  final Uri _baseUri;
  socket_io.Socket? _socket;

  @override
  Stream<void> watch({
    required PairingIdentity pairing,
    required String installationId,
  }) {
    late final StreamController<void> controller;
    controller = StreamController<void>(
      onListen: () => _connect(pairing, installationId, controller),
      onCancel: () async => close(),
    );
    return controller.stream;
  }

  void _connect(
    PairingIdentity pairing,
    String installationId,
    StreamController<void> controller,
  ) {
    final socket = socket_io.io(
      _baseUri.resolve(realtimeNamespace).toString(),
      socket_io.OptionBuilder()
          .setTransports(<String>['websocket'])
          .setAuth(<String, String>{
            'pairingSessionId': pairing.sessionId,
            'pollingCredential': pairing.pollingCredential,
            'installationId': installationId,
          })
          .enableForceNew()
          .build(),
    );
    _socket = socket;

    socket.on(pairingChangedEvent, (_) {
      if (!controller.isClosed) controller.add(null);
    });

    // A refused handshake ends the watch instead of retrying. The server returns
    // one constant refusal, so a retry cannot succeed, and repeated attempts
    // would spend the per-IP handshake budget for nothing. The poll loop keeps
    // the enrollment moving either way.
    socket.onConnectError((_) => unawaited(_endQuietly(controller)));
    socket.onError((_) => unawaited(_endQuietly(controller)));
  }

  Future<void> _endQuietly(StreamController<void> controller) async {
    await close();
    if (!controller.isClosed) await controller.close();
  }

  @override
  Future<void> close() async {
    _socket?.dispose();
    _socket = null;
  }
}
