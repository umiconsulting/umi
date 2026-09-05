import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/app/activity_listener.dart';

void main() {
  testWidgets('a pointer press reports activity', (tester) async {
    var activity = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ActivityListener(
          onActivity: () => activity += 1,
          child: const SizedBox.expand(child: Text('till')),
        ),
      ),
    );

    await tester.tap(find.text('till'));
    await tester.tap(find.text('till'));

    expect(activity, 2);
  });

  testWidgets('activity reporting does not swallow the tap', (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ActivityListener(
          onActivity: () {},
          child: Center(
            child: ElevatedButton(
              onPressed: () => taps += 1,
              child: const Text('Cobrar'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Cobrar'));

    expect(taps, 1);
  });
}
