import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/storage/local_working_copy.dart';

const _scope = LocalCatalogScope('merchant-a', 'branch-a', 'es');

CatalogProductSummary _product(
  String id, {
  required String name,
  String categoryId = 'drinks',
}) => CatalogProductSummary(
  id: id,
  name: name,
  description: '$name description',
  sku: 'SKU-$id',
  hasBarcode: false,
  category: CatalogCategory(
    id: categoryId,
    name: 'Bebidas',
    displayOrder: 0,
    enabled: true,
    color: null,
  ).toJson(),
  price: const CatalogMoney(minorUnits: 4500, currency: 'MXN').toJson(),
  taxRateBasisPoints: 1600,
  saleAction: 'merchandise',
  availability: 'enabled',
  availableFrom: null,
  primaryMedia: null,
  hasVariants: false,
  hasModifiers: false,
  updatedAt: '2026-10-16T12:00:00Z',
);

CatalogCategoriesResponse _categories() => const CatalogCategoriesResponse(
  items: [
    {
      'id': 'drinks',
      'name': 'Bebidas',
      'displayOrder': 0,
      'enabled': true,
      'color': null,
    },
    {
      'id': 'food',
      'name': 'Alimentos',
      'displayOrder': 1,
      'enabled': true,
      'color': '#FF8800',
    },
  ],
  catalogVersion: 'catalog-v2',
  updatedAt: '2026-10-16T12:00:00Z',
);

CatalogPage _page(List<CatalogProductSummary> products, {String? nextCursor}) =>
    CatalogPage(
      items: products.map((product) => product.toJson()).toList(),
      nextCursor: nextCursor,
      catalogVersion: 'catalog-v2',
      updatedAt: '2026-10-16T12:00:00Z',
    );

Cart _cart(String id, {String status = 'draft'}) => Cart(
  id: id,
  merchantId: 'merchant-a',
  locationId: 'branch-a',
  operatorSessionId: 'operator-a',
  status: status,
  accountName: 'Mesa $id',
  accountFolio: 'A-$id',
  createdAt: '2026-10-16T12:00:00Z',
  lifecycleState: 'building_cart',
  version: 1,
  firedOrderId: null,
  fulfillmentType: 'dine_in',
  items: const [],
  totals: const {
    'subtotal': {'minorUnits': 0, 'currency': 'MXN'},
    'tax': {'minorUnits': 0, 'currency': 'MXN'},
    'discounts': {
      'total': {'minorUnits': 0, 'currency': 'MXN'},
      'entries': <Map<String, Object?>>[],
    },
    'grandTotal': {'minorUnits': 0, 'currency': 'MXN'},
    'businessDate': '2026-10-16',
  },
  checkoutEnabled: false,
  checkoutMessageCode: 'CART_EMPTY',
  updatedAt: '2026-10-16T12:00:00Z',
);

