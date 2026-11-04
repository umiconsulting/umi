import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/errors/app_error.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/hardware/hardware_recovery_store.dart';
import 'package:umi_pos/features/hardware/hardware_repository.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/hardware_service.dart';
import 'package:umi_pos/features/hardware/hardware_surface.dart';

import 'support/fakes.dart';

final class _Gateway implements EntryGateway {
  @override
  Future<DeviceSummary> deviceStatus() async => throw const AppException(
    category: AppErrorCategory.server,
    code: 'UPSTREAM_UNAVAILABLE',
    recoverable: true,
  );
  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

final class _Hardware implements HardwareRepository {
  int reads = 0;
  @override
  Future<HardwareRuntimeSnapshot> snapshot(
    String merchant,
    HardwareRegistryQuery query,
  ) async {
    if (++reads == 1) throw StateError('Transient registry failure');
    return HardwareRuntimeSnapshot(
      merchantId: merchant,
      locationId: query.locationId,
      registerId: null,
      devices: const [],
      pendingJobs: 0,
      retryableJobs: 0,
      unknownCommands: 0,
      capturedAt: DateTime.now().toUtc().toIso8601String(),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

void main() {
  testWidgets('embedded hardware retains retry after a registry failure', (
    tester,
  ) async {
    final now = DateTime.now().toUtc();
    final vault = CredentialVault(MemorySecureStorage());
    await vault.saveDevice(
      id: 'device',
      publicId: 'public',
      credential: 'credential',
      credentialVersion: 1,
      state: 'active',
      merchantId: 'merchant',
      locationId: 'location',
    );
    await vault.saveTokens('access', 'refresh');
    final branch = {
      'id': 'location',
      'merchantId': 'merchant',
      'name': 'Local',
      'status': 'active',
      'deviceAllowed': true,
      'operatorAllowed': true,
    };
    await vault.saveEntrySnapshot({
      'device': DeviceSummary(
        id: 'device',
        publicId: 'public',
        merchantId: 'merchant',
        locationId: 'location',
        displayName: 'Caja',
        type: 'pos_terminal',
        platform: 'android',
        mobility: 'static',
        state: 'active',
        credentialVersion: 1,
        lastSeenAt: now.toIso8601String(),
        rotationRequired: false,
        revokedAt: null,
        replacementDeviceId: null,
      ).toJson(),
      'tenant': {
        'id': 'merchant',
        'name': 'Cafe',
        'roles': [],
        'permissions': [],
        'entitlements': [],
        'locations': [branch],
      },
      'branch': branch,
      'operator': {
        'id': 'operator',
        'userId': 'user',
        'staffId': 'staff',
        'merchantId': 'merchant',
        'locationId': 'location',
        'deviceId': 'device',
        'state': 'active',
        'permissions': ['hardware.read'],
        'entitlements': [],
        'startedAt': now.subtract(const Duration(hours: 1)).toIso8601String(),
        'lastActivityAt': now.toIso8601String(),
        'expiresAt': now.add(const Duration(hours: 7)).toIso8601String(),
      },
      'savedAt': now.toIso8601String(),
    });
    final entry = EntryController(
      gateway: _Gateway(),
      vault: vault,
      telemetry: SafeTelemetry(
        enabled: false,
        context: TelemetryContext.current(testConfig),
        exporter: RecordingExporter(),
      ),
    );
    await entry.initialize();
    expect(entry.state.phase, EntryPhase.ready);
    final repository = _Hardware();
    final service = HardwareService(
      repository: repository,
      coordinator: HardwareCoordinator(adapters: {}, devices: []),
      recovery: MemoryHardwareRecoveryStore(),
    );
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: HardwareSurface(
          entry: entry,
          service: service,
          permissions: OperatorPermissions(const ['hardware.read']),
          registerId: null,
          embedded: true,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(
      find.text('Los datos de hardware no están disponibles.'),
      findsOneWidget,
    );
    await tester.tap(find.text('Actualizar hardware'));
    await tester.pumpAndSettle();
    expect(find.text('Dispositivos asignados'), findsOneWidget);
    expect(
      find.text('Los datos de hardware no están disponibles.'),
      findsNothing,
    );
    expect(repository.reads, 2);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    entry.dispose();
    await tester.runAsync(service.dispose);
  });
}
