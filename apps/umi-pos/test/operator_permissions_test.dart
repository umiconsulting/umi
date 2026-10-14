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
    // The till this cashier is standing at may well be running the board, and
    // that is exactly the case this guards: the tab follows the OPERATOR's
    // permission, not the device's controller.
    expect(actions.showKitchenBoard, isFalse);
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
    expect(actions.showKitchenBoard, isFalse);
  });

  test('the kitchen board opens for a cook, on either kitchen permission', () {
    for (final granted in const [
      ['kitchen.read'],
      ['kitchen.prepare'],
      ['kitchen.read', 'kitchen.prepare'],
    ]) {
      final actions = OperatorActionAccess(OperatorPermissions(granted));
      expect(
        actions.showKitchenBoard,
        isTrue,
        reason: 'granted ${granted.join(' + ')}',
      );
    }
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

  test('waiter reads the kitchen beside accounts without kitchen commands', () {
    final permissions = OperatorPermissions(const [
      'cart.write',
      'catalog.read',
      'customer.attach',
      'customer.read',
      'customer.search',
      'loyalty.read',
      'offline.replay',
      'order.fire',
      'kitchen.read',
    ]);
    final surfaces = tillSurfacesFor(
      OperatorActionAccess(permissions),
      hasFloorPlan: true,
      hasKitchenBoard: true,
    );
    expect(surfaces, [
      TillSurface.order,
      TillSurface.tables,
      TillSurface.kitchen,
      TillSurface.settings,
    ]);
    expect(landingSurface(surfaces), TillSurface.order);
    for (final permission in const [
      'kitchen.prepare',
      'kitchen.ready',
      'kitchen.complete',
      'kitchen.recall',
      'checkout.commit',
      'cash.shift.read',
    ]) {
      expect(permissions.allows(permission), isFalse, reason: permission);
    }
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

  // F1 of the integrated-operation plan: the app looks like the role that
  // signed in. A tab is offered only when its permission is held (finding 6),
  // and the order screen is the seller's home and nobody else's (finding 4).

  test('a cook is offered the kitchen and settings, not the comanda', () {
    final access = OperatorActionAccess(
      OperatorPermissions(const ['kitchen.read', 'kitchen.prepare']),
    );

    final surfaces = tillSurfacesFor(access, hasKitchenBoard: true);

    expect(surfaces, [TillSurface.kitchen, TillSurface.settings]);
    expect(tillSurfacesFor(access).contains(TillSurface.kitchen), isFalse);
    expect(landingSurface(surfaces), TillSurface.kitchen);
  });

  test('a cashier lands on the comanda with cash and sales beside it', () {
    final access = OperatorActionAccess(
      OperatorPermissions(const [
        'cart.write',
        'cash.shift.read',
        'sale.lifecycle',
      ]),
    );

    final surfaces = tillSurfacesFor(access);

    expect(surfaces, [
      TillSurface.order,
      TillSurface.sales,
      TillSurface.cash,
      TillSurface.settings,
    ]);
    expect(landingSurface(surfaces), TillSurface.order);
  });

  test('the mesas tab also needs its permission and device', () {
    final access = OperatorActionAccess(
      OperatorPermissions(const ['cart.write', 'sale.lifecycle']),
    );

    final withoutDevice = tillSurfacesFor(access);
    final withDevice = tillSurfacesFor(access, hasFloorPlan: true);

    expect(withoutDevice, isNot(contains(TillSurface.tables)));
    expect(withDevice, contains(TillSurface.tables));
  });

  test('the pedidos tab needs the merchant to take orders from other channels', () {
    final access = OperatorActionAccess(
      OperatorPermissions(const ['cart.write', 'sale.lifecycle']),
    );

    // The device can show it and the operator may sell — but a merchant who does not
    // take orders from other channels does not get the tab (owner, 2026-10-12). The
    // surface stays in the tree; the entitlement is what turns it on.
    expect(
      tillSurfacesFor(access, hasIncomingOrders: true),
      isNot(contains(TillSurface.orders)),
    );
    expect(
      tillSurfacesFor(
        access,
        hasIncomingOrders: true,
        incomingOrdersEntitled: true,
      ),
      contains(TillSurface.orders),
    );
  });

  test('the entitlement key is the one the merchant data carries', () {
    expect(kIncomingOrdersFeature, 'pos.incoming_orders');
    expect(
      merchantCarriesFeature(kIncomingOrdersFeature, const [
        {'featureKey': 'pos', 'enabled': true},
      ]),
      isFalse,
    );
    expect(
      merchantCarriesFeature(kIncomingOrdersFeature, const [
        {'featureKey': 'pos', 'enabled': true},
        {'featureKey': 'pos.incoming_orders', 'enabled': true},
      ]),
      isTrue,
    );
    expect(
      merchantCarriesFeature(kIncomingOrdersFeature, const [
        {'featureKey': 'pos.incoming_orders', 'enabled': false},
      ]),
      isFalse,
    );
  });

  test('a role with no sale surface lands on the settings-led home', () {
    final access = OperatorActionAccess(
      OperatorPermissions(const ['insights.read']),
    );

    final surfaces = tillSurfacesFor(access);

    expect(surfaces, [TillSurface.settings]);
    expect(landingSurface(surfaces), TillSurface.settings);
  });

  test('a KDS device shows the kitchen, not the till, for a seller', () {
    final access = OperatorActionAccess(
      OperatorPermissions(const [
        'cart.write',
        'cash.shift.read',
        'sale.lifecycle',
        'kitchen.read',
        'kitchen.prepare',
      ]),
    );

    final onTill = tillSurfacesFor(access, hasKitchenBoard: true);
    final onKds = tillSurfacesFor(
      access,
      hasKitchenBoard: true,
      kdsDevice: true,
    );

    // The same operator: the till offers the sale surfaces, the KDS device does
    // not. What the device IS comes from the server (D6), not from the role.
    expect(onTill, contains(TillSurface.order));
    expect(onKds, [TillSurface.kitchen, TillSurface.settings]);
    expect(landingSurface(onKds), TillSurface.kitchen);
  });
}
