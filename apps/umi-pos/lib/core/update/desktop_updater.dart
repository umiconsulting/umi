import 'desktop_updater_platform.dart'
    if (dart.library.io) 'desktop_updater_io.dart';

/// What happened when the operator asked UmiPOS to update itself.
enum DesktopUpdateOutcome {
  /// A newer AppImage was downloaded and swapped in; prompt a restart.
  applied,

  /// This build cannot self-update (web, non-Linux, or not run as an AppImage).
  unsupported,

  /// The latest published release already matches the running version.
  alreadyCurrent,

  /// The latest release has no AppImage asset for this architecture.
  noAsset,

  /// A network or filesystem error stopped the update.
  failed,
}

/// The result of a self-update attempt. [version] is the release the app moved
/// to (or is already on); [detail] carries a short diagnostic for logs/UI.
final class DesktopUpdateResult {
  const DesktopUpdateResult(this.outcome, {this.version, this.detail});
  final DesktopUpdateOutcome outcome;
  final String? version;
  final String? detail;
}

/// Self-update for the desktop build. On Linux this replaces the running
/// AppImage with the latest GitHub release; everywhere else it is a no-op.
abstract interface class DesktopUpdater {
  /// True only when this build can actually self-update right now.
  bool get isSupported;

  /// Download the latest release AppImage and swap it in place.
  Future<DesktopUpdateResult> update();

  /// Relaunch the (updated) executable and exit the current process. No-op when
  /// [isSupported] is false.
  Future<void> relaunch();
}

/// The build cannot self-update. Used on web, on non-Linux desktops, and when
/// the update repo is not configured.
final class NoopDesktopUpdater implements DesktopUpdater {
  const NoopDesktopUpdater();

  @override
  bool get isSupported => false;

  @override
  Future<DesktopUpdateResult> update() async =>
      const DesktopUpdateResult(DesktopUpdateOutcome.unsupported);

  @override
  Future<void> relaunch() async {}
}

/// One AppImage asset picked out of a GitHub release payload.
final class GithubAppImageAsset {
  const GithubAppImageAsset({
    required this.version,
    required this.name,
    required this.downloadUrl,
  });
  final String version;
  final String name;
  final String downloadUrl;
}

/// Pick the AppImage asset for [archToken] from a GitHub "releases/latest"
/// payload. Pure so it can be unit-tested without any network or filesystem.
/// Returns null when the payload has no matching asset.
GithubAppImageAsset? resolveAppImageAsset(
  Map<String, Object?> releaseJson, {
  String archToken = 'x86_64',
}) {
  final assets = releaseJson['assets'];
  if (assets is! List) return null;
  final tag = (releaseJson['tag_name'] as String?)?.trim();
  for (final asset in assets) {
    if (asset is! Map) continue;
    final name = asset['name'];
    final url = asset['browser_download_url'];
    if (name is! String || url is! String) continue;
    if (name.endsWith('.AppImage') && name.contains(archToken)) {
      return GithubAppImageAsset(
        version: _resolveVersion(tag, name),
        name: name,
        downloadUrl: url,
      );
    }
  }
  return null;
}

/// Prefer the release tag (stripped of a leading `v`); fall back to the version
/// embedded in `umi_pos-<version>-<arch>.AppImage`.
String _resolveVersion(String? tag, String assetName) {
  if (tag != null && tag.isNotEmpty) {
    return tag.startsWith('v') ? tag.substring(1) : tag;
  }
  final match = RegExp(r'-(\d+\.\d+\.\d+[0-9A-Za-z.+-]*)-').firstMatch(assetName);
  return match?.group(1) ?? '';
}

/// Build the right updater for the current platform. Returns a
/// [NoopDesktopUpdater] on web, on non-Linux desktops, or when [owner]/[repo]
/// are empty; a working AppImage updater otherwise.
DesktopUpdater createDesktopUpdater({
  required String owner,
  required String repo,
  required String currentVersion,
}) {
  if (owner.isEmpty || repo.isEmpty) return const NoopDesktopUpdater();
  return createPlatformDesktopUpdater(
    owner: owner,
    repo: repo,
    currentVersion: currentVersion,
  );
}
