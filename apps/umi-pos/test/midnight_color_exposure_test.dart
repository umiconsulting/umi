import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/localization/app_localizations.dart';
import 'package:umi_pos/core/network/api_client.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';
import 'package:umi_pos/core/theme/umi_theme.dart';
import 'package:umi_pos/features/catalog/catalog_controller.dart';
import 'package:umi_pos/features/catalog/catalog_repository.dart';
import 'package:umi_pos/features/catalog/catalog_surface.dart';

import 'support/fakes.dart';

const _neutral = Color(0xFF0D0D0D);
const _category = <String, Object?>{
  'id': 'bread',
  'name': 'Pan',
  'displayOrder': 0,
  'enabled': true,
  'color': '#F28C28',
};

double _contrast(Color a, Color b) {
  final first = a.computeLuminance();
  final second = b.computeLuminance();
  return first > second
      ? (first + .05) / (second + .05)
      : (second + .05) / (first + .05);
}

final class _Repository implements CatalogRepository {
  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => CatalogCategoriesResponse(
    items: const [_category],
    catalogVersion: 'v1',
    updatedAt: '2026-10-12T00:00:00Z',
  );

  @override
  Future<CatalogPage> products(
    CatalogPartition partition, {
    String? categoryId,
    String? search,
    String? barcode,
    String? cursor,
    CancellationToken? cancellation,
  }) async => CatalogPage(
    items: [
      CatalogProductSummary(
        id: 'roll',
        name: 'Pan integral',
        description: null,
        sku: 'PAN-1',
        hasBarcode: false,
        category: _category,
        price: const CatalogMoney(minorUnits: 2500, currency: 'MXN').toJson(),
        taxRateBasisPoints: 0,
        saleAction: 'merchandise',
        availability: 'enabled',
        availableFrom: null,
        primaryMedia: null,
        hasVariants: false,
        hasModifiers: false,
        updatedAt: '2026-10-12T00:00:00Z',
      ).toJson(),
    ],
    nextCursor: null,
    catalogVersion: 'v1',
    updatedAt: '2026-10-12T00:00:00Z',
  );

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) => throw UnsupportedError('The test does not open product details.');
}

ShapeDecoration _buttonDecoration(WidgetTester tester) =>
    tester
            .widget<DecoratedBox>(
              find
                  .descendant(
                    of: find.byType(PosButton),
                    matching: find.byType(DecoratedBox),
                  )
                  .first,
            )
            .decoration
        as ShapeDecoration;

void main() {
  testWidgets(
    'Midnight photo-free keys retain readable category color and accessible selection',
    (tester) async {
      tester.view.physicalSize = const Size(1400, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final semantics = tester.ensureSemantics();
      try {
        final root = testRoot();
        final catalog = CatalogController(
          repository: _Repository(),
          cache: CatalogCache(),
          telemetry: root.telemetry,
        );
        addTearDown(root.dispose);
        addTearDown(catalog.dispose);
        await catalog.open(
          const CatalogPartition('tenant-a', 'branch-a', 'es'),
        );
        await tester.pumpWidget(
          PosApp(
            themeMode: PosThemeMode.midnight,
            midnightTheme: UmiTheme.midnight(),
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

        final product = find.byKey(const ValueKey('product-key-roll'));
        final surface = tester.widget<Container>(
          find
              .descendant(
                of: product,
                matching: find.byWidgetPredicate(
                  (widget) =>
                      widget is Container && widget.decoration is BoxDecoration,
                ),
              )
              .first,
        );
        final background = (surface.decoration! as BoxDecoration).color!;
        final foreground = tester
            .widget<Text>(find.text('Pan integral'))
            .style!
            .color!;
        expect(background.computeLuminance(), lessThan(.1));
        expect(_contrast(foreground, background), greaterThanOrEqualTo(4.5));
        expect(find.text('PI'), findsNothing);
        expect(find.byType(Image), findsNothing);

        final tab = find.descendant(
          of: find.byKey(const ValueKey('catalog-category-index')),
          matching: find.text('Pan'),
        );
        final tabRegion = find.ancestor(
          of: tab,
          matching: find.byType(PosTapRegion),
        );
        final tabSurface = tester.widget<Container>(
          find
              .descendant(
                of: tabRegion,
                matching: find.byWidgetPredicate(
                  (widget) =>
                      widget is Container && widget.decoration is BoxDecoration,
                ),
              )
              .first,
        );
        final fill = (tabSurface.decoration! as BoxDecoration).color!;
        final ink = tester.widget<Text>(tab).style!.color!;
        expect(fill.computeLuminance(), lessThan(.1));
        expect(_contrast(ink, fill), greaterThanOrEqualTo(4.5));
        expect(tester.widget<PosTapRegion>(tabRegion).selected, isFalse);
        await tester.tap(tab);
        await tester.pump();
        expect(catalog.state.selectedCategoryId, 'bread');
        expect(tester.widget<PosTapRegion>(tabRegion).selected, isTrue);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      } finally {
        semantics.dispose();
      }
    },
  );

  testWidgets(
    'Midnight filled button has readable ink and disabled loses signal',
    (tester) async {
      var enabled = true;
      var taps = 0;
      late StateSetter update;
      await tester.pumpWidget(
        PosApp(
          themeMode: PosThemeMode.midnight,
          midnightTheme: UmiTheme.midnight(),
          home: StatefulBuilder(
            builder: (_, state) {
              update = state;
              return PosPage(
                body: Center(
                  child: PosButton(
                    onPressed: enabled ? () => taps++ : null,
                    child: const Text('Continuar'),
                  ),
                ),
              );
            },
          ),
        ),
      );
      final decoration = _buttonDecoration(tester);
      final foreground = DefaultTextStyle.of(
        tester.element(find.text('Continuar')),
      ).style.color!;
      expect(decoration.color, const Color(0xFF111A2E));
      expect(foreground, const Color(0xFFA8BBDE));
      expect(
        _contrast(foreground, decoration.color!),
        greaterThanOrEqualTo(4.5),
      );
      expect(
        (decoration.shape as RoundedRectangleBorder).side.color,
        const Color(0xFF7692CB),
      );
      await tester.tap(find.text('Continuar'));
      await tester.pump();
      expect(taps, 1);
      update(() => enabled = false);
      await tester.pump();
      final disabled = _buttonDecoration(tester);
      expect(disabled.color, _neutral);
      expect((disabled.shape as RoundedRectangleBorder).side, BorderSide.none);
      await tester.tap(find.text('Continuar'));
      await tester.pump();
      expect(taps, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
