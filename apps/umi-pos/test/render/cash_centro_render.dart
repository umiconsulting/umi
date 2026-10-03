import 'dart:async';
import 'dart:io';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_repository.dart';
import 'package:umi_pos/features/cash/cash_surface.dart';
import 'package:umi_pos/shared/widgets/inline_notice.dart';

/// Renders the Centro de caja in every state it can be in, so a human can judge
/// the screens a narrow test run never shows.
///
/// This file is deliberately **not** named `*_test.dart`: it writes PNGs, which a
/// CI suite must not do on its own. Run it by name:
///
///   RENDER_STATES=open,counted RENDER_THEME=dark \
///     flutter test test/render/cash_centro_render.dart --update-goldens
///
/// The images land in `test/render/shots/`. They go through the golden pipeline
/// on purpose: an earlier version called `RepaintBoundary.toImage` directly and
/// left the tester alive until its ten-minute timeout, after the image was
/// already written — so a ten-state run took an hour and read as a hang.
///
/// `RENDER_STATES` defaults to `open`. `RENDER_THEME` is `light` or `dark`; the
/// till follows the platform, and this desk is dark, so both are worth reading.
/// `RENDER_VIEWPORT` takes `WxH` and defaults to `1920x1080`, the terminal this
/// screen was designed against.
void main() {
  final states = (Platform.environment['RENDER_STATES'] ?? 'open').split(',');
  final themeName = Platform.environment['RENDER_THEME'] ?? 'light';
  // An empty value means "no dialog": a shell that exports the variable without
  // a value should render the screen, not look for a dialog named ''.
  final rawDialog = Platform.environment['RENDER_DIALOG'];
  final dialog = (rawDialog == null || rawDialog.isEmpty) ? null : rawDialog;
  // Walk the keyboard path before capturing. The repo's own checklist asks for a
  // focus state that looks deliberate and does not rely on colour alone; this is
  // how that claim gets checked rather than assumed.
  final tabs = int.tryParse(Platform.environment['RENDER_TAB'] ?? '') ?? 0;
  // The checklist asks for a hover state that looks deliberate. The till is a
  // touch screen at the counter and a mouse on the back desk, so it is worth
  // knowing what the mouse gets.
  final hover = Platform.environment['RENDER_HOVER'] == '1';
  // The design language asks for 200 % text in the critical flows, and a dense
  // grid of figures is exactly where that breaks.
  final textScale =
      double.tryParse(Platform.environment['RENDER_TEXT_SCALE'] ?? '') ?? 1.0;
  final viewport = _parseViewport(
    Platform.environment['RENDER_VIEWPORT'] ?? '1920x1080',
  );

  // The two tones this screen has to speak in: a cash operation that failed, and
  // a drawer that did not answer while the money is safely recorded. They are one
  // widget apart, so they are worth one picture.
  if (Platform.environment['RENDER_NOTICE'] == '1') {
    testWidgets('notice tones', (tester) async {
      final fontBytes = File(
        '/usr/share/fonts/noto/NotoSans-Regular.ttf',
      ).readAsBytesSync();
      await (FontLoader(
        'PreviewSans',
      )..addFont(Future.value(ByteData.view(fontBytes.buffer)))).load();
      final base = themeName == 'dark' ? UmiTheme.dark() : UmiTheme.light();
      tester.view.physicalSize = const Size(900, 320);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: base.copyWith(
            textTheme: base.textTheme.apply(fontFamily: 'PreviewSans'),
          ),
          home: const Scaffold(
            body: Padding(
              padding: EdgeInsets.all(24),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  InlineNotice(
                    message:
                        'No fue posible completar la operación de caja de forma segura.',
                  ),
                  SizedBox(height: 16),
                  InlineNotice(
                    message:
                        'El cajón no respondió. La operación quedó registrada; '
                        'ábrelo a mano y avisa al encargado.',
                    tone: InlineNoticeTone.warning,
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      Directory('test/render/shots').createSync(recursive: true);
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('shots/cash-notice-$themeName.png'),
      );
    });
    return;
  }

  for (final state in states) {
    testWidgets('render $state', (tester) async {
      final fontBytes = File(
        '/usr/share/fonts/noto/NotoSans-Regular.ttf',
      ).readAsBytesSync();
      await (FontLoader(
        'PreviewSans',
      )..addFont(Future.value(ByteData.view(fontBytes.buffer)))).load();
      final base = themeName == 'dark' ? UmiTheme.dark() : UmiTheme.light();
      final theme = base.copyWith(
        textTheme: base.textTheme.apply(fontFamily: 'PreviewSans'),
      );

      final repository = _PreviewRepository(state);
      final controller = CashController(repository: repository);
      controller.setContext(
        merchantId: '00000000-0000-4000-8000-000000000010',
        locationId: '00000000-0000-4000-8000-000000000011',
        operatorSessionId: '00000000-0000-4000-8000-000000000012',
      );
      if (state == 'loading') {
        // The screen's own shape, before the first answer arrives. The load is
        // left hanging on purpose: this is what a slow network produces.
        unawaited(controller.load());
      } else {
        await controller.load();
      }

      tester.view.physicalSize = viewport;
      tester.view.devicePixelRatio = 1.0;
      tester.platformDispatcher.textScaleFactorTestValue = textScale;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await tester.pumpWidget(
        RepaintBoundary(
          child: MaterialApp(
            theme: theme,
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            home: Scaffold(
              body: CashCenter(
                controller: controller,
                permissions: OperatorPermissions(_permissionsFor(state)),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      for (var press = 0; press < tabs; press++) {
        await tester.sendKeyEvent(LogicalKeyboardKey.tab);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 60));
      }
      if (hover) {
        final target = find.byType(OutlinedButton).first;
        final gesture = await tester.createGesture(
          kind: PointerDeviceKind.mouse,
        );
        await gesture.addPointer(location: Offset.zero);
        addTearDown(gesture.removePointer);
        await tester.pump();
        await gesture.moveTo(tester.getCenter(target));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 200));
      }
      // The tab's other half is its dialogs. This opens one on top of the state
      // and captures the whole thing, barrier and all.
      if (dialog != null) {
        // Bring the control into view first: on a narrow or short viewport the
        // tile that opens the dialog sits below the fold, and a tap that misses
        // silently photographs a screen with no dialog on it.
        final opener = _dialogOpener(dialog);
        await tester.ensureVisible(opener);
        await tester.pumpAndSettle();
        await tester.tap(opener);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        // The approval dialog is two dialogs deep: the operator fills the
        // movement in first. One env flag walks both, so the screen a manager
        // actually reads is a picture rather than an assumption.
        if (dialog == 'approval') {
          await tester.enterText(find.byType(TextField).first, '120');
          await tester.enterText(find.byType(TextField).last, 'hielo');
          await tester.pump();
          await tester.tap(
            find.widgetWithText(FilledButton, 'Confirmar movimiento de caja'),
          );
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));
        }
      }
      Directory('test/render/shots').createSync(recursive: true);
      // The viewport is part of the name. Two renders of the same state at
      // different sizes are two different pieces of evidence, and a golden that
      // silently overwrites its twin at another size proves nothing.
      final size = '${viewport.width.toInt()}x${viewport.height.toInt()}';
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile(
          'shots/cash-$state${dialog == null ? '' : '-$dialog'}'
          '${tabs == 0 ? '' : '-tab$tabs'}'
          '${hover ? '-hover' : ''}'
          '${textScale == 1.0 ? '' : '-text${textScale.toInt()}'}'
          // The drawer's size is a different piece of evidence too: a
          // three-denomination dialog and an eleven-denomination one were
          // overwriting each other under the same name, which made a pixel diff
          // between two variants look like a regression.
          '${_fullDenominations ? '-denoms' : ''}'
          // Long names and large amounts are a different piece of evidence, and
          // a golden that overwrites its own twin proves nothing about either.
          '${_extremes ? '-extreme' : ''}-$themeName-$size.png',
        ),
      );
    });
  }
}

