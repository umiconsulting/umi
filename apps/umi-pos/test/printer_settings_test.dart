import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/hardware/hardware_surface.dart';

void main() {
  testWidgets(
    'printer settings shows only receipt preferences and preserves hidden policy',
    (tester) async {
      Map<String, Object?>? saved;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async {
                  saved = await showDialog<Map<String, Object?>>(
                    context: context,
                    builder: (_) => const PrinterSettingsDialog(
                      spanish: true,
                      initial: {
                        'autoPrintReceipt': true,
                        'receiptCopiesDefault': 2,
                        'hardwareRetryLimit': 3,
                        'hardwareHealthIntervalSeconds': 15,
                        'openDrawerOnCashSale': false,
                      },
                    ),
                  );
                },
                child: const Text('Abrir'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Abrir'));
      await tester.pumpAndSettle();

      expect(find.text('Ajustes de impresora'), findsOneWidget);
      expect(find.text('Imprimir el recibo al cobrar'), findsOneWidget);
      expect(find.text('Copias por recibo'), findsOneWidget);
      expect(find.text('Reintentos si falla'), findsNothing);
      expect(find.text('Revisión del estado'), findsNothing);
      final printLabel = tester.getRect(
        find.text('Imprimir el recibo al cobrar'),
      );
      final copiesLabel = tester.getRect(find.text('Copias por recibo'));
      final selector = tester.getRect(find.byType(PosSelect<int>));
      final switchColumn = tester.getRect(
        find.descendant(
          of: find.byType(PosSwitchRow),
          matching: find.byWidgetPredicate(
            (widget) => widget is SizedBox && widget.width == 96,
          ),
        ),
      );
      expect(printLabel.left, copiesLabel.left);
      expect((copiesLabel.center.dy - printLabel.center.dy).round(), 72);
      expect((selector.center.dy - copiesLabel.center.dy).abs(), lessThan(1));
      expect((switchColumn.center.dx - selector.center.dx).abs(), lessThan(1));

      await tester.tap(find.text('Guardar'));
      await tester.pumpAndSettle();
      expect(saved?['receiptCopiesDefault'], 2);
      expect(saved?['hardwareRetryLimit'], 3);
      expect(saved?['hardwareHealthIntervalSeconds'], 15);
      expect(saved?['openDrawerOnCashSale'], false);
    },
  );
}
