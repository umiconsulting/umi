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
  bool get showCashCenter => permissions.allows('cash.shift.read');
  bool get showSaleHistory => permissions.allows('sale.lifecycle');
  bool get showSaleActions => permissions.allows('sale.lifecycle');
  bool get showSaleExceptions => permissions.allows('sale.exception.read');
  bool canCash(String permission) => permissions.allows(permission);
  bool get showRecovery => permissions.allowsAny(const [
    'offline.replay',
    'offline.recovery.review',
  ]);
}
