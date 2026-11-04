import 'dart:async';

import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
import 'package:umi_pos/core/theme/display_preferences.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/catalog/catalog_surface.dart';

import 'support/fakes.dart';

const partition = CatalogPartition('tenant-a', 'branch-a', 'es');

CatalogProductSummary product(
  String id, {
  String name = 'Café',
  Map<String, Object?>? category,
  String availability = 'enabled',
  bool hasVariants = false,
  bool hasModifiers = false,
  Map<String, Object?>? media,
}) => CatalogProductSummary(
  id: id,
  name: name,
  description: null,
  sku: 'SKU-1',
  hasBarcode: true,
  category: category,
  price: const CatalogMoney(minorUnits: 4500, currency: 'MXN').toJson(),
  taxRateBasisPoints: 1600,
  saleAction: 'merchandise',
  availability: availability,
  availableFrom: null,
  primaryMedia: media,
  hasVariants: hasVariants,
  hasModifiers: hasModifiers,
  updatedAt: '2026-07-28T00:00:00Z',
);

final class FakeCatalogRepository implements CatalogRepository {
  FakeCatalogRepository({
    this.productName = 'Café',
    this.productCategory,
    this.productAvailability = 'enabled',
    this.categoryItems = const [],
    this.productHasVariants = false,
    this.productHasModifiers = false,
    this.productMedia,
    this.mediumDelta = 0,
  });

  /// What the one seeded product is called, and the category it carries. A test that
  /// cares about the tile's colour and letters sets both; the rest keep the defaults.
  final String productName;
  final int mediumDelta;
  final Map<String, Object?>? productMedia;
  final Map<String, Object?>? productCategory;

  /// What the branch's menu says about that product: `enabled`, or one of the four
  /// ways the café can say "no hay".
  final String productAvailability;

  /// The dividers of the menu, when the test is about the category index.
  final List<Map<String, Object?>> categoryItems;
  final bool productHasVariants;
  final bool productHasModifiers;
  var calls = 0;
  String? lastBarcode;
  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => CatalogCategoriesResponse(
    items: categoryItems,
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
    lastBarcode = barcode;
    final items = search == 'missing'
        ? <Map<String, Object?>>[]
        : [
            product(
              '$calls',
              name: productName,
              category: productCategory,
              media: productMedia,
              availability: productAvailability,
              hasVariants: productHasVariants,
              hasModifiers: productHasModifiers,
            ).toJson(),
          ];
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
    saleAction: 'merchandise',
    availability: 'enabled',
    availableFrom: null,
    primaryMedia: null,
    hasVariants: true,
    hasModifiers: true,
    updatedAt: '2026-07-28T00:00:00Z',
    barcode: '7501000000002',
    media: const [],
    variants: [
      {
        'id': 'small',
        'name': 'Chico',
        'attributes': <String, Object?>{},
        'priceDelta': {'minorUnits': 0, 'currency': 'MXN'},
        'availability': 'enabled',
      },
      {
        'id': 'medium',
        'name': 'Mediano',
        'attributes': <String, Object?>{},
        'priceDelta': {'minorUnits': mediumDelta, 'currency': 'MXN'},
        'availability': 'enabled',
      },
      {
        'id': 'large',
        'name': 'Grande',
        'attributes': <String, Object?>{},
        'priceDelta': {'minorUnits': 0, 'currency': 'MXN'},
        'availability': 'enabled',
      },
    ],
    optionGroups: const [
      {
        'id': 'milk',
        'name': 'Tipo de leche',
        'required': false,
        'minSelections': 0,
        'maxSelections': null,
        'modifiers': [
          {
            'id': 'oat',
            'name': 'Leche de avena',
            'priceDelta': {'minorUnits': 0, 'currency': 'MXN'},
            'available': true,
          },
          // One modifier carries a surcharge and the other does not, on purpose:
          // the surcharge adds a second line to its tile, and that is the case
          // that used to leave two tiles in one row at different heights.
          {
            'id': 'whole',
            'name': 'Leche entera',
            'available': true,
            'priceDelta': {'minorUnits': 1000, 'currency': 'MXN'},
          },
        ],
      },
    ],
  );
}

