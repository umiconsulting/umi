import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/features/kitchen/hub_command_forwarder.dart';

void main() {
  test('one account stays ordered while another account proceeds', () async {
    final sequencer = HubAccountSequencer();
    final release = Completer<void>();
    final events = <String>[];
    var secondSameAccountDone = false;
    var otherAccountDone = false;

    final first = sequencer.run('account:a', () async {
      events.add('a1-start');
      await release.future;
      events.add('a1-end');
    });
    final second = sequencer
        .run('account:a', () async {
          events.add('a2-start');
        })
        .whenComplete(() => secondSameAccountDone = true);
    final other = sequencer
        .run('account:b', () async {
          events.add('b-start');
        })
        .whenComplete(() => otherAccountDone = true);

    await Future<void>.delayed(Duration.zero);
    expect(otherAccountDone, isTrue);
    expect(secondSameAccountDone, isFalse);
    expect(events, ['a1-start', 'b-start']);

    release.complete();
    await Future.wait([first, second, other]);

    expect(events, ['a1-start', 'b-start', 'a1-end', 'a2-start']);
  });

  test('a refused account command releases the lane', () async {
    final sequencer = HubAccountSequencer();

    await expectLater(
      sequencer.run<void>('account:a', () async {
        throw StateError('refused');
      }),
      throwsStateError,
    );
    expect(await sequencer.run('account:a', () async => 7), 7);
  });
}
