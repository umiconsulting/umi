import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

void main() {
  testWidgets('initial text survives validation, save and reset', (
    tester,
  ) async {
    final form = GlobalKey<FormState>();
    String? saved;
    await tester.pumpWidget(
      PosApp(
        home: PosPage(
          body: Form(
            key: form,
            child: PosFormField(
              initialValue: 'Impresora principal',
              decoration: const PosFieldDecoration(labelText: 'Nombre'),
              validator: (value) =>
                  value?.isEmpty ?? true ? 'Escribe un nombre' : null,
              onSaved: (value) => saved = value,
            ),
          ),
        ),
      ),
    );
    expect(find.text('Impresora principal'), findsOneWidget);
    await tester.enterText(find.byType(EditableText), '');
    expect(form.currentState!.validate(), isFalse);
    await tester.pump();
    expect(find.text('Escribe un nombre'), findsOneWidget);
    await tester.enterText(find.byType(EditableText), 'Impresora barra');
    expect(form.currentState!.validate(), isTrue);
    form.currentState!.save();
    expect(saved, 'Impresora barra');
    form.currentState!.reset();
    await tester.pump();
    expect(find.text('Impresora principal'), findsOneWidget);
    form.currentState!.save();
    expect(saved, 'Impresora principal');
    expect(find.text('Escribe un nombre'), findsNothing);
  });

  testWidgets(
    'external text and replacement keep the form value synchronized',
    (tester) async {
      final first = TextEditingController(text: 'USB');
      final second = TextEditingController(text: 'Red');
      addTearDown(first.dispose);
      addTearDown(second.dispose);
      final field = GlobalKey<FormFieldState<String>>();
      Widget surface(TextEditingController? controller) => PosApp(
        home: PosPage(
          body: PosFormField(key: field, controller: controller),
        ),
      );
      await tester.pumpWidget(surface(first));
      first.text = 'Bluetooth';
      await tester.pump();
      expect(field.currentState!.value, 'Bluetooth');
      await tester.pumpWidget(surface(second));
      expect(field.currentState!.value, 'Red');
      second.text = 'Wi-Fi';
      await tester.pump();
      expect(field.currentState!.value, 'Wi-Fi');
      await tester.pumpWidget(surface(null));
      expect(find.text('Wi-Fi'), findsOneWidget);
      await tester.enterText(find.byType(EditableText), 'Local');
      field.currentState!.reset();
      await tester.pump();
      expect(find.text('Wi-Fi'), findsOneWidget);
      expect(field.currentState!.value, 'Wi-Fi');
      await tester.pumpWidget(const SizedBox.shrink());
      first.text = 'El propietario conserva su controlador';
      second.text = 'El propietario conserva su controlador';
      expect(tester.takeException(), isNull);
    },
  );
}
