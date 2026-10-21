import 'dart:async';

import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/observability/telemetry.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';
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
  primaryMedia: null,
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
  });

  /// What the one seeded product is called, and the category it carries. A test that
  /// cares about the tile's colour and letters sets both; the rest keep the defaults.
  final String productName;
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
          // One modifier carries a surcharge and the other does not, on purpose:
          // the surcharge adds a second line to its tile, and that is the case
          // that used to leave two tiles in one row at different heights.
          {
            'id': 'whole',
            'name': 'Leche entera',
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

  testWidgets('the category index stacks its ears and opens the one chosen', (
    tester,
  ) async {
    final repository = FakeCatalogRepository(
      categoryItems: const [
        {
          'id': 'drinks',
          'name': 'Bebidas',
          'displayOrder': 0,
          'enabled': true,
          'color': '#1E6F8C',
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

    Rect ear(String label) => tester.getRect(
      find.ancestor(of: find.text(label), matching: find.byType(PosTapRegion)),
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
    // The dividers wear their labels in capitals: the raised text is what the
    // operator reads on the ear, and the test taps and measures that text.
    final first = ear('TODO');
    final drinks = ear('BEBIDAS');
    final desserts = ear('POSTRES');
    // The ears tuck under each other, so a row of separate buttons would start
    // each one after the last instead of over it.
    expect(drinks.left, lessThan(first.right));
    expect(desserts.left, lessThan(drinks.right));
    // One divider is open at a time. The ear inside the box is what changes
    // height with the choice; the box stays on the till's touch floor.
    expect(chosen('TODO'), isTrue);
    expect(chosen('BEBIDAS'), isFalse);
    expect(chosen('POSTRES'), isFalse);
    expect(drinks.height, greaterThanOrEqualTo(UmiTouchTarget.minimum));
    expect(drinks.height, desserts.height);

    await tester.tap(find.text('POSTRES'));
    await tester.pump();
    expect(value.state.selectedCategoryId, 'desserts');
    expect(chosen('POSTRES'), isTrue);
    expect(chosen('BEBIDAS'), isFalse);

    await tester.pumpWidget(const SizedBox());
    value.dispose();
    root.dispose();
  });

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
    'a product with no photo is a block of its category colour with its initials',
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

      // The initials are the product's, not the category's: "Croissant" reads CR.
      expect(find.text('CR'), findsOneWidget);
      // The card and the page are ColoredBoxes too; the innermost ancestor of the letters is
      // the block itself.
      final block = find
          .ancestor(of: find.text('CR'), matching: find.byType(ColoredBox))
          .first;
      expect(tester.widget<ColoredBox>(block).color, const Color(0xFFF58231));
      // A light owner colour would wash white letters out, so the ink follows luminance.
      final letters = tester.widget<Text>(find.text('CR'));
      expect(letters.style?.color, const Color(0xFFFFFFFF));
      // No drawing and no corner badge: the block and the letters are the whole tile. Scoped to
      // the tile because the icons elsewhere on the card are painted, on purpose.
      expect(
        find.descendant(of: block, matching: find.byType(CustomPaint)),
        findsNothing,
      );

      await tester.pumpWidget(const SizedBox());
      value.dispose();
      root.dispose();
    },
  );

  testWidgets('product detail keeps variant choices horizontal inside its scroll surface', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final repository = FakeCatalogRepository(
      productHasVariants: true,
      productHasModifiers: true,
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
    await tester.tap(find.text('Café'));
    await tester.pumpAndSettle();

    expect(find.byType(RawScrollbar), findsWidgets);
    final small = tester.getCenter(find.text('Chico'));
    final medium = tester.getCenter(find.text('Mediano'));
    final large = tester.getCenter(find.text('Grande'));
    expect(small.dy, medium.dy);
    expect(medium.dy, large.dy);

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
    expect(plain.width, 200);

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

    // And it stays level when one of them is SELECTED: a selected tile draws a
    // 2 px border where an unselected one draws 1 px, which used to be absorbed
    // by a pinned tile height and painted a "BOTTOM OVERFLOWED" stripe in a
    // debug build. Now the row grows by those 2 px and both tiles grow with it.
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
    expect(selectedWithPrice.height, plain.height + 2);

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
