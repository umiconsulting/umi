import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/app/umi_pos_app.dart';

import 'support/fakes.dart';

void main() {
  test('generated canonical contract is linked', () {
    expect(contractVersion, '1.2.0');
    expect(contractContentHash, hasLength(64));
  });

  testWidgets('bootstrap presents the localized trusted-device boundary', (
    tester,
  ) async {
    final root = testRoot();
    await root.controller.initialize();
    await root.entry.initialize();
    await tester.pumpWidget(UmiPosApp(root: root));
    await tester.pumpAndSettle();
    expect(find.text('Registrar este dispositivo'), findsOneWidget);
    expect(find.byType(TextField), findsNWidgets(2));
  });
}
