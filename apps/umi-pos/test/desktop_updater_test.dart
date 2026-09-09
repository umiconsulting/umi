import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:umi_pos/core/update/desktop_updater.dart';
import 'package:umi_pos/core/update/desktop_updater_io.dart';

Map<String, Object?> _release({
  required String tag,
  List<Map<String, Object?>>? assets,
}) => {
  'tag_name': tag,
  'assets':
      assets ??
      [
        {
          'name': 'umi_pos-${tag.replaceFirst('v', '')}-x86_64.AppImage',
          'browser_download_url':
              'https://example.test/umi_pos-${tag.replaceFirst('v', '')}-x86_64.AppImage',
        },
      ],
};

void main() {
  group('resolveAppImageAsset', () {
    test('picks the x86_64 AppImage and strips the leading v from the tag', () {
      final asset = resolveAppImageAsset(_release(tag: 'v0.2.0'));
      expect(asset, isNotNull);
      expect(asset!.version, '0.2.0');
      expect(asset.name, 'umi_pos-0.2.0-x86_64.AppImage');
      expect(asset.downloadUrl, endsWith('-x86_64.AppImage'));
    });

    test('falls back to the version embedded in the filename', () {
      final asset = resolveAppImageAsset({
        'tag_name': '',
        'assets': [
          {
            'name': 'umi_pos-1.4.2-x86_64.AppImage',
            'browser_download_url': 'https://example.test/a.AppImage',
          },
        ],
      });
      expect(asset!.version, '1.4.2');
    });

    test('returns null when no asset matches the architecture', () {
      final asset = resolveAppImageAsset({
        'tag_name': 'v0.2.0',
        'assets': [
          {
            'name': 'umi_pos-0.2.0-aarch64.AppImage',
            'browser_download_url': 'https://example.test/a.AppImage',
          },
          {
            'name': 'umi_pos-0.2.0-x86_64.AppImage.zsync',
            'browser_download_url': 'https://example.test/a.zsync',
          },
        ],
      });
      expect(asset, isNull);
    });

    test('returns null when the payload carries no assets', () {
      expect(resolveAppImageAsset({'tag_name': 'v0.2.0'}), isNull);
    });
  });

  group('createDesktopUpdater', () {
    test('is a no-op when the update repo is not configured', () {
      final updater = createDesktopUpdater(
        owner: '',
        repo: '',
        currentVersion: '0.1.0',
      );
      expect(updater.isSupported, isFalse);
    });
  });

  group(
    'AppImageDesktopUpdater',
    () {
      test('is unsupported when APPIMAGE is not set', () {
        final updater = AppImageDesktopUpdater(
          owner: 'umiconsulting',
          repo: 'umi',
          currentVersion: '0.1.0',
          environment: const {},
          client: MockClient((_) async => http.Response('{}', 200)),
        );
        expect(updater.isSupported, isFalse);
      });

      test('swaps in a newer AppImage and keeps a rollback copy', () async {
        final dir = await Directory.systemTemp.createTemp('umi_pos_upd');
        addTearDown(() => dir.delete(recursive: true));
        final appImage = File('${dir.path}/umi_pos-0.1.0-x86_64.AppImage');
        final oldBytes = List<int>.filled(70000, 0x41); // "A" * 70000
        await appImage.writeAsBytes(oldBytes);
        final newBytes = List<int>.filled(80000, 0x42); // "B" * 80000

        final updater = AppImageDesktopUpdater(
          owner: 'umiconsulting',
          repo: 'umi',
          currentVersion: '0.1.0',
          environment: {'APPIMAGE': appImage.path},
          client: MockClient((request) async {
            if (request.url.host == 'api.github.com') {
              return http.Response(jsonEncode(_release(tag: 'v0.2.0')), 200);
            }
            return http.Response.bytes(newBytes, 200);
          }),
        );

        final result = await updater.update();
        expect(result.outcome, DesktopUpdateOutcome.applied);
        expect(result.version, '0.2.0');
        expect(await appImage.readAsBytes(), newBytes);
        expect(
          await File('${appImage.path}.zs-old').readAsBytes(),
          oldBytes,
        );
      });

      test('reports alreadyCurrent when the latest matches the running version',
          () async {
        final dir = await Directory.systemTemp.createTemp('umi_pos_upd');
        addTearDown(() => dir.delete(recursive: true));
        final appImage = File('${dir.path}/umi_pos.AppImage');
        await appImage.writeAsBytes(List<int>.filled(70000, 0x41));

        final updater = AppImageDesktopUpdater(
          owner: 'umiconsulting',
          repo: 'umi',
          currentVersion: '0.2.0',
          environment: {'APPIMAGE': appImage.path},
          client: MockClient(
            (_) async => http.Response(jsonEncode(_release(tag: 'v0.2.0')), 200),
          ),
        );

        final result = await updater.update();
        expect(result.outcome, DesktopUpdateOutcome.alreadyCurrent);
        // The running file is untouched.
        expect((await appImage.readAsBytes()).length, 70000);
      });

      test('fails without touching the running file on a tiny download',
          () async {
        final dir = await Directory.systemTemp.createTemp('umi_pos_upd');
        addTearDown(() => dir.delete(recursive: true));
        final appImage = File('${dir.path}/umi_pos.AppImage');
        await appImage.writeAsBytes(List<int>.filled(70000, 0x41));

        final updater = AppImageDesktopUpdater(
          owner: 'umiconsulting',
          repo: 'umi',
          currentVersion: '0.1.0',
          environment: {'APPIMAGE': appImage.path},
          client: MockClient((request) async {
            if (request.url.host == 'api.github.com') {
              return http.Response(jsonEncode(_release(tag: 'v0.2.0')), 200);
            }
            return http.Response('not found', 404);
          }),
        );

        final result = await updater.update();
        expect(result.outcome, DesktopUpdateOutcome.failed);
        expect((await appImage.readAsBytes()).length, 70000);
        expect(File('${appImage.path}.zs-old').existsSync(), isFalse);
      });

      test('reports noAsset when the release has no AppImage', () async {
        final dir = await Directory.systemTemp.createTemp('umi_pos_upd');
        addTearDown(() => dir.delete(recursive: true));
        final appImage = File('${dir.path}/umi_pos.AppImage');
        await appImage.writeAsBytes(List<int>.filled(70000, 0x41));

        final updater = AppImageDesktopUpdater(
          owner: 'umiconsulting',
          repo: 'umi',
          currentVersion: '0.1.0',
          environment: {'APPIMAGE': appImage.path},
          client: MockClient(
            (_) async => http.Response(
              jsonEncode({'tag_name': 'v0.2.0', 'assets': const []}),
              200,
            ),
          ),
        );

        expect(
          (await updater.update()).outcome,
          DesktopUpdateOutcome.noAsset,
        );
      });
    },
    skip: !Platform.isLinux ? 'AppImage updater is Linux-only' : null,
  );
}
