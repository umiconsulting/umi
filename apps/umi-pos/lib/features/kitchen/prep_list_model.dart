import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';

/// One scaled quantity, as the contract sends it: `{value, scale, unit}`.
///
/// `value` is the integer at its own scale, so `(1333, 2)` is 13.33. It is a
/// map on the wire, so the typing happens here once.
typedef ScaledQuantityView = ({int value, int scale, String unit});

/// The prep list, typed once from the contract's raw item maps.
typedef PrepListView = ({
  List<PrepListItem> items,
  String from,
  String to,
  String? locationId,
});

/// Read the contract's response into the rows the surface renders.
PrepListView prepListView(PrepList list) => (
  items: list.items.map(PrepListItem.fromJson).toList(growable: false),
  from: list.from,
  to: list.to,
  locationId: list.locationId,
);

/// Read one scaled quantity, or null when the payload does not carry one.
ScaledQuantityView? scaledQuantityView(Map<String, Object?>? quantity) {
  if (quantity == null) return null;
  final value = quantity['value'];
  final scale = quantity['scale'];
  final unit = quantity['unit'];
  if (value is! num || scale is! num || unit is! String) return null;
  return (value: value.toInt(), scale: scale.toInt(), unit: unit);
}

/// A scaled integer as a decimal string: `(1333, 2)` reads "13.33".
///
/// Trailing zeros are trimmed, so a `(1000, 3)` quantity reads "1".
String formatScaledQuantity(int value, int scale) {
  final digits = scale < 0 ? 0 : (scale > 6 ? 6 : scale);
  final factor = BigInt.from(10).pow(digits);
  final magnitude = BigInt.from(value).abs();
  final whole = magnitude ~/ factor;
  final fraction = (magnitude % factor).toString().padLeft(digits, '0');
  final trimmed = fraction.replaceFirst(RegExp(r'0+$'), '');
  final text = trimmed.isEmpty ? '$whole' : '$whole.$trimmed';
  return value < 0 ? '-$text' : text;
}

/// The quantity the item needs, or null when the item has no par.
///
/// An item with no par has no work order, so the surface names that state. It
/// never prints a zero. The server owns the arithmetic (plan D13).
ScaledQuantityView? prepQuantityView(PrepListItem item) =>
    item.parQuantity == null ? null : scaledQuantityView(item.prepQuantity);

/// The kitchen's own order: the largest quantity to make comes first.
///
/// An item with no par has no quantity, so it waits at the end. Equal
/// quantities fall back to the name, so the list keeps one order between reads.
List<PrepListItem> sortPrepItems(List<PrepListItem> items) {
  final rows = [...items];
  rows.sort((left, right) {
    final leftQuantity = prepQuantityView(left);
    final rightQuantity = prepQuantityView(right);
    if (leftQuantity != null && rightQuantity != null) {
      final compared = _compareMagnitudes(leftQuantity, rightQuantity);
      if (compared != 0) return -compared;
    } else if (leftQuantity != null) {
      return -1;
    } else if (rightQuantity != null) {
      return 1;
    }
    return left.displayName.compareTo(right.displayName);
  });
  return rows;
}

/// Compare two quantities at different scales without losing a digit.
int _compareMagnitudes(ScaledQuantityView left, ScaledQuantityView right) {
  final leftScaled =
      BigInt.from(left.value) * _powerOfTen(right.scale);
  final rightScaled =
      BigInt.from(right.value) * _powerOfTen(left.scale);
  return leftScaled.compareTo(rightScaled);
}

BigInt _powerOfTen(int scale) {
  final digits = scale < 0 ? 0 : (scale > 6 ? 6 : scale);
  return BigInt.from(10).pow(digits);
}

/// The short unit label a cook reads. An unknown unit prints as the server
/// named it, because a label the till can read beats a blank cell.
String kitchenUnitLabel(AppLocalizations l10n, String unit) => switch (unit) {
  'unit' => l10n.inventoryUnitEach,
  'gram' => l10n.inventoryUnitGram,
  'kilogram' => l10n.inventoryUnitKilogram,
  'milliliter' => l10n.inventoryUnitMilliliter,
  'liter' => l10n.inventoryUnitLiter,
  'portion' => l10n.inventoryUnitPortion,
  'package' => l10n.inventoryUnitPackage,
  'box' => l10n.inventoryUnitBox,
  _ => unit,
};

/// One quantity as "1.5 kg", or null when the payload does not carry one.
String? scaledQuantityText(
  AppLocalizations l10n,
  ScaledQuantityView? quantity,
) => quantity == null
    ? null
    : '${formatScaledQuantity(quantity.value, quantity.scale)} '
          '${kitchenUnitLabel(l10n, quantity.unit)}';
