import 'package:flutter_test/flutter_test.dart';
import 'package:umi_pos/core/security/operator_permissions.dart';

void main() {
  test('unknown and absent permissions fail closed', () {
    final permissions = OperatorPermissions(const ['catalog.read']);

    expect(permissions.allows('catalog.read'), isTrue);
    expect(permissions.allows('cart.write'), isFalse);
    expect(permissions.allows('future.permission'), isFalse);
  });

  test('an explicit break-glass wildcard remains compatible', () {
    final permissions = OperatorPermissions(const ['*']);

    expect(permissions.allows('cash.shift.open'), isTrue);
  });

  test('permission output is deduplicated for diagnostics', () {
    final permissions = OperatorPermissions(const [
      'catalog.read',
      'catalog.read',
    ]);

    expect(permissions.count, 1);
  });

  test('Cashier receives operational actions without approval authority', () {
    final permissions = OperatorPermissions(const [
      'cart.write',
      'checkout.commit',
      'cash.shift.read',
      'sale.lifecycle',
      'offline.replay',
    ]);
    final actions = OperatorActionAccess(permissions);

    expect(actions.canWriteCart, isTrue);
    expect(actions.canCheckout, isTrue);
    expect(actions.showCashCenter, isTrue);
    expect(actions.showSaleActions, isTrue);
    expect(actions.showRecovery, isTrue);
    expect(permissions.allows('sale.refund.approve'), isFalse);
  });

  test('Viewer remains read-only and cannot open the combined sale center', () {
    final permissions = OperatorPermissions(const [
      'catalog.read',
      'insights.read',
    ]);
    final actions = OperatorActionAccess(permissions);

    expect(actions.canWriteCart, isFalse);
    expect(actions.canCheckout, isFalse);
    expect(actions.showCashCenter, isFalse);
    expect(actions.showSaleHistory, isFalse);
    expect(actions.showSaleActions, isFalse);
    expect(actions.showRecovery, isFalse);
  });

  test('Cash Center actions require their exact effective permission', () {
    final actions = OperatorActionAccess(
      OperatorPermissions(const ['cash.shift.read', 'cash.movement.paid_in']),
    );

    expect(actions.showCashCenter, isTrue);
    expect(actions.canCash('cash.movement.paid_in'), isTrue);
    expect(actions.canCash('cash.movement.paid_out'), isFalse);
    expect(actions.canCash('cash.shift.close'), isFalse);
  });

  test('revoked permissions remove visible actions after refresh', () {
    final before = OperatorActionAccess(
      OperatorPermissions(const ['cart.write', 'checkout.commit']),
    );
    final after = OperatorActionAccess(OperatorPermissions(const []));

    expect(before.canCheckout, isTrue);
    expect(after.canWriteCart, isFalse);
    expect(after.canCheckout, isFalse);
  });
}
