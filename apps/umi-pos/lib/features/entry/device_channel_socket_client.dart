import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as socket_io;

import '../../core/security/credential_vault.dart';
import 'pairing_socket_client.dart';

/// The tender-attempt nudge, and the one event this channel carries.
///
/// The API declares it in `packages/contract/src/realtime-channels.ts`
/// (`REALTIME_EVENT_TENDER_ATTEMPT_CHANGED`), beside the namespace this file takes
/// from `pairing_socket_client.dart`. The contract generator emits models and
/// routes only, so the string is mirrored here by hand exactly as the pairing
/// event is, and `test/realtime_contract_test.dart` fails the moment it drifts.
const String tenderAttemptChangedEvent = 'tender.attempt.changed';

/// A tender attempt moved, in the IDS-ONLY shape the contract declares.
///
/// No amount, no provider status and no proof: those are re-read over REST from
/// the row itself, so a socket can never disagree with the money. Nothing here is
/// presented to anyone either — it decides WHICH attempt to re-read, and that read
/// is the one the poll would have made.
final class TenderAttemptNudge {
  const TenderAttemptNudge({
    required this.merchantId,
    required this.attemptId,
    required this.commandIdentity,
    required this.cartId,
  });

  final String merchantId;

  /// The attempt's own id: the one identity the till may not have known.
  final String attemptId;

  /// The identity the capture ran under. Nullable in the contract, because an
  /// attempt recorded outside the till's own capture path can carry none — which
  /// is why [matches] accepts the attempt id as well.
  final String? commandIdentity;
  final String cartId;

  /// Whether this nudge is about the attempt a screen is following.
  ///
  /// Either identity is enough. The command identity is the one the till chose
  /// and the capture sent; the attempt id is what the row came back as, so a
  /// nudge whose sender had no command identity can still be recognised.
  bool matches({required String identity, String? attemptId}) =>
      commandIdentity == identity ||
      (attemptId != null && this.attemptId == attemptId);

  /// Reads one event's payload, or null when it is not a nudge to act on.
  ///
  /// A payload missing an id, or shaped like a string or a list, is DROPPED
  /// rather than guessed at. The nudge is a wake-up, so the only cost of ignoring
  /// one is the poll that was always going to happen: a version skew — a newer
  /// server, an older till — is a slower sale and never a wrong one.
  static TenderAttemptNudge? fromJson(Object? data) {
    if (data is! Map<String, Object?>) return null;
    final merchantId = data['merchantId'];
    final attemptId = data['attemptId'];
    final cartId = data['cartId'];
    if (merchantId is! String || attemptId is! String || cartId is! String) {
      return null;
    }
    final commandIdentity = data['commandIdentity'];
    return TenderAttemptNudge(
      merchantId: merchantId,
      attemptId: attemptId,
      commandIdentity: commandIdentity is String ? commandIdentity : null,
      cartId: cartId,
    );
  }
}

/// Where the handshake's three values come from.
///
/// `CredentialVault.deviceIdentity` answers exactly this: the installation id,
/// plus the public id and credential the app's REST calls already carry.
typedef DeviceIdentityReader = Future<DeviceIdentity> Function();

/// Watches the merchant's tender attempts for THIS registered till.
///
/// The same doctrine as the pairing socket beside it: a nudge is a wake-up and
/// never a delivery gate. An event says an attempt moved and nothing more, and the
/// caller re-reads the attempt over REST. The poll at `queryAfterSeconds` stays
/// the delivery path, so a dropped socket, a refused handshake, a server restart
/// or a missed event costs LATENCY and never a resolution.
///
/// A till with no device credential is never connected. The handshake presents
/// the very credential its REST calls present, so a device that has not paired has
/// nothing to present — and no card terminal to be told about.
abstract interface class DeviceChannelSocketClient {
  /// Emits once per tender attempt change in this device's merchant. Meant to be
  /// listened to while a terminal's answer is still owed.
  Stream<TenderAttemptNudge> watch();

  /// Closes the channel now. A later [watch] connects again.
  Future<void> close();
}

/// Socket.IO implementation. It speaks to the `/rt` namespace of the UMI API.
final class SocketIoDeviceChannelClient implements DeviceChannelSocketClient {
  SocketIoDeviceChannelClient({
    required Uri baseUri,
    required DeviceIdentityReader deviceIdentity,
    Duration initialBackoff = const Duration(seconds: 1),
    Duration maximumBackoff = const Duration(seconds: 30),
    Random? random,
  }) : _baseUri = baseUri,
       _readIdentity = deviceIdentity,
       _initialBackoff = initialBackoff,
       _maximumBackoff = maximumBackoff,
       _random = random ?? Random();

  final Uri _baseUri;
  final DeviceIdentityReader _readIdentity;

  /// The floor and the ceiling of the reconnect schedule. The ceiling is what
  /// keeps a register from living in a connect loop, and the sequence between
  /// them is what makes a reconnect a retry rather than a hammer.
  final Duration _initialBackoff;
  final Duration _maximumBackoff;

  /// Spreads a fleet's reconnects. A café's registers come back from the same
  /// outage at the same moment and the API counts handshakes per address, so two
  /// tills that both wait exactly one second are two tills knocking together.
  final Random _random;

  StreamController<TenderAttemptNudge>? _controller;
  socket_io.Socket? _socket;
  Timer? _retryTimer;
  int _attempt = 0;
  bool _connecting = false;

  /// Whether a socket is open right now. The test that proves a device with no
  /// credential never opens one watches the decision itself rather than a log.
  @visibleForTesting
  bool get hasSocket => _socket != null;

