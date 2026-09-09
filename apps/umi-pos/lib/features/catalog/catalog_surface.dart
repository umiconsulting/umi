import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/observability/telemetry.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/umi_theme.dart';
import '../cart/cart_controller.dart';
import '../cash/cash_controller.dart';
import '../cash/cash_surface.dart';
import '../checkout/checkout_controller.dart';
import '../checkout/checkout_surface.dart';
import '../customer_value/customer_value_controller.dart';
import '../customer_value/customer_value_surface.dart';
import '../entry/entry_controller.dart';
import '../exception/exception_controller.dart';
import '../hardware/hardware_runtime.dart';
import '../hardware/hardware_service.dart';
import '../hardware/hardware_surface.dart';
import '../inventory/inventory_controller.dart';
import '../inventory/inventory_surface.dart';
import '../kitchen/kitchen_board_controller.dart';
import '../kitchen/kitchen_board_surface.dart';
import '../kitchen/kitchen_status_repository.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_journal.dart';
import '../offline/recovery_center.dart';
import '../offline/replay_engine.dart';
import '../sale/sale_lifecycle_controller.dart';
import '../sale/sale_surface.dart';
import 'catalog_controller.dart';
import 'catalog_repository.dart';
import 'frequent_products.dart';

final class CatalogSurface extends StatefulWidget {
  const CatalogSurface({
    required this.entry,
    required this.catalog,
    required this.cart,
    required this.cash,
    required this.checkout,
    required this.sales,
    this.kitchenStatus,
    this.kitchenBoard,
    this.customerValue,
    required this.exceptions,
    required this.connectivity,
    required this.telemetry,
    this.inventory,
    this.hardware,
    this.offlineJournal,
    this.offlineRecovery,
    super.key,
  });
  final EntryController entry;
  final CatalogController catalog;
  final CartController cart;
  final CashController cash;
  final CheckoutController checkout;
  final SaleLifecycleController sales;
  final KitchenStatusRepository? kitchenStatus;
  final KitchenBoardController? kitchenBoard;
  final CustomerValueController? customerValue;
  final SaleExceptionController exceptions;
  final ConnectivityController connectivity;
  final Telemetry telemetry;
  final InventoryController? inventory;
  final HardwareService? hardware;
  final EncryptedOfflineJournal? offlineJournal;
  final OfflineRecoveryController? offlineRecovery;
  @override
  State<CatalogSurface> createState() => _CatalogSurfaceState();
}

final class _CatalogSurfaceState extends State<CatalogSurface> {
  final _search = TextEditingController();
  final _scroll = ScrollController();
  final _searchFocus = FocusNode();
  bool _initialLoadStarted = false;
  bool _leaving = false;
  String? _lastSaleErrorCode;
  StreamSubscription<CanonicalScanEvent>? _scanSubscription;
  Future<void> _scanQueue = Future<void>.value();
  FrequentProductsStore? _frequent;
  List<FrequentProduct> _frequentTop = const [];
  // On a wide till the product detail opens INLINE in the right pane (PoloTab
  // pattern) instead of a modal sheet; null means the grid is showing.
  CatalogProductDetail? _inlineDetail;
  CartItem? _inlineDetailItem;
  // The order context the barista sets in the top bar (PoloTab's "Para llevar"):
  // dine-in vs takeout. Shown on the comanda; carried onto the sale note.
  String _orderType = 'dine_in';

  @override
  void initState() {
    super.initState();
    widget.catalog.addListener(_changed);
    widget.cart.addListener(_changed);
    widget.cash.addListener(_changed);
    widget.sales.addListener(_saleChanged);
    widget.connectivity.addListener(_changed);
    _scroll.addListener(() {
      if (_scroll.hasClients && _scroll.position.extentAfter < 700) {
        widget.catalog.loadMore();
      }
    });
    _loadFrequent();
  }

  Future<void> _loadFrequent() async {
    final store = await FrequentProductsStore.create();
    if (!mounted) return;
    _frequent = store;
    _refreshFrequent();
  }

  void _refreshFrequent() {
    final store = _frequent;
    final entry = widget.entry.state;
    final tenant = entry.selectedTenant?.id;
    final branch = entry.selectedBranch?.id;
    if (store == null || tenant == null || branch == null) return;
    setState(() => _frequentTop = store.top(tenant, branch));
  }

  /// Count a cart add toward this register's frequent-products rail (audit F9).
  /// Only sellable items qualify, and a storage failure never blocks the add.
  void _recordFrequent(String id, String name, Map<String, Object?> price) {
    final store = _frequent;
    final entry = widget.entry.state;
    final tenant = entry.selectedTenant?.id;
    final branch = entry.selectedBranch?.id;
    if (store == null || tenant == null || branch == null) return;
    if (CatalogMoney.fromJson(price).minorUnits <= 0) return;
    unawaited(
      store
          .record(
            merchant: tenant,
            location: branch,
            id: id,
            name: name,
            price: price,
          )
          .then((_) {
            if (mounted) _refreshFrequent();
          }),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialLoadStarted) return;
    final entry = widget.entry.state;
    if (entry.selectedTenant != null && entry.selectedBranch != null) {
      _initialLoadStarted = true;
      _loadInitial(Localizations.localeOf(context).languageCode);
    }
  }

  Future<void> _loadInitial(String locale) async {
    final entry = widget.entry.state;
    await _recover();
    try {
      await widget.catalog.open(
        CatalogPartition(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          locale,
        ),
      );
      widget.connectivity.apiReachable(authorityValid: true);
      if (entry.operator != null) {
        widget.cash.setContext(
          merchantId: entry.selectedTenant!.id,
          locationId: entry.selectedBranch!.id,
          operatorSessionId: entry.operator!.id,
        );
        // Load the shift state so the Cash Center button badge is accurate, but
        // do NOT force the operator into the Cash Center. After the PIN the home
        // screen is always the menu; opening a shift, a cash withdrawal, or a
        // turn change is done on purpose from the Cash Center button in the app
        // bar (badged when there is no open shift), not by a modal that blocks
        // the menu on every sign-in.
        await widget.cash.load();
        await widget.sales.open(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          entry.operator!.id,
        );
        await widget.exceptions.setContext(
          merchantId: entry.selectedTenant!.id,
          locationId: entry.selectedBranch!.id,
          operatorSessionId: entry.operator!.id,
        );
        await _startScanner(entry.operator!.permissions);
        widget.connectivity.apiReachable(authorityValid: true);
      }
      await _recover();
    } catch (_) {
      widget.connectivity.apiFailure();
    }
  }

  Future<void> _startScanner(List<String> permissions) async {
    final hardware = widget.hardware;
    if (hardware == null || !permissions.contains('hardware.scanner.use')) {
      return;
    }
    await _scanSubscription?.cancel();
    final entry = widget.entry.state;
    await hardware.snapshot(
      HardwareScope(
        merchantId: entry.selectedTenant!.id,
        locationId: entry.selectedBranch!.id,
        operatorSessionId: entry.operator!.id,
        deviceId: entry.device!.id,
        credentialVersion: entry.device!.credentialVersion,
        permissions: entry.operator!.permissions.toSet(),
        registerId: widget.cash.activeRegisterId,
      ),
    );
    _scanSubscription = hardware.scanEvents.listen((event) {
      if (mounted) _scanQueue = _scanQueue.then((_) => _handleScan(event));
    });
  }

