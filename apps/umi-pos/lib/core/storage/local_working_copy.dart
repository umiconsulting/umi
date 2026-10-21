import 'dart:convert';

import 'package:sqflite/sqflite.dart';
import 'package:umi_contract/umi_contract.dart';

import 'local_database_location_stub.dart'
    if (dart.library.io) 'local_database_location_io.dart';
import 'storage.dart';

/// A durable, queryable copy of the data an operator needs to paint a screen.
///
/// The API remains the authority. This store answers only what the device has
/// already received and keeps the last server answer available during a refresh.
abstract interface class LocalWorkingCopy {
  int get schemaVersion;
  Future<void> initialize();

  Future<LocalCatalogSnapshot?> readCatalog(LocalCatalogScope partition);
  Future<LocalCatalogSnapshot?> readCatalogPage(
    LocalCatalogScope partition, {
    String? categoryId,
    String? search,
    String? barcode,
  });
  Future<void> writeCategories(
    LocalCatalogScope partition,
    CatalogCategoriesResponse response,
  );
  Future<void> writeCatalogPage(
    LocalCatalogScope partition,
    CatalogPage page, {
    String? categoryId,
    String? search,
    String? barcode,
    bool append = false,
  });
  Future<CatalogProductDetail?> readProductDetail(
    LocalCatalogScope partition,
    String productId,
  );
  Future<void> writeProductDetail(
    LocalCatalogScope partition,
    CatalogProductDetail detail,
  );

  Future<PublishedFloorPlan?> readFloorPlan(
    String merchantId,
    PosFloorPlanQuery query,
  );
  Future<void> writeFloorPlan(
    String merchantId,
    PosFloorPlanQuery query,
    PublishedFloorPlan plan,
  );

  Future<List<Cart>?> readOpenAccounts(String merchantId, CartQuery query);
  Future<void> writeOpenAccounts(
    String merchantId,
    CartQuery query,
    List<Cart> accounts,
  );
  Future<Cart?> readCart(String merchantId, String cartId);
  Future<void> writeCart(Cart cart);
  Future<List<Cart>> readFiredCarts(String merchantId, String locationId);

  Future<Map<String, Object?>?> readDocument(
    String namespace,
    String scopeKey,
    String id,
  );
  Future<void> writeDocument({
    required String namespace,
    required String scopeKey,
    required String id,
    required Map<String, Object?> payload,
    String syncState = 'synced',
  });
  Future<List<LocalDocument>> readDocuments(String namespace, String scopeKey);
  Future<void> deleteDocument(String namespace, String scopeKey, String id);

  Future<LocalNetworkDevice?> readNetworkDevice(
    String merchantId,
    String locationId,
    String deviceId,
  );
  Future<List<LocalNetworkDevice>> readNetworkDevices(
    String merchantId,
    String locationId,
  );
  Future<void> writeNetworkDevice(LocalNetworkDevice device);
  Future<void> deleteNetworkDevice(
    String merchantId,
    String locationId,
    String deviceId,
  );
}

final class LocalDocument {
  const LocalDocument({
    required this.id,
    required this.payload,
    required this.updatedAt,
    required this.syncState,
  });

  final String id;
  final Map<String, Object?> payload;
  final String updatedAt;
  final String syncState;
}

final class LocalNetworkDevice {
  const LocalNetworkDevice({
    required this.merchantId,
    required this.locationId,
    required this.deviceId,
    required this.role,
    required this.stationId,
    required this.address,
    required this.port,
    required this.credentialHash,
    required this.pairedAt,
    required this.lastSeenAt,
    required this.status,
  });

  final String merchantId;
  final String locationId;
  final String deviceId;
  final String role;
  final String? stationId;
  final String? address;
  final int? port;
  final String credentialHash;
  final String pairedAt;
  final String lastSeenAt;
  final String status;