  @override
  Stream<TenderAttemptNudge> watch() {
    final existing = _controller;
    if (existing != null && !existing.isClosed) return existing.stream;
    // ONE CONNECTION PER WATCH, AND NONE WHILE NOBODY LISTENS: a screen that is
    // not waiting on a terminal holds no socket, and cancelling the last listener
    // takes it down. A connection dropped mid-wait is retried by this client, so
    // the caller never has to know the socket existed.
    //
    // Closed by `_shutdown`, which is where the last listener's cancel lands. The
    // lint only reads the one method that creates the controller.
    // ignore: close_sinks
    final controller = StreamController<TenderAttemptNudge>.broadcast(
      onListen: () => unawaited(_connect()),
      onCancel: () => unawaited(_shutdown()),
    );
    _controller = controller;
    return controller.stream;
  }

  /// Bring the channel up for the credential this device holds NOW.
  ///
  /// The credential is re-read on every attempt rather than captured once: the
  /// API refuses a device whose credential must be rotated, and the REST path is
  /// what rotates it — so a socket holding its first credential would be the one
  /// part of the app that could never come back.
  Future<void> _connect() async {
    if (_connecting || _socket != null) return;
    final controller = _controller;
    if (controller == null || controller.isClosed) return;

    _connecting = true;
    DeviceIdentity? identity;
    try {
      identity = await _readIdentity();
    } on Object {
      // A vault that cannot be read is, for this channel, a device with no
      // credential. Silent on purpose: the poll is the delivery path.
      identity = null;
    } finally {
      _connecting = false;
    }

    // NEVER A SOCKET WITHOUT A CREDENTIAL, and no retry without one either. The
    // handshake presents the credential the REST calls already carry, so a till
    // that has not paired has nothing to present — and no card terminal to be
    // told about. There is no loop to keep here, and a sale that is somehow
    // already in flight is carried by its own poll.
    if (identity == null || !identity.isEnrolled) return;
    if (controller.isClosed || !identical(controller, _controller)) return;

    final socket = socket_io.io(
      _baseUri.resolve(realtimeNamespace).toString(),
      socket_io.OptionBuilder()
          .setTransports(<String>['websocket'])
          .setAuth(<String, String>{
            'publicId': identity.publicId!,
            'installationId': identity.installationId,
            'credential': identity.credential!,
          })
          // The library's own reconnect is OFF. This client owns the schedule so
          // that it can re-read the credential between attempts and space them
          // out; two loops would be two sockets, one of them holding a stale
          // token.
          .disableReconnection()
          .enableForceNew()
          .build(),
    );
    _socket = socket;

    socket.on(tenderAttemptChangedEvent, (data) {
      final nudge = TenderAttemptNudge.fromJson(data);
      // A broadcast controller with no listeners drops the event, which is the
      // right answer for a nudge nobody is waiting on.
      if (nudge == null || controller.isClosed) return;
      controller.add(nudge);
    });
    // A live connection resets the schedule: a till that reconnects once an hour
    // retries at the floor the next time rather than where it left off.
    socket.onConnect((_) => _attempt = 0);
    socket.onDisconnect((_) => _dropped(socket));
    socket.onConnectError((_) => _dropped(socket));
    socket.onError((_) => _dropped(socket));
  }

  /// The connection is gone. Schedule ONE retry, never a loop.
  ///
  /// `identical` against the live socket is what makes this idempotent: a
  /// transport failure raises `connect_error` and then `error`, and a socket this
  /// client has already let go must not be able to schedule a second attempt for
  /// a connection that no longer exists.
  ///
  /// A REFUSED handshake is retried here, unlike the pairing channel's, which
  /// stops because a pairing session that was refused cannot start working again.
  /// This one presents the credential the REST calls carry, and the REST path is
  /// what rotates it — so the next attempt can be the one that works.
  void _dropped(socket_io.Socket socket) {
    if (!identical(socket, _socket)) return;
    _socket = null;
    socket.dispose();
    final controller = _controller;
    if (controller == null || controller.isClosed) return;
    if (_retryTimer != null) return;
    final delay = backoffFor(_attempt);
    _attempt++;
    _retryTimer = Timer(delay, () {
      _retryTimer = null;
      unawaited(_connect());
    });
  }

  /// How long to wait before the next reconnect attempt.
  ///
  /// Doubling from [initialBackoff] and capped at [maximumBackoff], then halved
  /// and jittered inside that half, so the result is never zero and never above
  /// the ceiling. The jitter is the fleet's protection, not this register's:
  /// attempts spread out, the average rate does not change.
  @visibleForTesting
  Duration backoffFor(int attempt) {
    var delay = _initialBackoff;
    for (var index = 0; index < attempt && delay < _maximumBackoff; index++) {
      delay *= 2;
    }
    if (delay > _maximumBackoff) delay = _maximumBackoff;
    final half = delay ~/ 2;
    return half +
        Duration(microseconds: _random.nextInt(half.inMicroseconds + 1));
  }

  /// Detach: drop the socket, cancel the schedule, close the stream. A later
  /// [watch] starts again from the floor.
  Future<void> _shutdown() async {
    _retryTimer?.cancel();
    _retryTimer = null;
    _attempt = 0;
    final socket = _socket;
    _socket = null;
    socket?.dispose();
    final controller = _controller;
    _controller = null;
    if (controller == null || controller.isClosed) return;
    await controller.close();
  }

  @override
  Future<void> close() => _shutdown();
}
