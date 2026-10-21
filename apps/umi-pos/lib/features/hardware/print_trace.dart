import 'package:flutter/foundation.dart';

/// Opt-in breadcrumbs for the print path.
///
/// A release/profile build has no Dart stack trace through the debugger, and a
/// receipt that stops between "dispatching" and the printer needs to name the
/// stage it reached. This is compile-time off unless a diagnostic build asks for
/// it, so ordinary tills pay nothing and log nothing from it.
const bool printTraceEnabled = bool.fromEnvironment('UMIPOS_PRINT_TRACE');

void printTrace(String stage, [Map<String, Object?> fields = const {}]) {
  if (!printTraceEnabled) return;
  final detail = fields.isEmpty
      ? ''
      : ' ${fields.entries.map((entry) => '${entry.key}=${entry.value}').join(' ')}';
  debugPrint('[umipos.print] $stage$detail');
}