  LocalNetworkDevice seen({String? address, int? port, String? at}) =>
      LocalNetworkDevice(
        merchantId: merchantId,
        locationId: locationId,
        deviceId: deviceId,
        role: role,
        stationId: stationId,
        address: address ?? this.address,
        port: port ?? this.port,
        credentialHash: credentialHash,
        pairedAt: pairedAt,
        lastSeenAt: at ?? DateTime.now().toUtc().toIso8601String(),
        status: status,
      );
}

final class LocalCatalogScope {
  const LocalCatalogScope(this.merchantId, this.locationId, this.locale);

  final String merchantId;
  final String locationId;
  final String locale;

  String get key => '$merchantId:$locationId:$locale';
}

final class LocalCatalogSnapshot {
  const LocalCatalogSnapshot({
    required this.categories,
    required this.products,
    required this.catalogVersion,
    required this.updatedAt,
    required this.nextCursor,
  });

  final List<CatalogCategory> categories;
  final List<CatalogProductSummary> products;
  final String catalogVersion;
  final String updatedAt;
  final String? nextCursor;
}

/// SQLite working copy for UmiPOS.
///
/// The schema stores the contract JSON beside the indexes the till uses. A
/// contract field therefore survives a local round trip without a second model.
final class SqliteLocalDatabase implements LocalDatabase, LocalWorkingCopy {
  SqliteLocalDatabase({DatabaseFactory? factory, String? path})
    : _factoryOverride = factory,
      _pathOverride = path;

  factory SqliteLocalDatabase.openDefault() => SqliteLocalDatabase();

  static const _databaseFileName = 'umipos-working-copy.sqlite';
  static const _databaseVersion = 2;
  static const _catalogPageRoot = 'root';

  final DatabaseFactory? _factoryOverride;
  final String? _pathOverride;
  Future<Database>? _opening;
  Database? _database;

  @override
  int get schemaVersion => _databaseVersion;

  @override
  Future<void> initialize() async {
    await _open();
  }

  Future<void> close() async {
    final database = _database;
    _database = null;
    _opening = null;
    if (database != null) await database.close();
  }

  Future<Database> _open() {
    final current = _database;
    if (current != null) return Future.value(current);
    return _opening ??= _openOnce();
  }

  Future<Database> _openOnce() async {
    final DatabaseFactory factory;
    final String path;
    if (_factoryOverride != null && _pathOverride != null) {
      factory = _factoryOverride;
      path = _pathOverride;
    } else {
      final location = await _locateLocalDatabase();
      factory = _factoryOverride ?? location.factory;
      path = _pathOverride ?? location.path;
    }
    final database = await factory.openDatabase(
      path,
      options: OpenDatabaseOptions(
        version: _databaseVersion,
        onConfigure: (database) async {
          await database.execute('PRAGMA foreign_keys = ON');
        },
        onCreate: (database, version) async {
          await _createSchema(database);
        },
        onUpgrade: (database, oldVersion, newVersion) async {
          if (oldVersion < 2) {
            await _createNetworkDevices(database);
          }
          if (newVersion > _databaseVersion) {
            throw StateError(
              'Unsupported local database migration: $oldVersion to $newVersion',
            );
          }
        },
      ),
    );
    _database = database;
    return database;
  }

