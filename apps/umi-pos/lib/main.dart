import 'package:flutter/widgets.dart';

import 'bootstrap/entrypoint.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await launchUmiPos();
}
