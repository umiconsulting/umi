import 'dart:ui' as ui;

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

const _orange = Color(0xFFF28C28);
const _neutral = Color(0xFF0D0D0D);
const _ink = Color(0xFFF2F2F2);
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
    'Midnight limits category color and retains accessible selection',
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

        final initials = find.text('PI');
        final background = tester
            .widget<ColoredBox>(
              find
                  .ancestor(of: initials, matching: find.byType(ColoredBox))
                  .first,
            )
            .color;
        final foreground = tester.widget<Text>(initials).style!.color!;
        expect(background, _neutral);
        expect(foreground, _ink);
        expect(_contrast(foreground, background), greaterThanOrEqualTo(4.5));

        final product = find
            .ancestor(of: initials, matching: find.byType(PosTapRegion))
            .first;
        final band = find.descendant(
          of: product,
          matching: find.byWidgetPredicate(
            (widget) => widget is ColoredBox && widget.color == _orange,
          ),
        );
        expect(band, findsOneWidget);
        expect(tester.getSize(band).height, 8);
        expect(
          tester.getSize(band).height,
          lessThan(tester.getSize(product).height / 5),
        );

        // The divider wears its label in capitals; the category above keeps the
        // name it was seeded with.
        final tab = find.text('PAN');
        expect(tester.widget<Text>(tab).style!.color, _ink);
        expect(
          tester.getSemantics(tab),
          isSemantics(isButton: true, isSelected: false),
        );
        final paintedTab = find
            .ancestor(of: tab, matching: find.byType(CustomPaint))
            .first;
        final size = tester.getSize(paintedTab);
        final painter = tester.widget<CustomPaint>(paintedTab).painter!;
        final recorder = ui.PictureRecorder();
        painter.paint(ui.Canvas(recorder), size);
        final picture = recorder.endRecording();
        final pixels = await tester.runAsync(() async {
          final image = await picture.toImage(
            size.width.ceil(),
            size.height.ceil(),
          );
          final bytes = await image.toByteData(
            format: ui.ImageByteFormat.rawRgba,
          );
          image.dispose();
          return bytes!;
        });
        picture.dispose();
        var orangePixels = 0;
        var neutralPixels = 0;
        for (var i = 0; i < pixels!.lengthInBytes; i += 4) {
          final color = Color.fromARGB(
            pixels.getUint8(i + 3),
            pixels.getUint8(i),
            pixels.getUint8(i + 1),
            pixels.getUint8(i + 2),
          );
          if (color == _orange) orangePixels++;
          if (color == _neutral) neutralPixels++;
        }
        final pixelCount = pixels.lengthInBytes / 4;
        expect(orangePixels, greaterThan(0));
        expect(orangePixels / pixelCount, lessThan(.3));
        expect(neutralPixels / pixelCount, greaterThan(.3));
        await tester.tap(tab);
        await tester.pump();
        expect(catalog.state.selectedCategoryId, 'bread');
        expect(
          tester.getSemantics(tab),
          isSemantics(isButton: true, isSelected: true),
        );
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
