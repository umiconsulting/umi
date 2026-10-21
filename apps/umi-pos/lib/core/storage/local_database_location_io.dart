import 'dart:io';

import 'package:path/path.dart' as path;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'local_working_copy.dart';

Future<LocalDatabaseLocation?> resolveLocalDatabaseLocation() async {
  if (Platform.isLinux || Platform.isWindows) {
    sqfliteFfiInit();
    final support = await getApplicationSupportDirectory();
    return LocalDatabaseLocation(databaseFactoryFfi, path.join(support.path));
  }
  return LocalDatabaseLocation(databaseFactory, await getDatabasesPath());
}