  Future<void> _handleScan(CanonicalScanEvent event) async {
    _search.text = event.value;
    final matches = await widget.catalog.lookupBarcode(event.value);
    if (!mounted) return;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    if (matches.length == 1) {
      final product = matches.single;
      if (!product.hasVariants && !product.hasModifiers) {
        await widget.cart.add(productId: product.id);
        _recordFrequent(product.id, product.name, product.price);
      } else {
        await _showDetail(product.id);
      }
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          matches.isEmpty
              ? (spanish ? 'Código de barras desconocido.' : 'Unknown barcode.')
              : (spanish
                    ? 'Hay varios productos para este código.'
                    : 'Multiple products match this barcode.'),
        ),
      ),
    );
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
    // Browsing (catalog detail/search) and cart mutations both surface a lost
    // operator session here; the `_leaving` guard makes this fire once.
    _reauthIfSessionLost(widget.cart.state.errorCode);
    _reauthIfSessionLost(widget.catalog.state.errorCode);
  }

  /// A cart/sale action the operator SHOULD be allowed to do (they hold
  /// `sale.lifecycle`) was refused for lost authority — their operator session
  /// was ended server-side (e.g. their role or a role's permissions changed in
  /// the dashboard, which ends active sessions). Return them to the PIN to
  /// re-authenticate rather than stranding them on a dead session with silent
  /// failures. A genuine permission gap is left alone: the operator would not
  /// hold `sale.lifecycle`, so re-entering the PIN would not change anything.
  /// Returns true when it takes over the exit. `_leaving` makes it fire once
  /// and stand down during an intentional lock/logout.
  bool _reauthIfSessionLost(String? errorCode) {
    if (_leaving || errorCode == null) return false;
    final lost =
        errorCode == 'PERMISSION_DENIED' ||
        errorCode == 'OPERATOR_SESSION_ENDED' ||
        errorCode == 'UNAUTHORIZED';
    if (!lost) return false;
    final permissions = OperatorPermissions(
      widget.entry.state.operator?.permissions ?? const [],
    );
    if (!permissions.allows('sale.lifecycle')) return false;
    _leaving = true;
    // Use a microtask, not addPostFrameCallback: dropping to the PIN must run
    // even if no further frame is pumped, and it also keeps `lock()` (which
    // mutates state) out of the current build/listener turn.
    scheduleMicrotask(() async {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).sessionEndedReauth),
        ),
      );
      await widget.entry.lock();
    });
    return true;
  }

  void _saleChanged() {
    if (!mounted) return;
    setState(() {});
    final errorCode = widget.sales.state.errorCode;
    if (errorCode != null && errorCode != _lastSaleErrorCode) {
      _lastSaleErrorCode = errorCode;
      if (!_reauthIfSessionLost(errorCode)) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(AppLocalizations.of(context).saleLifecycleError),
              ),
            );
          }
        });
      }
    } else if (errorCode == null) {
      _lastSaleErrorCode = null;
    }
    if (widget.sales.state.readyForNextCustomer) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _search.clear();
          widget.catalog.search('');
          _searchFocus.requestFocus();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                AppLocalizations.of(context).readyForNextCustomerMessage,
              ),
            ),
          );
        }
      });
    }
  }

  @override
  void dispose() {
    _scanSubscription?.cancel();
    widget.catalog.removeListener(_changed);
    widget.cart.removeListener(_changed);
    widget.cash.removeListener(_changed);
    widget.sales.removeListener(_saleChanged);
    widget.connectivity.removeListener(_changed);
    _search.dispose();
    _scroll.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.catalog.state;
    final entryState = widget.entry.state;
    final permissions = OperatorPermissions(
      entryState.operator?.permissions ?? const [],
    );
    final access = OperatorActionAccess(permissions);
    final canWriteCart = access.canWriteCart;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    // The overflow ("Más") menu holds the rare / admin actions (audit top-bar
    // redesign): it is shown only when the operator has at least one of them.
    final showOverflow =
        access.showSaleActions ||
        (permissions.allows('customer.search') &&
            widget.customerValue != null) ||
        (access.showInventory && widget.inventory != null) ||
        (permissions.allows('hardware.read') && widget.hardware != null) ||
        access.showRecovery ||
        kDebugMode;
    return Scaffold(
      floatingActionButton:
          MediaQuery.sizeOf(context).width < 900 && canWriteCart
          ? FloatingActionButton.extended(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => SafeArea(
                  child: SizedBox(
                    height: MediaQuery.sizeOf(context).height * .82,
                    child: _CartPanel(
                      controller: widget.cart,
                      checkout: widget.checkout,
                      cash: widget.cash,
                      entry: widget.entry,
                      permissions: permissions,
                      sales: widget.sales,
                      customerValue: widget.customerValue,
                      orderType: _orderType,
                      onEdit: (item) => _showDetail(
                        item.productId,
                        item: item,
                        canWrite: canWriteCart,
                      ),
                    ),
                  ),
                ),
              ),
              icon: const Icon(Icons.shopping_cart_outlined),
              label: Text(l.cartTitle),
            )
          : null,
      appBar: AppBar(
        // The order context (PoloTab's "Para llevar" pill) takes the title slot —
        // the barista sets dine-in vs takeout here before building the order.
        titleSpacing: UmiSpacing.md,
        title: Align(
          alignment: Alignment.centerLeft,
          child: SegmentedButton<String>(
            showSelectedIcon: false,
            style: SegmentedButton.styleFrom(
              selectedBackgroundColor: const Color(0xFF2E7DFF),
              selectedForegroundColor: Colors.white,
            ),
            segments: [
              ButtonSegment(
                value: 'dine_in',
                icon: const Icon(Icons.restaurant_outlined, size: 18),
                label: Text(spanish ? 'Comer aquí' : 'Dine in'),
              ),
              ButtonSegment(
                value: 'takeout',
                icon: const Icon(Icons.takeout_dining_outlined, size: 18),
                label: Text(spanish ? 'Para llevar' : 'Takeout'),
              ),
            ],
            selected: {_orderType},
            onSelectionChanged: (selection) =>
                setState(() => _orderType = selection.first),
          ),
        ),
        actions: [
          // Status — connectivity, compact. Visibility of system status.
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
            child: Semantics(
              liveRegion: true,
              label: _connectivityLabel(context, widget.connectivity.state),
              child: Chip(
                avatar: Icon(
                  widget.connectivity.state == PosConnectivity.online
                      ? Icons.cloud_done_outlined
                      : Icons.cloud_off_outlined,
                  size: 18,
                ),
                label: Text(
                  _connectivityLabel(context, widget.connectivity.state),
                ),
              ),
            ),
          ),
          // Primary, labelled, high-frequency actions (top-bar redesign).
          if (access.showSaleActions)
            _BarAction(
              icon: Icons.add_shopping_cart_outlined,
              label: l.newSaleAction,
              onPressed: () => widget.sales.newSale(),
            ),
          // Caja and Ventas moved to the bottom tab bar (PoloTab pattern).
          // Overflow — rare / admin actions (progressive disclosure).
          if (showOverflow)
            PopupMenuButton<String>(
              tooltip: spanish ? 'Más' : 'More',
              icon: const Icon(Icons.more_vert),
              onSelected: (action) async {
                switch (action) {
                  case 'suspend':
                    if (context.mounted) {
                      await showSuspendSaleDialog(context, widget.sales);
                    }
                  case 'cancel':
                    if (context.mounted) {
                      await showCancelSaleDialog(context, widget.sales);
                    }
                  case 'customers':
                    await showCustomerCenter(
                      context,
                      entry: widget.entry,
                      controller: widget.customerValue!,
                      sales: widget.sales,
                    );
                  case 'inventory':
                    await showInventoryCenter(
                      context,
                      entry: widget.entry,
                      controller: widget.inventory!,
                    );
                  case 'hardware':
                    await showHardwareCenter(
                      context,
                      entry: widget.entry,
                      service: widget.hardware!,
                      permissions: permissions,
                      registerId: widget.cash.activeRegisterId,
                    );
                  case 'recovery':
                    final scope = _scope();
                    if (scope != null &&
                        widget.offlineJournal != null &&
                        widget.offlineRecovery != null) {
                      await showRecoveryCenter(
                        context,
                        journal: widget.offlineJournal!,
                        recovery: widget.offlineRecovery!,
                        scope: scope,
                        entry: widget.entry,
                        telemetry: widget.telemetry,
                        refreshSnapshots: () => _loadInitial(
                          Localizations.localeOf(context).languageCode,
                        ),
                        queryAmbiguousPayment:
                            widget.checkout.queryUnknownPayment,
                        beforeContextExit: widget.sales.prepareForOperatorExit,
                        retryOfflineHardware:
                            widget.hardware == null ||
                                (!permissions.allows(
                                      'hardware.printer.print',
                                    ) &&
                                    !permissions.allows('hardware.drawer.open'))
                            ? null
                            : _retryOfflineHardware,
                      );
                    }
                  case 'diagnostics':
                    await _showAuthorizationDiagnostics(permissions);
                }
              },
              itemBuilder: (_) => [
                if (access.showSaleActions) ...[
                  _overflowItem(
                    'suspend',
                    Icons.pause_circle_outline,
                    l.suspendSaleAction,
                  ),
                  _overflowItem(
                    'cancel',
                    Icons.cancel_outlined,
                    l.cancelSaleAction,
                  ),
                ],
                if (permissions.allows('customer.search') &&
                    widget.customerValue != null)
                  _overflowItem(
                    'customers',
                    Icons.people_alt_outlined,
                    spanish ? 'Centro de clientes' : 'Customer center',
                  ),
                if (access.showInventory && widget.inventory != null)
                  _overflowItem(
                    'inventory',
                    Icons.inventory_2_outlined,
                    spanish ? 'Inventario' : 'Inventory',
                  ),
                if (permissions.allows('hardware.read') &&
                    widget.hardware != null)
                  _overflowItem(
                    'hardware',
                    Icons.devices_other_outlined,
                    'Hardware',
                  ),
                if (access.showRecovery)
                  _overflowItem(
                    'recovery',
                    Icons.sync_problem_outlined,
                    AppLocalizations.of(context).recoveryCenterTitle,
                  ),
                if (kDebugMode)
                  _overflowItem(
                    'diagnostics',
                    Icons.policy_outlined,
                    spanish ? 'Diagnóstico' : 'Diagnostics',
                  ),
              ],
            ),
          // Account — identity + Lock + Logout, consolidated.
          _AccountMenu(
            operatorName: widget.entry.operatorName,
            branch: widget.entry.state.selectedBranch?.name,
            onLock: () => _leaveOperator(lock: true),
            onLogout: () => _leaveOperator(lock: false),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: _catalogBody(context, l, state, permissions, canWriteCart),
        ),
      ),
      // The primary navigation, PoloTab-style: the order screen is home, with the
      // cash centre, the sales history, the kitchen board and settings a tap away.
      bottomNavigationBar: _primaryNav(context, l, spanish, access, permissions),
    );
  }

  // The kitchen board (KDS mode) is a first-class destination, not a settings
  // entry. On a POS terminal it opens the read-only board with the operator
  // session; a KDS-role device gets the full surface once device identity
  // unifies (see the KDS+POS unification ADR). The entry stays conditional
  // because `kitchenBoard` is optional in tests.
  Widget _primaryNav(
    BuildContext context,
    AppLocalizations l,
    bool spanish,
    OperatorActionAccess access,
    OperatorPermissions permissions,
  ) {
    final entries =
        <({NavigationDestination destination, void Function()? onTap})>[
          (
            destination: NavigationDestination(
              icon: const Icon(Icons.receipt_long_outlined),
              selectedIcon: const Icon(Icons.receipt_long),
              label: spanish ? 'Comanda' : 'Order',
            ),
            onTap: null,
          ),
          (
            destination: NavigationDestination(
              icon: Badge(
                isLabelVisible: widget.cash.activeShiftId == null,
                child: const Icon(Icons.point_of_sale_outlined),
              ),
              label: spanish ? 'Caja' : 'Cash',
            ),
            onTap: access.showCashCenter
                ? () => _openCashCenter(context, permissions)
                : null,
          ),
          (
            destination: NavigationDestination(
              icon: const Icon(Icons.receipt_outlined),
              label: spanish ? 'Ventas' : 'Sales',
            ),
            onTap: access.showSaleHistory
                ? () => _openSaleCenter(context, permissions)
                : null,
          ),
          if (widget.kitchenBoard != null)
            (
              destination: NavigationDestination(
                icon: const Icon(Icons.restaurant_menu_outlined),
                selectedIcon: const Icon(Icons.restaurant_menu),
                label: spanish ? 'Cocina' : 'Kitchen',
              ),
              onTap: () => showKitchenBoard(
                context,
                controller: widget.kitchenBoard!,
                entry: widget.entry,
              ),
            ),
          (
            destination: NavigationDestination(
              icon: const Icon(Icons.tune_outlined),
              label: spanish ? 'Ajustes' : 'Settings',
            ),
            onTap: () => _openSettingsSheet(context, l),
          ),
        ];
    return NavigationBar(
      selectedIndex: 0,
      onDestinationSelected: (index) => entries[index].onTap?.call(),
      destinations: [for (final entry in entries) entry.destination],
    );
  }

  void _openSettingsSheet(BuildContext context, AppLocalizations l) =>
      showModalBottomSheet<void>(
        context: context,
        builder: (sheetContext) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.lock_outline),
                title: Text(l.lockAction),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _leaveOperator(lock: true);
                },
              ),
              ListTile(
                leading: const Icon(Icons.logout),
                title: Text(l.logoutAction),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _leaveOperator(lock: false);
                },
              ),
            ],
          ),
        ),
      );

  /// PoloTab-style floor: on a wide till the screen is three panes — the order
  /// (comanda) on the left, a vertical colour-coded category rail in the middle,
  /// and the product grid on the right. A narrow device keeps the single column
  /// with a horizontal category strip and reaches the cart through the FAB sheet.
  Widget _catalogBody(
    BuildContext context,
    AppLocalizations l,
    CatalogState state,
    OperatorPermissions permissions,
    bool canWriteCart,
  ) {
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final search = TextField(
      key: const ValueKey('hardware-barcode-search'),
      controller: _search,
      focusNode: _searchFocus,
      onChanged: (value) {
        widget.catalog.search(value);
        setState(() {});
      },
      decoration: InputDecoration(
        prefixIcon: const Icon(Icons.search),
        hintText: l.catalogSearchHint,
        suffixIcon: _search.text.isEmpty
            ? null
            : IconButton(
                onPressed: () {
                  _search.clear();
                  widget.catalog.search('');
                  setState(() {});
                },
                icon: const Icon(Icons.clear),
              ),
      ),
    );
    final frequent = _frequentTop.isNotEmpty && canWriteCart
        ? _FrequentRail(
            products: _frequentTop,
            onTap: (id) => _showDetail(id, canWrite: canWriteCart),
          )
        : null;
    final productPane = Column(
      children: [
        search,
        if (frequent != null) ...[
          const SizedBox(height: UmiSpacing.md),
          frequent,
        ],
        const SizedBox(height: UmiSpacing.md),
        Expanded(child: _content(context, state)),
      ],
    );

    if (!wide) {
      return Column(
        children: [
          search,
          if (frequent != null) ...[
            const SizedBox(height: UmiSpacing.md),
            frequent,
          ],
          const SizedBox(height: UmiSpacing.md),
          SizedBox(
            height: 48,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                _Category(
                  label: l.allCategories,
                  selected: state.selectedCategoryId == null,
                  onTap: () => widget.catalog.selectCategory(null),
                ),
                ...state.categories.map(
                  (category) => _Category(
                    label: category.name,
                    selected: state.selectedCategoryId == category.id,
                    color: _ProductPlaceholder.categoryColor(
                      category,
                      category.name,
                    ),
                    onTap: category.enabled
                        ? () => widget.catalog.selectCategory(category.id)
                        : null,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: UmiSpacing.md),
          Expanded(child: _content(context, state)),
        ],
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Left pane — the order.
        SizedBox(
          width: 340,
          child: _CartPanel(
            controller: widget.cart,
            checkout: widget.checkout,
            cash: widget.cash,
            entry: widget.entry,
            permissions: permissions,
            sales: widget.sales,
            customerValue: widget.customerValue,
            orderType: _orderType,
            onEdit: (item) =>
                _showDetail(item.productId, item: item, canWrite: canWriteCart),
          ),
        ),
        const SizedBox(width: UmiSpacing.md),
        // Middle pane — the vertical category rail.
        SizedBox(
          width: 172,
          child: _CategoryRail(
            categories: state.categories,
            selectedId: state.selectedCategoryId,
            allLabel: l.allCategories,
            onSelect: (id) {
              setState(() {
                _inlineDetail = null;
                _inlineDetailItem = null;
              });
              widget.catalog.selectCategory(id);
            },
          ),
        ),
        const SizedBox(width: UmiSpacing.md),
        // Right pane — the product grid, or the selected product's detail.
        Expanded(
          child: _inlineDetail == null
              ? productPane
              : _Detail(
                  _inlineDetail!,
                  key: ValueKey(
                    '${_inlineDetail!.id}:${_inlineDetailItem != null}',
                  ),
                  cart: widget.cart,
                  canWrite: canWriteCart,
                  item: _inlineDetailItem,
                  onRecord: _inlineDetailItem == null
                      ? () => _recordFrequent(
                          _inlineDetail!.id,
                          _inlineDetail!.name,
                          _inlineDetail!.price,
                        )
                      : null,
                  onClose: () => setState(() {
                    _inlineDetail = null;
                    _inlineDetailItem = null;
                  }),
                ),
        ),
      ],
    );
  }

  Future<void> _openCashCenter(
    BuildContext context,
    OperatorPermissions permissions,
  ) => showCashCenter(
    context,
    controller: widget.cash,
    permissions: permissions,
    onHandoffCompleted: widget.entry.lock,
  );

  Future<void> _openSaleCenter(
    BuildContext context,
    OperatorPermissions permissions,
  ) => showSaleCenter(
    context,
    widget.sales,
    permissions,
    widget.exceptions,
    widget.hardware == null
        ? null
        : (receiptId, result) async {
            final entry = widget.entry.state;
            await widget.hardware!.printAuthoritativeReceipt(
              scope: HardwareScope(
                merchantId: entry.selectedTenant!.id,
                locationId: entry.selectedBranch!.id,
                operatorSessionId: entry.operator!.id,
                deviceId: entry.device!.id,
                credentialVersion: entry.device!.credentialVersion,
                permissions: entry.operator!.permissions.toSet(),
                registerId: widget.cash.activeRegisterId,
              ),
              receiptId: receiptId,
              receiptSnapshot: result.receipt!,
            );
          },
    widget.kitchenStatus == null
        ? null
        : (sale) {
            final state = widget.entry.state;
            return widget.kitchenStatus!.status(
              state.selectedTenant!.id,
              sale.sourceOrderId!,
              PosKitchenOrderQuery(
                locationId: state.selectedBranch!.id,
                operatorSessionId: state.operator!.id,
              ),
            );
          },
  );

  Future<void> _showAuthorizationDiagnostics(
    OperatorPermissions permissions,
  ) async {
    final state = widget.entry.state;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final entitlementEnabled = state.operator?.entitlements.any(
      (value) => value['featureKey'] == 'pos' && value['enabled'] == true,
    );
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          spanish ? 'Diagnóstico de autorización' : 'Authorization diagnostics',
        ),
        content: SelectableText(
          [
            '${spanish ? 'Operador' : 'Operator'}: ${state.operator?.staffId ?? '—'}',
            '${spanish ? 'Perfil' : 'Profile'}: ${state.selectedTenant?.roles.join(', ') ?? '—'}',
            'Merchant: ${state.selectedTenant?.name ?? '—'}',
            'Location: ${state.selectedBranch?.name ?? '—'}',
            '${spanish ? 'Permisos POS' : 'POS permissions'}: ${permissions.count}',
            'POS entitlement: ${entitlementEnabled == true ? (spanish ? 'activo' : 'active') : (spanish ? 'inactivo' : 'inactive')}',
            '${spanish ? 'Dispositivo' : 'Device'}: ${state.device?.state ?? '—'}',
          ].join('\n'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: Text(spanish ? 'Cerrar' : 'Close'),
          ),
        ],
      ),
    );
  }

  Future<void> _leaveOperator({required bool lock}) async {
    // Mark the exit as intentional so the sale listener does not also fire its
    // own auto-return-to-PIN when parking the open sale fails.
    _leaving = true;
    final safe = await widget.sales.prepareForOperatorExit();
    if (!mounted) return;
    if (!safe) {
      // The open sale could not be parked. Locking is meant to preserve it, so
      // for a possibly-recoverable failure keep the operator here and let them
      // retry. But never trap them: logging out ALWAYS proceeds, and even a
      // lock falls through when the operator has lost authority over the sale
      // (their session was ended server-side, e.g. after a role change) —
      // there is nothing left to preserve and nothing they can do here.
      final code = widget.sales.state.errorCode;
      final authorityLost =
          code == 'PERMISSION_DENIED' ||
          code == 'OPERATOR_SESSION_ENDED' ||
          code == 'UNAUTHORIZED';
      if (lock && !authorityLost) {
        _leaving = false;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context).saleLifecycleError),
          ),
        );
        return;
      }
    }
    if (lock) {
      await widget.entry.lock();
    } else {
      await widget.entry.logout();
    }
  }

  ReplayScope? _scope() {
    final state = widget.entry.state;
    final tenant = state.selectedTenant;
    final branch = state.selectedBranch;
    final operator = state.operator;
    final device = state.device;
    if (tenant == null ||
        branch == null ||
        operator == null ||
        device == null) {
      return null;
    }
    return ReplayScope(
      merchantId: tenant.id,
      locationId: branch.id,
      operatorSessionId: operator.id,
      credentialVersion: device.credentialVersion,
    );
  }

  Future<OfflineHardwareRecoveryResult> _retryOfflineHardware(
    JournalEntry entry,
  ) async {
    final hardware = widget.hardware;
    final state = widget.entry.state;
    final tenant = state.selectedTenant;
    final branch = state.selectedBranch;
    final operator = state.operator;
    final posDevice = state.device;
    final provisionalId = entry.command.provisionalId;
    final permissions = OperatorPermissions(operator?.permissions ?? const []);
    if (hardware == null ||
        tenant == null ||
        branch == null ||
        operator == null ||
        posDevice == null ||
        provisionalId == null ||
        (!permissions.allows('hardware.printer.print') &&
            !permissions.allows('hardware.drawer.open'))) {
      throw StateError('HARDWARE_OFFLINE_RECOVERY_CONTEXT_REQUIRED');
    }
    final command = OfflineCheckoutCommand.fromJson(entry.command.payload);
    final hardwareScope = HardwareScope(
      merchantId: tenant.id,
      locationId: branch.id,
      operatorSessionId: operator.id,
      deviceId: posDevice.id,
      credentialVersion: posDevice.credentialVersion,
      permissions: operator.permissions.toSet(),
      registerId: widget.cash.activeRegisterId,
    );
    final results = await hardware.retryOfflineCheckoutHardware(
      hardwareScope,
      ProvisionalReceipt(
        provisionalSaleId: provisionalId,
        status: 'pending_sync',
        locationName: branch.name,
        operatorName: operator.staffId,
        snapshot: command.snapshot,
        createdAt: entry.command.createdAt,
        lastSynchronizationAt: null,
        officialReceipt: entry.officialCommit,
      ),
    );
    return OfflineHardwareRecoveryResult([
      for (final result in results.whereType<RuntimeCommandResult>())
        OfflineHardwareRecoveryItem(
          commandId: result.safeMetadata['commandId']! as String,
          commandType: result.safeMetadata['commandType']! as String,
          status: result.status.name,
          verifyPrint:
              result.status == RuntimeCommandStatus.unknown &&
                  (result.safeMetadata['commandType'] == 'print_receipt' ||
                      result.safeMetadata['commandType'] ==
                          'controlled_reprint') &&
                  permissions.allows('hardware.printer.print')
              ? () => hardware.verifyOfflinePrint(
                  scope: hardwareScope,
                  commandId: result.safeMetadata['commandId']! as String,
                )
              : null,
          controlledReprint:
              result.status == RuntimeCommandStatus.unknown &&
                  (result.safeMetadata['commandType'] == 'print_receipt' ||
                      result.safeMetadata['commandType'] ==
                          'controlled_reprint') &&
                  permissions.allows('hardware.printer.reprint')
              ? () async {
                  final recovered = await hardware.controlledOfflineReprint(
                    scope: hardwareScope,
                    commandId: result.safeMetadata['commandId']! as String,
                  );
                  if (recovered.status != RuntimeCommandStatus.succeeded) {
                    throw StateError('HARDWARE_RECOVERY_NEEDS_ATTENTION');
                  }
                }
              : null,
          repeatDrawerOpen:
              result.status == RuntimeCommandStatus.unknown &&
                  result.safeMetadata['commandType'] == 'open_drawer' &&
                  permissions.allows('hardware.drawer.open')
              ? () async {
                  final recovered = await hardware.repeatOfflineDrawerOpen(
                    scope: hardwareScope,
                    commandId: result.safeMetadata['commandId']! as String,
                  );
                  if (recovered.status != RuntimeCommandStatus.succeeded) {
                    throw StateError('HARDWARE_RECOVERY_NEEDS_ATTENTION');
                  }
                }
              : null,
        ),
    ]);
  }

  Future<void> _recover() async {
    final scope = _scope();
    if (scope != null) await widget.offlineRecovery?.recover(scope);
  }

  Widget _content(BuildContext context, CatalogState state) {
    final l = AppLocalizations.of(context);
    return switch (state.phase) {
      CatalogPhase.idle ||
      CatalogPhase.loading => _Skeleton(label: l.catalogLoading),
      CatalogPhase.empty => _Message(
        l.catalogEmpty,
        Icons.inventory_2_outlined,
        widget.catalog.refresh,
      ),
      CatalogPhase.noResults => _Message(
        l.catalogNoResults,
        Icons.search_off,
        null,
      ),
      CatalogPhase.permissionDenied => _Message(
        l.catalogPermissionDenied,
        Icons.lock_outline,
        null,
      ),
      CatalogPhase.networkFailure => _Message(
        l.catalogNetworkError,
        Icons.cloud_off,
        widget.catalog.refresh,
      ),
      CatalogPhase.failure => _Message(
        l.catalogUnexpectedError,
        Icons.error_outline,
        widget.catalog.refresh,
      ),
      CatalogPhase.ready => LayoutBuilder(
        builder: (context, size) {
          final columns = size.maxWidth >= 1400
              ? 6
              : size.maxWidth >= 1050
              ? 5
              : size.maxWidth >= 760
              ? 4
              : 2;
          // Keep the barista's fast path to sellable café items (audit F8):
          // a zero-price product (space rental, placeholders) cannot be
          // charged, so it does not belong in the sale grid.
          final products = state.products
              .where(
                (product) =>
                    CatalogMoney.fromJson(product.price).minorUnits > 0,
              )
              .toList(growable: false);
          return GridView.builder(
            key: const PageStorageKey('catalog-grid'),
            controller: _scroll,
            itemCount: products.length + (state.loadingMore ? 1 : 0),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
              childAspectRatio: .72,
            ),
            itemBuilder: (context, index) => index == products.length
                ? const Center(child: CircularProgressIndicator())
                : _ProductCard(
                    product: products[index],
                    onTap: () => _showDetail(
                      products[index].id,
                      canWrite: OperatorPermissions(
                        widget.entry.state.operator?.permissions ?? const [],
                      ).allows('cart.write'),
                    ),
                  ),
          );
        },
      ),
    };
  }

  Future<void> _showDetail(String id, {CartItem? item, bool? canWrite}) async {
    try {
      final detail = await widget.catalog.detail(id);
      if (!mounted) return;
      // Single-tap add: a product with no size/variant and no modifier group
      // needs no choices, so adding it should not cost a sheet plus a second
      // tap. Add it straight to the cart; products that require a choice still
      // open the sheet. (Editing an existing line always opens the sheet.)
      final canAdd =
          canWrite ??
          OperatorPermissions(
            widget.entry.state.operator?.permissions ?? const [],
          ).allows('cart.write');
      if (item == null &&
          canAdd &&
          detail.variants.isEmpty &&
          detail.optionGroups.isEmpty) {
        await widget.cart.add(productId: detail.id);
        _recordFrequent(detail.id, detail.name, detail.price);
        return;
      }
      // Wide till: the detail lives in the right pane, not a modal.
      if (MediaQuery.sizeOf(context).width >= 900) {
        setState(() {
          _inlineDetail = detail;
          _inlineDetailItem = item;
        });
        return;
      }
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        constraints: const BoxConstraints(maxWidth: 760),
        builder: (_) => _Detail(
          detail,
          cart: widget.cart,
          item: item,
          canWrite: canAdd,
          onRecord: item == null
              ? () => _recordFrequent(detail.id, detail.name, detail.price)
              : null,
        ),
      );
    } on AppException catch (error) {
      if (!mounted) return;
      // The detail fetch is authorized against the operator session, so a lost
      // session shows up here too — bounce to the PIN instead of a dead-end
      // "catalog unavailable" toast.
      if (_reauthIfSessionLost(error.code)) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(AppLocalizations.of(context).catalogUnexpectedError),
        ),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context).catalogUnexpectedError),
          ),
        );
      }
    }
  }
}

