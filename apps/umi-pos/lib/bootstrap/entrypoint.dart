import 'dart:async';

import 'package:flutter/widgets.dart';

import '../app/umi_pos_app.dart';
import 'bootstrap_state.dart';
import 'composition_root.dart';

Future<void> launchUmiPos({AppCompositionRoot Function()? createRoot}) async {
  WidgetsFlutterBinding.ensureInitialized();
  final root = (createRoot ?? AppCompositionRoot.production)();
  runApp(UmiPosApp(root: root));
  unawaited(
    root.controller.initialize().then((_) {
      if (root.controller.state.phase ==
          BootstrapPhase.readyForAuthentication) {
        return root.entry.initialize();
      }
    }),
  );
}
