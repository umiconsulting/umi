import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// One product the operator adds often on this register, kept for the quick-add
/// rail (audit F9). Stored with enough to render a chip without a catalog fetch.
class FrequentProduct {
  const FrequentProduct({
    required this.id,
    required this.name,
    required this.price,
    required this.count,
  });

  final String id;
  final String name;

  /// `{minorUnits, currency}`.
  final Map<String, Object?> price;
  final int count;

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'price': price,
    'count': count,
  };

  static FrequentProduct? tryFromJson(Object? raw) {
    if (raw is! Map) return null;
    final id = raw['id'];
    final name = raw['name'];
    final price = raw['price'];
    final count = raw['count'];
    if (id is! String || name is! String || price is! Map || count is! num) {
      return null;
    }
    return FrequentProduct(
      id: id,
      name: name,
      price: price.cast<String, Object?>(),
      count: count.toInt(),
    );
  }
}

/// Remembers, per merchant + location, how many times each product was added to
/// a cart on this device, so the catalog can offer a fast path to the barista's
/// top items (audit F9). This is a device-local favourites signal; a global
/// "most-sold" from sales history would be a backend enhancement.
///
/// Every read and write is guarded: a storage failure simply yields no rail.
class FrequentProductsStore {
  FrequentProductsStore(this._prefs);

  final SharedPreferences _prefs;

  static Future<FrequentProductsStore?> create() async {
    try {
      return FrequentProductsStore(await SharedPreferences.getInstance());
    } catch (_) {
      return null;
    }
  }

  static const _maxStored = 30;

  String _key(String merchant, String location) =>
      'umi.pos.frequent.$merchant.$location';

  List<FrequentProduct> _read(String merchant, String location) {
    try {
      final raw = _prefs.getString(_key(merchant, location));
      if (raw == null) return [];
      final decoded = jsonDecode(raw);
      if (decoded is! List) return [];
      return decoded
          .map(FrequentProduct.tryFromJson)
          .whereType<FrequentProduct>()
          .toList();
    } catch (_) {
      return [];
    }
  }

  List<FrequentProduct> top(String merchant, String location, {int limit = 6}) {
    final items = _read(merchant, location)
      ..sort((a, b) => b.count.compareTo(a.count));
    return items.take(limit).toList(growable: false);
  }

  Future<void> record({
    required String merchant,
    required String location,
    required String id,
    required String name,
    required Map<String, Object?> price,
  }) async {
    try {
      final items = _read(merchant, location);
      final index = items.indexWhere((item) => item.id == id);
      if (index >= 0) {
        items[index] = FrequentProduct(
          id: id,
          name: name,
          price: price,
          count: items[index].count + 1,
        );
      } else {
        items.add(FrequentProduct(id: id, name: name, price: price, count: 1));
      }
      items.sort((a, b) => b.count.compareTo(a.count));
      final capped = items
          .take(_maxStored)
          .map((item) => item.toJson())
          .toList();
      await _prefs.setString(_key(merchant, location), jsonEncode(capped));
    } catch (_) {
      // A failed write just means the rail misses this add; never block a sale.
    }
  }
}