String _connectivityLabel(BuildContext context, PosConnectivity state) {
  final spanish = Localizations.localeOf(context).languageCode == 'es';
  return switch (state) {
    PosConnectivity.unknown =>
      spanish ? 'Conexión desconocida' : 'Connection unknown',
    PosConnectivity.online => spanish ? 'En línea' : 'Online',
    PosConnectivity.degraded => spanish ? 'Conexión inestable' : 'Degraded',
    PosConnectivity.offline => spanish ? 'Sin conexión' : 'Offline',
    PosConnectivity.recovering =>
      spanish ? 'Recuperando conexión' : 'Recovering',
    PosConnectivity.replaying => spanish ? 'Sincronizando' : 'Synchronizing',
    PosConnectivity.reconciliationRequired =>
      spanish ? 'Revisión necesaria' : 'Review required',
    PosConnectivity.blocked => spanish ? 'Operación bloqueada' : 'Blocked',
  };
}

PopupMenuItem<String> _overflowItem(
  String value,
  IconData icon,
  String label,
) => PopupMenuItem<String>(
  value: value,
  child: Row(
    children: [
      Icon(icon, size: 20),
      const SizedBox(width: UmiSpacing.md),
      Text(label),
    ],
  ),
);

/// A labelled top-bar action (top-bar redesign): icon + visible text label
/// (recognition, not recall), a touch-sized target, and an optional badge dot.
final class _BarAction extends StatelessWidget {
  const _BarAction({
    required this.icon,
    required this.label,
    required this.onPressed,
  });
  final IconData icon;
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 2),
    child: TextButton.icon(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: Theme.of(context).colorScheme.onSurface,
        minimumSize: const Size(0, UmiTouchTarget.minimum),
        padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
      ),
      icon: Icon(icon),
      label: Text(label),
    ),
  );
}

