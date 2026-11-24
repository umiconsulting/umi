import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/security/credential_vault.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/features/cart/accounts_workspace.dart';
import 'package:umi_pos/features/entry/entry_controller.dart';
import 'package:umi_pos/features/entry/entry_gateway.dart';
import 'package:umi_pos/features/hardware/hardware_recovery_store.dart';
import 'package:umi_pos/features/hardware/hardware_repository.dart';
import 'package:umi_pos/features/hardware/hardware_runtime.dart';
import 'package:umi_pos/features/hardware/hardware_service.dart';
import 'package:umi_pos/features/hardware/hardware_surface.dart';
import 'package:umi_pos/features/settings/display_settings_surface.dart';
import 'package:umi_pos/features/tables/floor_plan_controller.dart';
import 'package:umi_pos/features/tables/floor_plan_surface.dart';
import 'package:umi_pos/features/tables/table_state_controller.dart';
import 'package:umi_pos/features/tables/table_state_repository.dart';

import 'support/fakes.dart';

void _setPortraitViewport(WidgetTester tester, Size size) {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Widget _portraitApp(Widget home, {Locale locale = const Locale('es')}) =>
    PosApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      home: home,
    );

final class _SignedInEntryGateway implements EntryGateway {
  @override
  Future<OperatorSessionView> startOperator(
    String merchantId,
    String locationId,
  ) async => OperatorSessionView(
    id: 'op-1',
    userId: 'user-1',
    staffId: 'staff-1',
    merchantId: merchantId,
    locationId: locationId,
    deviceId: 'device-1',
    state: 'active',
    permissions: const ['*'],
    entitlements: const [],
    startedAt: '2026-11-24T00:00:00Z',
    lastActivityAt: '2026-11-24T00:00:00Z',
    expiresAt: '2026-11-24T08:00:00Z',
  );

  @override
  Future<void> lockOperator(String id) async {}

  @override
  Future<void> logout() async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnimplementedError();
}

Future<EntryController> _signedInEntry() async {
  final entry = EntryController(
    gateway: _SignedInEntryGateway(),
    vault: CredentialVault(MemorySecureStorage()),
    telemetry: const SafeTelemetry(
      enabled: false,
      context: TelemetryContext(
        appVersion: 'test',
        environment: 'test',
        platform: 'test',
      ),
      exporter: NoopTelemetryExporter(),
    ),
    idleTimeout: const Duration(seconds: 30),
  );
  await entry.selectTenant(
    EntryMerchant.fromJson({
      'id': 'm1',
      'name': 'UmiPOS Local',
      'roles': <Object?>[],
      'permissions': <Object?>[],
      'entitlements': <Object?>[],
      'locations': [
        {
          'id': 'branch-1',
          'merchantId': 'm1',
          'name': 'Sucursal Local',
          'status': 'active',
          'deviceAllowed': true,
          'operatorAllowed': true,
        },
      ],
    }),
  );
  return entry;
}

class _FakeFloorPlanRepository implements FloorPlanRepository {
  _FakeFloorPlanRepository(this.plan);
  final PublishedFloorPlan plan;

  @override
  Future<PublishedFloorPlan> load(
    String merchantId,
    PosFloorPlanQuery query,
  ) async => plan;
}

class _FakeTableStateRepository implements TableStateRepository {
  @override
  Future<TableStateMap> read(
    String merchantId,
    PosTableStateQuery query,
  ) async => TableStateMap(
    locationId: query.locationId,
    serverTime: '2026-11-24T00:00:00Z',
    states: [
      {
        'tableId': 't1',
        'state': 'seated',
        'seatedAt': '2026-11-23T23:45:00Z',
        'partySize': 2,
        'groupId': null,
      },
    ],
  );