void main() {
  late Directory temporary;
  late String databasePath;
  late SqliteLocalDatabase database;

  setUpAll(sqfliteFfiInit);

  setUp(() async {
    temporary = await Directory.systemTemp.createTemp('umipos-local-copy-');
    databasePath = '${temporary.path}/working-copy.sqlite';
    database = SqliteLocalDatabase(
      factory: databaseFactoryFfi,
      path: databasePath,
    );
    await database.initialize();
  });

  tearDown(() async {
    await database.securelyDelete();
    if (await temporary.exists()) await temporary.delete(recursive: true);
  });

  test(
    'opens the versioned SQLite schema and passes its integrity check',
    () async {
      expect(database.schemaVersion, 2);
      final health = await database.healthCheck();
      expect(health.available, isTrue);
      expect(health.category, 'available');
    },
  );

  test(
    'stores LAN peers as credential hashes and retires them on revoke',
    () async {
      final pairedAt = DateTime.now().toUtc().toIso8601String();
      await database.writeNetworkDevice(
        LocalNetworkDevice(
          merchantId: 'merchant-a',
          locationId: 'branch-a',
          deviceId: 'device-a',
          role: 'kds',
          stationId: 'station-a',
          address: '192.168.1.21',
          port: 4244,
          credentialHash: List.filled(64, 'a').join(),
          pairedAt: pairedAt,
          lastSeenAt: pairedAt,
          status: 'active',
        ),
      );
      final peer = await database.readNetworkDevice(
        'merchant-a',
        'branch-a',
        'device-a',
      );
      expect(peer?.credentialHash, List.filled(64, 'a').join());
      expect(peer?.role, 'kds');
      await database.deleteNetworkDevice('merchant-a', 'branch-a', 'device-a');
      expect(
        await database.readNetworkDevice('merchant-a', 'branch-a', 'device-a'),
        isNull,
      );
    },
  );

  test('lists local documents by namespace and scope', () async {
    await database.writeDocument(
      namespace: 'kds',
      scopeKey: 'merchant-a:branch-a',
      id: 'board',
      payload: const {'orders': <Object?>[]},
    );
    await database.writeDocument(
      namespace: 'kds',
      scopeKey: 'merchant-a:branch-b',
      id: 'board',
      payload: const {'orders': <Object?>[]},
    );
    final documents = await database.readDocuments(
      'kds',
      'merchant-a:branch-a',
    );
    expect(documents.map((document) => document.id), ['board']);
  });

  test(
    'catalogue survives a close and reopens with categories and products',
    () async {
      await database.writeCategories(_scope, _categories());
      await database.writeCatalogPage(
        _scope,
        _page([
          _product('latte', name: 'Latte'),
          _product('tea', name: 'Té'),
        ], nextCursor: 'page-2'),
      );

      await database.close();
      database = SqliteLocalDatabase(
        factory: databaseFactoryFfi,
        path: databasePath,
      );
      await database.initialize();

      final snapshot = await database.readCatalog(_scope);
      expect(snapshot, isNotNull);
      expect(snapshot!.categories.map((category) => category.id), [
        'drinks',
        'food',
      ]);
      expect(snapshot.products.map((product) => product.name), ['Latte', 'Té']);
      expect(snapshot.catalogVersion, 'catalog-v2');
      expect(snapshot.nextCursor, 'page-2');
    },
  );

  test(
    'category and search pages stay separate and retain server order',
    () async {
      await database.writeCategories(_scope, _categories());
      await database.writeCatalogPage(
        _scope,
        _page([_product('latte', name: 'Latte')]),
      );
      await database.writeCatalogPage(
        _scope,
        _page([_product('mocha', name: 'Mocha'), _product('tea', name: 'Té')]),
        categoryId: 'drinks',
      );
      await database.writeCatalogPage(
        _scope,
        _page([_product('taco', name: 'Taco', categoryId: 'food')]),
        search: 'TA',
      );

      expect(
        (await database.readCatalogPage(
          _scope,
          categoryId: 'drinks',
        ))!.products.map((product) => product.id),
        ['mocha', 'tea'],
      );
      expect(
        (await database.readCatalogPage(
          _scope,
          search: 'ta',
        ))!.products.map((product) => product.id),
        ['taco'],
      );
      expect(
        (await database.readCatalog(
          _scope,
        ))!.products.map((product) => product.id),
        ['latte'],
      );
    },
  );

  test(
    'a replacement page updates rows without blanking the last answer',
    () async {
      await database.writeCategories(_scope, _categories());
      await database.writeCatalogPage(
        _scope,
        _page([_product('latte', name: 'Latte')]),
      );
      await database.writeCatalogPage(
        _scope,
        _page([_product('latte', name: 'Latte grande')]),
      );

      final snapshot = await database.readCatalog(_scope);
      expect(snapshot!.products, hasLength(1));
      expect(snapshot.products.single.name, 'Latte grande');
    },
  );

  test('stores floor plan, open accounts and registered documents', () async {
    const floorQuery = PosFloorPlanQuery(
      locationId: 'branch-a',
      operatorSessionId: 'operator-a',
    );
    const floor = PublishedFloorPlan(
      locationId: 'branch-a',
      publishedVersion: 7,
      published: {'schemaVersion': 1, 'areas': <Map<String, Object?>>[]},
      publishedAt: '2026-10-16T12:00:00Z',
    );
    await database.writeFloorPlan('merchant-a', floorQuery, floor);
    expect(
      (await database.readFloorPlan(
        'merchant-a',
        floorQuery,
      ))!.publishedVersion,
      7,
    );

    const cartQuery = CartQuery(
      locationId: 'branch-a',
      operatorSessionId: 'operator-a',
    );
    await database.writeOpenAccounts('merchant-a', cartQuery, [
      _cart('one'),
      _cart('two'),
    ]);
    expect(
      (await database.readOpenAccounts(
        'merchant-a',
        cartQuery,
      ))!.map((cart) => cart.id),
      ['one', 'two'],
    );
    await database.writeOpenAccounts('merchant-a', cartQuery, [_cart('two')]);
    expect(
      (await database.readOpenAccounts(
        'merchant-a',
        cartQuery,
      ))!.map((cart) => cart.id),
      ['two'],
    );

    await database.writeDocument(
      namespace: 'device',
      scopeKey: 'merchant-a:branch-a',
      id: 'imin-main',
      payload: const {'role': 'main'},
      syncState: 'pending',
    );
    expect(
      await database.readDocument('device', 'merchant-a:branch-a', 'imin-main'),
      {'role': 'main'},
    );
  });
}