/// The control that opens each dialog, by the label the operator reads.
///
/// The finder names the button type as well as the text: `Cerrar turno` is both
/// the fourth step's label and the button under it, and a tap that lands on the
/// label would capture a screenshot of nothing happening.
Finder _dialogOpener(String dialog) => switch (dialog) {
  'movement' => find.widgetWithText(OutlinedButton, 'Entrada de efectivo'),
  'approval' => find.widgetWithText(OutlinedButton, 'Entrada de efectivo'),
  'handoff' => find.widgetWithText(OutlinedButton, 'Entregar turno'),
  'nosale' => find.widgetWithText(
    OutlinedButton,
    'Solicitar apertura de cajón',
  ),
  'count' => find.widgetWithText(FilledButton, 'Iniciar conteo ciego'),
  'recount' => find.widgetWithText(FilledButton, 'Iniciar conteo ciego'),
  'resolve' => find.widgetWithText(FilledButton, 'Motivo de la diferencia'),
  'close' => find.widgetWithText(FilledButton, 'Cerrar turno'),
  'cancelcount' => find.widgetWithText(
    TextButton,
    'Cancelar conteo y volver a abierto',
  ),
  _ => throw ArgumentError('unknown RENDER_DIALOG "$dialog"'),
};

/// The same fixture the goldens are rendered from, for tests that need the screen
/// without a picture: `test/cash_keyboard_test.dart` reads this to assert what the
/// screen draws for a focused control.
CashRepository previewRepository(String variant) => _PreviewRepository(variant);