/// The consolidated account control (top-bar redesign): the operator identity
/// and the Lock / Logout actions folded into one menu, so they no longer take
/// three separate slots on the bar.
final class _AccountMenu extends StatelessWidget {
  const _AccountMenu({
    required this.operatorName,
    required this.branch,
    required this.onLock,
    required this.onLogout,
  });
  final String? operatorName;
  final String? branch;
  final VoidCallback onLock;
  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return PopupMenuButton<String>(
      tooltip: spanish ? 'Cuenta' : 'Account',
      onSelected: (value) {
        if (value == 'lock') {
          onLock();
        } else if (value == 'logout') {
          onLogout();
        }
      },
      itemBuilder: (_) => [
        if (operatorName != null || branch != null) ...[
          PopupMenuItem<String>(
            enabled: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (operatorName != null)
                  Text(operatorName!, style: theme.textTheme.titleSmall),
                if (branch != null)
                  Text(branch!, style: theme.textTheme.bodySmall),
              ],
            ),
          ),
          const PopupMenuDivider(),
        ],
        PopupMenuItem<String>(
          value: 'lock',
          child: Row(
            children: [
              const Icon(Icons.lock_outline, size: 20),
              const SizedBox(width: UmiSpacing.md),
              Text(l.lockAction),
            ],
          ),
        ),
        PopupMenuItem<String>(
          value: 'logout',
          child: Row(
            children: [
              const Icon(Icons.logout, size: 20),
              const SizedBox(width: UmiSpacing.md),
              Text(l.logoutAction),
            ],
          ),
        ),
      ],
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.account_circle_outlined),
            const SizedBox(width: UmiSpacing.sm),
            Text(
              operatorName ?? branch ?? '—',
              style: theme.textTheme.titleSmall,
            ),
            const Icon(Icons.arrow_drop_down),
          ],
        ),
      ),
    );
  }
}

