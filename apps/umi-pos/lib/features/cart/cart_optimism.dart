/// The cart the till paints while the server is still answering.
///
/// Why this file exists. Every cart write used to be "send it, wait, then paint
/// it" — `CartController._mutation` left the state in `loading` and only
/// published the cart the API returned. With the till in a café and the database
/// two regions away that is a 130–200 ms floor on every tap, which is what the
/// owner reports as "se siente lento" (see
/// `docs/research/2026-10-14-pos-latencia-hub-local`).
///
/// These functions predict the next cart locally so the till can paint it at
/// once and let the server confirm afterwards. The prediction is **provisional
/// by construction**: the server remains the pricing and lifecycle authority, so
/// the answer that arrives later replaces whatever is drawn here — including
/// when it disagrees.
///
/// The arithmetic is a transcription of the server's own, deliberately:
/// `PosCartRepository` in `apps/umi-api/src/modules/pos-cart/pos-cart.repository.ts`
/// prices a line as `unit = base + variantDelta + modifierTotal`, `lineTotal =
/// unit × quantity`, and extracts a **tax-inclusive** tax as
/// `round(lineTotal × rate ÷ (10000 + rate))`. Prices in this product are gross:
/// `subtotal` already carries the tax inside it and `grandTotal == subtotal`.
/// If that convention ever changes, it changes in both places or the till starts
/// showing a total the server will not agree with.
library;

import 'package:flutter/foundation.dart';
import 'package:umi_contract/umi_contract.dart';

/// One line the till can describe on its own, before the server has priced it.
///
/// The display facts ride along with the price for the same reason: a line the
/// till paints has to read like a line, and the name and the sale action come from
/// the catalogue the operator just tapped, not from the server's answer.
final class ProvisionalLine {
  const ProvisionalLine({
    required this.productId,
    required this.productName,
    required this.saleAction,
    required this.unitMinorUnits,
    required this.currency,
    required this.taxRateBasisPoints,
  });

  final String productId;
  final String productName;
  final String saleAction;

  /// What one unit of the line costs, gross, with variant and modifier deltas
  /// already folded in — the shape the server keeps as `unitPrice`.
  final int unitMinorUnits;
  final String currency;
  final int taxRateBasisPoints;

  /// Prices a selection from the catalogue detail the operator already has on
  /// screen.
  ///
  /// The detail is what makes this trustworthy: a product whose variants and
  /// modifiers the till has not loaded cannot be priced locally, and the caller
  /// is expected not to try. `_addProduct` in `catalog_surface.dart` only asks
  /// for a provisional price on the two paths that add a product **without**
  /// variants or option groups, which is exactly the set of products whose price
  /// the summary already carries.
  factory ProvisionalLine.fromSelection({
    required CatalogProductDetail product,
    String? variantId,
    Map<String, int> modifierQuantities = const {},
  }) {
    final base = CatalogMoney.fromJson(product.price);
    var unit = base.minorUnits;
    if (variantId != null) {
      for (final raw in product.variants) {
        final variant = CatalogVariant.fromJson(raw);
        if (variant.id == variantId) {
          unit += CatalogMoney.fromJson(variant.priceDelta).minorUnits;
          break;
        }
      }
    }
    if (modifierQuantities.isNotEmpty) {
      for (final rawGroup in product.optionGroups) {
        final group = CatalogOptionGroup.fromJson(rawGroup);
        for (final rawModifier in group.modifiers) {
          final modifier = CatalogModifier.fromJson(rawModifier);
          final quantity = modifierQuantities[modifier.id];
          if (quantity != null && quantity > 0) {
            unit +=
                CatalogMoney.fromJson(modifier.priceDelta).minorUnits *
                quantity;
          }
        }
      }
    }
    return ProvisionalLine(
      productId: product.id,
      productName: product.name,
      saleAction: product.saleAction,
      unitMinorUnits: unit,
      currency: base.currency,
      taxRateBasisPoints: product.taxRateBasisPoints,
    );
  }

  /// The same, for the paths that hold only a catalogue summary — a tap on a
  /// category card, a scanned barcode. A summary carries the price and the tax
  /// rate but not the variants or the option groups, so it can only describe a
  /// product that has neither, and the callers already prove that before they
  /// ask: `!product.hasVariants && !product.hasModifiers`.
  factory ProvisionalLine.fromSummary({
    required CatalogProductSummary product,
  }) {
    final price = CatalogMoney.fromJson(product.price);
    return ProvisionalLine(
      productId: product.id,
      productName: product.name,
      saleAction: product.saleAction,
      unitMinorUnits: price.minorUnits,
      currency: price.currency,
      taxRateBasisPoints: product.taxRateBasisPoints,
    );
  }
}

