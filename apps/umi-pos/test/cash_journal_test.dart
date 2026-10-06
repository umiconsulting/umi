import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/features/cash/cash_journal.dart';

Map<String, Object?> _line({
  required int sequence,
  required String type,
  required int minorUnits,
  int received = 0,
  int change = 0,
  String? receipt,
  String? reason,
  String? note,
  String? operator,
}) => {
  'sequence': sequence,
  'type': type,
  'amount': {'minorUnits': minorUnits, 'currency': 'MXN'},
  'cashReceived': {'minorUnits': received, 'currency': 'MXN'},
  'changeGiven': {'minorUnits': change, 'currency': 'MXN'},
  'saleId': null,
  'receiptNumber': receipt,
  'operatorReference': operator,
  'reasonCode': reason,
  'note': note,
  'occurredAt': '2026-09-29T18:00:00.000Z',
};

Future<void> _pump(WidgetTester tester, List<Map<String, Object?>> lines) =>
    tester.pumpWidget(
      MaterialApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        home: Scaffold(
          body: SingleChildScrollView(child: CashJournal(lines: lines)),
        ),
      ),
    );

void main() {
  testWidgets('says so when the drawer has not moved yet', (tester) async {
    await _pump(tester, const []);
    await tester.pumpAndSettle();
    expect(find.text('Libro del turno'), findsOneWidget);
    expect(find.text('Sin movimientos todavía.'), findsOneWidget);
    expect(find.text('0'), findsOneWidget);
  });

  testWidgets(
    'signs the journal from the entry type, never from the stored amount',
    (tester) async {
      await _pump(tester, [
        _line(sequence: 1, type: 'opening_float', minorUnits: 150000),
        _line(
          sequence: 2,
          type: 'cash_sale',
          minorUnits: 31000,
          received: 50000,
          change: 19000,
          receipt: 'A-1042',
        ),
        _line(
          sequence: 3,
          type: 'paid_out',
          minorUnits: 35000,
          reason: 'hielo',
        ),
        _line(sequence: 4, type: 'safe_drop', minorUnits: 200000),
        _line(
          sequence: 5,
          type: 'cash_refund',
          minorUnits: 12000,
          receipt: 'A-1038',
        ),
        _line(sequence: 6, type: 'count_observation', minorUnits: 342850),
      ]);
      await tester.pumpAndSettle();

      expect(find.text('6'), findsOneWidget); // the count badge
      expect(find.text('Fondo inicial'), findsOneWidget);
      expect(find.text('+MXN 1,500.00'), findsOneWidget);
      expect(find.text('Ventas en efectivo'), findsOneWidget);
      expect(find.text('+MXN 310.00'), findsOneWidget);
      // The line leads with the local time, so match the rest of the detail.
      expect(
        find.textContaining('MXN 500.00 − MXN 190.00 · A-1042'),
        findsOneWidget,
      );
      expect(find.text('−MXN 350.00'), findsOneWidget);
      expect(find.textContaining('hielo'), findsOneWidget);
      expect(find.text('−MXN 2,000.00'), findsOneWidget);
      expect(find.text('Reembolso en efectivo'), findsOneWidget);
      expect(find.text('−MXN 120.00'), findsOneWidget);
      // A count observes the drawer; it does not move money, so it carries no sign.
      expect(find.text('Arqueo'), findsOneWidget);
      expect(find.text('MXN 3,428.50'), findsOneWidget);
    },
  );

  testWidgets('names the operator who caused each line', (tester) async {
    await _pump(tester, [
      _line(
        sequence: 1,
        type: 'paid_out',
        minorUnits: 35000,
        reason: 'proveedor',
        operator: 'Luis M.',
      ),
    ]);
    await tester.pumpAndSettle();
    expect(find.textContaining('proveedor · Luis M.'), findsOneWidget);
  });
}