  Future<void> _createSchema(Database database) async {
    await database.execute('''
      CREATE TABLE local_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    ''');
    await database.execute('''
      CREATE TABLE catalog_partitions (
        partition_key TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        catalog_version TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        refreshed_at TEXT NOT NULL
      )
    ''');
    await database.execute('''
      CREATE TABLE catalog_categories (
        partition_key TEXT NOT NULL,
        category_id TEXT NOT NULL,
        display_order INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (partition_key, category_id),
        FOREIGN KEY (partition_key) REFERENCES catalog_partitions(partition_key)
          ON DELETE CASCADE
      )
    ''');
    await database.execute('''
      CREATE TABLE catalog_products (
        partition_key TEXT NOT NULL,
        product_id TEXT NOT NULL,
        category_id TEXT,
        product_name TEXT NOT NULL,
        search_text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (partition_key, product_id),
        FOREIGN KEY (partition_key) REFERENCES catalog_partitions(partition_key)
          ON DELETE CASCADE
      )
    ''');
    await database.execute('''
      CREATE INDEX catalog_products_category
        ON catalog_products(partition_key, category_id)
    ''');
    await database.execute('''
      CREATE TABLE catalog_pages (
        partition_key TEXT NOT NULL,
        filter_key TEXT NOT NULL,
        catalog_version TEXT NOT NULL,
        next_cursor TEXT,
        refreshed_at TEXT NOT NULL,
        PRIMARY KEY (partition_key, filter_key),
        FOREIGN KEY (partition_key) REFERENCES catalog_partitions(partition_key)
          ON DELETE CASCADE
      )
    ''');
    await database.execute('''
      CREATE TABLE catalog_page_products (
        partition_key TEXT NOT NULL,
        filter_key TEXT NOT NULL,
        product_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (partition_key, filter_key, product_id),
        FOREIGN KEY (partition_key) REFERENCES catalog_partitions(partition_key)
          ON DELETE CASCADE,
        FOREIGN KEY (partition_key, product_id)
          REFERENCES catalog_products(partition_key, product_id)
          ON DELETE CASCADE
      )
    ''');
    await database.execute('''
      CREATE INDEX catalog_page_products_order
        ON catalog_page_products(partition_key, filter_key, sort_order)
    ''');
    await database.execute('''
      CREATE TABLE catalog_product_details (
        partition_key TEXT NOT NULL,
        product_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (partition_key, product_id),
        FOREIGN KEY (partition_key) REFERENCES catalog_partitions(partition_key)
          ON DELETE CASCADE
      )
    ''');
    await database.execute('''
      CREATE TABLE floor_plans (
        scope_key TEXT PRIMARY KEY,
        merchant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        published_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        sync_state TEXT NOT NULL
      )
    ''');
    await database.execute('''
      CREATE TABLE carts (
        merchant_id TEXT NOT NULL,
        cart_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        location_id TEXT NOT NULL,
        operator_session_id TEXT NOT NULL,
        status TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        sync_state TEXT NOT NULL,
        PRIMARY KEY (merchant_id, cart_id)
      )
    ''');
    await database.execute('''
      CREATE INDEX carts_open_accounts
        ON carts(scope_key, deleted_at, updated_at)
    ''');
    await database.execute('''
      CREATE TABLE local_documents (
        namespace TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        document_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sync_state TEXT NOT NULL,
        PRIMARY KEY (namespace, scope_key, document_id)
      )
    ''');
    await _createNetworkDevices(database);
    await database.execute('INSERT INTO local_meta(key, value) VALUES (?, ?)', [
      'created_by',
      'umipos',
    ]);
  }

  Future<void> _createNetworkDevices(Database database) async {
    await database.execute('''
      CREATE TABLE IF NOT EXISTS network_devices (
        merchant_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        role TEXT NOT NULL,
        station_id TEXT,
        address TEXT,
        port INTEGER,
        credential_hash TEXT NOT NULL,
        paired_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (merchant_id, location_id, device_id)
      )
    ''');
    await database.execute('''
      CREATE INDEX IF NOT EXISTS network_devices_last_seen
        ON network_devices(merchant_id, location_id, last_seen_at)
    ''');
  }

  @override
  Future<StorageHealth> healthCheck() async {
    try {
      final rows = await (await _open()).rawQuery('PRAGMA quick_check');
      final value = rows.isEmpty ? null : rows.first.values.first;
      return StorageHealth(
        available: value == 'ok',
        category: value == 'ok' ? 'available' : 'sqlite_integrity_failed',
      );
    } catch (_) {
      return const StorageHealth(
        available: false,
        category: 'sqlite_unavailable',
      );
    }
  }

