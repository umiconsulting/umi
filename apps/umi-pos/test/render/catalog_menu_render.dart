import 'dart:io';

import 'package:flutter/services.dart' show FontLoader, rootBundle;
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

import '../support/fakes.dart';

/// Renders the menu, so a human can judge the folder tabs that index it.
///
/// This file is deliberately **not** named `*_test.dart`: it writes PNGs, which
/// a CI suite must not do on its own. Run it by name:
///
///   RENDER_THEME=dark flutter test test/render/catalog_menu_render.dart \
///     --update-goldens
///
/// The images land in `test/render/shots/`. `RENDER_VIEWPORT` takes `WxH` and
/// defaults to `1920x1080`, the terminal this screen was designed against;
/// `RENDER_TEXT_SCALE` doubles the type, which is the scale the tabs have to
/// survive.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final themeName = Platform.environment['RENDER_THEME'] ?? 'light';
  final viewport = _parseViewport(
    Platform.environment['RENDER_VIEWPORT'] ?? '1920x1080',
  );
  final textScale =
      double.tryParse(Platform.environment['RENDER_TEXT_SCALE'] ?? '') ?? 1.0;
  final theme = switch (themeName) {
    'midnight' => UmiTheme.midnight(),
    'dark' => UmiTheme.dark(),
    _ => UmiTheme.light(),
  };
  final pixelRatio =
      double.tryParse(Platform.environment['RENDER_PIXEL_RATIO'] ?? '') ?? 1.0;

  setUpAll(() async {
    // Without the product's own faces the label metrics are the test font's, and
    // the ear heights under review would be the wrong ones.
    final body = FontLoader('IBM Plex Sans');
    for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
      body.addFont(rootBundle.load('assets/fonts/IBMPlexSans-$weight.ttf'));
    }
    await body.load();
    final headings = FontLoader('Bricolage Grotesque');
    for (final weight in ['SemiBold', 'Bold']) {
      headings.addFont(
        rootBundle.load('assets/fonts/BricolageGrotesque12pt-$weight.ttf'),
      );
    }
    await headings.load();
  });

  testWidgets('menu index as folder tabs', (tester) async {
    final root = testRoot();
    final catalog = CatalogController(
      repository: _MenuRepository(),
      cache: CatalogCache(),
      telemetry: root.telemetry,
    );
    await catalog.open(const CatalogPartition('tenant-a', 'branch-a', 'es'));

    tester.view.physicalSize = viewport;
    tester.view.devicePixelRatio = pixelRatio;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    tester.platformDispatcher.textScaleFactorTestValue = textScale;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    addTearDown(root.dispose);
    addTearDown(catalog.dispose);

    await tester.pumpWidget(
      RepaintBoundary(
        child: PosApp(
          theme: theme,
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
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    Directory('test/render/shots').createSync(recursive: true);
    final size = '${viewport.width.toInt()}x${viewport.height.toInt()}';
    await expectLater(
      find.byType(PosApp),
      matchesGoldenFile(
        'shots/catalog-menu-$themeName'
        '${textScale == 1.0 ? '' : '-text${textScale.toInt()}'}-$size.png',
      ),
    );
  });
}

/// A menu with enough dividers to judge the index: four categories, one of them
/// disabled, and colours of both tints so the ink rule on an ear is visible.
final class _MenuRepository implements CatalogRepository {
  static const _categories = [
    ('cat-cafe', 'Café de olla', '#8C4A2F'),
    ('cat-pan', 'Panadería', '#C9A227'),
    ('cat-frio', 'Bebidas frías', '#1E6F8C'),
    ('cat-postre', 'Postres', null),
    ('cat-snack', 'Botanas de la casa', '#2F6B3C'),
  ];

  @override
  Future<CatalogCategoriesResponse> categories(
    CatalogPartition partition,
  ) async => CatalogCategoriesResponse(
    items: [
      for (final (index, (id, name, color)) in _categories.indexed)
        CatalogCategory(
          id: id,
          name: name,
          displayOrder: index,
          // The last divider is a category an owner has switched off.
          enabled: index != _categories.length - 1,
          color: color,
        ).toJson(),
    ],
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
  }) async => CatalogPage(
    items: [
      for (final (id, name) in const [
        ('p1', 'Café de olla'),
        ('p2', 'Capuchino'),
        ('p3', 'Concha'),
        ('p4', 'Croissant'),
        ('p5', 'Latte helado'),
        ('p6', 'Agua de horchata'),
        ('p7', 'Pay de limón'),
        ('p8', 'Té chai'),
      ])
        CatalogProductSummary(
          id: id,
          name: name,
          description: null,
          sku: 'SKU-$id',
          hasBarcode: false,
          category: null,
          price: const CatalogMoney(minorUnits: 4500, currency: 'MXN').toJson(),
          taxRateBasisPoints: 1600,
          saleAction: 'merchandise',
          availability: 'enabled',
          availableFrom: null,
          primaryMedia: null,
          hasVariants: false,
          hasModifiers: false,
          updatedAt: '2026-07-28T00:00:00Z',
        ).toJson(),
    ],
    nextCursor: null,
    catalogVersion: 'v1',
    updatedAt: '2026-07-28T00:00:00Z',
  );

  @override
  Future<CatalogProductDetail> detail(
    CatalogPartition partition,
    String productId,
  ) async => throw UnimplementedError();
}

Size _parseViewport(String value) {
  final parts = value.split('x');
  if (parts.length != 2) return const Size(1920, 1080);
  return Size(
    double.tryParse(parts.first) ?? 1920,
    double.tryParse(parts.last) ?? 1080,
  );
}
