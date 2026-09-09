import 'desktop_updater.dart';

/// Default (web / no dart:io) platform factory: the desktop updater is not
/// available. The real implementation lives in `desktop_updater_io.dart` and is
/// selected by the conditional import in `desktop_updater.dart`.
DesktopUpdater createPlatformDesktopUpdater({
  required String owner,
  required String repo,
  required String currentVersion,
}) => const NoopDesktopUpdater();
