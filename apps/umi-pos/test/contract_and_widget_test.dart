import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/app/umi_pos_app.dart';

import 'support/fakes.dart';

void main() {
  test('generated canonical contract is linked', () {
    expect(contractVersion, '1.0.0');
    expect(contractContentHash, hasLength(64));
  });

  testWidgets('bootstrap presents a localized authentication boundary', (
    tester,
  ) async {
    final root = testRoot();
    await root.controller.initialize();
    await tester.pumpWidget(UmiPosApp(root: root));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.lock_outline), findsOneWidget);
    expect(find.text('Listo para comenzar'), findsOneWidget);
  });
}
