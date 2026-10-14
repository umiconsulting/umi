import 'package:flutter/semantics.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/sale/sale_surface.dart';

import 'support/fakes.dart';

/// The sheet answers the two gestures an operator expects at the counter: a
/// downward drag moves it, and a drag past the floor distance closes it. The
/// list inside keeps its own drag until it reaches its top.
void main() {
  Widget sheetHost({
    required void Function(BuildContext context) open,
    int items = 12,
  }) => PosApp(
    locale: const Locale('es'),
    supportedLocales: const [Locale('es')],
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    home: Builder(
      builder: (context) => PosPage(
        body: PosButton(
          onPressed: () => open(context),
          child: const Text('Abrir'),
        ),
      ),
    ),
  );

  Future<void> openTestSheet(BuildContext context, {int items = 12}) =>
      showPosSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (_) => SizedBox(
          height: 420,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Cliente actual'),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: items,
                  itemBuilder: (context, index) =>
                      SizedBox(height: 64, child: Text('Cliente ${index + 1}')),
                ),
              ),
            ],
          ),
        ),
      );

  testWidgets('a downward drag on the panel closes the sheet', (tester) async {
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
    expect(find.text('Cliente actual'), findsOneWidget);

    await tester.drag(find.text('Cliente actual'), const Offset(0, 320));
    await tester.pumpAndSettle();

    expect(find.text('Cliente actual'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a downward drag on the list at its top closes the sheet', (
    tester,
  ) async {
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    await tester.drag(find.text('Cliente 3'), const Offset(0, 320));
    await tester.pumpAndSettle();

    expect(find.text('Cliente actual'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a short drag returns the sheet and keeps it open', (
    tester,
  ) async {
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    final before = tester.getRect(find.text('Cliente actual'));
    await tester.drag(find.text('Cliente actual'), const Offset(0, 40));
    await tester.pumpAndSettle();

    expect(find.text('Cliente actual'), findsOneWidget);
    expect(tester.getRect(find.text('Cliente actual')), before);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a scrolled list keeps its own drag', (tester) async {
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    // Push the list off its top, then pull down over it. The list moves; the
    // sheet is not the gesture's owner.
    await tester.drag(find.text('Cliente 1'), const Offset(0, -240));
    await tester.pumpAndSettle();
    expect(find.text('Cliente 1'), findsNothing);

    await tester.drag(find.text('Cliente 6'), const Offset(0, 400));
    await tester.pumpAndSettle();

    expect(find.text('Cliente actual'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an upward drag never closes the sheet', (tester) async {
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    await tester.drag(find.text('Cliente actual'), const Offset(0, -400));
    await tester.pumpAndSettle();

    expect(find.text('Cliente actual'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the handle pulls the sheet down whatever the list is doing', (
    tester,
  ) async {
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    // Take the list off its top first: the handle is the one grip that does not
    // care.
    await tester.drag(find.text('Cliente 1'), const Offset(0, -240));
    await tester.pumpAndSettle();

    await tester.drag(find.byType(PosSheetDragHandle), const Offset(0, 320));
    await tester.pumpAndSettle();

    expect(find.text('Cliente actual'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the handle names its close action for assistive technology', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await tester.pumpWidget(
      sheetHost(open: (context) => openTestSheet(context)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    final handle = tester.getSemantics(find.byType(PosSheetDragHandle));
    expect(handle.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
    expect(handle.getSemanticsData().label, 'Cerrar');
    expect(tester.takeException(), isNull);
    semantics.dispose();
  });

  testWidgets('the customer picker opens without the keyboard', (tester) async {
    final root = testRoot();
    await tester.pumpWidget(
      sheetHost(open: (context) => showCustomerPicker(context, root.sales)),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();

    expect(find.byType(PosSheetDragHandle), findsOneWidget);
    final fields = find.byType(EditableText);
    expect(fields, findsOneWidget);
    expect(tester.widget<EditableText>(fields).focusNode.hasFocus, isFalse);
    expect(tester.testTextInput.isVisible, isFalse);

    // The field still answers the operator who taps it.
    await tester.tap(fields);
    await tester.pumpAndSettle();
    expect(tester.widget<EditableText>(fields).focusNode.hasFocus, isTrue);
    expect(tester.takeException(), isNull);
  });
}
