import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets(
    'line progress announces known amounts and stops reduced motion',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        Widget surface({bool reduced = false, double? value}) => PosApp(
          home: MediaQuery(
            data: MediaQueryData(disableAnimations: reduced),
            child: PosPage(
              body: Center(child: PosProgress(value: value)),
            ),
          ),
        );
        await tester.pumpWidget(surface());
        await tester.pump(const Duration(milliseconds: 30));
        expect(tester.getSemantics(find.byType(PosProgress)).value, isEmpty);
        expect(tester.binding.transientCallbackCount, greaterThan(0));
        await tester.pumpWidget(surface(reduced: true));
        await tester.pump(const Duration(seconds: 1));
        expect(tester.getSemantics(find.byType(PosProgress)).value, isEmpty);
        expect(tester.binding.transientCallbackCount, 0);
        await tester.pumpWidget(surface(value: .25));
        await tester.pump(const Duration(seconds: 1));
        expect(tester.getSemantics(find.byType(PosProgress)).value, '25%');
        expect(tester.binding.transientCallbackCount, 0);
        await tester.pumpWidget(surface());
        await tester.pump(const Duration(milliseconds: 30));
        expect(tester.binding.transientCallbackCount, greaterThan(0));
        await tester.pumpWidget(const SizedBox.shrink());
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets('reduced and determinate progress stop scheduling frames', (
    tester,
  ) async {
    Widget surface({bool reduced = false, double? progress}) => PosApp(
      home: MediaQuery(
        data: MediaQueryData(disableAnimations: reduced),
        child: PosPage(
          body: Center(child: PosSpinner(value: progress)),
        ),
      ),
    );
    await tester.pumpWidget(surface());
    await tester.pump(const Duration(milliseconds: 20));
    expect(tester.binding.transientCallbackCount, greaterThan(0));
    await tester.pumpWidget(surface(reduced: true));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.binding.transientCallbackCount, 0);
    await tester.pumpWidget(surface(progress: .5));
    await tester.pump(const Duration(seconds: 1));
    expect(tester.binding.transientCallbackCount, 0);
    await tester.pumpWidget(surface());
    await tester.pump(const Duration(milliseconds: 20));
    expect(tester.binding.transientCallbackCount, greaterThan(0));
  });
}
