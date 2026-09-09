import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

import 'desktop_updater.dart';

/// Native platform factory. Returns a working AppImage updater on Linux when the
/// process is running from an AppImage; a no-op updater otherwise.
DesktopUpdater createPlatformDesktopUpdater({
  required String owner,
  required String repo,
  required String currentVersion,
}) {
  if (!Platform.isLinux) return const NoopDesktopUpdater();
  return AppImageDesktopUpdater(
    owner: owner,
    repo: repo,
    currentVersion: currentVersion,
  );
}

/// Replaces the running AppImage with the latest GitHub release AppImage.
///
/// The AppImage runtime exports the absolute path of the running `.AppImage`
/// file in the `APPIMAGE` environment variable. We download the newest release
/// asset next to it, keep the old file as `<name>.zs-old` for rollback, and move
/// the new file into place. The swap only touches the running file after the
/// download has fully succeeded, so a failed download never breaks the till.
final class AppImageDesktopUpdater implements DesktopUpdater {
  AppImageDesktopUpdater({
    required this.owner,
    required this.repo,
    required this.currentVersion,
    http.Client? client,
    Map<String, String>? environment,
    this.archToken = 'x86_64',
  }) : _client = client ?? http.Client(),
       _env = environment ?? Platform.environment;

  final String owner;
  final String repo;
  final String currentVersion;
  final String archToken;
  final http.Client _client;
  final Map<String, String> _env;

  static const _userAgent = 'UmiPOS-Updater';

  String? get _appImagePath {
    final value = _env['APPIMAGE'];
    return (value != null && value.isNotEmpty) ? value : null;
  }

  @override
  bool get isSupported =>
      Platform.isLinux && _appImagePath != null && owner.isNotEmpty &&
      repo.isNotEmpty;

  @override
  Future<DesktopUpdateResult> update() async {
    final path = _appImagePath;
    if (!Platform.isLinux || path == null || owner.isEmpty || repo.isEmpty) {
      return const DesktopUpdateResult(DesktopUpdateOutcome.unsupported);
    }
    try {
      final metaResponse = await _client.get(
        Uri.parse('https://api.github.com/repos/$owner/$repo/releases/latest'),
        headers: const {
          'Accept': 'application/vnd.github+json',
          'User-Agent': _userAgent,
        },
      );
      if (metaResponse.statusCode != 200) {
        return DesktopUpdateResult(
          DesktopUpdateOutcome.failed,
          detail: 'release lookup HTTP ${metaResponse.statusCode}',
        );
      }
      final decoded = jsonDecode(metaResponse.body);
      if (decoded is! Map<String, Object?>) {
        return const DesktopUpdateResult(
          DesktopUpdateOutcome.failed,
          detail: 'unexpected release payload',
        );
      }
      final asset = resolveAppImageAsset(decoded, archToken: archToken);
      if (asset == null) {
        return const DesktopUpdateResult(DesktopUpdateOutcome.noAsset);
      }
      if (_sameVersion(asset.version, currentVersion)) {
        return DesktopUpdateResult(
          DesktopUpdateOutcome.alreadyCurrent,
          version: asset.version,
        );
      }

      final binResponse = await _client.get(
        Uri.parse(asset.downloadUrl),
        headers: const {'User-Agent': _userAgent},
      );
      // A real AppImage is megabytes; a tiny body means an error page slipped
      // through with a 200, so refuse it rather than swap in a broken file.
      if (binResponse.statusCode != 200 ||
          binResponse.bodyBytes.length < 65536) {
        return DesktopUpdateResult(
          DesktopUpdateOutcome.failed,
          detail: 'download HTTP ${binResponse.statusCode}',
        );
      }

      final target = File(path);
      final incoming = File('$path.new');
      await incoming.writeAsBytes(binResponse.bodyBytes, flush: true);
      await Process.run('chmod', ['+x', incoming.path]);

      final backup = File('$path.zs-old');
      if (await backup.exists()) await backup.delete();
      if (await target.exists()) await target.rename(backup.path);
      await incoming.rename(path);

      return DesktopUpdateResult(
        DesktopUpdateOutcome.applied,
        version: asset.version,
      );
    } catch (error) {
      return DesktopUpdateResult(
        DesktopUpdateOutcome.failed,
        detail: '$error',
      );
    }
  }

  @override
  Future<void> relaunch() async {
    final path = _appImagePath;
    if (path == null) return;
    await Process.start(path, const [], mode: ProcessStartMode.detached);
    // Let the child spawn before this process exits so the window never blinks
    // out with nothing to replace it.
    await Future<void>.delayed(const Duration(milliseconds: 200));
    exit(0);
  }

  bool _sameVersion(String left, String right) =>
      left.isNotEmpty && right.isNotEmpty && left == right;
}
