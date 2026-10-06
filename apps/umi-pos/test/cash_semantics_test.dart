import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/features/cash/cash_controller.dart';
import 'package:umi_pos/features/cash/cash_surface.dart';

import 'render/cash_centro_render.dart';

/// What a screen reader is handed.
///
/// The tree is worth reading rather than assuming: this screen once wrapped its
/// entire body in one live region, so every change anywhere — a spinner, a
/// refresh — was an announcement, and it merged the drawer's account into a
/// single node that said the masked placeholder twice and ended on a bare "#3".
Future<void> _pumpCashCenter(
  WidgetTester tester, {
  String variant = 'open',
}) async {
  final controller = CashController(repository: previewRepository(variant));
  controller.setContext(
    merchantId: '00000000-0000-4000-8000-000000000010',
    locationId: '00000000-0000-4000-8000-000000000011',
    operatorSessionId: '00000000-0000-4000-8000-000000000012',
  );
  await controller.load();
  tester.view.physicalSize = const Size(1920, 1080);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
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
      home: Scaffold(
        body: CashCenter(
          controller: controller,
          permissions: OperatorPermissions(const [
            'cash.shift.read',
            'cash.movement.paid_in',
            'cash.movement.paid_out',
            'cash.count.submit',
            'cash.shift.suspend',
          ]),
        ),
      ),
    ),
  );
  await tester.pump();
}

({List<String> liveRegions, List<String> labels}) _read(WidgetTester tester) {
  // `pipelineOwner` is deprecated in favour of the `rootPipelineOwner` tree, but
  // in this version only the deprecated owner exposes the tree's
  // `SemanticsOwner`; `rootPipelineOwner` and `SemanticsBinding` do not.
  // ignore: deprecated_member_use
  final owner = tester.binding.pipelineOwner.semanticsOwner;
  final root = owner!.rootSemanticsNode!;
  final liveRegions = <String>[];
  final labels = <String>[];
  void walk(SemanticsNode node) {
    if (node.flagsCollection.isLiveRegion) liveRegions.add(node.label);
    if (node.label.isNotEmpty) labels.add(node.label);
    node.visitChildren((child) {
      walk(child);
      return true;
    });
  }

  walk(root);
  return (liveRegions: liveRegions, labels: labels);
}

void main() {
  testWidgets('the live regions are the state and the answer, not the screen', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await _pumpCashCenter(tester);
    final read = _read(tester);

    // Two things interrupt: the drawer's state changed, or the count revealed
    // its answer. Nothing else on this screen is worth interrupting for — and
    // the body of the screen used to be a live region all by itself.
    expect(read.liveRegions, hasLength(2));
    expect(read.liveRegions.first, 'Turno abierto');
    expect(read.liveRegions.last, contains('Efectivo esperado'));

    handle.dispose();
  });

  testWidgets('the account is one card and one answer', (tester) async {
    final handle = tester.ensureSemantics();
    await _pumpCashCenter(tester);
    final read = _read(tester);

    final card = read.labels.firstWhere(
      (l) => l.startsWith('La cuenta del cajón'),
    );
    expect(card, contains('FONDO INICIAL'));
    expect(card, contains('MXN 1,500.00'));
    expect(card, contains('−MXN 350.00'));
    // The covered total says why it is covered once, and the sequence has a name
    // instead of being read as a hash and a digit.
    final answer = read.labels.firstWhere(
      (l) => l.startsWith('Efectivo esperado'),
    );
    expect(
      answer,
      'Efectivo esperado: Se revela al contar\nSecuencia del libro 3',
    );

    handle.dispose();
  });

  testWidgets('a revealed count is announced with its figure', (tester) async {
    final handle = tester.ensureSemantics();
    await _pumpCashCenter(tester, variant: 'counted');
    final read = _read(tester);

    final answer = read.labels.firstWhere(
      (l) => l.startsWith('Efectivo esperado'),
    );
    expect(answer, contains('MXN 1,460.00'));
    expect(answer, isNot(contains('Se revela al contar')));

    handle.dispose();
  });
}