/// The middle pane's vertical category rail (PoloTab pattern): "Todo" on top,
/// then one tile per category, each carrying its POS colour as an underline bar.
final class _CategoryRail extends StatelessWidget {
  const _CategoryRail({
    required this.categories,
    required this.selectedId,
    required this.allLabel,
    required this.onSelect,
  });
  final List<CatalogCategory> categories;
  final String? selectedId;
  final String allLabel;
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) => ListView(
    children: [
      _CategoryTile(
        label: allLabel,
        color: null,
        selected: selectedId == null,
        onTap: () => onSelect(null),
      ),
      for (final category in categories)
        _CategoryTile(
          label: category.name,
          color: _ProductPlaceholder.categoryColor(category, category.name),
          selected: selectedId == category.id,
          onTap: category.enabled ? () => onSelect(category.id) : null,
        ),
    ],
  );
}

final class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.label,
    required this.color,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final Color? color;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final accent = color ?? scheme.primary;
    return Padding(
      padding: const EdgeInsets.only(bottom: UmiSpacing.sm),
      child: Material(
        color: selected
            ? accent.withValues(alpha: .22)
            : scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Container(
            height: 64,
            decoration: BoxDecoration(
              border: Border.all(
                color: selected ? accent : Colors.transparent,
                width: 2,
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: UmiSpacing.md,
                      vertical: UmiSpacing.sm,
                    ),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Text(
                        label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: onTap == null
                              ? scheme.onSurfaceVariant
                              : scheme.onSurface,
                          fontWeight: selected
                              ? FontWeight.w700
                              : FontWeight.w500,
                        ),
                      ),
                    ),
                  ),
                ),
                // Edge-to-edge colour bar along the bottom — the category's tint,
                // the way PoloTab underlines each tile.
                Container(height: 4, color: accent),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

