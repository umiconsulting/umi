import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/features/entry/device_channel_socket_client.dart';

/// The till's device channel (Phase 3 step 3): the wake-up that makes a waiting
/// card sale resolve in about a second instead of at the terminal's own
/// `queryAfterSeconds`.
///
/// The socket itself is not exercised here — a test cannot open a real one — and
/// it does not need to be: what decides whether the channel is worth listening to
/// is the payload it accepts, the attempt it says an event is about, whether a
/// device without a credential connects at all, and how it spaces a reconnect.
const _baseUri = 'https://api.example.test';

SocketIoDeviceChannelClient _client({
  DeviceIdentityReader? deviceIdentity,
  Random? random,
  Duration initialBackoff = const Duration(seconds: 1),
  Duration maximumBackoff = const Duration(seconds: 30),
}) => SocketIoDeviceChannelClient(
  baseUri: Uri.parse(_baseUri),
  deviceIdentity:
      deviceIdentity ??
      () async => const DeviceIdentity(installationId: 'installation-1'),
  random: random,
  initialBackoff: initialBackoff,
  maximumBackoff: maximumBackoff,
);

void main() {
  test('a nudge names an attempt, and carries nothing that is money', () {
    final nudge = TenderAttemptNudge.fromJson(<String, Object?>{
      'merchantId': 'merchant-1',
      'attemptId': 'attempt-1',
      'commandIdentity': 'cart-1:card_terminal',
      'cartId': 'cart-1',
    });

    expect(nudge, isNotNull);
    expect(nudge!.merchantId, 'merchant-1');
    expect(nudge.attemptId, 'attempt-1');
    expect(nudge.commandIdentity, 'cart-1:card_terminal');
    expect(nudge.cartId, 'cart-1');
    // The server's event has no amount, no status and no proof, and nothing here
    // invents one: those are read from the row, so the socket cannot disagree
    // with the money.
  });

  test('a payload this version cannot act on is dropped, never guessed at', () {
    // A command identity is allowed to be absent...
    final withoutIdentity = TenderAttemptNudge.fromJson(<String, Object?>{
      'merchantId': 'merchant-1',
      'attemptId': 'attempt-1',
      'commandIdentity': null,
      'cartId': 'cart-1',
    });
    expect(withoutIdentity, isNotNull);
    expect(withoutIdentity!.commandIdentity, isNull);

    // ...but an id that is missing or not a string is not a nudge at all. The
    // cost of dropping one is the poll that was always going to happen; the cost
    // of guessing is a read for an attempt nobody named.
    expect(TenderAttemptNudge.fromJson(null), isNull);
    expect(TenderAttemptNudge.fromJson('tender.attempt.changed'), isNull);
    expect(TenderAttemptNudge.fromJson(<Object?>[]), isNull);
    expect(
      TenderAttemptNudge.fromJson(<String, Object?>{
        'merchantId': 'merchant-1',
        'commandIdentity': null,
        'cartId': 'cart-1',
      }),
      isNull,
      reason: 'an event with no attempt id cannot be acted on',
    );
    expect(
      TenderAttemptNudge.fromJson(<String, Object?>{
        'merchantId': 'merchant-1',
        'attemptId': 17,
        'cartId': 'cart-1',
      }),
      isNull,
      reason: 'an id that is not a string is not an id',
    );
  });

  test('a nudge is about one attempt, by either identity', () {
    final nudge = TenderAttemptNudge.fromJson(<String, Object?>{
      'merchantId': 'merchant-1',
      'attemptId': 'attempt-1',
      'commandIdentity': 'cart-1:card_terminal',
      'cartId': 'cart-1',
    })!;

    // The identity the capture chose, and the identity the row answers with.
    expect(nudge.matches(identity: 'cart-1:card_terminal'), isTrue);
    expect(
      nudge.matches(identity: 'someone-elses', attemptId: 'attempt-1'),
      isTrue,
    );
    // Another sale's card is another sale's: nothing matches a nudge about it.
    expect(nudge.matches(identity: 'cart-2:card_terminal'), isFalse);
    expect(
      nudge.matches(identity: 'cart-2:card_terminal', attemptId: 'attempt-2'),
      isFalse,
    );

    // An event whose sender had no command identity is still this attempt when
    // the attempt id says so.
    final identityless = TenderAttemptNudge.fromJson(<String, Object?>{
      'merchantId': 'merchant-1',
      'attemptId': 'attempt-1',
      'commandIdentity': null,
      'cartId': 'cart-1',
    })!;
    expect(identityless.matches(identity: 'cart-1:card_terminal'), isFalse);
    expect(
      identityless.matches(
        identity: 'cart-1:card_terminal',
        attemptId: 'attempt-1',
      ),
      isTrue,
    );
  });

  test('a device with no credential never opens a socket', () async {
    // The handshake presents the credential the REST calls carry, so an install
    // that has not paired has nothing to present — and the poll carries any sale
    // that is somehow in flight.
    var reads = 0;
    final client = _client(
      deviceIdentity: () async {
        reads++;
        return const DeviceIdentity(
          installationId: 'installation-1',
          deviceId: 'device-1',
          publicId: 'public-1',
          // No credential: the row exists, and the secret does not.
        );
      },
    );
    final subscription = client.watch().listen((_) {});

    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    // It woke up and looked — and then refused to connect.
    expect(reads, 1);
    expect(client.hasSocket, isFalse);

    await subscription.cancel();
    await client.close();
    expect(client.hasSocket, isFalse);
  });

  test('a vault that cannot be read is a device with no credential', () async {
    var reads = 0;
    final client = _client(
      deviceIdentity: () async {
        reads++;
        throw StateError('no keystore');
      },
    );
    final subscription = client.watch().listen((_) {});

    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
    // No socket, and no rethrow reaching the screen: the wait is unchanged.
    expect(reads, 1);
    expect(client.hasSocket, isFalse);

    await subscription.cancel();
    await client.close();
  });

  test('a reconnect is spaced out, capped, and never zero', () {
    final client = _client(random: Random(7));

    // The window doubles from the floor, and the drawn delay is inside it.
    expect(
      client.backoffFor(0),
      greaterThanOrEqualTo(const Duration(milliseconds: 500)),
    );
    expect(client.backoffFor(0), lessThanOrEqualTo(const Duration(seconds: 1)));
    expect(
      client.backoffFor(2),
      greaterThanOrEqualTo(const Duration(seconds: 2)),
    );
    expect(client.backoffFor(2), lessThanOrEqualTo(const Duration(seconds: 4)));

    // The ceiling holds however long the outage runs: a register sleeps at most
    // half a minute between attempts, and never reaches a zero-delay loop.
    for (final attempt in <int>[0, 1, 5, 40, 4000]) {
      final delay = client.backoffFor(attempt);
      expect(delay, greaterThan(Duration.zero));
      expect(delay, lessThanOrEqualTo(const Duration(seconds: 30)));
    }
    expect(
      client.backoffFor(4000),
      greaterThanOrEqualTo(const Duration(seconds: 15)),
      reason: 'a capped wait is still a wait, not a spin',
    );

    // The jitter is real: a café's registers do not come back in lockstep.
    final draws = <Duration>{for (var i = 0; i < 40; i++) client.backoffFor(9)};
    expect(draws.length, greaterThan(1));
  });
}