Size _parseViewport(String value) {
  final parts = value.split('x');
  return Size(double.parse(parts.first), double.parse(parts.last));
}

/// The permission set the state is about. A cashier owns the movements and the
/// count; `denied` is the same open shift for a role that may only look, which is
/// the one path where the close flow is not offered at all.
List<String> _permissionsFor(String state) => state == 'denied'
    ? const ['cash.shift.read']
    : const [
        'cash.shift.read',
        'cash.shift.open',
        'cash.shift.suspend',
        'cash.shift.resume',
        'cash.shift.handoff',
        'cash.movement.paid_in',
        'cash.movement.paid_out',
        'cash.movement.safe_drop',
        'cash.drawer.no_sale',
        'cash.count.submit',
        'cash.count.recount',
        'cash.reconcile',
        'cash.shift.close',
      ];

Map<String, Object?> _money(int minorUnits) => {
  // `RENDER_EXTREMES` stretches every figure by a thousand, which is the
  // checklist's large-number case: a shift that took a million pesos, not a
  // café's afternoon.
  'minorUnits': _extremes ? minorUnits * 1000 : minorUnits,
  'currency': 'MXN',
};

/// The checklist's long-string and large-number cases, for the states where a
/// row can break: real names are longer than fixtures, and a real amount has
/// more digits than a demo.
final bool _extremes = Platform.environment['RENDER_EXTREMES'] == '1';

/// A drawer whose holding terminal is gone: the state the reclaim panel exists
/// for, and one this screen had never been rendered in.
final bool _orphanRegister =
    Platform.environment['RENDER_ORPHAN_REGISTER'] == '1';

String get _longOr =>
    _extremes ? 'María Fernanda Rodríguez Villaseñor' : 'Luis M.';
String get _registerName => _extremes
    ? 'Caja principal de la sucursal Centro Histórico'
    : 'Caja principal';
String get _receipt => _extremes ? 'A-1042-REIMPRESION' : 'A-1042';
String get _reason =>
    _extremes ? 'compra_de_hielo_y_vasos_para_la_barra' : 'compra_hielo';

/// The real drawer, for the states where the count's height matters: eleven
/// denominations is what the counter terminal actually has, and three is what
/// makes a screenshot look comfortable.
final bool _fullDenominations =
    Platform.environment['RENDER_DENOMINATIONS'] == 'full';

