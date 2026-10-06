import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/entry/device_channel_socket_client.dart';
import 'package:umi_pos/features/entry/pairing_socket_client.dart';

/// The realtime namespace and event names live in `packages/contract`, but the
/// contract generator emits models and routes only — not loose constants. So the
/// strings are mirrored by hand in the two socket clients, and a silent drift
/// would leave the device connected to a namespace nobody emits on, or waiting
/// for an event nobody sends.
///
/// This reads the contract source and fails the moment the mirror stops matching.
void main() {
  // The channel constants are DECLARED in the zero-dep realtime-channels entry (realtime.ts
  // only re-exports them), so read the declarations from there.
  final source = File('../../packages/contract/src/realtime-channels.ts');
  final schemas = File('../../packages/contract/src/realtime.ts');

  String contractConstant(String name) {
    final match = RegExp(
      "$name = '([^']+)'",
    ).firstMatch(source.readAsStringSync());
    expect(
      match,
      isNotNull,
      reason: '$name is no longer declared in the contract',
    );
    return match!.group(1)!;
  }

  test('the mirrored realtime constants match the contract', () {
    expect(source.existsSync(), isTrue, reason: 'contract source moved');
    expect(realtimeNamespace, contractConstant('REALTIME_NAMESPACE'));
    expect(
      pairingChangedEvent,
      contractConstant('REALTIME_EVENT_PAIRING_CHANGED'),
    );
    // The till's own nudge travels the SAME namespace, on the event the API
    // emits into the device room. A till listening for a name the server does not
    // send is the exact failure this file exists to catch.
    expect(
      tenderAttemptChangedEvent,
      contractConstant('REALTIME_EVENT_TENDER_ATTEMPT_CHANGED'),
    );
  });

  /// The nudge's own fields, read from the schema the server validates with.
  ///
  /// The event is IDS ONLY, and the till's parser reads those ids by name. A
  /// renamed field would leave the till ignoring every nudge — a sale that falls
  /// back to the forty-second poll with nothing anywhere saying why — so the names
  /// are pinned here rather than trusted.
  test(
    'the nudge payload the till parses is the one the contract declares',
    () {
      expect(schemas.existsSync(), isTrue, reason: 'contract source moved');
      final contract = schemas.readAsStringSync();
      final block = RegExp(
        r'const TenderAttemptChangedEvent = z\s*\.object\(\{([^}]*)\}\)',
      ).firstMatch(contract);
      expect(
        block,
        isNotNull,
        reason:
            'TenderAttemptChangedEvent is no longer declared in the contract',
      );
      final declared = RegExp(
        r'^\s*([a-zA-Z]+):',
        multiLine: true,
      ).allMatches(block!.group(1)!).map((match) => match.group(1)!).toSet();
      expect(declared, <String>{
        'merchantId',
        'attemptId',
        'commandIdentity',
        'cartId',
      });

      // And a payload shaped exactly like that parses into a nudge.
      final nudge = TenderAttemptNudge.fromJson(<String, Object?>{
        for (final field in declared) field: 'value-1',
      });
      expect(nudge, isNotNull);
      expect(nudge!.attemptId, 'value-1');
      expect(nudge.cartId, 'value-1');
    },
  );
}
