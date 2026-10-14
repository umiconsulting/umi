/// Exact presentation of the contract's integer quantity and scale.
/// No rounding occurs between the operator's decimal and the API value.
abstract final class InventoryQuantityText {
  static final _maximum = BigInt.from(9007199254740991);

  static int? parse(String text, int scale) {
    if (scale < 0 || scale > 6) return null;
    final match = RegExp(r'^(\d+)(?:\.(\d+))?$').firstMatch(text.trim());
    if (match == null) return null;
    final fraction = match.group(2) ?? '';
    if (fraction.length > scale) return null;
    final value = BigInt.parse(
      '${match.group(1)}${fraction.padRight(scale, '0')}',
    );
    return value > _maximum ? null : value.toInt();
  }

  static String format(Object value, int scale) {
    final integer = BigInt.parse('$value');
    final digits = integer.abs().toString().padLeft(scale + 1, '0');
    final sign = integer.isNegative ? '-' : '';
    if (scale == 0) return '$sign$digits';
    final fraction = digits
        .substring(digits.length - scale)
        .replaceFirst(RegExp(r'0+$'), '');
    final whole = digits.substring(0, digits.length - scale);
    return '$sign$whole${fraction.isEmpty ? '' : '.$fraction'}';
  }

  static String unit(String unit) => switch (unit) {
    'gram' => 'g',
    'kilogram' => 'kg',
    'milliliter' => 'ml',
    'liter' => 'l',
    _ => unit,
  };

  static String label(Map<String, Object?> quantity) =>
      '${format(quantity['value']!, (quantity['scale'] as num?)?.toInt() ?? 0)} ${unit(quantity['unit']! as String)}';
}
