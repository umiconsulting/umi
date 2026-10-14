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

/// One surface the till can show for the operator who signed in.
///
/// This is the model behind decision D1 of the integrated-operation plan: the
/// app looks like the role that holds the turn. A surface is offered only when
/// the operator holds the permission its route requires, and — for the surfaces
/// that need a device controller — when this device carries that controller.
/// The old shell offered every tab and then refused inside the route, which is
/// what painted a cook a red banner over a sale they could not build.
enum TillSurface {
  /// The comanda: the order screen and the product catalog. The seller's home.
  order,

  /// The cash centre: the shift, the drawer and the reconciliations.
  cash,

  /// The combined sale centre: history, refunds and the open-sale lifecycle.
  sales,

  /// The floor plan (Mesas).
  tables,

  /// The kitchen board (Cocina).
  kitchen,

  /// The orders arriving from other surfaces (Pedidos).
  orders,

  /// Lock and logout. Always offered, because a turn must always be closable.
  settings,
}

/// The surfaces this operator may open on this device, in the till's tab order.
///
/// Each entry names the same permission its route enforces, so the tab and the
/// route agree: `cart.write` sustains the order screen and the incoming-orders
/// rail, `cash.shift.read` the cash centre, `sale.lifecycle` the sale centre,
/// `cart.write` or `sale.lifecycle` the floor plan, and
/// `kitchen.read`/`kitchen.prepare` the kitchen board.
/// `settings` is always last.
///
/// The device is the other gate (plan §7 D6). A device the owner marked as a KDS
/// shows the kitchen, not the till: an operator may hold `cart.write` and still
/// not sell on a screen bolted to a kitchen wall. What the device IS comes from
/// the server's device record, never from the operator's permissions.
///
/// The device controllers are the second gate. `floorPlan`, `kitchenBoard` and
/// `incomingOrders` are optional in tests and on some builds, so a surface that
/// needs one is offered only when the shell actually holds it.
/// The entitlement a merchant carries when orders that come from other channels
/// reach the till.
///
/// ABSENT BY DEFAULT, AND THAT IS THE POINT. ONCA does not take orders from other
/// channels today, so the owner asked for "Pedidos" off the rail (2026-10-12) — but
/// not out of the product: another merchant may, and so may ONCA later. The surface
/// and its plumbing stay in the tree, and this key decides per merchant whether the
/// till offers it. Turning it on is data, not a release.
const String kIncomingOrdersFeature = 'pos.incoming_orders';

/// Whether a session's entitlements carry [featureKey] switched on.
bool merchantCarriesFeature(
  String featureKey,
  List<Map<String, Object?>> entitlements,
) => entitlements.any(
  (entitlement) =>
      entitlement['featureKey'] == featureKey && entitlement['enabled'] == true,
);

List<TillSurface> tillSurfacesFor(
  OperatorActionAccess access, {
  bool hasFloorPlan = false,
  bool hasKitchenBoard = false,
  bool hasIncomingOrders = false,
  bool incomingOrdersEntitled = false,
  bool kdsDevice = false,
}) => [
  // THE ORDER OF THIS LIST IS THE ORDER OF THE SIDEBAR, AND THE OWNER SET IT BY
  // HAND (2026-10-12): Comanda, Cuentas, Cocina, Ventas, Caja, Ajustes. It follows
  // the counter's day — take the order, look at the accounts, watch the kitchen,
  // check what sold, count the money, and only then the settings — instead of the
  // order the surfaces happened to be built in.
  //
  if (!kdsDevice && access.canWriteCart) TillSurface.order,
  if (!kdsDevice &&
      hasFloorPlan &&
      (access.canWriteCart || access.showSaleHistory))
    TillSurface.tables,
  if (hasKitchenBoard && access.showKitchenBoard) TillSurface.kitchen,
  // The other channels' orders are work to be done, so they sit with the kitchen —
  // and only for a merchant who takes them. See [kIncomingOrdersFeature].
  if (!kdsDevice &&
      hasIncomingOrders &&
      incomingOrdersEntitled &&
      access.canWriteCart)
    TillSurface.orders,
  if (!kdsDevice && access.showSaleHistory) TillSurface.sales,
  if (!kdsDevice && access.showCashCenter) TillSurface.cash,
  TillSurface.settings,
];

/// The surface the till lands on: the order screen for a seller, the kitchen
/// board for a cook, and the settings-led home for any other composition.
///
/// The order screen is the seller's home and nobody else's. Landing a role that
/// cannot build an order on the catalog is what asked the cook to start a sale
/// and answered with a red banner; the landing follows the role instead.
TillSurface landingSurface(List<TillSurface> surfaces) {
  for (final surface in surfaces) {
    if (surface == TillSurface.order || surface == TillSurface.kitchen) {
      return surface;
    }
  }
  return TillSurface.settings;
}