Map<String, Object?> _journalLine({
  required int sequence,
  required String type,
  required int minorUnits,
  int received = 0,
  int change = 0,
  String? receipt,
  String? reason,
  String? operator,
  required String occurredAt,
}) => {
  'sequence': sequence,
  'type': type,
  'amount': _money(minorUnits),
  'cashReceived': _money(received),
  'changeGiven': _money(change),
  'saleId': null,
  'receiptNumber': receipt,
  'operatorReference': operator,
  'reasonCode': reason,
  'note': null,
  'occurredAt': occurredAt,
};

final class _PreviewRepository implements CashRepository {
  _PreviewRepository(this.variant);

  final String variant;

  @override
  Future<CashCenterSnapshot> center(
    String merchantId,
    CashCenterQuery query,
  ) async {
    if (variant == 'loading') {
      // Never answers: the render below captures the screen waiting for it.
      return Completer<CashCenterSnapshot>().future;
    }
    if (variant == 'unavailable') {
      throw StateError('the api did not answer');
    }
    return _snapshot();
  }

  CashCenterSnapshot _snapshot() {
    final counted = switch (variant) {
      'counted' ||
      'balanced' ||
      'within-tolerance' ||
      'resolved' ||
      'reconciled' => true,
      _ => false,
    };
    // Three shapes of a count's outcome: exact, inside the tolerance, and
    // outside it. The middle one is the case a card can get wrong quietly — a
    // shortage of MXN 0.50 is not an error, and colouring or wording it as one
    // trains the operator to ignore the colour.
    final balanced = variant == 'balanced';
    final closed = variant == 'closed';
    // A closed shift has, by definition, been counted, explained and reconciled.
    // The fixture says so, or the closed screen would show a path that ends on a
    // step nobody ever took.
    final resolved = variant == 'resolved' || variant == 'reconciled' || closed;
    final reconciled = variant == 'reconciled' || closed;
    final suspended = variant == 'suspended';
    // An orphaned hold means this device has no shift of its own: the drawer on
    // the counter belongs to a terminal that will not come back.
    final hasShift =
        variant != 'no-shift' && variant != 'adopt' && !_orphanRegister;
    final varianceMinor = balanced
        ? 0
        : variant == 'within-tolerance'
        ? -50
        : -150;

    return CashCenterSnapshot(
      businessDate: '2026-09-30',
      policy: {
        'version': 'pilot-1',
        'issuedAt': '2026-09-01T00:00:00.000Z',
        'expiresAt': '2026-10-01T00:00:00.000Z',
        'fingerprint':
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'cashShiftRequired': true,
        'registerAssignmentRequired': true,
        'oneShiftPerOperator': true,
        'oneShiftPerRegister': true,
        'openingFloatRequired': true,
        'maximumOpeningFloat': _money(100000),
        'allowedMovementTypes': ['paid_in', 'paid_out', 'safe_drop'],
        'movementApprovalThreshold': _money(5000),
        'countMethod': 'denomination_or_total',
        'blindCountRequired': true,
        'handoffAllowed': true,
        'handoffCountRequired': true,
        'varianceTolerance': _money(100),
        'closeApprovalThreshold': _money(500),
        'noSaleDrawerAllowed': true,
        // `offline-allowed` is the policy that promises a capability this build
        // does not have: the row must not repeat the promise.
        'offlineCashShiftAllowed': variant == 'offline-allowed',
        'denominations': _fullDenominations
            ? [
                _money(100000),
                _money(50000),
                _money(20000),
                _money(10000),
                _money(5000),
                _money(2000),
                _money(1000),
                _money(500),
                _money(200),
                _money(100),
                _money(50),
              ]
            : [_money(50000), _money(20000), _money(10000)],
      },
      registers: [
        {
          'id': '00000000-0000-4000-8000-000000000001',
          'merchantId': '00000000-0000-4000-8000-000000000010',
          'locationId': '00000000-0000-4000-8000-000000000011',
          'displayName': _registerName,
          'publicReference': 'CAJA-01',
          'currency': 'MXN',
          'active': true,
          'assignmentPolicy': 'device_required',
          'assignment': {
            'deviceId': '00000000-0000-4000-8000-000000000003',
            'allowedDeviceClasses': ['pos_terminal'],
            'assignedAt': '2026-09-01T00:00:00.000Z',
          },
          'currentShiftId': '00000000-0000-4000-8000-000000000009',
          'hold': {
            // The terminal that opened this drawer is gone for good, so nobody
            // is coming back to count it and the drawer is free to reclaim. The
            // hold is the only thing that says so.
            'state': _orphanRegister
                ? 'held_by_orphaned_till'
                : 'held_by_this_device',
            'shiftId': '00000000-0000-4000-8000-000000000009',
            'shiftStatus': 'open',
            'openedAt': '2026-09-30T13:25:00.000Z',
            'deviceId': '00000000-0000-4000-8000-000000000003',
            'deviceName': 'POS-01',
            'deviceStatus': _orphanRegister ? 'revoked' : 'active',
            'operatorSessionId': '00000000-0000-4000-8000-000000000012',
            'reclaimable': _orphanRegister,
          },
          'status': 'in_use',
          'version': 3,
          'createdAt': '2026-08-01T00:00:00.000Z',
          'archivedAt': null,
        },
      ],
      ledger: hasShift
          ? variant == 'busy'
                ? _busyLedger()
                : [
                    _journalLine(
                      sequence: 1,
                      type: 'opening_float',
                      minorUnits: 150000,
                      operator: 'Ana R.',
                      occurredAt: '2026-09-30T13:25:00.000Z',
                    ),
                    _journalLine(
                      sequence: 2,
                      type: 'cash_sale',
                      minorUnits: 31000,
                      received: 50000,
                      change: 19000,
                      receipt: _receipt,
                      operator: _longOr,
                      occurredAt: '2026-09-30T15:04:00.000Z',
                    ),
                    _journalLine(
                      sequence: 3,
                      type: 'paid_out',
                      minorUnits: 35000,
                      reason: _reason,
                      operator: _longOr,
                      occurredAt: '2026-09-30T18:48:00.000Z',
                    ),
                  ]
          : const [],
      adoptableShift: variant == 'adopt' ? _shift(status: 'open') : null,
      currentShift: hasShift
          ? _shift(
              status: closed
                  ? 'closed'
                  : suspended
                  ? 'suspended'
                  : counted
                  ? 'reconciliation_required'
                  : 'open',
              closed: closed,
            )
          : null,
      expectedCash: counted || closed ? _expectedCash() : null,
      latestCount: counted || closed
          ? {
              'count': {
                'id': '00000000-0000-4000-8000-000000000011',
                'shiftId': '00000000-0000-4000-8000-000000000009',
                'attemptNumber': 1,
                'state': 'variance_calculated',
                'countedCash': _money(145850),
                'denominations': const [],
                'operatorId': '00000000-0000-4000-8000-000000000013',
                'ledgerSequence': 3,
                'submittedAt': '2026-09-30T19:21:00.000Z',
              },
              'variance': _variance(varianceMinor),
              'approvalFingerprint':
                  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            }
          : null,
      varianceResolution: resolved
          ? const {
              'id': '00000000-0000-4000-8000-000000000014',
              'shiftId': '00000000-0000-4000-8000-000000000009',
              'countAttemptId': '00000000-0000-4000-8000-000000000011',
              'reason': 'counting_error',
              'note': 'Se contó dos veces la misma pieza.',
              'approvalId': null,
              'approvalFingerprint': null,
              'ledgerSequence': 3,
              'resolvedAt': '2026-09-30T19:31:00.000Z',
            }
          : null,
      reconciliation: reconciled
          ? {
              'id': '00000000-0000-4000-8000-000000000015',
              'shiftId': '00000000-0000-4000-8000-000000000009',
              'countAttemptId': '00000000-0000-4000-8000-000000000011',
              'expectedCash': _expectedCash(),
              'selectedCount': const {
                'id': '00000000-0000-4000-8000-000000000011',
                'shiftId': '00000000-0000-4000-8000-000000000009',
                'attemptNumber': 1,
                'state': 'variance_calculated',
                'countedCash': {'minorUnits': 145850, 'currency': 'MXN'},
                'denominations': [],
                'operatorId': '00000000-0000-4000-8000-000000000013',
                'ledgerSequence': 3,
                'submittedAt': '2026-09-30T19:21:00.000Z',
              },
              'variance': _variance(varianceMinor),
              'resolution': null,
              'outcome': 'balanced',
              'ledgerSequence': 3,
              'closeApprovalRequired': false,
              'closeApprovalFingerprint': null,
              'reconciledAt': '2026-09-30T19:40:00.000Z',
            }
          : null,
      recoveryState: variant == 'policy-expired'
          ? 'policy_expired'
          : closed
          ? 'none'
          : suspended
          ? 'shift_suspended'
          : counted
          ? 'reconciliation_required'
          : 'none',
      allowedActions: variant == 'policy-expired'
          ? const []
          : closed
          ? const []
          : variant == 'no-shift'
          ? const ['open_shift']
          : variant == 'adopt'
          ? const ['adopt_shift']
          : suspended
          ? const ['resume', 'count']
          : reconciled
          ? const ['close']
          : counted
          ? const ['cancel_count', 'resolve_variance', 'reconcile', 'count']
          : const ['movement', 'suspend', 'handoff', 'count', 'no_sale'],
      summary: closed ? _summary() : null,
    );
  }

