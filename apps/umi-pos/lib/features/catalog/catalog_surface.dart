import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

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
import '../kitchen/kitchen_status_repository.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_journal.dart';
import '../offline/recovery_center.dart';
import '../offline/replay_engine.dart';
import '../sale/sale_lifecycle_controller.dart';
import '../sale/sale_surface.dart';
import 'catalog_controller.dart';
import 'catalog_repository.dart';

final class CatalogSurface extends StatefulWidget {
  const CatalogSurface({
    required this.entry,
    required this.catalog,
    required this.cart,
    required this.cash,
    required this.checkout,
    required this.sales,
    this.kitchenStatus,
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
  bool _cashPromptShown = false;
  String? _lastSaleErrorCode;
  StreamSubscription<CanonicalScanEvent>? _scanSubscription;
  Future<void> _scanQueue = Future<void>.value();

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
        await widget.cash.load();
        if (widget.cash.activeShiftId == null && !_cashPromptShown && mounted) {
          _cashPromptShown = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              showCashCenter(
                context,
                controller: widget.cash,
                permissions: OperatorPermissions(
                  entry.operator?.permissions ?? const [],
                ),
                onHandoffCompleted: widget.entry.lock,
              );
            }
          });
        }
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
    if (mounted) setState(() {});
  }

  void _saleChanged() {
    if (!mounted) return;
    setState(() {});
    final errorCode = widget.sales.state.errorCode;
    if (errorCode != null && errorCode != _lastSaleErrorCode) {
      _lastSaleErrorCode = errorCode;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(AppLocalizations.of(context).saleLifecycleError),
            ),
          );
        }
      });
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
        title: Text(l.catalogTitle),
        actions: [
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
          if (access.showCashCenter)
            IconButton(
              tooltip: l.cashCenterAction,
              onPressed: () => showCashCenter(
                context,
                controller: widget.cash,
                permissions: permissions,
                onHandoffCompleted: widget.entry.lock,
              ),
              icon: Badge(
                isLabelVisible: widget.cash.activeShiftId == null,
                child: const Icon(Icons.point_of_sale_outlined),
              ),
            ),
          if (access.showInventory && widget.inventory != null)
            IconButton(
              tooltip: Localizations.localeOf(context).languageCode == 'es'
                  ? 'Operaciones de inventario'
                  : 'Inventory operations',
              onPressed: () => showInventoryCenter(
                context,
                entry: widget.entry,
                controller: widget.inventory!,
              ),
              icon: const Icon(Icons.inventory_2_outlined),
            ),
          if (permissions.allows('hardware.read') && widget.hardware != null)
            IconButton(
              tooltip: Localizations.localeOf(context).languageCode == 'es'
                  ? 'Centro de hardware'
                  : 'Hardware center',
              onPressed: () => showHardwareCenter(
                context,
                entry: widget.entry,
                service: widget.hardware!,
                permissions: permissions,
                registerId: widget.cash.activeRegisterId,
              ),
              icon: const Icon(Icons.devices_other_outlined),
            ),
          if (access.showSaleHistory)
            IconButton(
              tooltip: l.saleHistoryTitle,
              onPressed: () => showSaleCenter(
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
              ),
              icon: const Icon(Icons.receipt_long_outlined),
            ),
          if (access.showSaleActions)
            if (permissions.allows('customer.search') &&
                widget.customerValue != null)
              IconButton(
                tooltip: Localizations.localeOf(context).languageCode == 'es'
                    ? 'Centro de clientes'
                    : 'Customer center',
                onPressed: () => showCustomerCenter(
                  context,
                  entry: widget.entry,
                  controller: widget.customerValue!,
                  sales: widget.sales,
                ),
                icon: const Icon(Icons.people_alt_outlined),
              ),
          if (access.showSaleActions)
            IconButton(
              tooltip: l.currentCustomerLabel,
              onPressed: () => showCustomerPicker(context, widget.sales),
              icon: Badge(
                isLabelVisible: widget.sales.state.sale?.customer != null,
                child: const Icon(Icons.person_outline),
              ),
            ),
          if (access.showSaleActions)
            PopupMenuButton<String>(
              tooltip: l.saleActionsTitle,
              icon: const Icon(Icons.more_vert),
              onSelected: (action) async {
                switch (action) {
                  case 'new':
                    await widget.sales.newSale();
                  case 'suspend':
                    if (context.mounted) {
                      await showSuspendSaleDialog(context, widget.sales);
                    }
                  case 'cancel':
                    if (context.mounted) {
                      await showCancelSaleDialog(context, widget.sales);
                    }
                }
              },
              itemBuilder: (_) => [
                PopupMenuItem(value: 'new', child: Text(l.newSaleAction)),
                PopupMenuItem(
                  value: 'suspend',
                  child: Text(l.suspendSaleAction),
                ),
                PopupMenuItem(value: 'cancel', child: Text(l.cancelSaleAction)),
              ],
            ),
          if (access.showRecovery)
            IconButton(
              tooltip: AppLocalizations.of(context).recoveryCenterTitle,
              onPressed: () {
                final scope = _scope();
                if (scope != null &&
                    widget.offlineJournal != null &&
                    widget.offlineRecovery != null) {
                  showRecoveryCenter(
                    context,
                    journal: widget.offlineJournal!,
                    recovery: widget.offlineRecovery!,
                    scope: scope,
                    entry: widget.entry,
                    telemetry: widget.telemetry,
                    refreshSnapshots: () => _loadInitial(
                      Localizations.localeOf(context).languageCode,
                    ),
                    queryAmbiguousPayment: widget.checkout.queryUnknownPayment,
                    beforeContextExit: widget.sales.prepareForOperatorExit,
                    retryOfflineHardware:
                        widget.hardware == null ||
                            (!permissions.allows('hardware.printer.print') &&
                                !permissions.allows('hardware.drawer.open'))
                        ? null
                        : _retryOfflineHardware,
                  );
                }
              },
              icon: const Icon(Icons.sync_problem_outlined),
            ),
          if (kDebugMode)
            IconButton(
              tooltip: Localizations.localeOf(context).languageCode == 'es'
                  ? 'Diagnóstico de autorización'
                  : 'Authorization diagnostics',
              onPressed: () => _showAuthorizationDiagnostics(permissions),
              icon: const Icon(Icons.policy_outlined),
            ),
          Center(child: Text(widget.entry.state.selectedBranch?.name ?? '—')),
          IconButton(
            tooltip: l.lockAction,
            onPressed: () => _leaveOperator(lock: true),
            icon: const Icon(Icons.lock_outline),
          ),
          IconButton(
            tooltip: l.logoutAction,
            onPressed: () => _leaveOperator(lock: false),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  children: [
                    TextField(
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
                    ),
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
                              onTap: category.enabled
                                  ? () => widget.catalog.selectCategory(
                                      category.id,
                                    )
                                  : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: UmiSpacing.md),
                    Expanded(child: _content(context, state)),
                  ],
                ),
              ),
              if (MediaQuery.sizeOf(context).width >= 900) ...[
                const SizedBox(width: UmiSpacing.lg),
                SizedBox(
                  width: 380,
                  child: _CartPanel(
                    controller: widget.cart,
                    checkout: widget.checkout,
                    cash: widget.cash,
                    entry: widget.entry,
                    permissions: permissions,
                    sales: widget.sales,
                    customerValue: widget.customerValue,
                    onEdit: (item) => _showDetail(
                      item.productId,
                      item: item,
                      canWrite: canWriteCart,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

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
    final safe = await widget.sales.prepareForOperatorExit();
    if (!safe || !mounted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppLocalizations.of(context).saleLifecycleError),
          ),
        );
      }
      return;
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
          return GridView.builder(
            key: const PageStorageKey('catalog-grid'),
            controller: _scroll,
            itemCount: state.products.length + (state.loadingMore ? 1 : 0),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              mainAxisSpacing: 16,
              crossAxisSpacing: 16,
              childAspectRatio: .72,
            ),
            itemBuilder: (context, index) => index == state.products.length
                ? const Center(child: CircularProgressIndicator())
                : _ProductCard(
                    product: state.products[index],
                    onTap: () => _showDetail(
                      state.products[index].id,
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
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        constraints: const BoxConstraints(maxWidth: 760),
        builder: (_) => _Detail(
          detail,
          cart: widget.cart,
          item: item,
          canWrite:
              canWrite ??
              OperatorPermissions(
                widget.entry.state.operator?.permissions ?? const [],
              ).allows('cart.write'),
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

final class _Category extends StatelessWidget {
  const _Category({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(right: 8),
    child: ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: onTap == null ? null : (_) => onTap!(),
    ),
  );
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
                    ? const ColoredBox(
                        color: Color(0x221D9BF0),
                        child: Center(
                          child: Icon(Icons.local_cafe_outlined, size: 44),
                        ),
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

final class _Detail extends StatefulWidget {
  const _Detail(
    this.detail, {
    required this.cart,
    required this.canWrite,
    this.item,
  });
  final CatalogProductDetail detail;
  final CartController cart;
  final bool canWrite;
  final CartItem? item;
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

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final detail = widget.detail;
    final money = CatalogMoney.fromJson(detail.price);
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
            children: [
              Text(
                detail.name,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              Text(
                '${money.currency} ${(money.minorUnits / 100).toStringAsFixed(2)}',
              ),
              if (detail.description != null) Text(detail.description!),
              if (detail.sku != null) Text('SKU: ${detail.sku}'),
              if (detail.barcode != null) Text('Barcode: ${detail.barcode}'),
              if (detail.taxRateBasisPoints > 0) Text(l.taxIncludedLabel),
              if (detail.variants.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(
                  l.variantsLabel,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: UmiSpacing.sm),
                Wrap(
                  spacing: UmiSpacing.sm,
                  runSpacing: UmiSpacing.sm,
                  children: detail.variants
                      .map(
                        (item) => ChoiceChip(
                          label: Text(item['name']! as String),
                          selected: variantId == item['id'],
                          onSelected: (_) =>
                              setState(() => variantId = item['id']! as String),
                        ),
                      )
                      .toList(),
                ),
              ],
              if (detail.optionGroups.isNotEmpty) ...[
                const SizedBox(height: UmiSpacing.xl),
                Text(
                  l.modifiersLabel,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: UmiSpacing.md),
                ...detail.optionGroups.map((group) {
                  final modifiers = group['modifiers']! as List<Object?>;
                  return Padding(
                    padding: const EdgeInsets.only(bottom: UmiSpacing.lg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          group['name']! as String,
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: UmiSpacing.sm),
                        Wrap(
                          spacing: UmiSpacing.sm,
                          runSpacing: UmiSpacing.sm,
                          children: modifiers.map((raw) {
                            final modifier = raw! as Map<String, Object?>;
                            final id = modifier['id']! as String;
                            return FilterChip(
                              label: Text(modifier['name']! as String),
                              selected: selectedModifiers.containsKey(id),
                              onSelected: (selected) => setState(() {
                                if (selected) {
                                  selectedModifiers[id] = 1;
                                } else {
                                  selectedModifiers.remove(id);
                                }
                              }),
                            );
                          }).toList(),
                        ),
                      ],
                    ),
                  );
                }),
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
                    onPressed: quantity > 1
                        ? () => setState(() => quantity--)
                        : null,
                    icon: const Icon(Icons.remove),
                  ),
                  Text('$quantity'),
                  IconButton(
                    tooltip: l.increaseQuantity,
                    onPressed: quantity < 999
                        ? () => setState(() => quantity++)
                        : null,
                    icon: const Icon(Icons.add),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed:
                    !widget.canWrite ||
                        (detail.variants.isNotEmpty && variantId == null)
                    ? null
                    : () async {
                        final modifiers = selectedModifiers.entries
                            .map(
                              (e) => {'modifierId': e.key, 'quantity': e.value},
                            )
                            .toList();
                        if (widget.item == null) {
                          await widget.cart.add(
                            productId: detail.id,
                            variantId: variantId,
                            modifiers: modifiers,
                            quantity: quantity,
                            note: note.text,
                          );
                        } else {
                          await widget.cart.edit(
                            item: widget.item!,
                            variantId: variantId,
                            modifiers: modifiers,
                            quantity: quantity,
                            note: note.text,
                          );
                        }
                        if (context.mounted) Navigator.pop(context);
                      },
                child: Text(
                  widget.item == null
                      ? l.addToCartAction
                      : l.saveCartLineAction,
                ),
              ),
              const SizedBox(height: UmiSpacing.md),
            ],
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
  });
  final CartController controller;
  final CheckoutController checkout;
  final CashController cash;
  final EntryController entry;
  final OperatorPermissions permissions;
  final SaleLifecycleController sales;
  final CustomerValueController? customerValue;
  final ValueChanged<CartItem> onEdit;

  String _money(Map<String, Object?> value) {
    final currency = value['currency'] as String? ?? '';
    final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
    return '$currency ${(minor / 100).toStringAsFixed(2)}';
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
            Text(l.cartTitle, style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: UmiSpacing.sm),
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
