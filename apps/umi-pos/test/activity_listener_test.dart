import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/app/activity_listener.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('a pointer press reports activity', (tester) async {
    var activity = 0;
    await tester.pumpWidget(
      PosApp(
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
      PosApp(
        home: ActivityListener(
          onActivity: () {},
          child: Center(
            child: PosButton(
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