  Map<String, Object?> _shift({
    required String status,
    bool closed = false,
  }) => {
    'id': '00000000-0000-4000-8000-000000000009',
    'merchantId': '00000000-0000-4000-8000-000000000010',
    'locationId': '00000000-0000-4000-8000-000000000011',
    'registerId': '00000000-0000-4000-8000-000000000001',
    'deviceId': '00000000-0000-4000-8000-000000000003',
    'deviceCredentialVersion': 1,
    'holdingDeviceId': '00000000-0000-4000-8000-000000000003',
    'holdingDeviceCredentialVersion': 1,
    'openingOperatorId': '00000000-0000-4000-8000-000000000013',
    'responsibleOperatorId': '00000000-0000-4000-8000-000000000013',
    'operatorSessionId': '00000000-0000-4000-8000-000000000012',
    'currency': 'MXN',
    'businessDate': '2026-09-30',
    'status': status,
    'openingCommandId': '00000000-0000-4000-8000-000000000060',
    'openedAt': '2026-09-30T13:25:00.000Z',
    'suspendedAt': status == 'suspended' ? '2026-09-30T17:00:00.000Z' : null,
    'closedAt': closed ? '2026-09-30T20:02:00.000Z' : null,
    'ledgerSequence': 3,
    'version': 4,
  };

