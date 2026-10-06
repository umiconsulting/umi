import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/app/umi_pos_app.dart';

import 'support/fakes.dart';

void main() {
  test('generated canonical contract is linked', () {
    // The canonical manifest, read from disk, not a literal typed here.
    //
    // A pinned literal only says somebody remembered to edit this line when the
    // contract was regenerated — and they did not, which is how this test failed
    // on a contract that was correct (defect D46's shape: a hand-maintained
    // value that drifts). Comparing against the manifest the generator wrote is
    // the assertion the test's own name makes: the Dart contract this app links
    // IS the canonical one, not a stale copy of it.
    // Walk up from wherever the test runner started until the generated
    // manifest appears, so this does not depend on the runner's working
    // directory.
    File? manifest;
    var dir = Directory.current.absolute;
    for (var depth = 0; depth < 6; depth += 1) {
      final candidate = File(
        '${dir.path}/packages/contract/generated/contract.json',
      );
      if (candidate.existsSync()) {
        manifest = candidate;
        break;
      }
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
    expect(
      manifest,
      isNotNull,
      reason: 'the generated contract manifest must exist in the repository',
    );
    final canonical =
        jsonDecode(manifest!.readAsStringSync()) as Map<String, Object?>;
    expect(contractVersion, canonical['contractVersion']);
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
    expect(find.byType(TextField), findsOneWidget);
  });
}
