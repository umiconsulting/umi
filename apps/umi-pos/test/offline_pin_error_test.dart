import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/entry/entry_surface.dart';

import 'support/fakes.dart';

final class _OfflinePinGateway implements EntryGateway {
  _OfflinePinGateway(this.device);
  final DeviceSummary device;

  @override
  Future<DeviceSummary> deviceStatus() async => device;

  @override
  Future<PosSessionResponse> pinLogin({
    required String pin,
    required String merchantId,
    required String locationId,
  }) async => throw const AppException(
    category: AppErrorCategory.transport,
    code: 'NETWORK_ERROR',
    recoverable: true,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

void main() {
  testWidgets(
    'PIN login failure while offline renders a visible connection error instead of silently clearing dots',
    (tester) async {
      tester.view.physicalSize = const Size(800, 1280);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final storage = MemorySecureStorage();
      final vault = CredentialVault(storage);
      final now = DateTime.now().toUtc().toIso8601String();
      await vault.saveDevice(
        id: 'dev-1',
        publicId: 'pub-1',
        credential: 'cred-1',
        credentialVersion: 1,
        state: 'active',
        merchantId: 'merchant-1',
        locationId: 'loc-1',
      );
      final device = DeviceSummary(
        id: 'dev-1',
        publicId: 'pub-1',
        merchantId: 'merchant-1',
        locationId: 'loc-1',
        displayName: 'pos movil',
        type: 'pos_terminal',
        platform: 'android',
        mobility: 'mobile',
        state: 'active',
        credentialVersion: 1,
        lastSeenAt: now,
        rotationRequired: false,
        revokedAt: null,
        replacementDeviceId: null,
      );
      final controller = EntryController(
        gateway: _OfflinePinGateway(device),
        vault: vault,
        telemetry: const SafeTelemetry(
          enabled: false,
          context: TelemetryContext(
            appVersion: 'test',
            environment: 'test',
            platform: 'test',
          ),
          exporter: NoopTelemetryExporter(),
        ),
        idleTimeout: const Duration(minutes: 5),
      );
      await controller.initialize();
      expect(controller.state.phase, EntryPhase.pinRequired);

      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: ListenableBuilder(
            listenable: controller,
            builder: (context, _) => EntrySurface(controller: controller),
          ),
        ),
      );
      await tester.pump();

      await controller.loginWithPin('2468');
      await tester.pump();

      expect(
        find.text(
          'No se pudo verificar el PIN. Revisa la conexión e intenta de nuevo.',
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );
}