/// The same calculation the server makes, in the same order.
Map<String, Object?> _linePrice({
  required int unitMinorUnits,
  required int quantity,
  required int taxRateBasisPoints,
  required String currency,
}) {
  final lineTotal = unitMinorUnits * quantity;
  final tax = ((lineTotal * taxRateBasisPoints) / (10000 + taxRateBasisPoints))
      .round();
  return {
    'unitPrice': _money(unitMinorUnits, currency),
    'lineSubtotal': _money(lineTotal, currency),
    'tax': _money(tax, currency),
    'lineTotal': _money(lineTotal, currency),
    'taxRateBasisPoints': taxRateBasisPoints,
  };
}

Map<String, Object?> _money(int minorUnits, String currency) => {
  'minorUnits': minorUnits,
  'currency': currency,
};

int _minorUnits(Map<String, Object?> money) =>
    (money['minorUnits'] as num?)?.toInt() ?? 0;

String _currencyOf(Map<String, Object?> money) =>
    money['currency'] as String? ?? 'MXN';

/// Rebuilds the totals from the lines, the way the server does.
///
/// `discounts` is zeroed rather than carried: the server's own line-by-line
/// snapshot builder emits `{total: 0, entries: []}` and lets the checkout
/// calculate discounts later, so a cart that is still being built has none to
/// preserve. Anything that changes that must change it on both sides.
Map<String, Object?> _totalsFor(List<Map<String, Object?>> items, Cart base) {
  final baseTotals = TotalsPreview.fromJson(base.totals);
  final currency = _currencyOf(baseTotals.grandTotal);
  var subtotal = 0;
  var tax = 0;
  for (final raw in items) {
    final price = PriceSnapshot.fromJson(
      (raw['price'] as Map<String, Object?>?) ?? const {},
    );
    subtotal += _minorUnits(price.lineTotal);
    tax += _minorUnits(price.tax);
  }
  return {
    'subtotal': _money(subtotal, currency),
    'tax': _money(tax, currency),
    'discounts': {
      'total': _money(0, currency),
      'entries': const <Map<String, Object?>>[],
    },
    'grandTotal': _money(subtotal, currency),
    'businessDate': baseTotals.businessDate,
  };
}

Cart _withItems(Cart base, List<Map<String, Object?>> items) => Cart.fromJson({
  ...base.toJson(),
  'items': items,
  'totals': _totalsFor(items, base),
});

/// Predicts the cart after a new line lands on it.
///
/// [lineId] is the id the till gives the line locally. The server mints its own
/// when it answers, and the answer replaces this line — so the provisional id
/// never has to match anything.
Cart optimisticAddLine(
  Cart base, {
  required String lineId,
  required ProvisionalLine line,
  required int quantity,
  required int courseNumber,
  Map<String, Object?>? variant,
  List<Map<String, Object?>> modifiers = const [],
  String? note,
}) {
  final entry = <String, Object?>{
    'id': lineId,
    'productId': line.productId,
    'productName': line.productName,
    'saleAction': line.saleAction,
    'quantity': quantity,
    'courseNumber': courseNumber,
    'variant': variant,
    'modifiers': modifiers,
    'note': note,
    // A line the kitchen does not have yet. `fired` is the server's answer, and
    // the honest provisional answer is false: the fire has not happened.
    'fired': false,
    'firedOrderItemId': null,
    'price': _linePrice(
      unitMinorUnits: line.unitMinorUnits,
      quantity: quantity,
      taxRateBasisPoints: line.taxRateBasisPoints,
      currency: line.currency,
    ),
  };
  return _withItems(base, [...base.items, entry]);
}

