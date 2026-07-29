import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/catalog/catalog_surface.dart';

import 'support/fakes.dart';

const partition = CatalogPartition('tenant-a', 'branch-a', 'es');

CatalogProductSummary product(String id) => CatalogProductSummary(
  id: id,
  name: 'Café',
  description: null,
  sku: 'SKU-1',
  hasBarcode: true,
  category: null,
  price: const CatalogMoney(minorUnits: 4500, currency: 'MXN').toJson(),
  taxRateBasisPoints: 1600,
  availability: 'enabled',
  availableFrom: null,
  primaryMedia: null,
  hasVariants: false,
  hasModifiers: false,
  updatedAt: '2026-07-28T00:00:00Z',
);

final class FakeCatalogRepository implements CatalogRepository {
  var calls = 0;
  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => const CatalogCategoriesResponse(
    items: [],
    catalogVersion: 'v1',
    updatedAt: '2026-07-28T00:00:00Z',
  );
  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async {
    calls += 1;
    final items = search == 'missing'
        ? <Map<String, Object?>>[]
        : [product('$calls').toJson()];
    return CatalogPage(
      items: items,
      nextCursor: cursor == null && search != 'missing' ? 'next' : null,
      catalogVersion: 'v1',
      updatedAt: '2026-07-28T00:00:00Z',
    );
  }

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) async => CatalogProductDetail(
    id: productId,
    name: 'Latte',
    description: 'Espresso con leche.',
    sku: 'CAF-LAT',
    hasBarcode: true,
    category: null,
    price: const CatalogMoney(minorUnits: 6500, currency: 'MXN').toJson(),
    taxRateBasisPoints: 1600,
    availability: 'enabled',
    availableFrom: null,
    primaryMedia: null,
    hasVariants: true,
    hasModifiers: true,
    updatedAt: '2026-07-28T00:00:00Z',
    barcode: '7501000000002',
    media: const [],
    variants: const [
      {'id': 'small', 'name': 'Chico'},
      {'id': 'medium', 'name': 'Mediano'},
      {'id': 'large', 'name': 'Grande'},
    ],
    optionGroups: const [
      {
        'id': 'milk',
        'name': 'Tipo de leche',
        'modifiers': [
          {'id': 'oat', 'name': 'Leche de avena'},
          {'id': 'whole', 'name': 'Leche entera'},
        ],
      },
    ],
  );
}

CatalogController controller(FakeCatalogRepository repository) {
  final telemetry = SafeTelemetry(
    enabled: true,
    context: TelemetryContext.current(testConfig),
    exporter: RecordingExporter(),
  );
  return CatalogController(
    repository: repository,
    cache: CatalogCache(),
    telemetry: telemetry,
  );
}

void main() {
  test(
    'catalog cache is bounded and partitioned by tenant, branch and language',
    () {
      final cache = CatalogCache(maxPartitions: 1);
      cache.write(partition, 'v1', [product('one')]);
      cache.write(const CatalogPartition('tenant-b', 'branch-b', 'en'), 'v1', [
        product('two'),
      ]);
      expect(cache.read(partition, 'v1'), isNull);
      expect(
        cache
            .read(const CatalogPartition('tenant-b', 'branch-b', 'en'), 'v1')!
            .single
            .id,
        'two',
      );
    },
  );

  test('controller loads incrementally and deduplicates product IDs', () async {
    final repository = FakeCatalogRepository();
    final value = controller(repository);
    await value.open(partition);
    expect(value.state.phase, CatalogPhase.ready);
    await value.loadMore();
    expect(value.state.products.map((item) => item.id), ['1', '2']);
    value.dispose();
  });

  test(
    'server search empty result is distinct from an empty branch catalog',
    () async {
      final repository = FakeCatalogRepository();
      final value = controller(repository);
      await value.open(partition);
      value.search('missing');
      await Future<void>.delayed(const Duration(milliseconds: 350));
      expect(value.state.phase, CatalogPhase.noResults);
      value.dispose();
    },
  );

  testWidgets(
    'virtualized catalog surface renders authoritative product data',
    (tester) async {
      final repository = FakeCatalogRepository();
      final value = controller(repository);
      await value.open(partition);
      final root = testRoot();
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            checkout: root.checkout,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Café'), findsOneWidget);
      expect(find.byType(GridView), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    },
  );

  testWidgets(
    'product detail keeps variant choices horizontal inside its scroll surface',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = FakeCatalogRepository();
      final value = controller(repository);
      await value.open(partition);
      final root = testRoot();
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            checkout: root.checkout,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.text('Café'));
      await tester.pumpAndSettle();

      expect(find.byType(Scrollbar), findsWidgets);
      final small = tester.getCenter(find.text('Chico'));
      final medium = tester.getCenter(find.text('Mediano'));
      final large = tester.getCenter(find.text('Grande'));
      expect(small.dy, medium.dy);
      expect(medium.dy, large.dy);

      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    },
  );
}
