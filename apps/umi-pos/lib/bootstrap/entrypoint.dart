import 'dart:async';

import 'package:flutter/widgets.dart';

import '../app/umi_pos_app.dart';
import 'composition_root.dart';

Future<void> launchUmiPos({AppCompositionRoot Function()? createRoot}) async {
  WidgetsFlutterBinding.ensureInitialized();
  final root = (createRoot ?? AppCompositionRoot.production)();
  runApp(UmiPosApp(root: root));
  unawaited(root.controller.initialize());
}