final class _Category extends StatelessWidget {
  const _Category({
    required this.label,
    required this.selected,
    required this.onTap,
    this.color,
  });
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  /// The category's POS colour, shown as a small dot so the filter chip carries
  /// the same colour the barista sees on the product tiles. Null on "all".
  final Color? color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(
      avatar: color == null
          ? null
          : CircleAvatar(backgroundColor: color, radius: 6),
      label: Text(label),
      selected: selected,
      onSelected: onTap == null ? null : (_) => onTap!(),
    ),
  );
}

/// A quick-add rail of the register's most-added products (audit F9), so the
/// barista reaches the top drinks without scrolling the grid.
final class _FrequentRail extends StatelessWidget {
  const _FrequentRail({required this.products, required this.onTap});
  final List<FrequentProduct> products;
  final ValueChanged<String> onTap;

  String _money(Map<String, Object?> price) {
    final money = CatalogMoney.fromJson(price);
    return '${money.currency} ${(money.minorUnits / 100).toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              Icons.star_outline,
              size: 18,
              color: Theme.of(context).colorScheme.primary,
            ),
            const SizedBox(width: UmiSpacing.xs),
            Text(
              spanish ? 'Frecuentes' : 'Frequent',
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ],
        ),
        const SizedBox(height: UmiSpacing.sm),
        SizedBox(
          height: 44,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: products.length,
            separatorBuilder: (_, _) => const SizedBox(width: UmiSpacing.sm),
            itemBuilder: (context, index) {
              final product = products[index];
              return ActionChip(
                avatar: const Icon(Icons.add, size: 18),
                label: Text('${product.name}  ·  ${_money(product.price)}'),
                onPressed: () => onTap(product.id),
              );
            },
          ),
        ),
      ],
    );
  }
}

