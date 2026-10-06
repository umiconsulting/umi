final class OperatorPermissions {
  OperatorPermissions(Iterable<String> values)
    : _values = Set.unmodifiable(values);

  final Set<String> _values;

  bool allows(String permission) =>
      _values.contains(permission) || _values.contains('*');

  bool allowsAny(Iterable<String> permissions) => permissions.any(allows);

  int get count => _values.length;
}

final class OperatorActionAccess {
  const OperatorActionAccess(this.permissions);

  final OperatorPermissions permissions;

  bool get canWriteCart => permissions.allows('cart.write');
  bool get canCheckout => permissions.allows('checkout.commit');

  /// The kitchen board is a full-screen destination where a cook works a
  /// service, and a cashier has no business on it. Whether the *device* holds a
  /// board controller is a different question from whether *this operator* may
  /// open it: the tab used to be offered on the controller alone, so a cashier
  /// on a till that ran the board could walk into the kitchen's screen. Reading
  /// the board is the gate; the item commands inside are refused by the API for
  /// anyone without `kitchen.prepare`.
  bool get showKitchenBoard =>
      permissions.allowsAny(const ['kitchen.read', 'kitchen.prepare']);
  bool get showCashCenter => permissions.allows('cash.shift.read');
  bool get showSaleHistory => permissions.allows('sale.lifecycle');
  bool get showSaleActions => permissions.allows('sale.lifecycle');
  bool get showSaleExceptions => permissions.allows('sale.exception.read');
  bool get showInventory => permissions.allows('inventory.read');
  bool canCash(String permission) => permissions.allows(permission);
  bool get showRecovery => permissions.allowsAny(const [
    'offline.replay',
    'offline.recovery.review',
  ]);
}
