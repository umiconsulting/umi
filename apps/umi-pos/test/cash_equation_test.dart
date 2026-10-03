import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/features/cash/cash_equation.dart';
import 'package:umi_pos/features/cash/money_input.dart';

/// The drawer's account, term by term. The backend computes these numbers from
/// the append-only ledger; the till has to show the same line that produced the
/// number, or an operator cannot explain a total they did not expect.
const _expectedCash = {
  'openingFloat': {'minorUnits': 150000, 'currency': 'MXN'},
  'grossCashReceived': {'minorUnits': 482000, 'currency': 'MXN'},
  'changeGiven': {'minorUnits': 62000, 'currency': 'MXN'},
  'netCashSales': {'minorUnits': 420000, 'currency': 'MXN'},
  'paidIn': {'minorUnits': 20000, 'currency': 'MXN'},
  'paidOut': {'minorUnits': 35000, 'currency': 'MXN'},
  'safeDrops': {'minorUnits': 200000, 'currency': 'MXN'},
  'adjustments': {'minorUnits': -500, 'currency': 'MXN'},
  'expectedDrawerCash': {'minorUnits': 354500, 'currency': 'MXN'},
  'currency': 'MXN',
  'ledgerSequence': 17,
};

/// The same shift as a journal. The till rebuilds the terms from these lines, so
/// the fixture has to be a ledger that *produces* `_expectedCash` — otherwise
/// the test would only prove that two hand-written maps agree.
const _ledger = <Map<String, Object?>>[
  {
    'sequence': 1,
    'type': 'opening_float',
    'amount': {'minorUnits': 150000, 'currency': 'MXN'},
  },
  {
    'sequence': 2,
    'type': 'cash_sale',
    'amount': {'minorUnits': 420000, 'currency': 'MXN'},
    'cashReceived': {'minorUnits': 482000, 'currency': 'MXN'},
    'changeGiven': {'minorUnits': 62000, 'currency': 'MXN'},
  },
  {
    'sequence': 3,
    'type': 'paid_in',
    'amount': {'minorUnits': 20000, 'currency': 'MXN'},
  },
  {
    'sequence': 4,
    'type': 'paid_out',
    'amount': {'minorUnits': 35000, 'currency': 'MXN'},
  },
  {
    'sequence': 5,
    'type': 'safe_drop',
    'amount': {'minorUnits': 200000, 'currency': 'MXN'},
  },
  {
    'sequence': 6,
    'type': 'drawer_correction',
    'amount': {'minorUnits': -500, 'currency': 'MXN'},
  },
];

const _account = CashDrawerAccount(
  currency: 'MXN',
  openingFloat: 150000,
  netCashSales: 420000,
  paidIn: 20000,
  paidOut: 35000,
  safeDrops: 200000,
  adjustments: -500,
  sequence: 17,
);

const _policy = {
  'version': 'pilot-1',
  'expiresAt': '2026-10-01T00:00:00.000Z',
  'blindCountRequired': true,
  'varianceTolerance': {'minorUnits': 100, 'currency': 'MXN'},
  'movementApprovalThreshold': {'minorUnits': 5000, 'currency': 'MXN'},
  'closeApprovalThreshold': {'minorUnits': 500, 'currency': 'MXN'},
  'offlineCashShiftAllowed': false,
  'currency': 'MXN',
};

