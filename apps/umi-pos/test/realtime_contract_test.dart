import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/entry/pairing_socket_client.dart';

/// The realtime namespace and event name live in `packages/contract`, but the
/// contract generator emits models and routes only — not loose constants. So the
/// two strings are mirrored by hand in `pairing_socket_client.dart`, and a silent
/// drift would leave the device connected to a namespace nobody emits on.
///
/// This reads the contract source and fails the moment the mirror stops matching.
void main() {
  final source = File('../../packages/contract/src/realtime.ts');

  String contractConstant(String name) {
    final match = RegExp("$name = '([^']+)'").firstMatch(source.readAsStringSync());
    expect(match, isNotNull, reason: '$name is no longer declared in the contract');
    return match!.group(1)!;
  }

  test('the mirrored realtime constants match the contract', () {
    expect(source.existsSync(), isTrue, reason: 'contract source moved');
    expect(realtimeNamespace, contractConstant('REALTIME_NAMESPACE'));
    expect(pairingChangedEvent, contractConstant('REALTIME_EVENT_PAIRING_CHANGED'));
  });
}