final class _ProductCard extends StatelessWidget {
  const _ProductCard({required this.product, required this.onTap});
  final CatalogProductSummary product;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final money = CatalogMoney.fromJson(product.price);
    final category = product.category == null
        ? null
        : CatalogCategory.fromJson(product.category!);
    final url = product.primaryMedia?['url'] as String?;
    return Semantics(
      button: true,
      label: product.name,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: url == null
                    ? _ProductPlaceholder(
                        name: product.name,
                        category: category,
                      )
                    : Image.network(
                        url,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => const Center(
                          child: Icon(Icons.broken_image_outlined),
                        ),
                      ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    if (category != null) Text(category.name, maxLines: 1),
                    const SizedBox(height: 8),
                    Text(
                      '${money.currency} ${(money.minorUnits / 100).toStringAsFixed(2)}',
                    ),
                    Wrap(
                      spacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (product.sku != null) Text(product.sku!),
                        if (product.hasBarcode)
                          const Icon(Icons.qr_code_2, size: 20),
                        if (product.availability != 'enabled')
                          Text(l.unavailableLabel),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A product with no photo gets a colour and its initials, so the barista
/// recognizes it at a glance (audit F7). The colour groups the tile by CATEGORY:
/// the owner sets it in the dashboard, and when unset the terminal derives a
/// stable hue from the category name so a category still reads as one block.
/// A product with no category falls back to its own name.
final class _ProductPlaceholder extends StatelessWidget {
  const _ProductPlaceholder({required this.name, this.category});
  final String name;
  final CatalogCategory? category;

  static String _initials(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      final word = parts.first;
      return (word.length >= 2 ? word.substring(0, 2) : word).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  /// The background a category paints behind photo-less products. Shared with the
  /// dashboard (see `categoryColor` in the dashboard's categories view) so the
  /// owner's preview matches the terminal.
  static Color categoryColor(CatalogCategory? category, String fallbackSeed) {
    final explicit = category?.color;
    if (explicit != null) {
      final parsed = _parseHex(explicit);
      if (parsed != null) return parsed;
    }
    final seed = category?.name ?? fallbackSeed;
    return HSLColor.fromAHSL(1, _hue(seed).toDouble(), .42, .32).toColor();
  }

  /// djb2 over the lowercased seed, wrapped to 32 bits. `<<5 + self == *33` and the
  /// mask equals `% 2^32`, which the dashboard mirrors with `(*33) % 4294967296` so
  /// both derive the identical hue. Deterministic: a category is always one colour.
  static int _hue(String seed) {
    var hash = 5381;
    for (final unit in seed.toLowerCase().codeUnits) {
      hash = ((hash << 5) + hash + unit) & 0xFFFFFFFF;
    }
    return hash % 360;
  }

  static Color? _parseHex(String value) {
    final match = RegExp(r'^#([0-9a-fA-F]{6})$').firstMatch(value);
    if (match == null) return null;
    return Color(0xFF000000 | int.parse(match.group(1)!, radix: 16));
  }

  @override
  Widget build(BuildContext context) {
    final background = categoryColor(category, name);
    // White reads on the dark auto-derived tints, but an owner colour can be light;
    // pick the legible ink by luminance so the initials never wash out.
    final onColor = background.computeLuminance() > 0.5
        ? Colors.black87
        : Colors.white;
    return ColoredBox(
      color: background,
      child: Center(
        child: Text(
          _initials(name),
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
            color: onColor,
            fontWeight: FontWeight.w700,
            letterSpacing: 1,
          ),
        ),
      ),
    );
  }
}

final class _Detail extends StatefulWidget {
  const _Detail(
    this.detail, {
    required this.cart,
    required this.canWrite,
    this.item,
    this.onRecord,
    this.onClose,
    super.key,
  });
  final CatalogProductDetail detail;
  final CartController cart;
  final bool canWrite;
  final CartItem? item;
  final VoidCallback? onRecord;

  /// When set, the detail renders INLINE in the right pane (PoloTab pattern) with
  /// a back affordance, and closing/adding calls this instead of popping a sheet.
  final VoidCallback? onClose;
  @override
  State<_Detail> createState() => _DetailState();
}

final class _DetailState extends State<_Detail> {
  String? variantId;
  final selectedModifiers = <String, int>{};
  final note = TextEditingController();
  int quantity = 1;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    if (item == null) return;
    variantId = item.variant?['variantId'] as String?;
    for (final modifier in item.modifiers) {
      selectedModifiers[modifier['modifierId']! as String] =
          (modifier['quantity']! as num).toInt();
    }
    note.text = item.note ?? '';
    quantity = item.quantity;
  }

  @override
  void dispose() {
    note.dispose();
    super.dispose();
  }

  List<Map<String, Object?>> _groupModifiers(Map<String, Object?> group) =>
      (group['modifiers'] as List<Object?>? ?? const <Object?>[])
          .cast<Map<String, Object?>>();

  /// The "+$X" a modifier adds, shown on its card. Null when it is free.
  String? _priceLabel(Map<String, Object?> modifier) {
    final delta = modifier['priceDelta'];
    if (delta is! Map) return null;
    final minor = (delta['minorUnits'] as num?)?.toInt() ?? 0;
    if (minor == 0) return null;
    final currency = delta['currency'] as String? ?? '';
    return '${minor > 0 ? '+' : ''}$currency ${(minor / 100).toStringAsFixed(2)}';
  }

  /// How many options this group needs before the line can be added. A
  /// `required` group needs at least `minSelections` (at least one when the
  /// menu leaves the minimum at zero); an optional group needs none.
  int _requiredCount(Map<String, Object?> group) {
    final required = group['required'] == true;
    final min = (group['minSelections'] as num?)?.toInt() ?? 0;
    if (!required) return min;
    return min == 0 ? 1 : min;
  }

  /// Every required option group has enough choices. This is error prevention
  /// (audit F2): a crucial choice like size cannot be skipped.
  bool _requiredOptionsSatisfied() {
    for (final group in widget.detail.optionGroups) {
      final needed = _requiredCount(group);
      if (needed <= 0) continue;
      final selected = _groupModifiers(
        group,
      ).where((m) => selectedModifiers.containsKey(m['id'])).length;
      if (selected < needed) return false;
    }
    return true;
  }

  String? _groupHint(
    bool spanish, {
    required bool required,
    required int min,
    required int? max,
    required bool single,
  }) {
    if (required) {
      if (min > 1) return spanish ? 'Elige $min o más' : 'Choose $min or more';
      return spanish ? 'Requerido' : 'Required';
    }
    if (single) return spanish ? 'Elige una' : 'Choose one';
    if (max != null) return spanish ? 'Hasta $max' : 'Up to $max';
    return spanish ? 'Opcional' : 'Optional';
  }

  /// One option group rendered per its menu rules (audit F1): a single-choice
  /// group (`maxSelections == 1`) is single-select chips; a multi-choice group
  /// caps at `maxSelections`; a required group shows a clear, coloured hint.
  Widget _buildOptionGroup(Map<String, Object?> group) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final name = group['name'] as String? ?? '';
    final required = group['required'] == true;
    final min = (group['minSelections'] as num?)?.toInt() ?? 0;
    final max = (group['maxSelections'] as num?)?.toInt();
    final single = max == 1;
    final modifiers = _groupModifiers(group);
    final ids = modifiers.map((m) => m['id']! as String).toList();
    final selectedCount = ids.where(selectedModifiers.containsKey).length;
    final unmet = selectedCount < _requiredCount(group);
    final hint = _groupHint(
      spanish,
      required: required,
      min: min,
      max: max,
      single: single,
    );

    return Padding(
      padding: const EdgeInsets.only(bottom: UmiSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Flexible(
                child: Text(
                  name,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              if (hint != null) ...[
                const SizedBox(width: UmiSpacing.sm),
                Text(
                  hint,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: unmet
                        ? Theme.of(context).colorScheme.error
                        : Theme.of(context).colorScheme.outline,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: UmiSpacing.sm),
          Wrap(
            spacing: UmiSpacing.sm,
            runSpacing: UmiSpacing.sm,
            children: modifiers.map((modifier) {
              final id = modifier['id']! as String;
              final selected = selectedModifiers.containsKey(id);
              if (single) {
                return _OptionCard(
                  label: modifier['name']! as String,
                  priceLabel: _priceLabel(modifier),
                  selected: selected,
                  onTap: () => setState(() {
                    // One choice per group: clear the others first. A required
                    // group cannot be emptied — a re-tap keeps the choice.
                    for (final other in ids) {
                      selectedModifiers.remove(other);
                    }
                    if (!selected || required) selectedModifiers[id] = 1;
                  }),
                );
              }
              final atCap = max != null && selectedCount >= max && !selected;
              return _OptionCard(
                label: modifier['name']! as String,
                priceLabel: _priceLabel(modifier),
                selected: selected,
                disabled: atCap,
                onTap: () => setState(() {
                  if (selected) {
                    selectedModifiers.remove(id);
                  } else {
                    selectedModifiers[id] = 1;
                  }
                }),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final detail = widget.detail;
    final money = CatalogMoney.fromJson(detail.price);
    final children = <Widget>[
      Text(detail.name, style: Theme.of(context).textTheme.headlineMedium),
      Text('${money.currency} ${(money.minorUnits / 100).toStringAsFixed(2)}'),
      if (detail.description != null) Text(detail.description!),
      if (detail.sku != null) Text('SKU: ${detail.sku}'),
      if (detail.barcode != null) Text('Barcode: ${detail.barcode}'),
      if (detail.taxRateBasisPoints > 0) Text(l.taxIncludedLabel),
      if (detail.variants.isNotEmpty) ...[
        const SizedBox(height: 16),
        Text(l.variantsLabel, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: UmiSpacing.sm),
        Wrap(
          spacing: UmiSpacing.sm,
          runSpacing: UmiSpacing.sm,
          children: detail.variants
              .map(
                (item) => _OptionCard(
                  label: item['name']! as String,
                  selected: variantId == item['id'],
                  onTap: () =>
                      setState(() => variantId = item['id']! as String),
                ),
              )
              .toList(),
        ),
      ],
      if (detail.optionGroups.isNotEmpty) ...[
        const SizedBox(height: UmiSpacing.xl),
        Text(l.modifiersLabel, style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: UmiSpacing.md),
        ...detail.optionGroups.map(_buildOptionGroup),
      ],
      const SizedBox(height: UmiSpacing.md),
      TextField(
        controller: note,
        maxLength: 500,
        decoration: InputDecoration(labelText: l.cartNoteLabel),
      ),
      Row(
        children: [
          IconButton(
            tooltip: l.decreaseQuantity,
            onPressed: quantity > 1 ? () => setState(() => quantity--) : null,
            icon: const Icon(Icons.remove),
          ),
          Text('$quantity'),
          IconButton(
            tooltip: l.increaseQuantity,
            onPressed: quantity < 999 ? () => setState(() => quantity++) : null,
            icon: const Icon(Icons.add),
          ),
        ],
      ),
      const SizedBox(height: 24),
      FilledButton(
        onPressed:
            !widget.canWrite ||
                (detail.variants.isNotEmpty && variantId == null) ||
                !_requiredOptionsSatisfied()
            ? null
            : () async {
                final modifiers = selectedModifiers.entries
                    .map((e) => {'modifierId': e.key, 'quantity': e.value})
                    .toList();
                if (widget.item == null) {
                  await widget.cart.add(
                    productId: detail.id,
                    variantId: variantId,
                    modifiers: modifiers,
                    quantity: quantity,
                    note: note.text,
                  );
                  widget.onRecord?.call();
                } else {
                  await widget.cart.edit(
                    item: widget.item!,
                    variantId: variantId,
                    modifiers: modifiers,
                    quantity: quantity,
                    note: note.text,
                  );
                }
                if (widget.onClose != null) {
                  widget.onClose!();
                } else if (context.mounted) {
                  Navigator.pop(context);
                }
              },
        child: Text(
          widget.item == null ? l.addToCartAction : l.saveCartLineAction,
        ),
      ),
      const SizedBox(height: UmiSpacing.md),
    ];
    if (widget.onClose != null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.arrow_back),
                tooltip: l.closeAction,
                onPressed: widget.onClose,
              ),
              Expanded(
                child: Text(
                  detail.name,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ],
          ),
          const Divider(height: 1),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(UmiSpacing.lg),
              children: children,
            ),
          ),
        ],
      );
    }
    return SafeArea(
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: .82,
        minChildSize: .45,
        maxChildSize: .95,
        builder: (_, controller) => Scrollbar(
          controller: controller,
          thumbVisibility: true,
          child: ListView(
            controller: controller,
            padding: const EdgeInsets.all(UmiSpacing.xl),
            children: children,
          ),
        ),
      ),
    );
  }
}

/// A modifier / variant option rendered as a PoloTab-style card: a fixed-width
/// tile that fills and borders in the brand blue with a check when chosen, and
/// dims when it is over the group's cap.
final class _OptionCard extends StatelessWidget {
  const _OptionCard({
    required this.label,
    required this.selected,
    required this.onTap,
    this.priceLabel,
    this.disabled = false,
  });
  final String label;
  final String? priceLabel;
  final bool selected;
  final bool disabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    const accent = Color(0xFF2E7DFF);
    return Opacity(
      opacity: disabled ? .45 : 1,
      child: SizedBox(
        width: 176,
        child: Material(
          color: selected
              ? accent.withValues(alpha: .16)
              : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: disabled ? null : onTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: UmiSpacing.md,
                vertical: UmiSpacing.sm,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: selected ? accent : scheme.outlineVariant,
                  width: selected ? 2 : 1,
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    selected
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    size: 18,
                    color: selected ? accent : scheme.outlineVariant,
                  ),
                  const SizedBox(width: UmiSpacing.sm),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                fontWeight: selected
                                    ? FontWeight.w600
                                    : FontWeight.w400,
                              ),
                        ),
                        if (priceLabel != null)
                          Text(
                            priceLabel!,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: scheme.onSurfaceVariant),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

final class _Skeleton extends StatelessWidget {
  const _Skeleton({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: label,
    child: GridView.builder(
      itemCount: 12,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisSpacing: 16,
        crossAxisSpacing: 16,
        childAspectRatio: .75,
      ),
      itemBuilder: (_, _) =>
          const Card(child: Center(child: CircularProgressIndicator())),
    ),
  );
}

final class _Message extends StatelessWidget {
  const _Message(this.message, this.icon, this.retry);
  final String message;
  final IconData icon;
  final VoidCallback? retry;
  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      liveRegion: true,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 52),
          const SizedBox(height: 16),
          Text(message, textAlign: TextAlign.center),
          if (retry != null) ...[
            const SizedBox(height: 16),
            FilledButton(
              onPressed: retry,
              child: Text(AppLocalizations.of(context).retryAction),
            ),
          ],
        ],
      ),
    ),
  );
}