Future<void> _pump(WidgetTester tester, Widget child) => tester.pumpWidget(
  MaterialApp(
    locale: const Locale('es'),
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: const [
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    home: Scaffold(body: SingleChildScrollView(child: child)),
  ),
);

void main() {
  group('the drawer account rebuilt from the journal', () {
    test('matches the equation the API computes for the same lines', () {
      final account = CashDrawerAccount.fromLedger(_ledger);
      expect(account.openingFloat, 150000);
      expect(account.netCashSales, 420000);
      expect(account.paidIn, 20000);
      expect(account.paidOut, 35000);
      expect(account.safeDrops, 200000);
      expect(account.adjustments, -500);
      expect(account.sequence, 6);
      expect(
        account.expectedDrawerCash,
        (_expectedCash['expectedDrawerCash']!
            as Map<String, Object?>)['minorUnits'],
      );
    });

    test('observing entries move nothing', () {
      final account = CashDrawerAccount.fromLedger([
        ..._ledger,
        {
          'sequence': 7,
          'type': 'count_observation',
          'amount': {'minorUnits': 354500, 'currency': 'MXN'},
        },
        {
          'sequence': 8,
          'type': 'variance_resolution',
          'amount': {'minorUnits': 1200, 'currency': 'MXN'},
        },
      ]);
      expect(account.expectedDrawerCash, 354500);
      expect(account.sequence, 8);
    });
  });

  group('the drawer equation', () {
    testWidgets('shows every term and the expected total', (tester) async {
      await _pump(
        tester,
        const CashEquation(account: _account, expectedCash: _expectedCash),
      );
      await tester.pumpAndSettle();

      expect(find.text('La cuenta del cajón'), findsOneWidget);
      expect(find.text('FONDO INICIAL'), findsOneWidget);
      expect(find.text('MXN 1,500.00'), findsWidgets);
      expect(find.text('VENTAS EN EFECTIVO'), findsOneWidget);
      expect(find.text('MXN 4,200.00'), findsOneWidget);
      expect(find.text('INGRESOS'), findsOneWidget);
      expect(find.text('MXN 200.00'), findsOneWidget);
      expect(find.text('RETIROS'), findsOneWidget);
      expect(find.text('−MXN 350.00'), findsOneWidget);
      expect(find.text('CAJA FUERTE'), findsOneWidget);
      expect(find.text('−MXN 2,000.00'), findsOneWidget);
      expect(find.text('MXN 3,545.00'), findsOneWidget);
    });

    testWidgets('carries the sign of a negative adjustment, not the label', (
      tester,
    ) async {
      await _pump(
        tester,
        const CashEquation(account: _account, expectedCash: _expectedCash),
      );
      await tester.pumpAndSettle();
      // The adjustment is the one term whose sign lives in the number: a
      // correction can go either way, and the operator has to see which.
      expect(find.text('AJUSTES'), findsOneWidget);
      expect(find.text('−MXN 5.00'), findsOneWidget);
    });

    testWidgets('states the ledger sequence the total was computed from', (
      tester,
    ) async {
      await _pump(
        tester,
        const CashEquation(account: _account, expectedCash: _expectedCash),
      );
      await tester.pumpAndSettle();
      expect(find.text('#17'), findsOneWidget);
    });

    testWidgets('tolerates a payload without a sequence', (tester) async {
      final partial = Map<String, Object?>.from(_expectedCash)
        ..remove('ledgerSequence');
      // Without the server's sequence the card falls back to the journal's own
      // last line, which is the newest fact it folded in.
      await _pump(
        tester,
        CashEquation(
          account: CashDrawerAccount.fromLedger(_ledger),
          expectedCash: partial,
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('#6'), findsOneWidget);
    });

    testWidgets('keeps a row\'s figures on one line when a label wraps', (
      tester,
    ) async {
      // The design language asks for 200 % text in the critical flows. At that
      // scale one label in the row wraps to two lines and its neighbour does not,
      // and the figures used to drop out of line with each other — an equation
      // read by position, with the positions gone.
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      // The till's own width: a narrow card puts every term in one column, and
      // the question this test asks is about terms that share a row.
      tester.view.physicalSize = const Size(1920, 1080);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await _pump(
        tester,
        const CashEquation(account: _account, expectedCash: _expectedCash),
      );
      await tester.pumpAndSettle();

      final floatFigure = tester.getTopLeft(find.text('MXN 1,500.00'));
      final salesFigure = tester.getTopLeft(find.text('MXN 4,200.00'));
      expect(salesFigure.dy, floatFigure.dy);
    });

    testWidgets('stands still when the platform asks it to', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: const MediaQuery(
            data: MediaQueryData(
              size: Size(1200, 800),
              disableAnimations: true,
            ),
            child: Scaffold(
              body: SingleChildScrollView(
                child: CashEquation(
                  account: _account,
                  expectedCash: _expectedCash,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The reveal still happens; it just does not travel. The design language
      // asks the product to respect the platform's reduced-motion preference.
      final switcher = tester.widget<AnimatedSwitcher>(
        find.byType(AnimatedSwitcher).first,
      );
      expect(switcher.duration, Duration.zero);
    });

    testWidgets(
      'keeps the terms and masks the total while the policy withholds it',
      (tester) async {
        await _pump(
          tester,
          const CashEquation(account: _account, expectedCash: null),
        );
        await tester.pumpAndSettle();

        // The blind count hides the number the operator is meant to test, not the
        // account they can already read in the journal.
        expect(find.text('La cuenta del cajón'), findsOneWidget);
        expect(find.text('FONDO INICIAL'), findsOneWidget);
        expect(find.text('MXN 3,545.00'), findsNothing);
        expect(find.text('Se revela al contar'), findsOneWidget);
        // The figure is covered, not absent: the redacted shape keeps the layout
        // and the line below says why.
        expect(find.text('MXN ••••••'), findsOneWidget);
      },
    );
  });

  group('the drawer policy', () {
    testWidgets('shows the mode and the thresholds the operator must respect', (
      tester,
    ) async {
      await _pump(tester, const CashPolicyTable(policy: _policy));
      await tester.pumpAndSettle();

      expect(find.text('Conteo ciego'), findsOneWidget);
      expect(find.text('Tolerancia'), findsOneWidget);
      expect(find.text('MXN 1.00'), findsOneWidget);
      expect(find.text('PIN movimiento desde'), findsOneWidget);
      expect(find.text('MXN 50.00'), findsOneWidget);
      expect(find.text('PIN cierre: diferencia >'), findsOneWidget);
      expect(find.text('MXN 5.00'), findsOneWidget);
      expect(find.text('Requiere conexión'), findsOneWidget);
    });

    testWidgets('never promises offline cash the till cannot deliver', (
      tester,
    ) async {
      final allowed = Map<String, Object?>.from(_policy)
        ..['offlineCashShiftAllowed'] = true;
      await _pump(tester, CashPolicyTable(policy: allowed));
      await tester.pumpAndSettle();
      // A policy may allow it; nothing in this build does it. The row answers
      // the operator's question with the terminal's truth, not the policy's
      // permission — and "Sin conexión permitido" was a promise the till could
      // not keep (deep-design finding 5.3).
      expect(find.text('No disponible aún'), findsOneWidget);
      expect(find.text('Permitido'), findsNothing);
      expect(find.text('Requiere conexión'), findsNothing);
    });

    testWidgets('says the count is visible when blindness is off', (
      tester,
    ) async {
      final off = Map<String, Object?>.from(_policy)
        ..['blindCountRequired'] = false;
      await _pump(tester, CashPolicyTable(policy: off));
      await tester.pumpAndSettle();
      expect(find.text('Conteo visible'), findsOneWidget);
      expect(find.text('Conteo ciego'), findsNothing);
    });

    testWidgets('says "Sin definir" when the policy omits a value', (
      tester,
    ) async {
      // A payload missing a field is not a payload that set the field to zero or
      // to off. Read as zero, it claimed a tolerance of nothing and a count that
      // is never blind — two rules the owner never made.
      final sparse = Map<String, Object?>.from(_policy)
        ..remove('varianceTolerance')
        ..remove('blindCountRequired')
        ..remove('offlineCashShiftAllowed');
      await _pump(tester, CashPolicyTable(policy: sparse));
      await tester.pumpAndSettle();

      // Two rules the policy omitted, and the offline row — which reports what
      // the terminal can do, so a policy that says nothing about it cannot make
      // that row undefined.
      expect(find.text('Sin definir'), findsNWidgets(2));
      expect(find.text('MXN 0.00'), findsNothing);
      expect(find.text('Conteo visible'), findsNothing);
      // The connection row is about this till, not about the policy: cash needs
      // the API either way.
      expect(find.text('Requiere conexión'), findsOneWidget);
    });
  });

  group('money formatting', () {
    test('groups thousands and keeps two decimals from minor units', () {
      expect(formatMinorUnits(0, 'MXN'), 'MXN 0.00');
      expect(formatMinorUnits(5, 'MXN'), 'MXN 0.05');
      expect(formatMinorUnits(123456, 'MXN'), 'MXN 1,234.56');
      expect(formatMinorUnits(100000000, 'MXN'), 'MXN 1,000,000.00');
    });

    test('marks a negative amount with a minus, never with a bracket', () {
      expect(formatMinorUnits(-1500, 'MXN'), '−MXN 15.00');
    });
  });
}