  Map<String, Object?> _expectedCash() => {
    'openingFloat': _money(150000),
    'grossCashReceived': _money(50000),
    'changeGiven': _money(19000),
    'netCashSales': _money(31000),
    'paidIn': _money(0),
    'paidOut': _money(35000),
    'safeDrops': _money(0),
    'adjustments': _money(0),
    'expectedDrawerCash': _money(146000),
    'currency': 'MXN',
    'ledgerSequence': 3,
    'calculatedAt': '2026-09-30T19:20:00.000Z',
    'shiftVersion': 4,
  };

  Map<String, Object?> _variance(int signedMinor) => {
    'expectedCash': _money(146000),
    'countedCash': _money(146000 + signedMinor),
    'signedVariance': _money(signedMinor),
    'absoluteVariance': _money(signedMinor.abs()),
    'tolerance': _money(100),
    'withinTolerance': signedMinor.abs() <= 100,
    'approvalRequired': signedMinor.abs() > 100,
    'reasonRequired': signedMinor != 0,
    'outcome': signedMinor == 0
        ? 'balanced'
        : signedMinor.abs() <= 100
        ? 'within_tolerance'
        : 'approval_required',
    'ledgerSequence': 3,
  };

  Map<String, Object?> _summary() => {
    'shift': _shift(status: 'closed', closed: true),
    'register': {
      'id': '00000000-0000-4000-8000-000000000001',
      'displayName': _registerName,
      'publicReference': 'CAJA-01',
    },
    'openingFloat': _money(150000),
    'expectedCash': _expectedCash(),
    'countedCash': _money(145850),
    'variance': _money(-150),
    'varianceReason': 'counting_error',
    'reconciliationOutcome': 'balanced',
    'countAttempts': 1,
    'handoffCount': 0,
  };

