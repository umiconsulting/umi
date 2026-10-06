import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/features/cart/course_control.dart';

/// The till's course control (§8H step 4).
///
/// The board can only group by course if the operator can set one, and the
/// contract can only accept what the control offers: 1..20, one step at a time,
/// on a target a finger can hit. These tests hold the control to that.
Future<List<int>> _pump(
  WidgetTester tester, {
  int course = 1,
  bool enabled = true,
}) async {
  final changes = <int>[];
  await tester.pumpWidget(
    MaterialApp(
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(
        body: CourseControl(
          course: course,
          enabled: enabled,
          onChanged: changes.add,
        ),
      ),
    ),
  );
  await tester.pump();
  return changes;
}

void main() {
  testWidgets('the control states the course it was given', (tester) async {
    await _pump(tester, course: 3);

    expect(tester.widget<Text>(find.byKey(CourseControl.valueKey)).data, '3');
    // The number is a field of a sentence, not a bare digit: a screen reader
    // gets "Course 3", which is what the operator needs to hear.
    expect(find.bySemanticsLabel('Course 3'), findsOneWidget);
    // And both steps are named, so neither is an unlabelled glyph.
    expect(find.byTooltip('Previous course'), findsOneWidget);
    expect(find.byTooltip('Next course'), findsOneWidget);
  });

  testWidgets('each step moves exactly one course', (tester) async {
    final fromOne = await _pump(tester, course: 1);
    await tester.tap(find.byKey(CourseControl.increaseKey));
    expect(fromOne, [2]);

    final fromNine = await _pump(tester, course: 9);
    await tester.tap(find.byKey(CourseControl.decreaseKey));
    expect(fromNine, [8]);
  });

  testWidgets('the course cannot leave the range the contract accepts', (
    tester,
  ) async {
    await _pump(tester, course: CourseControl.minCourse);
    expect(
      tester
          .widget<IconButton>(find.byKey(CourseControl.decreaseKey))
          .onPressed,
      isNull,
    );

    await _pump(tester, course: CourseControl.maxCourse);
    expect(
      tester
          .widget<IconButton>(find.byKey(CourseControl.increaseKey))
          .onPressed,
      isNull,
    );
  });

  testWidgets('a read-only operator gets a control that offers nothing', (
    tester,
  ) async {
    await _pump(tester, course: 2, enabled: false);

    expect(
      tester
          .widget<IconButton>(find.byKey(CourseControl.decreaseKey))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<IconButton>(find.byKey(CourseControl.increaseKey))
          .onPressed,
      isNull,
    );
    // The course is still stated: the operator has to be able to read the line
    // they may not change.
    expect(tester.widget<Text>(find.byKey(CourseControl.valueKey)).data, '2');
  });

  testWidgets('both steps are at least a 44 px target', (tester) async {
    await _pump(tester, course: 2);

    for (final key in [CourseControl.decreaseKey, CourseControl.increaseKey]) {
      final size = tester.getSize(find.byKey(key));
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
    }
  });
}
