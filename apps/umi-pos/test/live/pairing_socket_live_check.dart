// A live check, not part of `flutter test`. It drives the real Socket.IO client
// against a running UMI API to prove the wire details the fakes cannot: the
// namespace URL, the handshake key names, and the event name.
//
//   1. Start the API and seed a pairing session (see the integration suite).
//   2. dart run test/live/pairing_socket_live_check.dart <baseUrl> <sessionId>
// ignore_for_file: avoid_print — this is an operator-run diagnostic script.
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/features/entry/pairing_socket_client.dart';

void main() {
  final baseUri = Uri.parse(
    const String.fromEnvironment(
      'LIVE_API',
      defaultValue: 'http://127.0.0.1:4099',
    ),
  );
  final sessionId = const String.fromEnvironment(
    'LIVE_SESSION',
    defaultValue: '00000000-0000-4000-8000-00000000dcb0',
  );

  Future<String> attempt({
    required String credential,
    required String installationId,
    required String label,
  }) async {
    final client = SocketIoPairingClient(baseUri: baseUri);
    final pairing = PairingIdentity(
      sessionId: sessionId,
      pollingCredential: credential,
      expiresAt: DateTime.now().add(const Duration(minutes: 5)),
    );
    final completer = Completer<String>();
    late final StreamSubscription<void> sub;
    sub = client
        .watch(pairing: pairing, installationId: installationId)
        .listen(
          (_) {
            if (!completer.isCompleted) completer.complete('NUDGE RECEIVED');
          },
          onDone: () {
            if (!completer.isCompleted) completer.complete('REFUSED');
          },
          onError: (Object _) {
            if (!completer.isCompleted) completer.complete('REFUSED');
          },
        );
    // A socket that stays open past the handshake window was accepted.
    final result = await completer.future.timeout(
      const Duration(seconds: 3),
      onTimeout: () => 'ACCEPTED (open, waiting)',
    );
    await sub.cancel();
    await client.close();
    print('$label -> $result');
    return result;
  }

  test('the real Dart client is admitted only with a valid triplet', () async {
    expect(
      await attempt(
        credential: 'dart-credential',
        installationId: 'dart-installation',
        label: 'valid triplet     ',
      ),
      startsWith('ACCEPTED'),
    );
    expect(
      await attempt(
        credential: 'wrong-credential',
        installationId: 'dart-installation',
        label: 'wrong credential  ',
      ),
      'REFUSED',
    );
    expect(
      await attempt(
        credential: 'dart-credential',
        installationId: 'wrong-installation',
        label: 'wrong installation',
      ),
      'REFUSED',
    );
  }, timeout: const Timeout(Duration(seconds: 60)));
}