  @override
  Future<void> securelyDelete() async {
    await close();
    if (_factoryOverride != null && _pathOverride != null) {
      await _factoryOverride.deleteDatabase(_pathOverride);
      return;
    }
    final location = await _locateLocalDatabase();
    await (_factoryOverride ?? location.factory).deleteDatabase(
      _pathOverride ?? location.path,
    );
  }

  @override
  Future<LocalCatalogSnapshot?> readCatalog(LocalCatalogScope partition) =>
      readCatalogPage(partition);

  @override
  Future<LocalCatalogSnapshot?> readCatalogPage(
    LocalCatalogScope partition, {
    String? categoryId,
    String? search,
    String? barcode,
  }) async {
    final database = await _open();
    final filterKey = _filterKey(
      categoryId: categoryId,
      search: search,
      barcode: barcode,
    );
    final pages = await database.query(
      'catalog_pages',
      where: 'partition_key = ? AND filter_key = ?',
      whereArgs: [partition.key, filterKey],
      limit: 1,
    );
    if (pages.isEmpty) return null;
    final meta = await database.query(
      'catalog_partitions',
      where: 'partition_key = ?',
      whereArgs: [partition.key],
      limit: 1,
    );
    if (meta.isEmpty) return null;
    final pageVersion = pages.first['catalog_version'] as String?;
    final currentVersion = meta.first['catalog_version'] as String;
    if (pageVersion != currentVersion) return null;
    final categories = await database.query(
      'catalog_categories',
      where: 'partition_key = ? AND deleted_at IS NULL',
      whereArgs: [partition.key],
      orderBy: 'display_order, category_id',
    );
    final products = await database.rawQuery(
      '''
      SELECT p.payload_json
      FROM catalog_page_products pp
      JOIN catalog_products p
        ON p.partition_key = pp.partition_key
       AND p.product_id = pp.product_id
      WHERE pp.partition_key = ? AND pp.filter_key = ?
        AND p.deleted_at IS NULL
      ORDER BY pp.sort_order
      ''',
      [partition.key, filterKey],
    );
    return LocalCatalogSnapshot(
      categories: categories
          .map(
            (row) => CatalogCategory.fromJson(
              _decodeObject(row['payload_json'] as String),
            ),
          )
          .toList(growable: false),
      products: products
          .map(
            (row) => CatalogProductSummary.fromJson(
              _decodeObject(row['payload_json'] as String),
            ),
          )
          .toList(growable: false),
      catalogVersion: currentVersion,
      updatedAt: meta.first['updated_at'] as String,
      nextCursor: pages.first['next_cursor'] as String?,
    );
  }