  /// A full shift's worth of lines: the journal has to read at volume, not only
  /// with the two or three rows a fresh drawer has.
  List<Map<String, Object?>> _busyLedger() => [
    _journalLine(
      sequence: 1,
      type: 'opening_float',
      minorUnits: 150000,
      operator: 'Ana R.',
      occurredAt: '2026-09-30T13:25:00.000Z',
    ),
    for (var i = 0; i < 26; i++)
      _journalLine(
        sequence: 2 + i,
        type: 'cash_sale',
        minorUnits: 4000 + i * 500,
        received: 5000 + i * 500,
        change: i.isEven ? 1000 : 0,
        receipt: 'A-${1043 + i}',
        operator: i.isEven ? _longOr : 'Ana R.',
        occurredAt:
            '2026-09-30T14:${(i * 2).toString().padLeft(2, '0')}:00.000Z',
      ),
    _journalLine(
      sequence: 28,
      type: 'paid_in',
      minorUnits: 20000,
      reason: 'fondo_extra',
      operator: 'Ana R.',
      occurredAt: '2026-09-30T18:10:00.000Z',
    ),
    _journalLine(
      sequence: 29,
      type: 'safe_drop',
      minorUnits: 100000,
      operator: _longOr,
      occurredAt: '2026-09-30T18:20:00.000Z',
    ),
    _journalLine(
      sequence: 30,
      type: 'cash_refund',
      minorUnits: 8000,
      receipt: 'A-1010',
      operator: _longOr,
      occurredAt: '2026-09-30T18:30:00.000Z',
    ),
  ];

  @override
  Future<CashCommandRecoveryResult> commandRecovery(
    String m,
    CashCommandRecoveryQuery q,
  ) => throw UnimplementedError();
  @override
  Future<OpenCashShiftResult> open(String m, OpenCashShiftRequest r) =>
      throw UnimplementedError();
  @override
  Future<CashMovement> movement(String m, String s, CashMovementRequest r) =>
      throw UnimplementedError();
  @override
  Future<CashShift> transition(
    String m,
    String s,
    ShiftTransitionRequest r, {
    required bool suspend,
  }) => throw UnimplementedError();
  @override
  Future<ShiftHandoff> handoff(String m, String s, ShiftHandoffRequest r) =>
      throw UnimplementedError();
  @override
  Future<AdoptCashShiftResult> adopt(
    String m,
    String s,
    AdoptCashShiftRequest r,
  ) => throw UnimplementedError();
  @override
  Future<ReclaimCashRegisterResult> reclaimRegister(
    String m,
    String registerId,
    ReclaimCashRegisterRequest r,
  ) => throw UnimplementedError();
  @override
  Future<CashCountSummary> count(
    String m,
    String s,
    SubmitBlindCountRequest r,
  ) => throw UnimplementedError();
  @override
  Future<CashShift> recount(String m, String s, RecountRequest r) =>
      throw UnimplementedError();
  @override
  Future<CashShift> cancelCount(String m, String s, CancelCashCountRequest r) =>
      throw UnimplementedError();
  @override
  Future<CashVarianceResolution> resolve(
    String m,
    String s,
    ResolveCashVarianceRequest r,
  ) => throw UnimplementedError();
  @override
  Future<ShiftReconciliation> reconcile(
    String m,
    String s,
    ReconcileCashShiftRequest r,
  ) => throw UnimplementedError();
  @override
  Future<ShiftCloseResult> close(String m, String s, ShiftCloseRequest r) =>
      throw UnimplementedError();
  @override
  Future<NoSaleDrawerEvent> noSale(String m, String s, NoSaleDrawerRequest r) =>
      throw UnimplementedError();
  @override
  Future<ElevationGrantView> approve(ManagerApprovalRequest r) =>
      throw UnimplementedError();
}