final class _CartPanel extends StatelessWidget {
  const _CartPanel({
    required this.controller,
    required this.checkout,
    required this.cash,
    required this.entry,
    required this.permissions,
    required this.sales,
    required this.customerValue,
    required this.onEdit,
    this.orderType,
  });
  final CartController controller;
  final CheckoutController checkout;
  final CashController cash;
  final EntryController entry;
  final OperatorPermissions permissions;
  final SaleLifecycleController sales;
  final CustomerValueController? customerValue;
  final ValueChanged<CartItem> onEdit;
  final String? orderType;

  String _money(Map<String, Object?> value) {
    final currency = value['currency'] as String? ?? '';
    final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
    return '$currency ${(minor / 100).toStringAsFixed(2)}';
  }

  Widget _customerButton(BuildContext context, AppLocalizations l) {
    final theme = Theme.of(context);
    final customer = sales.state.sale?.customer;
    final hasCustomer = customer != null;
    final label = hasCustomer
        ? SaleCustomerSummary.fromJson(customer).displayName
        : l.attachCustomerAction;
    return OutlinedButton.icon(
      onPressed: () => showCustomerPicker(context, sales),
      style: OutlinedButton.styleFrom(
        alignment: Alignment.centerLeft,
        minimumSize: const Size(0, UmiTouchTarget.minimum),
        padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.md),
      ),
      icon: Icon(
        hasCustomer ? Icons.person_outline : Icons.person_add_alt_1_outlined,
      ),
      label: Row(
        children: [
          Expanded(child: Text(label, overflow: TextOverflow.ellipsis)),
          Icon(
            Icons.chevron_right,
            size: 18,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final cart = controller.state.cart;
    if (cart == null) {
      return Card(
        child: Center(
          child: controller.state.phase == CartPhase.failure
              ? Text(l.cartUnavailable)
              : const CircularProgressIndicator(),
        ),
      );
    }
    final items = cart.items.map(CartItem.fromJson).toList(growable: false);
    final totals = TotalsPreview.fromJson(cart.totals);
    final discounts = DiscountPreview.fromJson(totals.discounts);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l.cartTitle,
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                if (orderType != null)
                  Builder(
                    builder: (context) {
                      final es =
                          Localizations.localeOf(context).languageCode == 'es';
                      final takeout = orderType == 'takeout';
                      return Chip(
                        visualDensity: VisualDensity.compact,
                        avatar: Icon(
                          takeout
                              ? Icons.takeout_dining_outlined
                              : Icons.restaurant_outlined,
                          size: 16,
                        ),
                        label: Text(
                          takeout
                              ? (es ? 'Para llevar' : 'Takeout')
                              : (es ? 'Comer aquí' : 'Dine in'),
                        ),
                      );
                    },
                  ),
              ],
            ),
            const SizedBox(height: UmiSpacing.sm),
            // Customer selector — moved from the top bar to the head of the
            // cart so the operator assigns the buyer where the sale lives.
            if (permissions.allows('sale.lifecycle')) ...[
              _customerButton(context, l),
              const SizedBox(height: UmiSpacing.sm),
            ],
            Expanded(
              child: items.isEmpty
                  ? Center(child: Text(l.cartEmpty))
                  : ListView.builder(
                      itemCount: items.length,
                      itemBuilder: (context, index) {
                        final item = items[index];
                        final price = PriceSnapshot.fromJson(item.price);
                        return Semantics(
                          label: '${item.productName}, ${item.quantity}',
                          child: Column(
                            children: [
                              ListTile(
                                contentPadding: EdgeInsets.zero,
                                title: Text(item.productName),
                                subtitle: Text(
                                  [
                                    if (item.variant != null)
                                      item.variant!['name'] as String,
                                    ...item.modifiers.map(
                                      (m) => m['name'] as String,
                                    ),
                                    if (item.note != null) item.note!,
                                  ].join(' · '),
                                ),
                                trailing: Text(_money(price.lineTotal)),
                              ),
                              Row(
                                children: [
                                  IconButton(
                                    tooltip: l.decreaseQuantity,
                                    onPressed: permissions.allows('cart.write')
                                        ? () => controller.quantity(
                                            item,
                                            item.quantity - 1,
                                          )
                                        : null,
                                    icon: const Icon(Icons.remove),
                                  ),
                                  Text('${item.quantity}'),
                                  IconButton(
                                    tooltip: l.increaseQuantity,
                                    onPressed:
                                        permissions.allows('cart.write') &&
                                            item.quantity < 999
                                        ? () => controller.quantity(
                                            item,
                                            item.quantity + 1,
                                          )
                                        : null,
                                    icon: const Icon(Icons.add),
                                  ),
                                  const Spacer(),
                                  IconButton(
                                    tooltip: l.editCartLineAction,
                                    onPressed: permissions.allows('cart.write')
                                        ? () => onEdit(item)
                                        : null,
                                    icon: const Icon(Icons.edit_outlined),
                                  ),
                                  IconButton(
                                    tooltip: l.removeFromCartAction,
                                    onPressed: permissions.allows('cart.write')
                                        ? () => controller.remove(item)
                                        : null,
                                    icon: const Icon(Icons.delete_outline),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
            const Divider(),
            _Total(label: l.subtotalLabel, value: _money(totals.subtotal)),
            _Total(label: l.taxLabel, value: _money(totals.tax)),
            _Total(label: l.discountLabel, value: _money(discounts.total)),
            _Total(
              label: l.totalLabel,
              value: _money(totals.grandTotal),
              emphasized: true,
            ),
            Text('${l.businessDateLabel}: ${totals.businessDate}'),
            const SizedBox(height: UmiSpacing.md),
            OutlinedButton.icon(
              onPressed: items.isEmpty || !permissions.allows('cart.write')
                  ? null
                  : () async {
                      final confirmed = await showDialog<bool>(
                        context: context,
                        builder: (dialogContext) => AlertDialog(
                          title: Text(l.confirmClearCartTitle),
                          content: Text(l.confirmClearCartBody),
                          actions: [
                            TextButton(
                              onPressed: () =>
                                  Navigator.pop(dialogContext, false),
                              child: Text(l.closeAction),
                            ),
                            FilledButton.tonal(
                              onPressed: () =>
                                  Navigator.pop(dialogContext, true),
                              child: Text(l.clearCartAction),
                            ),
                          ],
                        ),
                      );
                      if (confirmed ?? false) await controller.clear();
                    },
              icon: const Icon(Icons.remove_shopping_cart_outlined),
              label: Text(l.clearCartAction),
            ),
            const SizedBox(height: UmiSpacing.sm),
            FilledButton(
              onPressed: items.isEmpty || !permissions.allows('checkout.commit')
                  ? null
                  : () => showCheckoutSheet(
                      context,
                      checkout: checkout,
                      cashShiftId: cash.activeShiftId,
                      cart: controller,
                      entry: entry,
                      sales: sales,
                      customerValue: customerValue,
                    ),
              child: Text(l.checkoutAction),
            ),
          ],
        ),
      ),
    );
  }
}

final class _Total extends StatelessWidget {
  const _Total({
    required this.label,
    required this.value,
    this.emphasized = false,
  });
  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label),
        Text(
          value,
          style: emphasized ? Theme.of(context).textTheme.titleLarge : null,
        ),
      ],
    ),
  );
}