  @override
  Future<void> writeCategories(
    LocalCatalogScope partition,
    CatalogCategoriesResponse response,
  ) async {
    final database = await _open();
    await database.transaction((transaction) async {
      final refreshedAt = DateTime.now().toUtc().toIso8601String();
      final values = {
        'partition_key': partition.key,
        'merchant_id': partition.merchantId,
        'location_id': partition.locationId,
        'locale': partition.locale,
        'catalog_version': response.catalogVersion,
        'updated_at': response.updatedAt,
        'refreshed_at': refreshedAt,
      };
      await transaction.insert(
        'catalog_partitions',
        values,
        conflictAlgorithm: ConflictAlgorithm.ignore,
      );
      await transaction.update(
        'catalog_partitions',
        values,
        where: 'partition_key = ?',
        whereArgs: [partition.key],
      );
      final batch = transaction.batch();
      for (final raw in response.items) {
        final category = CatalogCategory.fromJson(raw);
        batch.insert('catalog_categories', {
          'partition_key': partition.key,
          'category_id': category.id,
          'display_order': category.displayOrder,
          'payload_json': jsonEncode(category.toJson()),
          'deleted_at': null,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
    });
  }

  @override
  Future<void> writeCatalogPage(
    LocalCatalogScope partition,
    CatalogPage page, {
    String? categoryId,
    String? search,
    String? barcode,
    bool append = false,
  }) async {
    final database = await _open();
    final filterKey = _filterKey(
      categoryId: categoryId,
      search: search,
      barcode: barcode,
    );
    await database.transaction((transaction) async {
      final existing = await transaction.query(
        'catalog_partitions',
        columns: ['catalog_version', 'updated_at'],
        where: 'partition_key = ?',
        whereArgs: [partition.key],
        limit: 1,
      );
      final existingVersion = existing.isEmpty
          ? null
          : existing.first['catalog_version'] as String;
      final existingUpdatedAt = existing.isEmpty
          ? null
          : existing.first['updated_at'] as String;
      final refreshedAt = DateTime.now().toUtc().toIso8601String();
      final partitionValues = {
        'partition_key': partition.key,
        'merchant_id': partition.merchantId,
        'location_id': partition.locationId,
        'locale': partition.locale,
        'catalog_version': page.catalogVersion,
        'updated_at': page.updatedAt,
        'refreshed_at': refreshedAt,
      };
      await transaction.insert(
        'catalog_partitions',
        partitionValues,
        conflictAlgorithm: ConflictAlgorithm.ignore,
      );
      await transaction.update(
        'catalog_partitions',
        partitionValues,
        where: 'partition_key = ?',
        whereArgs: [partition.key],
      );

      int startOrder = 0;
      if (append) {
        final previous = await transaction.rawQuery(
          '''
          SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
          FROM catalog_page_products
          WHERE partition_key = ? AND filter_key = ?
          ''',
          [partition.key, filterKey],
        );
        startOrder = (previous.first['next_order'] as num).toInt();
      } else {
        await transaction.delete(
          'catalog_page_products',
          where: 'partition_key = ? AND filter_key = ?',
          whereArgs: [partition.key, filterKey],
        );
      }

      final batch = transaction.batch();
      for (var index = 0; index < page.items.length; index++) {
        final product = CatalogProductSummary.fromJson(page.items[index]);
        final category = product.category == null
            ? null
            : CatalogCategory.fromJson(product.category!);
        final searchText = [
          product.name,
          product.description ?? '',
          product.sku ?? '',
        ].join(' ').toLowerCase();
        batch.insert('catalog_products', {
          'partition_key': partition.key,
          'product_id': product.id,
          'category_id': category?.id,
          'product_name': product.name,
          'search_text': searchText,
          'updated_at': product.updatedAt,
          'payload_json': jsonEncode(product.toJson()),
          'deleted_at': null,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
        batch.insert('catalog_page_products', {
          'partition_key': partition.key,
          'filter_key': filterKey,
          'product_id': product.id,
          'sort_order': startOrder + index,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      batch.insert('catalog_pages', {
        'partition_key': partition.key,
        'filter_key': filterKey,
        'catalog_version': page.catalogVersion,
        'next_cursor': page.nextCursor,
        'refreshed_at': refreshedAt,
      }, conflictAlgorithm: ConflictAlgorithm.replace);
      await batch.commit(noResult: true);

      if (!append &&
          existingVersion != null &&
          existingVersion != page.catalogVersion) {
        await transaction.rawDelete(
          '''
          DELETE FROM catalog_products
          WHERE partition_key = ?
            AND product_id NOT IN (
              SELECT product_id
              FROM catalog_page_products
              WHERE partition_key = ?
            )
          ''',
          [partition.key, partition.key],
        );
      }
      if (existingUpdatedAt != null &&
          existingUpdatedAt != page.updatedAt &&
          !append) {
        await transaction.delete(
          'catalog_product_details',
          where: 'partition_key = ?',
          whereArgs: [partition.key],
        );
      }
    });
  }

  @override
  Future<CatalogProductDetail?> readProductDetail(
    LocalCatalogScope partition,
    String productId,
  ) async {
    final rows = await (await _open()).query(
      'catalog_product_details',
      columns: ['payload_json'],
      where: 'partition_key = ? AND product_id = ?',
      whereArgs: [partition.key, productId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return CatalogProductDetail.fromJson(
      _decodeObject(rows.first['payload_json'] as String),
    );
  }

  @override
  Future<void> writeProductDetail(
    LocalCatalogScope partition,
    CatalogProductDetail detail,
  ) async {
    final database = await _open();
    await database.insert('catalog_product_details', {
      'partition_key': partition.key,
      'product_id': detail.id,
      'payload_json': jsonEncode(detail.toJson()),
      'updated_at': detail.updatedAt,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<PublishedFloorPlan?> readFloorPlan(
    String merchantId,
    PosFloorPlanQuery query,
  ) async {
    final rows = await (await _open()).query(
      'floor_plans',
      columns: ['payload_json'],
      where: 'scope_key = ?',
      whereArgs: [_floorScope(merchantId, query)],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return PublishedFloorPlan.fromJson(
      _decodeObject(rows.first['payload_json'] as String),
    );
  }

  @override
  Future<void> writeFloorPlan(
    String merchantId,
    PosFloorPlanQuery query,
    PublishedFloorPlan plan,
  ) async {
    await (await _open()).insert('floor_plans', {
      'scope_key': _floorScope(merchantId, query),
      'merchant_id': merchantId,
      'location_id': query.locationId,
      'published_version': plan.publishedVersion,
      'payload_json': jsonEncode(plan.toJson()),
      'refreshed_at': DateTime.now().toUtc().toIso8601String(),
      'sync_state': 'synced',
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<List<Cart>?> readOpenAccounts(
    String merchantId,
    CartQuery query,
  ) async {
    final database = await _open();
    final scope = _cartScope(
      merchantId,
      query.locationId,
      query.operatorSessionId,
    );
    final known = await database.query(
      'carts',
      columns: ['cart_id'],
      where: 'scope_key = ?',
      whereArgs: [scope],
      limit: 1,
    );
    if (known.isEmpty) return null;
    final rows = await database.query(
      'carts',
      columns: ['payload_json'],
      where:
          'scope_key = ? AND deleted_at IS NULL '
          "AND status IN ('draft', 'prepared')",
      whereArgs: [scope],
      orderBy: 'sort_order, cart_id',
    );
    return rows
        .map(
          (row) => Cart.fromJson(_decodeObject(row['payload_json'] as String)),
        )
        .toList(growable: false);
  }

  @override
  Future<void> writeOpenAccounts(
    String merchantId,
    CartQuery query,
    List<Cart> accounts,
  ) async {
    final database = await _open();
    final scope = _cartScope(
      merchantId,
      query.locationId,
      query.operatorSessionId,
    );
    await database.transaction((transaction) async {
      final ids = accounts.map((cart) => cart.id).toList(growable: false);
      if (ids.isEmpty) {
        await transaction.update(
          'carts',
          {'deleted_at': DateTime.now().toUtc().toIso8601String()},
          where:
              'scope_key = ? AND deleted_at IS NULL '
              "AND status IN ('draft', 'prepared')",
          whereArgs: [scope],
        );
      } else {
        final placeholders = List.filled(ids.length, '?').join(', ');
        await transaction.rawUpdate(
          '''
          UPDATE carts
          SET deleted_at = ?
          WHERE scope_key = ? AND deleted_at IS NULL
            AND cart_id NOT IN ($placeholders)
          ''',
          [DateTime.now().toUtc().toIso8601String(), scope, ...ids],
        );
      }
      final batch = transaction.batch();
      for (var index = 0; index < accounts.length; index++) {
        final cart = accounts[index];
        batch.insert('carts', {
          'merchant_id': merchantId,
          'cart_id': cart.id,
          'scope_key': scope,
          'location_id': query.locationId,
          'operator_session_id': query.operatorSessionId,
          'status': cart.status,
          'sort_order': index,
          'payload_json': jsonEncode(cart.toJson()),
          'updated_at': cart.updatedAt,
          'deleted_at': null,
          'sync_state': 'synced',
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
    });
  }

  @override
  Future<Cart?> readCart(String merchantId, String cartId) async {
    final rows = await (await _open()).query(
      'carts',
      columns: ['payload_json'],
      where: 'merchant_id = ? AND cart_id = ? AND deleted_at IS NULL',
      whereArgs: [merchantId, cartId],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return Cart.fromJson(_decodeObject(rows.first['payload_json'] as String));
  }

  @override
  Future<void> writeCart(Cart cart) async {
    final scope = _cartScope(
      cart.merchantId,
      cart.locationId,
      cart.operatorSessionId,
    );
    await (await _open()).insert('carts', {
      'merchant_id': cart.merchantId,
      'cart_id': cart.id,
      'scope_key': scope,
      'location_id': cart.locationId,
      'operator_session_id': cart.operatorSessionId,
      'status': cart.status,
      'sort_order': 0,
      'payload_json': jsonEncode(cart.toJson()),
      'updated_at': cart.updatedAt,
      'deleted_at': null,
      'sync_state': 'synced',
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<List<Cart>> readFiredCarts(
    String merchantId,
    String locationId,
  ) async {
    final rows = await (await _open()).query(
      'carts',
      columns: ['payload_json'],
      where:
          'merchant_id = ? AND location_id = ? AND deleted_at IS NULL '
          "AND status IN ('draft', 'prepared')",
      whereArgs: [merchantId, locationId],
      orderBy: 'updated_at, cart_id',
    );
    return rows
        .map(
          (row) => Cart.fromJson(_decodeObject(row['payload_json'] as String)),
        )
        .where(
          (cart) =>
              cart.firedOrderId != null ||
              cart.items.any((item) => item['fired'] == true),
        )
        .toList(growable: false);
  }

  @override
  Future<Map<String, Object?>?> readDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async {
    final rows = await (await _open()).query(
      'local_documents',
      columns: ['payload_json'],
      where: 'namespace = ? AND scope_key = ? AND document_id = ?',
      whereArgs: [namespace, scopeKey, id],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return _decodeObject(rows.first['payload_json'] as String);
  }

  @override
  Future<void> writeDocument({
    required String namespace,
    required String scopeKey,
    required String id,
    required Map<String, Object?> payload,
    String syncState = 'synced',
  }) async {
    await (await _open()).insert('local_documents', {
      'namespace': namespace,
      'scope_key': scopeKey,
      'document_id': id,
      'payload_json': jsonEncode(payload),
      'updated_at': DateTime.now().toUtc().toIso8601String(),
      'sync_state': syncState,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<List<LocalDocument>> readDocuments(
    String namespace,
    String scopeKey,
  ) async {
    final rows = await (await _open()).query(
      'local_documents',
      columns: ['document_id', 'payload_json', 'updated_at', 'sync_state'],
      where: 'namespace = ? AND scope_key = ?',
      whereArgs: [namespace, scopeKey],
      orderBy: 'document_id',
    );
    return rows
        .map(
          (row) => LocalDocument(
            id: row['document_id'] as String,
            payload: _decodeObject(row['payload_json'] as String),
            updatedAt: row['updated_at'] as String,
            syncState: row['sync_state'] as String,
          ),
        )
        .toList(growable: false);
  }

  @override
  Future<void> deleteDocument(
    String namespace,
    String scopeKey,
    String id,
  ) async {
    await (await _open()).delete(
      'local_documents',
      where: 'namespace = ? AND scope_key = ? AND document_id = ?',
      whereArgs: [namespace, scopeKey, id],
    );
  }

  @override
  Future<LocalNetworkDevice?> readNetworkDevice(
    String merchantId,
    String locationId,
    String deviceId,
  ) async {
    final rows = await (await _open()).query(
      'network_devices',
      where: 'merchant_id = ? AND location_id = ? AND device_id = ?',
      whereArgs: [merchantId, locationId, deviceId],
      limit: 1,
    );
    return rows.isEmpty ? null : _networkDevice(rows.first);
  }

  @override
  Future<List<LocalNetworkDevice>> readNetworkDevices(
    String merchantId,
    String locationId,
  ) async {
    final rows = await (await _open()).query(
      'network_devices',
      where: 'merchant_id = ? AND location_id = ?',
      whereArgs: [merchantId, locationId],
      orderBy: 'last_seen_at DESC, device_id',
    );
    return rows.map(_networkDevice).toList(growable: false);
  }

  @override
  Future<void> writeNetworkDevice(LocalNetworkDevice device) async {
    await (await _open()).insert('network_devices', {
      'merchant_id': device.merchantId,
      'location_id': device.locationId,
      'device_id': device.deviceId,
      'role': device.role,
      'station_id': device.stationId,
      'address': device.address,
      'port': device.port,
      'credential_hash': device.credentialHash,
      'paired_at': device.pairedAt,
      'last_seen_at': device.lastSeenAt,
      'status': device.status,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  @override
  Future<void> deleteNetworkDevice(
    String merchantId,
    String locationId,
    String deviceId,
  ) async {
    await (await _open()).delete(
      'network_devices',
      where: 'merchant_id = ? AND location_id = ? AND device_id = ?',
      whereArgs: [merchantId, locationId, deviceId],
    );
  }

  LocalNetworkDevice _networkDevice(Map<String, Object?> row) =>
      LocalNetworkDevice(
        merchantId: row['merchant_id'] as String,
        locationId: row['location_id'] as String,
        deviceId: row['device_id'] as String,
        role: row['role'] as String,
        stationId: row['station_id'] as String?,
        address: row['address'] as String?,
        port: row['port'] as int?,
        credentialHash: row['credential_hash'] as String,
        pairedAt: row['paired_at'] as String,
        lastSeenAt: row['last_seen_at'] as String,
        status: row['status'] as String,
      );

  static String _filterKey({
    String? categoryId,
    String? search,
    String? barcode,
  }) {
    if (categoryId != null) return 'category:$categoryId';
    if (search != null && search.trim().isNotEmpty) {
      return 'search:${search.trim().toLowerCase()}';
    }
    if (barcode != null && barcode.trim().isNotEmpty) {
      return 'barcode:${barcode.trim()}';
    }
    return _catalogPageRoot;
  }

  static String _floorScope(String merchantId, PosFloorPlanQuery query) =>
      // Branch, not session. A published floor plan is a property of the room,
      // and the operator session id is minted again on every restart, lock or
      // handover. Keying the cache by it meant that a till which had drawn the
      // room a minute ago could not find it after a restart — the table picker
      // went to the API, got nothing, and refused a dine-in sale offline.
      '$merchantId:${query.locationId}';

  static String _cartScope(
    String merchantId,
    String locationId,
    String operatorSessionId,
  ) => '$merchantId:$locationId:$operatorSessionId';

  static Map<String, Object?> _decodeObject(String source) =>
      (jsonDecode(source) as Map<Object?, Object?>).cast<String, Object?>();
}

final class _LocalDatabaseLocation {
  const _LocalDatabaseLocation(this.factory, this.path);

  final DatabaseFactory factory;
  final String path;
}

Future<_LocalDatabaseLocation> _locateLocalDatabase() async {
  final resolved = await resolveLocalDatabaseLocation();
  if (resolved == null) {
    throw UnsupportedError('SQLite storage is unavailable on this platform');
  }
  return _LocalDatabaseLocation(
    resolved.factory,
    '${resolved.directory}/${SqliteLocalDatabase._databaseFileName}',
  );
}

final class LocalDatabaseLocation {
  const LocalDatabaseLocation(this.factory, this.directory);

  final DatabaseFactory factory;
  final String directory;
}