final class _LocalCatalog implements LocalWorkingCopy {
  _LocalCatalog(this.root, this.byCategory);

  final LocalCatalogSnapshot root;
  final Map<String, LocalCatalogSnapshot> byCategory;

  @override
  Future<LocalCatalogSnapshot?> readCatalog(
    LocalCatalogScope partition,
  ) async => root;

  @override
  Future<LocalCatalogSnapshot?> readCatalogPage(
    LocalCatalogScope partition, {
    String? categoryId,
    String? search,
    String? barcode,
  }) async => categoryId == null ? root : byCategory[categoryId];

  @override
  Future<CatalogProductDetail?> readProductDetail(
    LocalCatalogScope partition,
    String productId,
  ) async => null;

  @override
  Future<void> writeCategories(
    LocalCatalogScope partition,
    CatalogCategoriesResponse response,
  ) async {}

  @override
  Future<void> writeCatalogPage(
    LocalCatalogScope partition,
    CatalogPage page, {
    String? categoryId,
    String? search,
    String? barcode,
    bool append = false,
  }) async {}

  @override
  Future<void> writeProductDetail(
    LocalCatalogScope partition,
    CatalogProductDetail detail,
  ) async {}

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _WaitingCatalogRepository implements CatalogRepository {
  final categoriesResult = Completer<CatalogCategoriesResponse>();
  final productsResult = Completer<CatalogPage>();

  @override
  Future<CatalogCategoriesResponse> categories(CatalogPartition partition) =>
      categoriesResult.future;

  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) => productsResult.future;

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) => throw UnimplementedError();
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
  for (final dark in [false, true]) {
    testWidgets(
      'photo-free keys retain readable names and category contrast in dark=$dark',
      (tester) async {
        const name = 'Una bebida con nombre largo para comprobar el contraste';
        final repo = FakeCatalogRepository(
          productName: name,
          productMedia: const {'url': 'https://example.invalid/product.png'},
          categoryItems: const [
            {
              'id': 'sage',
              'name': 'Sage',
              'displayOrder': 0,
              'enabled': true,
              'color': '#34d399',
            },
            {
              'id': 'cyan',
              'name': 'Cyan',
              'displayOrder': 1,
              'enabled': true,
              'color': '#67e8f9',
            },
            {
              'id': 'lavender',
              'name': 'Lavender',
              'displayOrder': 2,
              'enabled': true,
              'color': '#a78bfa',
            },
          ],
        );
        final catalog = controller(repo);
        await catalog.open(partition);
        final root = testRoot();
        await tester.pumpWidget(
          PosApp(
            theme: dark ? UmiTheme.dark() : UmiTheme.light(),
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            home: CatalogSurface(
              entry: root.entry,
              catalog: catalog,
              cart: root.cart,
              cash: root.cash,
              checkout: root.checkout,
              sales: root.sales,
              exceptions: root.exceptions,
              connectivity: root.connectivity,
              telemetry: root.telemetry,
            ),
          ),
        );
        await tester.pump();
        final label = tester.widget<Text>(find.text(name));
        expect(label.style!.backgroundColor, isNull);
        expect(find.byType(Image), findsNothing);
        expect(label.style!.fontSize, 18);
        expect(label.style!.fontWeight, FontWeight.w600);
        final fills = <Color>[];
        for (final name in ['Sage', 'Cyan', 'Lavender']) {
          final box = tester.widget<Container>(
            find
                .ancestor(of: find.text(name), matching: find.byType(Container))
                .first,
          );
          fills.add((box.decoration! as BoxDecoration).color!);
        }
        expect(fills.toSet(), hasLength(3));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
        catalog.dispose();
        root.dispose();
      },
    );
  }

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
    'cached catalogue paints before a wide-area request can finish',
    () async {
      const category = CatalogCategory(
        id: 'hot',
        name: 'Calientes',
        displayOrder: 0,
        enabled: true,
        color: null,
      );
      final hot = product(
        'hot-latte',
        name: 'Latte caliente',
        category: category.toJson(),
      );
      final snapshot = LocalCatalogSnapshot(
        categories: const [category],
        products: [hot],
        catalogVersion: 'v1',
        updatedAt: '2026-07-28T00:00:00Z',
        nextCursor: null,
      );
      final repository = _WaitingCatalogRepository();
      final value = CatalogController(
        repository: repository,
        cache: CatalogCache(),
        telemetry: SafeTelemetry(
          enabled: true,
          context: TelemetryContext.current(testConfig),
          exporter: RecordingExporter(),
        ),
        workingCopy: _LocalCatalog(snapshot, {'hot': snapshot}),
      );

      await value.open(partition);
      expect(value.state.phase, CatalogPhase.ready);
      expect(value.state.products.single.name, 'Latte caliente');

      await value.selectCategory('hot');
      expect(value.state.phase, CatalogPhase.ready);
      expect(value.state.selectedCategoryId, 'hot');
      expect(value.state.products.single.id, 'hot-latte');
      value.dispose();
    },
  );

  test('scanner lookup uses the exact barcode query', () async {
    final repository = FakeCatalogRepository();
    final value = controller(repository);
    await value.open(partition);
    final matches = await value.lookupBarcode('7501000000002');
    expect(repository.lastBarcode, '7501000000002');
    expect(matches, hasLength(1));
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

  testWidgets('virtualized catalog surface renders authoritative product data', (
    tester,
  ) async {
    final repository = FakeCatalogRepository();
    final value = controller(repository);
    await value.open(partition);
    final root = testRoot();
    await tester.pumpWidget(
      PosApp(
        locale: const Locale('es'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: const [
          AppLocalizations.delegate,

          GlobalWidgetsLocalizations.delegate,
        ],
        home: CatalogSurface(
          entry: root.entry,
          catalog: value,
          cart: root.cart,
          cash: root.cash,
          checkout: root.checkout,
          sales: root.sales,
          exceptions: root.exceptions,
          connectivity: root.connectivity,
          telemetry: root.telemetry,
        ),
      ),
    );
    await tester.pump();
    expect(find.text('Café'), findsOneWidget);
    expect(find.byType(GridView), findsOneWidget);
    // The tile's price, once and in the till's own shape. Rewriting the card's
    // amount without removing the currency it used to prefix printed
    // `MXN MXN 45.00` on the iMin D3-504 on 2026-10-11 and no test noticed,
    // because none of them read the tile's money.
    expect(find.text('MXN 45.00'), findsOneWidget);
    expect(find.textContaining('MXN MXN'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    value.dispose();
    root.dispose();
  });

  for (final size in const [
    Size(402, 874),
    Size(412, 915),
    Size(820, 1180),
    Size(800, 1340),
    Size(1340, 800),
    Size(1440, 1000),
  ]) {
    testWidgets('category selection stays readable beside products at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final repository = FakeCatalogRepository(
        categoryItems: const [
          {
            'id': 'drinks',
            'name': 'Bebidas',
            'displayOrder': 0,
            'enabled': true,
            'color': '#67e8f9',
          },
          {
            'id': 'desserts',
            'name': 'Postres',
            'displayOrder': 1,
            'enabled': true,
            'color': null,
          },
        ],
      );
      final value = controller(repository);
      await value.open(partition);
      final root = testRoot();
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('La carta'), findsOneWidget);
      expect(find.text('umi'), findsOneWidget);
      Rect ear(String label) => tester.getRect(
        find.ancestor(
          of: find.text(label),
          matching: find.byType(PosTapRegion),
        ),
      );
      bool chosen(String label) =>
          tester
              .widget<PosTapRegion>(
                find.ancestor(
                  of: find.text(label),
                  matching: find.byType(PosTapRegion),
                ),
              )
              .selected ??
          false;
      final first = ear('Todo');
      final drinks = ear('Bebidas');
      final desserts = ear('Postres');
      expect(drinks.left, greaterThanOrEqualTo(first.right));
      expect(desserts.left, greaterThanOrEqualTo(drinks.right));
      final products = tester.getRect(
        find.byKey(const PageStorageKey('catalog-grid')),
      );
      expect(drinks.bottom, lessThanOrEqualTo(products.top));
      if (size.width >= 700) {
        final account = tester.getRect(
          find.byKey(const ValueKey('catalog-account')),
        );
        expect(products.right, lessThanOrEqualTo(account.left));
      }
      final categoryText = tester.widget<Text>(find.text('Bebidas'));
      final categoryContainer = tester.widget<Container>(
        find
            .ancestor(
              of: find.text('Bebidas'),
              matching: find.byType(Container),
            )
            .first,
      );
      final softened = HSLColor.fromColor(
        (categoryContainer.decoration! as BoxDecoration).color!,
      );
      expect(softened.saturation, lessThan(.36));
      expect(softened.lightness, greaterThan(.70));
      expect(
        softened.hue,
        closeTo(HSLColor.fromColor(const Color(0xFF67E8F9)).hue, 3),
      );
      final allContainer = tester.widget<Container>(
        find
            .ancestor(of: find.text('Todo'), matching: find.byType(Container))
            .first,
      );
      expect(
        (allContainer.decoration! as BoxDecoration).color,
        const Color(0xFFCDD2DF),
      );
      final foreground = categoryText.style!.color!.computeLuminance();
      final background = (categoryContainer.decoration! as BoxDecoration).color!
          .computeLuminance();
      final contrast =
          ((foreground > background ? foreground : background) + .05) /
          ((foreground < background ? foreground : background) + .05);
      expect(contrast, greaterThanOrEqualTo(4.5));
      expect(chosen('Todo'), isTrue);
      expect(chosen('Bebidas'), isFalse);
      expect(drinks.height, greaterThanOrEqualTo(UmiTouchTarget.minimum - .01));
      await tester.ensureVisible(find.text('Postres'));
      await tester.tap(find.text('Postres'));
      await tester.pump();
      expect(value.state.selectedCategoryId, 'desserts');
      expect(chosen('Postres'), isTrue);
      expect(chosen('Bebidas'), isFalse);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    });
  }

  testWidgets(
    'an unavailable product is dimmed, says "No disponible", and its tap never reaches the cart',
    (tester) async {
      // The owner's requirement, said in the till's words: a product the café marked
      // unavailable stays on the grid (the barista has to recognise it), the card dims,
      // the words ride on top, and the tap answers instead of ringing a line the API
      // would refuse — which is how 28 taps became a "most ordered" #2 that never sold.
      final repository = FakeCatalogRepository(
        productName: 'Rollo de canela',
        productAvailability: 'temporarily_unavailable',
      );
      final value = controller(repository);
      await value.open(partition);
      final root = testRoot();
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Rollo de canela'), findsOneWidget);
      expect(find.text('No disponible'), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) => widget is Opacity && widget.opacity == .45,
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('Rollo de canela'));
      await tester.pump();

      expect(
        find.textContaining('no está disponible en esta sucursal'),
        findsOneWidget,
        reason: 'the tap must answer, not silently ring a line the API refuses',
      );

      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    },
  );

  testWidgets(
    'a product key shows its full name without a decorative photo or initials',
    (tester) async {
      // The tile carries the owner's colour and the product's own letters, and nothing
      // else. The owner removed the line drawing that used to sit behind the letters on
      // 2026-10-11: this is the previous design's behaviour, kept as one rule for every
      // catalogue view. The colour comes from the dashboard's `Categorías` screen.
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final repository = FakeCatalogRepository(
        productName: 'Croissant',
        productCategory: const {
          'id': 'c-pan',
          'name': 'Pan',
          'displayOrder': 1,
          'enabled': true,
          'color': '#f58231',
        },
      );
      final value = controller(repository);
      await value.open(partition);
      final root = testRoot();
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,

            GlobalWidgetsLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('CR'), findsNothing);
      expect(find.byType(Image), findsNothing);
      final name = tester.widget<Text>(find.text('Croissant'));
      expect(name.style!.fontSize, 18);
      expect(name.style!.fontWeight, FontWeight.w600);
      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    },
  );

  testWidgets('product detail presents variant and modifier inspectors with stacked keys', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final repository = FakeCatalogRepository(
      productHasVariants: true,
      mediumDelta: 1000,
      productHasModifiers: true,
    );
    final value = controller(repository);
    await value.open(partition);
    final root = testRoot();
    final prefs = DisplayPreferences(TestPreferences());
    await prefs.load();
    addTearDown(prefs.dispose);
    await tester.pumpWidget(
      DisplayPreferencesScope(
        preferences: prefs,
        child: PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,

            GlobalWidgetsLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.tap(find.text('Café'));
    await tester.pumpAndSettle();

    final variant = find
        .ancestor(of: find.text('Mediano'), matching: find.byType(PosTapRegion))
        .first;
    expect(
      find.descendant(of: variant, matching: find.text('+MXN 10.00')),
      findsOneWidget,
    );
    expect(find.text('Incluido'), findsNWidgets(2));
    expect(find.byKey(const ValueKey('product-detail-photo')), findsOneWidget);
    await prefs.setShowProductPhotos(false);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('product-detail-photo')), findsNothing);
    expect(find.byType(RawScrollbar), findsWidgets);
    final small = tester.getTopLeft(find.text('Chico'));
    final medium = tester.getTopLeft(find.text('Mediano'));
    final large = tester.getTopLeft(find.text('Grande'));
    expect(small.dx, medium.dx);
    expect(medium.dx, large.dx);
    expect(small.dy, lessThan(medium.dy));
    expect(medium.dy, lessThan(large.dy));

    // Every option tile in a row is the same size, whether or not it carries a
    // surcharge. The tile with a price used to be one line taller than the one
    // without, which is the disproportion the owner reported from the till, and
    // "Leche entera" above is the surcharge that reproduces it.
    final plain = tester.getSize(
      find
          .ancestor(
            of: find.text('Leche de avena'),
            matching: find.byType(SizedBox),
          )
          .first,
    );
    final withPrice = tester.getSize(
      find
          .ancestor(
            of: find.text('Leche entera'),
            matching: find.byType(SizedBox),
          )
          .first,
    );
    expect(plain, withPrice);
    expect(plain.width, greaterThanOrEqualTo(160));

    // AND THE NAME SITS IN THE MIDDLE OF ITS TILE.
    //
    // The tile is stretched to the tallest in its row, so a tile with no price
    // used to draw an EMPTY price line under its name and the name ended up above
    // the centre — which is what the owner saw and reported as "centra el texto
    // verticalmente" (2026-10-12). The row centres what it is given; the bug was
    // being handed a blank line.
    final tileRect = tester.getRect(
      find
          .ancestor(
            of: find.text('Leche de avena'),
            matching: find.byType(SizedBox),
          )
          .first,
    );
    final labelRect = tester.getRect(find.text('Leche de avena'));
    expect((labelRect.center.dy - tileRect.center.dy).abs(), lessThan(1.5));

    // Selecting a choice changes its surface and border color without changing row geometry.
    await tester.tap(find.text('Leche entera'));
    await tester.pumpAndSettle();
    final selectedPlain = tester.getSize(
      find
          .ancestor(
            of: find.text('Leche de avena'),
            matching: find.byType(SizedBox),
          )
          .first,
    );
    final selectedWithPrice = tester.getSize(
      find
          .ancestor(
            of: find.text('Leche entera'),
            matching: find.byType(SizedBox),
          )
          .first,
    );
    expect(selectedPlain, selectedWithPrice);
    expect(selectedWithPrice.height, plain.height);

    await tester.tap(find.text('Catálogo'));
    await tester.pumpAndSettle();
    expect(find.text('Variantes'), findsNothing);
    expect(find.text('Café'), findsOneWidget);

    await tester.pumpWidget(const SizedBox());
    value.dispose();
    root.dispose();
  });
  for (final size in [const Size(1280, 720), const Size(375, 812)]) {
    testWidgets('product action stays visible while options scroll at $size', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 200);
      addTearDown(tester.view.reset);
      final value = controller(
        FakeCatalogRepository(
          productHasVariants: true,
          productHasModifiers: true,
        ),
      );
      await value.open(partition);
      final root = testRoot();
      await tester.pumpWidget(
        PosApp(
          locale: const Locale('es'),
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: const [
            AppLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
          ],
          home: CatalogSurface(
            entry: root.entry,
            catalog: value,
            cart: root.cart,
            cash: root.cash,
            checkout: root.checkout,
            sales: root.sales,
            exceptions: root.exceptions,
            connectivity: root.connectivity,
            telemetry: root.telemetry,
          ),
        ),
      );
      await tester.pump();
      await tester.tap(find.text('Café'));
      await tester.pump(const Duration(seconds: 1));
      final l = AppLocalizations.of(
        tester.element(find.byType(CatalogSurface)),
      );
      final action = find.widgetWithText(PosButton, l.addToCartAction);
      final before = tester.getRect(action);
      expect(before.bottom, lessThanOrEqualTo(size.height - 200));
      expect(before.top, greaterThanOrEqualTo(0));
      expect(tester.widget<PosButton>(action).onPressed, isNull);
      expect(find.text(l.productVariantRequiredHint), findsOneWidget);
      await tester.drag(find.byType(ListView).last, const Offset(0, -500));
      await tester.pump(const Duration(seconds: 1));
      expect(tester.getRect(action), before);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    });
  }
  testWidgets(
    'detail choices and note survive desktop-phone-desktop resizing',
    (tester) async {
      final semantics = tester.ensureSemantics();
      try {
        tester.view.physicalSize = const Size(1400, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final value = controller(
          FakeCatalogRepository(
            productHasVariants: true,
            productHasModifiers: true,
          ),
        );
        await value.open(partition);
        final root = testRoot();
        await tester.pumpWidget(
          PosApp(
            locale: const Locale('es'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: const [
              AppLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
            ],
            home: CatalogSurface(
              entry: root.entry,
              catalog: value,
              cart: root.cart,
              cash: root.cash,
              checkout: root.checkout,
              sales: root.sales,
              exceptions: root.exceptions,
              connectivity: root.connectivity,
              telemetry: root.telemetry,
            ),
          ),
        );
        await tester.pump();
        await tester.tap(find.text('Café'));
        await tester.pump(const Duration(seconds: 1));
        expect(
          tester.getSemantics(find.text('Chico')),
          isSemantics(isSelected: false, isButton: true),
        );
        await tester.tap(find.text('Chico'));
        await tester.pump();
        expect(
          tester.getSemantics(find.text('Chico')),
          isSemantics(isSelected: true, isButton: true),
        );
        await tester.scrollUntilVisible(
          find.byType(EditableText),
          100,
          scrollable: find
              .descendant(
                of: find.byType(ListView).last,
                matching: find.byType(Scrollable),
              )
              .first,
        );
        await tester.enterText(
          find.byType(EditableText),
          'Café de piñón · sin azúcar',
        );
        await tester.pump();
        for (final size in [const Size(375, 812), const Size(1400, 900)]) {
          tester.view.physicalSize = size;
          await tester.pump();
          await tester.scrollUntilVisible(
            find.text('Chico'),
            -100,
            scrollable: find
                .descendant(
                  of: find.byType(ListView).last,
                  matching: find.byType(Scrollable),
                )
                .first,
          );
          await tester.pump();
          expect(
            tester.getSemantics(find.text('Chico')),
            isSemantics(isSelected: true),
          );
          await tester.scrollUntilVisible(
            find.byType(EditableText),
            100,
            scrollable: find
                .descendant(
                  of: find.byType(ListView).last,
                  matching: find.byType(Scrollable),
                )
                .first,
          );
          await tester.pump();
          expect(
            tester
                .widget<EditableText>(find.byType(EditableText))
                .controller
                .text,
            'Café de piñón · sin azúcar',
          );
          expect(
            find.text('Elige una variante para agregar el producto.'),
            findsNothing,
          );
          expect(
            find.widgetWithText(PosButton, 'Agregar a la comanda'),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
        }
        await tester.pumpWidget(const SizedBox());
        value.dispose();
        root.dispose();
      } finally {
        semantics.dispose();
      }
    },
  );
}