/// Predicts the cart after a line's quantity changes.
///
/// The line already carries what it costs, so this is not a guess about price —
/// only about arithmetic the server will repeat identically.
Cart? optimisticSetQuantity(Cart base, String lineId, int quantity) {
  if (quantity <= 0) return optimisticRemoveLine(base, lineId);
  var found = false;
  final items = base.items
      .map((raw) {
        if (raw['id'] != lineId) return raw;
        found = true;
        final price = PriceSnapshot.fromJson(
          (raw['price'] as Map<String, Object?>?) ?? const {},
        );
        return <String, Object?>{
          ...raw,
          'quantity': quantity,
          'price': _linePrice(
            unitMinorUnits: _minorUnits(price.unitPrice),
            quantity: quantity,
            taxRateBasisPoints: price.taxRateBasisPoints,
            currency: _currencyOf(price.unitPrice),
          ),
        };
      })
      .toList(growable: false);
  if (!found) return null;
  return _withItems(base, items);
}

/// Predicts the cart after a line is dropped.
Cart? optimisticRemoveLine(Cart base, String lineId) {
  if (!base.items.any((raw) => raw['id'] == lineId)) return null;
  return _withItems(
    base,
    base.items.where((raw) => raw['id'] != lineId).toList(growable: false),
  );
}

/// Predicts an empty cart while keeping the cart identity and business date.
Cart optimisticClear(Cart base) => _withItems(base, const []);

/// Predicts the next cart after a line is edited.
///
/// A change to the variant or the modifier set can change the price. The till
/// cannot price that from the line alone, so this returns null and the caller
/// keeps the old waiting path. Quantity, course and note are local facts and can
/// be painted at once.
Cart? optimisticEditLine(
  Cart base,
  CartItem item, {
  required String? variantId,
  required List<Map<String, Object?>> modifiers,
  required int quantity,
  required int courseNumber,
  required String? note,
  String? lineId,
}) {
  final oldVariant = item.variant?['variantId'] as String?;
  final oldModifierIds =
      item.modifiers
          .map((value) => value['modifierId'])
          .whereType<String>()
          .toList()
        ..sort();
  final nextModifierIds =
      modifiers.map((value) => value['modifierId']).whereType<String>().toList()
        ..sort();
  if (oldVariant != variantId || !listEquals(oldModifierIds, nextModifierIds)) {
    return null;
  }
  var found = false;
  final targetId = lineId ?? item.id;
  final items = base.items
      .map((raw) {
        if (raw['id'] != targetId) return raw;
        found = true;
        final price = PriceSnapshot.fromJson(
          (raw['price'] as Map<String, Object?>?) ?? const {},
        );
        return <String, Object?>{
          ...raw,
          'quantity': quantity,
          'courseNumber': courseNumber,
          'note': note,
          'price': _linePrice(
            unitMinorUnits: _minorUnits(price.unitPrice),
            quantity: quantity,
            taxRateBasisPoints: price.taxRateBasisPoints,
            currency: _currencyOf(price.unitPrice),
          ),
        };
      })
      .toList(growable: false);
  return found ? _withItems(base, items) : null;
}

/// Predicts the cart after the account is renamed.
Cart optimisticRenameAccount(Cart base, String? name) => Cart.fromJson({
  ...base.toJson(),
  'accountName': (name == null || name.trim().isEmpty) ? null : name.trim(),
});

/// Predicts the cart after the account is moved to a table (or taken off one).
Cart optimisticAssignTable(Cart base, {String? tableId, String? tableName}) =>
    Cart.fromJson({
      ...base.toJson(),
      'tableId': tableId,
      'tableName': tableName,
    });

/// Predicts the order type and the table release that follows a takeout choice.
Cart optimisticSetFulfillment(Cart base, String fulfillmentType) =>
    Cart.fromJson({
      ...base.toJson(),
      'fulfillmentType': fulfillmentType,
      if (fulfillmentType == 'takeout') ...{
        'tableId': null,
        'tableName': null,
        'tableVisitId': null,
      },
    });

/// Predicts the table the operator just chose.
///
/// The server owns the room: it may refuse a table another till claimed while
/// this one was offline. Until it answers, the slip in the cashier's hand says
/// the table they picked, which is what they will tell the kitchen.
Cart optimisticSetTable(Cart base, String tableId, String? tableName) =>
    Cart.fromJson({
      ...base.toJson(),
      'fulfillmentType': 'dine_in',
      'tableId': tableId,
      'tableName': tableName,
    });

/// Predicts that every line is on the kitchen ticket.
///
/// The server returns the real order id after the command lands. The queued view
/// only needs the operator's fact: these lines are no longer waiting to be sent.
Cart optimisticFire(Cart base) => Cart.fromJson({
  ...base.toJson(),
  'items': [
    for (final item in base.items) {...item, 'fired': true},
  ],
});