  @override
  Future<TableStateChangeResult> seat(
    String merchantId,
    SeatTableRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> move(
    String merchantId,
    MovePartyRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> merge(
    String merchantId,
    MergeTablesRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> split(
    String merchantId,
    SplitPartyRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> clear(
    String merchantId,
    ClearTableRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> markReady(
    String merchantId,
    OpenTableRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> markOrdered(
    String merchantId,
    MarkTableOrderedRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> markServed(
    String merchantId,
    MarkTableServedRequest request,
  ) => throw UnimplementedError();

  @override
  Future<TableStateChangeResult> markAwaitingPayment(
    String merchantId,
    MarkTableAwaitingPaymentRequest request,
  ) => throw UnimplementedError();
}

PublishedFloorPlan _sampleFloorPlan() => PublishedFloorPlan(
  locationId: 'branch-1',
  publishedVersion: 1,
  publishedAt: '2026-11-24T00:00:00Z',
  published: {
    'schemaVersion': 1,
    'areas': [
      {
        'id': 'area-1',
        'name': 'Salón Local',
        'width': 800,
        'height': 600,
        'elements': [
          {
            'id': 't1',
            'kind': 'table',
            'label': 'Mesa 1',
            'shape': 'square',
            'x': 100,
            'y': 100,
            'width': 140,
            'height': 140,
            'capacity': 4,
            'rotation': 0,
          },
          {
            'id': 't2',
            'kind': 'table',
            'label': 'Mesa 2',
            'shape': 'square',
            'x': 400,
            'y': 100,
            'width': 140,
            'height': 140,
            'capacity': 4,
            'rotation': 0,
          },
          {
            'id': 't3',
            'kind': 'table',
            'label': 'Mesa 3',
            'shape': 'square',
            'x': 100,
            'y': 360,
            'width': 140,
            'height': 140,
            'capacity': 2,
            'rotation': 0,
          },
          {
            'id': 't4',
            'kind': 'table',
            'label': 'Mesa 4',
            'shape': 'square',
            'x': 400,
            'y': 360,
            'width': 140,
            'height': 140,
            'capacity': 2,
            'rotation': 0,
          },
        ],
      },
    ],
  },
);

void main() {
  for (final size in const [Size(411, 731), Size(390, 844)]) {
    group(
      'Portrait layout audit (${size.width.toInt()}x${size.height.toInt()})',
      () {
        testWidgets('PosSelectFormField stretches full width by default', (
          tester,
        ) async {
          _setPortraitViewport(tester, size);

          await tester.pumpWidget(
            _portraitApp(
              PosPage(
                body: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      PosSelectFormField<String>(
                        initialValue: 'printer',
                        decoration: const PosFieldDecoration(
                          labelText: 'Tipo de dispositivo',
                        ),
                        items: const [
                          PosSelectItem(
                            value: 'printer',
                            child: Text('Impresora'),
                          ),
                        ],
                        onChanged: (_) {},
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();

          final buttonRect = tester.getRect(find.byType(PosOutlineButton));
          expect(buttonRect.width, closeTo(size.width - 32, 2));
          expect(tester.takeException(), isNull);
        });

        testWidgets(
          'PosBadge accepts high-contrast rail foreground/background',
          (tester) async {
            _setPortraitViewport(tester, size);

            await tester.pumpWidget(
              _portraitApp(
                PosPage(
                  body: Center(
                    child: Builder(
                      builder: (context) {
                        final palette = PosTheme.of(context).colorScheme;
                        return PosBadge.count(
                          count: 14,
                          backgroundColor: palette.signal,
                          foregroundColor: palette.onSignal,
                          child: const PosIcon(PosGlyph('nav_layout-grid')),
                        );
                      },
                    ),
                  ),
                ),
              ),
            );
            await tester.pumpAndSettle();

            expect(find.text('14'), findsOneWidget);
            expect(tester.takeException(), isNull);
          },
        );

        testWidgets('Settings tabs have vertical breathing room below header', (
          tester,
        ) async {
          _setPortraitViewport(tester, size);

          await tester.pumpWidget(
            _portraitApp(
              PosSettingsWorkspace(
                onLock: () async {},
                onLogout: () async {},
                hardwareBuilder: (_) => const SizedBox.shrink(),
              ),
            ),
          );
          await tester.pumpAndSettle();

          final headerRect = tester.getRect(find.byType(PosHeader));
          final firstTabRect = tester.getRect(find.text('Dispositivos'));
          expect(
            firstTabRect.top - headerRect.bottom,
            greaterThanOrEqualTo(12),
          );
          expect(tester.takeException(), isNull);
        });

        testWidgets(
          'AccountsWorkspace list view keeps 16dp horizontal padding',
          (tester) async {
            _setPortraitViewport(tester, size);

            await tester.pumpWidget(
              _portraitApp(
                AccountsWorkspace(
                  withoutTable: true,
                  onViewChanged: (_) {},
                  load: () async => const [],
                  onSelected: (_) {},
                  onNewAccount: () {},
                ),
              ),
            );
            await tester.pumpAndSettle();

            final searchRect = tester.getRect(find.byType(PosField));
            expect(searchRect.left, closeTo(16, 1));
            expect(tester.takeException(), isNull);
          },
        );

        testWidgets(
          'HardwareSurface modal header suppresses redundant back button',
          (tester) async {
            _setPortraitViewport(tester, size);

            final entry = await _signedInEntry();
            final service = HardwareService(
              repository: ApiHardwareRepository(TestApiClient()),
              coordinator: HardwareCoordinator(
                adapters: const {},
                devices: const [],
              ),
              recovery: MemoryHardwareRecoveryStore(),
            );

            await tester.pumpWidget(
              _portraitApp(
                Builder(
                  builder: (context) => PosPage(
                    body: Center(
                      child: PosButton(
                        onPressed: () {
                          showHardwareCenter(
                            context,
                            entry: entry,
                            service: service,
                            permissions: OperatorPermissions(const ['*']),
                            registerId: 'reg-1',
                          );
                        },
                        child: const Text('Abrir hardware'),
                      ),
                    ),
                  ),
                ),
              ),
            );
            await tester.pumpAndSettle();

            await tester.tap(find.text('Abrir hardware'));
            await tester.pumpAndSettle();

            final header = tester.widget<PosHeader>(find.byType(PosHeader));
            expect(header.automaticallyImplyLeading, isFalse);
            expect(tester.takeException(), isNull);

            await tester.pumpWidget(const SizedBox.shrink());
            entry.dispose();
          },
        );

        testWidgets(
          'FloorPlanSurface portrait renders unclipped legend, 4 tables, and scrolls detail into view on tap',
          (tester) async {
            _setPortraitViewport(tester, size);

            final entry = await _signedInEntry();
            final floorPlan = FloorPlanController(
              _FakeFloorPlanRepository(_sampleFloorPlan()),
            );
            final tableState = TableStateController(
              _FakeTableStateRepository(),
            );

            await tester.pumpWidget(
              _portraitApp(
                FloorPlanSurface(
                  entry: entry,
                  controller: floorPlan,
                  tableState: tableState,
                  embedded: true,
                  directAccounts: true,
                ),
              ),
            );
            await tester.pumpAndSettle();

            for (final table in const [
              'Mesa 1',
              'Mesa 2',
              'Mesa 3',
              'Mesa 4',
            ]) {
              expect(find.text(table), findsOneWidget);
            }
            for (final state in const [
              'Libre',
              'Ocupada',
              'Pedido tomado',
              'Servido',
              'Por cobrar',
              'Pagada y ocupada',
              'Por limpiar',
            ]) {
              final rect = tester.getRect(find.text(state));
              expect(rect.right, lessThanOrEqualTo(size.width));
            }

            await tester.tap(find.text('Mesa 1'));
            await tester.pumpAndSettle();

            expect(find.text('4 lugares'), findsOneWidget);
            final actionsHeader = find.text('Acciones');
            expect(actionsHeader, findsOneWidget);
            final actionRect = tester.getRect(actionsHeader);
            expect(actionRect.bottom, lessThanOrEqualTo(size.height));
            expect(tester.takeException(), isNull);

            await tester.pumpWidget(const SizedBox.shrink());
            floorPlan.dispose();
            tableState.dispose();
            entry.dispose();
          },
        );
      },
    );
  }
}
