import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show SystemChannels;
import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/errors/app_error.dart';
import '../../core/errors/operator_error_message.dart';
import '../../core/localization/app_localizations.dart';
import '../../core/observability/telemetry.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/display_preferences.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/money.dart';
import '../../shared/widgets/connectivity_label.dart';
import '../../shared/widgets/inline_notice.dart';
import '../../shared/widgets/manager_approval.dart';
import '../../shared/widgets/receipt_print_action.dart';
import '../../shared/widgets/station_document.dart';
import '../cart/account_details_surface.dart';
import '../cart/accounts_workspace.dart';
import '../cart/cart_controller.dart';
import '../cart/cart_optimism.dart';
import '../cart/course_control.dart';
import '../cart/incoming_orders_controller.dart';
import '../cart/incoming_orders_surface.dart';
import '../cart/order_type_picker.dart';
import '../cash/cash_controller.dart';
import '../cash/cash_surface.dart';
import '../checkout/checkout_controller.dart';
import '../checkout/checkout_surface.dart';
import '../customer_value/customer_value_controller.dart';
import '../customer_value/customer_value_surface.dart';
import '../entry/device_channel_socket_client.dart';
import '../entry/entry_controller.dart';
import '../exception/exception_controller.dart';
import '../hardware/hardware_runtime.dart';
import '../hardware/hardware_service.dart';
import '../hardware/hardware_surface.dart';
import '../inventory/inventory_controller.dart';
import '../inventory/inventory_surface.dart';
import '../kitchen/kitchen_alerts.dart';
import '../kitchen/kitchen_audio.dart';
import '../kitchen/kitchen_board_controller.dart';
import '../kitchen/kitchen_board_surface.dart';
import '../kitchen/kitchen_push_notifications.dart';
import '../kitchen/kitchen_status_repository.dart';
import '../offline/connectivity_controller.dart';
import '../offline/offline_journal.dart';
import '../offline/recovery_center.dart';
import '../offline/replay_engine.dart';
import '../sale/sale_lifecycle_controller.dart';
import '../sale/sale_surface.dart';
import '../settings/display_settings_surface.dart';
import '../tables/floor_plan_controller.dart';
import '../tables/floor_plan_surface.dart';
import '../tables/order_table_picker.dart';
import '../tables/table_state_controller.dart';
import 'catalog_controller.dart';
import 'catalog_repository.dart';
import 'frequent_products.dart';

final class CatalogSurface extends StatefulWidget {
  const CatalogSurface({
    required this.entry,
    required this.catalog,
    required this.cart,
    this.incomingOrders,
    required this.cash,
    required this.checkout,
    required this.sales,
    this.kitchenStatus,
    this.notificationOpen,
    this.kitchenBoard,
    this.floorPlan,
    this.tableState,
    this.customerValue,
    this.deviceChannel,
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
  final IncomingOrdersController? incomingOrders;
  final CashController cash;
  final CheckoutController checkout;
  final SaleLifecycleController sales;
  final KitchenStatusRepository? kitchenStatus;
  final ValueListenable<KitchenPushNotice?>? notificationOpen;
  final KitchenBoardController? kitchenBoard;
  final FloorPlanController? floorPlan;
  final TableStateController? tableState;
  final CustomerValueController? customerValue;

  /// The till's realtime wake-up for a card terminal's answer. Null on a build
  /// with no socket path wired; the poll carries the sale either way.
  final DeviceChannelSocketClient? deviceChannel;
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
  final _searchAnchor = GlobalKey();
  Size? _lastOrderSize;
  final _newSaleFocus = FocusNode();
  final _overflowFocus = FocusNode();
  final _accountFocus = FocusNode();
  (Size, bool, bool, bool, Locale)? _lastHeaderLayout;
  bool _initialLoadStarted = false;
  bool _initialAccountPolicyApplied = false;
  bool _restoringAccount = false;
  int _openAccountCount = 0;
  bool _leaving = false;
  String? _lastSaleErrorCode;

  /// The last thing that went wrong, shown inline above the grid instead of in
  /// a bar that slid up from the bottom of the screen. See `InlineNotice`.
  String? _notice;
  StreamSubscription<CanonicalScanEvent>? _scanSubscription;
  Future<void> _scanQueue = Future<void>.value();
  FrequentProductsStore? _frequent;
  List<FrequentProduct> _frequentTop = const [];
  // One detail owner remains mounted when the catalog changes its layout.
  CatalogProductDetail? _inlineDetail;
  GlobalKey<_DetailState>? _detailKey;
  CartItem? _inlineDetailItem;
  // The order context the barista sets in the top bar (PoloTab's "Para llevar"):
  // dine-in vs takeout. Shown on the comanda; carried onto the sale note.
  String _orderType = 'dine_in';
  TillSurface? _section;
  int _scanGeneration = 0;
  bool _cashVisited = false;
  bool _salesVisited = false;
  bool _accountTransition = false;
  bool _accountsWithoutTable = false;
  Cart? _blockedAccount;
  String? _preparedMobileCartId;
  String? _promptedMobileCartId;
  Future<bool>? _orderStart;
  String? _pendingOrderType;
  DateTime _suppressMenuTapUntil = DateTime.fromMillisecondsSinceEpoch(0);

  bool get _mobileDevice => widget.entry.state.device?.mobility == 'mobile';
  bool get _menuTapSuppressed => DateTime.now().isBefore(_suppressMenuTapUntil);

  void _consumeModalPointer() {
    // A fast tap can finish closing an account-type sheet on the same pointer-up
    // that lands over a menu card. Suppress the menu for one gesture window so a
    // choice such as Takeaway can never also open the product beneath it.
    _suppressMenuTapUntil = DateTime.now().add(
      const Duration(milliseconds: 250),
    );
  }

  void _requestMobileOrderStart() {
    final cart = widget.cart.state.cart;
    if (!(ModalRoute.of(context)?.isCurrent ?? true)) return;
    if (!_mobileDevice ||
        _accountTransition ||
        !OperatorPermissions(
          widget.entry.state.operator?.permissions ?? const [],
        ).allows('cart.write')) {
      return;
    }
    if (cart == null) return;
    if (cart.items.isNotEmpty ||
        cart.tableId != null ||
        _promptedMobileCartId == cart.id) {
      return;
    }
    _promptedMobileCartId = cart.id;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && widget.cart.state.cart?.id == cart.id) {
        unawaited(_prepareMobileOrder());
      }
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  Future<FloorPlanElement?> _chooseOrderTable({
    String? assigningAccountId,
  }) async {
    final plan = widget.floorPlan;
    final entry = widget.entry.state;
    if (plan == null || entry.operator == null) return null;
    final merchant = entry.selectedTenant!.id;
    final query = PosFloorPlanQuery(
      locationId: entry.selectedBranch!.id,
      operatorSessionId: entry.operator!.id,
    );
    final room = widget.tableState;
    Future<void> refreshRoom() async =>
        room?.load(merchant, query.locationId, query.operatorSessionId);
    final planFresh =
        plan.plan != null &&
        plan.refreshedAt != null &&
        DateTime.now().difference(plan.refreshedAt!) <
            const Duration(seconds: 5);
    final roomFresh =
        room == null ||
        (room.map != null && !room.stale && room.loading == false);
    await Future.wait([
      if (!planFresh) plan.load(merchant, query),
      if (!roomFresh) refreshRoom(),
    ]);
    if (!mounted) return null;
    if (plan.failed) {
      showPosFeedback(
        context,
        Localizations.localeOf(context).languageCode == 'es'
            ? 'No se pudieron cargar las mesas. Intenta de nuevo.'
            : 'The tables could not load. Try again.',
      );
      return null;
    }
    final document = plan.plan?.published;
    final areas = document == null
        ? <FloorPlanArea>[]
        : FloorPlanDocument.fromJson(
            document,
          ).areas.map(FloorPlanArea.fromJson).toList();
    if (!mounted) return null;
    final permissions = OperatorPermissions(entry.operator!.permissions);
    return showOrderTablePicker(
      context,
      areas: areas,
      room: room,
      refreshRoom: room == null ? null : refreshRoom,
      canManage: permissions.allows('sale.lifecycle'),
      assigningAccountId: assigningAccountId,
      addTable:
          plan.supportsAdditionalTables && permissions.allows('cart.write')
          ? (areaId, label, capacity) async {
              final updated = await plan.addTable(
                merchant,
                query,
                areaId: areaId,
                label: label,
                capacity: capacity,
              );
              if (updated == null) return null;
              return FloorPlanDocument.fromJson(
                updated.published!,
              ).areas.map(FloorPlanArea.fromJson).toList();
            }
          : null,
      createTables: plan.supportsBootstrap
          ? (slots) async {
              final initialized = await plan.bootstrapTables(
                merchant,
                query,
                slots,
              );
              if (initialized == null) return null;
              return FloorPlanDocument.fromJson(
                initialized.published!,
              ).areas.map(FloorPlanArea.fromJson).toList();
            }
          : null,
    );
  }

  /// Fetch the room while the operator is still choosing Dine in or Takeaway.
  ///
  /// The two reads are independent and small, but doing them only after the
  /// service choice made Dine in feel delayed by a second modal transition. The
  /// result is ignored on failure; the picker's own load path owns recovery.
  Future<void> _warmOrderTableData() async {
    final plan = widget.floorPlan;
    final entry = widget.entry.state;
    final operator = entry.operator;
    final location = entry.selectedBranch;
    final merchant = entry.selectedTenant;
    if (plan == null ||
        operator == null ||
        location == null ||
        merchant == null) {
      return;
    }
    try {
      await Future.wait([
        plan.load(
          merchant.id,
          PosFloorPlanQuery(
            locationId: location.id,
            operatorSessionId: operator.id,
          ),
        ),
        if (widget.tableState case final room?)
          room.load(merchant.id, location.id, operator.id),
      ]);
    } catch (_) {
      // The normal picker load reports actionable failures.
    }
  }

  Future<bool> _prepareMobileOrder() {
    if (!_mobileDevice) return Future.value(true);
    return _orderStart ??= _prepareMobileOrderOnce().whenComplete(
      () => _orderStart = null,
    );
  }

  Future<bool> _prepareMobileOrderOnce() async {
    final cart = widget.cart.state.cart;
    if (cart == null) {
      unawaited(_warmOrderTableData());
      final type = await showOrderTypePicker(context);
      if (type == null || !mounted) return false;
      _consumeModalPointer();
      if (type == 'dine_in') {
        final table = await _chooseOrderTable();
        if (table == null || !mounted) return false;
        await _openTableAccount(table);
        return widget.cart.state.cart?.tableId == table.id;
      }
      return _openTablelessAccount(type);
    }
    if (_preparedMobileCartId == cart.id ||
        cart.tableId != null ||
        cart.items.isNotEmpty ||
        cart.firedOrderId != null) {
      _preparedMobileCartId = cart.id;
      return true;
    }
    unawaited(_warmOrderTableData());
    final type = await showOrderTypePicker(context);
    if (type == null || !mounted) return false;
    _consumeModalPointer();
    if (type == 'dine_in') {
      final table = await _chooseOrderTable();
      if (table == null || !mounted) return false;
      await _openTableAccount(table);
      final selected = widget.cart.state.cart;
      if (selected?.tableId != table.id) return false;
      _preparedMobileCartId = selected!.id;
    } else {
      await widget.cart.setFulfillment(type);
      if (!mounted || widget.cart.state.cart?.fulfillmentType != type) {
        if (mounted) _refuseCartWrite();
        return false;
      }
      _preparedMobileCartId = widget.cart.state.cart!.id;
      setState(() {
        _orderTypeTouched = false;
        _orderType = type;
      });
    }
    return true;
  }

  Future<bool> _prepareCheckout() async {
    final cart = widget.cart.state.cart;
    if (cart == null) return false;
    // Existing payment attempts keep their recovery path.
    if (cart.lifecycleState == 'payment_pending' ||
        cart.lifecycleState == 'payment_unknown') {
      return true;
    }
    if (cart.fulfillmentType != 'dine_in' || cart.tableId != null) return true;
    final operator = widget.entry.state.operator;
    if (operator != null) {
      await widget.checkout.loadPolicy(
        merchantId: cart.merchantId,
        locationId: cart.locationId,
        operatorSessionId: operator.id,
        currency:
            TotalsPreview.fromJson(cart.totals).grandTotal['currency']!
                as String,
      );
      if (!mounted) return false;
      if (widget.checkout.policy?.allowDineInWithoutTable == true) return true;
    }
    return _assignAccountTable();
  }

  Future<void> _createFirstTableAccount() async {
    if (_accountRestoring) {
      _showAccountRestoreNotice();
      return;
    }
    if (_accountTransition) return;
    final table = await _chooseOrderTable();
    if (table != null && mounted) await _openTableAccount(table);
  }

  /// Ask before a takeout takes the table with it, and name the table.
  ///
  /// A takeout account has no table: the server clears it and hands the table back
  /// to the floor plan, empty. That is a fact about the room and not only about the
  /// cart, and the operator is the one person who can see whether the guests are
  /// still sitting there — so the question is asked first, and whatever the account
  /// carries (products, folio, customer) stays put either way.
  Future<bool> _confirmTableRelease(Cart cart) async {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final table = cart.tableName ?? (spanish ? 'La mesa' : 'The table');
    final answer = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(spanish ? 'Cambiar a para llevar' : 'Change to takeout'),
        content: Text(
          spanish
              ? 'Se quitará $table de esta cuenta y la mesa quedará vacía. '
                    'La cuenta conserva sus productos, su folio y su cliente.'
              : '$table will be removed from this account and left empty. '
                    'The account keeps its products, its reference and its customer.',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(spanish ? 'Cancelar' : 'Cancel'),
          ),
          PosButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(
              spanish ? 'Cambiar a para llevar' : 'Change to takeout',
            ),
          ),
        ],
      ),
    );
    return answer == true;
  }

  /// The buyer's control: the glyph beside the order type.
  ///
  /// It carries the name in its tooltip (and so in the semantics tree) rather than
  /// on its face, and it draws in the palette's primary blue at 20 logical pixels —
  /// the size and colour the segmented control's own icons use, so the row reads as
  /// one control group instead of two.
  Widget _customerAction(
    BuildContext context,
    AppLocalizations l, {
    required bool room,
  }) {
    final customer = widget.sales.state.sale?.customer;
    final hasCustomer = customer != null;
    final label = hasCustomer
        ? SaleCustomerSummary.fromJson(customer).displayName
        : l.attachCustomerAction;
    final palette = PosTheme.of(context).colorScheme;
    return PosIconButton(
      tooltip: label,
      onPressed: () => showCustomerPicker(context, widget.sales),
      iconSize: 20,
      color: palette.primary,
      // Eight, not twelve: the two marks are 48 wide between them, and the slot the
      // row hands this button on the counter till is 70. Twelve apiece would put its
      // own content two logical pixels past the edge it just lined up with.
      padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
      // A SQUARE THE SIZE OF THE ORDER TYPE'S OWN SEGMENTS, AND FILLED LIKE THEM.
      //
      // The owner asked for it as a square button beside "Comer aquí / Para
      // llevar", the same size, with the logo inside (2026-10-12). The segments
      // are 48 logical pixels tall on the paper of the panel with the palette's
      // outline; a bare icon button next to them read as a stray glyph, so this
      // one wears the same paper, edge and radius and measures 48 by 48.
      style: PosIconButton.styleFrom(
        backgroundColor: palette.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(PosGeometry.controlRadius),
          side: BorderSide(color: palette.outlineVariant),
        ),
      ),
      // TWO MARKS, WITH AIR BETWEEN THEM, WHEN THE BUTTON HAS ROOM FOR THEM.
      //
      // The set's `person_add_alt_1` tucks a six-pixel plus against the person's
      // shoulder, which is what it is for at 24 logical pixels in a list. Where the
      // button takes the row's leftover width — the counter till — the mark is the
      // whole face of it, so the person keeps the centre it has everywhere else and
      // the plus stands beside it on the same line: "attach a customer" reads as a
      // person and a plus, not as a person with something caught in its outline.
      // The compact app bar hands out no leftover width at all, so there the one
      // glyph keeps the control inside its 48-pixel square. Once a customer is
      // attached the plus has nothing left to say and the plain person stays.
      icon: hasCustomer
          ? const PosIcon(PosGlyphs.personOutline)
          : room
          ? const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PosIcon(PosGlyphs.personOutline),
                SizedBox(width: 10),
                PosIcon(PosGlyphs.add, size: 18),
              ],
            )
          : const PosIcon(PosGlyphs.personAddAlt1Outlined),
    );
  }

  Future<void> _resumeAccount(Cart selected) async {
    if (_accountRestoring) {
      _showAccountRestoreNotice();
      return;
    }
    if (_accountTransition) return;
    final entry = widget.entry.state;
    if (entry.operator == null) return;
    setState(() => _accountTransition = true);
    try {
      final opened = await widget.cart.resumeAccount(
        account: selected,
        operatorSessionId: entry.operator!.id,
      );
      if (!mounted) return;
      if (!opened) {
        _refuseCartWrite();
        setState(() {
          _blockedAccount = widget.cart.state.errorCode == 'CART_ACCOUNT_BUSY'
              ? selected
              : null;
        });
        return;
      }
      widget.checkout.reset();
      widget.sales.accountSaved();
      final refreshed = await widget.sales.refreshCurrent(
        expectedCartId: selected.id,
      );
      if (!mounted) return;
      // An account with a fired order has no live sale to read until the
      // operator starts checkout. The resume itself already succeeded, so a
      // missing sale is not a product refusal and must not put an error line
      // over an account the till has open.
      final cartReady =
          widget.cart.state.cart?.id == selected.id &&
          widget.cart.state.errorCode == null;
      setState(() {
        _blockedAccount = null;
        _editingAccountId = widget.cart.state.cart!.id;
        _section = TillSurface.order;
        _inlineDetail = null;
        _orderTypeTouched = false;
        _orderType = widget.cart.state.cart!.fulfillmentType;
        _noticeCode = null;
        _noticeDetails = null;
        _notice = refreshed || cartReady
            ? null
            : operatorErrorMessage(
                context,
                widget.sales.state.errorCode ?? 'CART_VALIDATION_FAILED',
              );
      });
    } finally {
      if (mounted) setState(() => _accountTransition = false);
    }
  }

  Future<bool> _openTableAccount(
    FloorPlanElement table, {
    int? partySize,
  }) async {
    if (_accountRestoring) {
      _showAccountRestoreNotice();
      return false;
    }
    if (_accountTransition) return false;
    final entry = widget.entry.state;
    if (entry.selectedTenant == null ||
        entry.selectedBranch == null ||
        entry.operator == null) {
      return false;
    }
    final occupiedAccountId = widget.tableState
        ?.stateOf(table.id)
        .openAccountId;
    if (occupiedAccountId != null) {
      // An occupied table is already an account identity. Asking the server to
      // open it through `cart/table` returned CART_ACTOR_BUSY while the exact
      // account the operator wanted was open behind that table. Resolve and
      // resume it instead of trying to create a second account.
      final accounts = await widget.cart.openAccounts(
        entry.selectedTenant!.id,
        entry.selectedBranch!.id,
        entry.operator!.id,
      );
      Cart? target;
      for (final account in accounts) {
        if (account.id == occupiedAccountId) {
          target = account;
          break;
        }
      }
      if (target != null) {
        await _resumeAccount(target);
        return widget.cart.state.cart?.id == target.id;
      }
    }
    setState(() => _accountTransition = true);
    try {
      final opened = await widget.cart.openTableAccount(
        merchantId: entry.selectedTenant!.id,
        locationId: entry.selectedBranch!.id,
        operatorSessionId: entry.operator!.id,
        tableId: table.id,
        tableName: table.label,
        partySize: partySize,
      );
      if (!mounted) return false;
      if (!opened) {
        showPosFeedback(
          context,
          operatorErrorMessage(
            context,
            widget.cart.state.errorCode ?? 'CART_VALIDATION_FAILED',
          ),
        );
        return false;
      }
      widget.sales.accountSaved();
      // The local account already has the table. A cloud refresh here is what
      // turned a successful offline seating into a red "operation failed"
      // banner: it asked the API again after the journal had done its job.
      final refreshed =
          widget.cart.isOffline ||
          await widget.sales.refreshCurrent(
            expectedCartId: widget.cart.state.cart!.id,
          );
      widget.checkout.reset();
      if (!mounted) return false;
      setState(() {
        _section = TillSurface.order;
        _inlineDetail = null;
        _orderTypeTouched = false;
        _orderType = widget.cart.state.cart!.fulfillmentType;
        _notice = refreshed
            ? null
            : operatorErrorMessage(
                context,
                widget.sales.state.errorCode ?? 'CART_VALIDATION_FAILED',
              );
      });
      return true;
    } finally {
      if (mounted) setState(() => _accountTransition = false);
    }
  }

  /// Open a resumable account identified as a temporary table.
  ///
  /// The account is tableless on purpose: the floor never invents a physical
  /// table UUID, while the account still carries a normal folio, can receive
  /// lines and is resumed from Cuentas like any other account. "Mesa temporal"
  /// is its commercial label, not a claim that the published floor plan has a
  /// new physical table.
  Future<bool> _openTemporaryAccount() async {
    if (_accountRestoring) {
      _showAccountRestoreNotice();
      return false;
    }
    if (_accountTransition) return false;
    final entry = widget.entry.state;
    final merchantId = entry.selectedTenant?.id;
    final locationId = entry.selectedBranch?.id;
    final operatorSessionId = entry.operator?.id;
    if (merchantId == null || locationId == null || operatorSessionId == null) {
      return false;
    }
    setState(() => _accountTransition = true);
    try {
      final current = widget.cart.state.cart;
      final alreadyTemporary =
          current?.tableId == null &&
          current?.accountName == temporaryTableAccountName;
      if (alreadyTemporary) {
        if (!mounted) return false;
        setState(() {
          _section = TillSurface.order;
          _editingAccountId = null;
          _inlineDetail = null;
          _orderTypeTouched = false;
          _orderType = 'dine_in';
          _noticeCode = null;
          _notice = null;
        });
        return true;
      }
      if (current != null && !accountIsBare(current)) {
        final preserved = await widget.cart.preserveForAccountSwitch();
        if (!preserved) {
          if (mounted) {
            setState(() {
              _notice =
                  'No se pudo guardar la cuenta actual en este equipo. Vuelve a intentarlo antes de cambiar de cuenta.';
              _noticeCode = 'CART_LOCAL_STORAGE_FAILED';
            });
          }
          return false;
        }
        widget.sales.accountSaved();
        widget.checkout.reset();
        widget.cart.clearLocal();
      }
      await widget.cart.open(
        merchantId,
        locationId,
        operatorSessionId,
        accountName: temporaryTableAccountName,
      );
      final ready = widget.cart.state.cart;
      if (ready == null) {
        if (mounted) _refuseCartWrite();
        return false;
      }
      if (ready.fulfillmentType != 'dine_in') {
        await widget.cart.setFulfillment('dine_in');
      }
      if (!mounted) return false;
      setState(() {
        _section = TillSurface.order;
        _editingAccountId = null;
        _inlineDetail = null;
        _orderTypeTouched = false;
        _orderType = 'dine_in';
        _noticeCode = null;
        _notice = null;
      });
      _search.clear();
      widget.catalog.search('');
      return true;
    } finally {
      if (mounted) setState(() => _accountTransition = false);
    }
  }

  Future<void> _saveAccount() async {
    if (_accountTransition) return;
    setState(() => _accountTransition = true);
    try {
      final cart = widget.cart.state.cart;
      if (!await widget.cart.saveAccount()) {
        if (mounted) _refuseCartWrite();
        return;
      }
      widget.sales.accountSaved();
      widget.checkout.reset();
      widget.cart.clearLocal();
      if (!mounted) return;
      setState(() {
        _accountsWithoutTable = cart?.tableId == null;
        _editingAccountId = null;
        _inlineDetail = null;
        _section = widget.floorPlan == null
            ? TillSurface.order
            : TillSurface.tables;
        _noticeCode = null;
        _notice = null;
      });
    } finally {
      if (mounted) setState(() => _accountTransition = false);
    }
  }

  Future<bool> _assignAccountTable() async {
    if (_accountTransition) return false;
    final entry = widget.entry.state;
    final cart = widget.cart.state.cart;
    if (widget.floorPlan == null || cart == null || entry.operator == null) {
      return false;
    }
    setState(() => _accountTransition = true);
    try {
      final table = await _chooseOrderTable(assigningAccountId: cart.id);
      if (table == null || !mounted) return false;
      if (!await widget.cart.assignAccountTable(
        table.id,
        tableName: table.label,
      )) {
        if (mounted) _refuseCartWrite();
        return false;
      }
      if (mounted) {
        setState(() {
          _noticeCode = null;
          _notice = null;
        });
      }
      final selected = widget.cart.state.cart!;
      widget.sales.accountSaved();
      widget.checkout.reset();
      await widget.sales.refreshCurrent(expectedCartId: selected.id);
      if (mounted) setState(() => _orderType = selected.fulfillmentType);
      return true;
    } finally {
      if (mounted) setState(() => _accountTransition = false);
    }
  }

  // True once the operator has chosen the type in this turn. Until then the cart
  // is the truth (plan §8.2 F3), so a restored sale shows the type it carries.
  bool _orderTypeTouched = false;

  /// WHETHER THIS CART IS AN ACCOUNT THE OPERATOR OPENED TO EDIT.
  ///
  /// "Guardar y salir" is the action that puts an account down and walks away, and
  /// it only means something to the operator who picked the account up: they came
  /// from the open-accounts list to change something, and the button is how they
  /// put it back. A fresh sale has nothing to put down — the till saves it as the
  /// operator goes and starting the next sale saves it again — so the button there
  /// was a step that asked a question the screen had already answered. The owner
  /// asked for it to stop appearing on the ordinary cart (2026-10-12); this flag is
  /// what the panel reads. It is set by [_resumeAccount] and cleared by
  /// [_newSale] and [_saveAccount]. The cart ID also guards cancellation and
  /// direct new-sale actions: a later account cannot inherit this button.
  String? _editingAccountId;
  bool get _editingAccount =>
      _editingAccountId != null &&
      _editingAccountId == widget.cart.state.cart?.id;

  /// The device's own kind, as the server records it (plan §7 D6). A device the
  /// owner marked as a KDS shows the kitchen, not the till — even for an operator
  /// who may sell.
  bool get _kdsDevice => widget.entry.state.device?.type == 'kds';
  Timer? _readyTicker;
  final _readyTracker = KitchenReadyTracker();
  final _readyAudio = KitchenAudio();
  final ValueNotifier<Map<String, String>> _lineStatuses = ValueNotifier({});
  String? _lineStatusOrderId;
  Map<String, String> get _currentLineStatuses =>
      _lineStatusOrderId == widget.cart.state.cart?.firedOrderId
      ? _lineStatuses.value
      : const {};
  bool _readyBusy = false;
  KitchenPushNotice? _handledKitchenNotice;
  Future<void> _pollReadyItems() async {
    final state = widget.entry.state;
    final orderId = widget.cart.state.cart?.firedOrderId;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operator = state.operator;
    if (_readyBusy ||
        _kdsDevice ||
        orderId == null ||
        merchant == null ||
        location == null ||
        operator == null ||
        widget.kitchenStatus == null ||
        !OperatorPermissions(operator.permissions).allows('order.fire')) {
      return;
    }
    _readyBusy = true;
    try {
      final status = await widget.kitchenStatus!.status(
        merchant,
        orderId,
        PosKitchenOrderQuery(
          locationId: location,
          operatorSessionId: operator.id,
        ),
      );
      if (!mounted ||
          widget.cart.state.cart?.firedOrderId != orderId ||
          widget.entry.state.operator?.id != operator.id) {
        return;
      }
      final nextStatuses = kitchenLineStatuses(status);
      if (_lineStatusOrderId != orderId ||
          !mapEquals(_lineStatuses.value, nextStatuses)) {
        _lineStatusOrderId = orderId;
        _lineStatuses.value = nextStatuses;
        setState(() {});
      }
      final sounds = _readyTracker.observe(
        '$merchant:${operator.id}:$orderId',
        status.readyItems ?? const [],
        muted:
            DisplayPreferencesScope.maybeOf(context)?.kitchenSoundsMuted ??
            false,
      );
      for (final sound in sounds) {
        unawaited(_readyAudio.play(sound));
      }
    } catch (_) {
      // El aviso es auxiliar: una lectura fallida no interrumpe la cuenta.
    } finally {
      _readyBusy = false;
    }
  }

  void _onKitchenNotificationOpen() {
    final notice = widget.notificationOpen?.value;
    if (notice == null || identical(notice, _handledKitchenNotice)) return;
    _handledKitchenNotice = notice;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_openNotifiedAccount(notice));
    });
  }

  Future<void> _openNotifiedAccount(KitchenPushNotice notice) async {
    final entry = widget.entry.state;
    final merchant = entry.selectedTenant?.id;
    final location = entry.selectedBranch?.id;
    final operator = entry.operator;
    if (merchant == null || location == null || operator == null) return;
    final current = widget.cart.state.cart;
    if (current?.firedOrderId != notice.sourceOrderId ||
        (notice.cartId != null && current?.id != notice.cartId)) {
      try {
        final accounts = await widget.cart.openAccounts(
          merchant,
          location,
          operator.id,
        );
        Cart? target;
        for (final account in accounts) {
          if (account.firedOrderId == notice.sourceOrderId &&
              (notice.cartId == null || account.id == notice.cartId)) {
            target = account;
            break;
          }
        }
        if (!mounted) return;
        if (target == null) {
          showPosFeedback(
            context,
            Localizations.localeOf(context).languageCode == 'es'
                ? 'Esta cuenta ya no está abierta.'
                : 'This account is no longer open.',
          );
          return;
        }
        await _resumeAccount(target);
      } catch (_) {
        if (mounted) _refuseCartWrite();
        return;
      }
    } else {
      await widget.cart.refresh();
    }
    if (!mounted ||
        widget.cart.state.cart?.firedOrderId != notice.sourceOrderId) {
      return;
    }
    setState(() => _section = TillSurface.order);
    await _pollReadyItems();
    if (!mounted) return;
    final permissions = OperatorPermissions(operator.permissions);
    if (MediaQuery.sizeOf(context).width < 900 &&
        permissions.allows('cart.write')) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          unawaited(_showCartSheet(context, permissions, canWriteCart: true));
        }
      });
    }
  }

  Future<void> _showCartSheet(
    BuildContext context,
    OperatorPermissions permissions, {
    required bool canWriteCart,
  }) async {
    await showPosSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => AnimatedBuilder(
        animation: Listenable.merge([widget.cart, _lineStatuses]),
        builder: (sheetContext, _) {
          // Keep the pinned actions above the keyboard on a narrow device.
          final media = MediaQuery.of(sheetContext);
          return Padding(
            padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
            child: SafeArea(
              child: SizedBox(
                height: (media.size.height - media.viewInsets.bottom) * .82,
                child: _CartPanel(
                  controller: widget.cart,
                  restoringAccount: _restoringAccount,
                  onNewSale: () => _newSale(context),
                  lineStatuses: _currentLineStatuses,
                  checkout: widget.checkout,
                  cash: widget.cash,
                  entry: widget.entry,
                  permissions: permissions,
                  sales: widget.sales,
                  customerValue: widget.customerValue,
                  deviceChannel: widget.deviceChannel,
                  onPrint: _receiptPrinter,
                  orderType: _orderType,
                  beforeCheckout: _prepareCheckout,
                  beforeFire: _mobileDevice ? _prepareCheckout : null,
                  onAssignTable:
                      canWriteCart &&
                          widget.cart.supportsAccountDetails &&
                          widget.floorPlan != null
                      ? () async {
                          Navigator.pop(sheetContext);
                          await _assignAccountTable();
                        }
                      : null,
                  onSave:
                      canWriteCart &&
                          widget.cart.supportsOpenAccounts &&
                          _editingAccount
                      ? () async {
                          Navigator.pop(sheetContext);
                          await _saveAccount();
                        }
                      : null,
                  onClose: () => Navigator.pop(sheetContext),
                  onEdit: (item) {
                    Navigator.pop(sheetContext);
                    _showDetail(
                      item.productId,
                      item: item,
                      canWrite: canWriteCart,
                    );
                  },
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  /// Whether `Nueva cuenta` can do anything for the account on screen.
  ///
  /// It can when the till holds no account at all (the tap opens the first one), and
  /// it can when the account holds something to put down — lines, a table, a name or
  /// a fired order. It cannot when the account is bare: the operator is already on
  /// the account the tap would open, so the control stands down and its tooltip says
  /// why. A button that looks ready and answers with nothing is the defect this code
  /// keeps meeting; the account it names is `Cuenta NNN`, shown by the comanda itself.
  bool get _canStartNewAccount {
    if (_accountRestoring) return false;
    if (!widget.cart.supportsOpenAccounts) return true;
    final cart = widget.cart.state.cart;
    return cart == null || !accountIsBare(cart);
  }

  bool get _accountRestoring =>
      _restoringAccount || widget.sales.isRestoringCurrent;

  void _showAccountRestoreNotice() {
    if (!mounted) return;
    setState(() {
      _noticeCode = null;
      _noticeDetails = null;
      _notice = AppLocalizations.of(context).cartRestoringAccountHint;
    });
  }

  @override
  void initState() {
    super.initState();
    widget.notificationOpen?.addListener(_onKitchenNotificationOpen);
    _onKitchenNotificationOpen();
    _searchFocus.addListener(_revealSearch);
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
    _readyTicker = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _pollReadyItems(),
    );
  }

  @override
  void didUpdateWidget(covariant CatalogSurface oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.notificationOpen != widget.notificationOpen) {
      oldWidget.notificationOpen?.removeListener(_onKitchenNotificationOpen);
      widget.notificationOpen?.addListener(_onKitchenNotificationOpen);
      _onKitchenNotificationOpen();
    }
  }

  void _revealSearch() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final anchor = _searchAnchor.currentContext;
      if (mounted &&
          _searchFocus.hasFocus &&
          anchor != null &&
          (ModalRoute.of(context)?.isCurrent ?? true)) {
        Scrollable.ensureVisible(anchor);
      }
    });
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

  /// The card's own words, said back: this product is not sellable here.
  ///
  /// The server refuses the line for a product the café marked unavailable, so the
  /// till answers first — the tap never opens a sheet that cannot be saved.
  void _refuseUnavailable(String name) {
    if (!mounted) return;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    setState(
      () => _notice = spanish
          ? '«$name» no está disponible en esta sucursal.'
          : '“$name” is not available at this branch.',
    );
  }

  /// The write reached the API and was refused. Say so, in the operator's words: the
  /// cart's own error state is where the reason lives, and an operator who is told
  /// nothing reads a lost tap as a broken till.
  void _refuseCartWrite() {
    if (!mounted) return;
    if (_accountRestoring) {
      _showAccountRestoreNotice();
      return;
    }
    final code = widget.cart.state.errorCode ?? 'CART_VALIDATION_FAILED';
    setState(() {
      _noticeCode = code;
      _noticeDetails = widget.cart.state.errorDetails;
      _notice = operatorErrorMessage(context, code, details: _noticeDetails);
    });
  }

  /// The cart code behind the bar on screen, when the bar is a refused write.
  ///
  /// A refusal describes a moment, and it is stale the instant a later write lands.
  /// The bar is meant to stay "until the operator does something else" — its own
  /// widget says so — and it used to outlive the problem instead: after the till
  /// released a suspended account and opened a fresh one, the sentence about the
  /// closed account sat there over an empty, healthy comanda. Clearing on the cart's
  /// own "no error" is the same statement as the one that raised it.
  String? _noticeCode;
  Map<String, Object?>? _noticeDetails;

  void _clearStaleRefusal() {
    final code = _noticeCode;
    final notice = _notice;
    if (code == null || notice == null || !mounted) return;
    final cart = widget.cart.state;
    if (cart.errorCode != null ||
        cart.phase != CartPhase.ready ||
        cart.cart == null) {
      return;
    }
    // A different message took the bar — a search that found nothing, a sale the
    // lifecycle refused — and it is not this refusal. Leave it alone.
    if (notice !=
        operatorErrorMessage(context, code, details: _noticeDetails)) {
      _noticeCode = null;
      return;
    }
    _notice = null;
    _noticeCode = null;
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
    final operator = entry.operator;
    final permissions = OperatorPermissions(operator?.permissions ?? const []);
    final access = OperatorActionAccess(permissions);
    final sells = !_kdsDevice;
    final restoresAccount = operator != null && access.canWriteCart && sells;
    final restoreStartupAccount =
        _initialAccountPolicyApplied || widget.cart.state.cart != null;
    _initialAccountPolicyApplied = true;
    // The first frame after sign-in has no cart yet. Painting the normal empty
    // comanda there offers `Nueva venta` while the server may still be returning
    // the account that was already open. The tap cannot start the order the
    // operator asked for, and the restored account then appears underneath it, so
    // the till looks like the button opened an old order. Keep the panel in a
    // named restore state from the first frame until the current read answers.
    _restoringAccount = restoresAccount && restoreStartupAccount;
    try {
      if (restoresAccount && !restoreStartupAccount) {
        // Entry is a boundary. The account survives in Cuentas, but a fresh
        // operator entry paints a clean till instead of silently adopting the
        // active cart from this operator's previous session.
        await widget.sales.open(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          operator.id,
          useCartAuthority: !access.showSaleActions,
          restoreCurrent: false,
        );
      }
      // Start the account read before the catalogue, but do not make the catalogue
      // depend on it. A slow or malformed sale answer must not leave the menu empty.
      Future<void>? accountRestore;
      if (restoresAccount && restoreStartupAccount) {
        accountRestore = _restoreCurrentAccount(
          entry.selectedTenant!.id,
          entry.selectedBranch!.id,
          operator.id,
          useCartAuthority: !access.showSaleActions,
        );
      }
      // The order surface belongs to a seller. A role without `cart.write` never
      // opens it, never opens the sale lifecycle behind it, and therefore never
      // meets the 403 the old shell painted as the red banner (plan §8.2 F1,
      // findings 4 and 5). A cook loads the kitchen board instead; that board
      // holds its own controller and loads on its own.
      if (operator == null || (access.canWriteCart && sells)) {
        await widget.catalog.open(
          CatalogPartition(
            entry.selectedTenant!.id,
            entry.selectedBranch!.id,
            locale,
          ),
        );
        widget.connectivity.apiReachable(authorityValid: true);
        // Warm the option sheets while the link is up, so the same products can
        // still be customised later in a dead spot. Fire and forget: nothing on
        // screen waits for it.
        unawaited(widget.catalog.warmDetails());
      }
      if (operator != null) {
        widget.cash.setContext(
          merchantId: entry.selectedTenant!.id,
          locationId: entry.selectedBranch!.id,
          operatorSessionId: operator.id,
        );
        // The shift read badge and the cash centre belong to the roles that can
        // reach them. Asking for the shift without `cash.shift.read` is another
        // 403, so the call follows the permission too.
        //
        // Load the shift state so the Cash Center button badge is accurate, but
        // do NOT force the operator into the Cash Center. After the PIN the home
        // screen is always the menu; opening a shift, a cash withdrawal, or a
        // turn change is done on purpose from the Cash Center button in the app
        // bar (badged when there is no open shift), not by a modal that blocks
        // the menu on every sign-in.
        if (access.showCashCenter && sells) {
          await widget.cash.load();
        }
        await widget.exceptions.setContext(
          merchantId: entry.selectedTenant!.id,
          locationId: entry.selectedBranch!.id,
          operatorSessionId: operator.id,
        );
        await _startScanner(operator.permissions);
        widget.connectivity.apiReachable(authorityValid: true);
      }
      if (accountRestore != null) await accountRestore;
    } on AppException catch (error) {
      // The same narrow vocabulary the kitchen board uses: a transport failure or
      // a timeout means "no answer", and everything else reached the API and got
      // one. Counting a legitimate 403 as a failed request painted "Conexión
      // inestable" over a till whose wire was fine (plan §2.1 finding 7).
      if (error.category == AppErrorCategory.transport ||
          error.category == AppErrorCategory.timeout) {
        widget.connectivity.apiFailure();
      } else {
        // The server answered — it refused. The wire is up, so say so.
        widget.connectivity.apiReachable(authorityValid: true);
      }
    } catch (_) {
      // Not an API answer at all: a parse error or a bug in this file. The wire
      // told us nothing, so the connectivity state says nothing about it.
    } finally {
      _restoringAccount = false;
      if (mounted) setState(() {});
    }
    // Attach the replay scope whatever happened above.
    //
    // This used to be the last statement of the `try`, so the one boot that
    // needs it most — the catalogue failing to open because there is no uplink —
    // skipped it. Without a scope the recovery controller cannot replay from a
    // heartbeat, and a sale taken on that boot sat in the journal while the API
    // was demonstrably answering every ten seconds.
    unawaited(_recoverInBackground());
    unawaited(_refreshOpenAccountCount());
    if (mounted) _requestMobileOrderStart();
  }

  Future<void> _refreshOpenAccountCount() async {
    final state = widget.entry.state;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operator = state.operator;
    if (!widget.cart.supportsOpenAccounts ||
        merchant == null ||
        location == null ||
        operator == null) {
      return;
    }
    try {
      final accounts = await widget.cart.openAccounts(
        merchant,
        location,
        operator.id,
      );
      if (!mounted || widget.entry.state.operator?.id != operator.id) return;
      setState(() => _openAccountCount = accounts.length);
    } catch (_) {
      // The count is a navigation hint. A failed background read never covers
      // the till with an error; opening Cuentas performs the authoritative read.
    }
  }

  Future<void> _restoreCurrentAccount(
    String merchantId,
    String locationId,
    String operatorSessionId, {
    required bool useCartAuthority,
  }) async {
    try {
      await widget.sales.open(
        merchantId,
        locationId,
        operatorSessionId,
        useCartAuthority: useCartAuthority,
      );
    } finally {
      _restoringAccount = false;
      if (mounted) setState(() {});
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
      if (!_scanActive) return;
      final generation = _scanGeneration;
      _scanQueue = _scanQueue.then((_) => _handleScan(event, generation));
    });
  }

  bool get _scanActive {
    if (!mounted || _leaving || _kdsDevice || _inlineDetail != null) {
      return false;
    }
    final operator = widget.entry.state.operator;
    return operator != null &&
        OperatorActionAccess(
          OperatorPermissions(operator.permissions),
        ).canWriteCart &&
        (_section == null || _section == TillSurface.order) &&
        ModalRoute.of(context)?.isCurrent == true;
  }

  bool _scanCurrent(int generation) =>
      _scanActive && generation == _scanGeneration;

  void _setSection(TillSurface section) {
    _scanGeneration += 1;
    _salesVisited =
        _salesVisited ||
        _section == TillSurface.sales ||
        section == TillSurface.sales;
    _section = section;
  }

  Future<void> _handleScan(CanonicalScanEvent event, int generation) async {
    if (!_scanCurrent(generation)) return;
    _search.text = event.value;
    final matches = await widget.catalog.lookupBarcode(event.value);
    if (!mounted || !_scanCurrent(generation)) return;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    if (matches.length == 1) {
      final product = matches.single;
      if (!product.hasVariants && !product.hasModifiers) {
        if (product.availability != 'enabled') {
          _refuseUnavailable(product.name);
          return;
        }
        // A scanned product with no variants and no options is a product whose
        // price the summary already carries, so the till can paint the line while
        // the server prices it for real.
        final added = await _addProduct(
          productId: product.id,
          provisional: ProvisionalLine.fromSummary(product: product),
        );
        if (!added) {
          _refuseCartWrite();
          return;
        }
        _recordFrequent(product.id, product.name, product.price);
      } else {
        await _showDetail(product.id, scanGeneration: generation);
      }
      return;
    }
    setState(
      () => _notice = matches.isEmpty
          ? (spanish ? 'Código de barras desconocido.' : 'Unknown barcode.')
          : (spanish
                ? 'Hay varios productos para este código.'
                : 'Multiple products match this barcode.'),
    );
  }

  void _changed() {
    if (!mounted) return;
    final cartType = widget.cart.state.cart?.fulfillmentType;
    if (!_orderTypeTouched && cartType != null) {
      _orderType = cartType;
    }
    setState(() {});
    // Browsing (catalog detail/search) and cart mutations both surface a lost
    // operator session here; the `_leaving` guard makes this fire once.
    _reauthIfSessionLost(widget.cart.state.errorCode);
    _reauthIfSessionLost(widget.catalog.state.errorCode);
    _noticeForReleasedAccount(widget.cart.state.errorCode);
    _clearStaleRefusal();
  }

  String? _lastCartReleaseCode;

  /// The cart controller let go of an account the server had stopped taking writes
  /// on — it was suspended or closed from another screen while this comanda kept it.
  ///
  /// Two things have to happen for the till to be usable again. The operator has to be
  /// told, in words that name the real cause; and the sales controller has to forget
  /// the snapshot it read before the account moved, because while it believes a sale is
  /// in progress it refuses `Nueva cuenta` — which is how the dead end used to close
  /// itself from both sides.
  void _noticeForReleasedAccount(String? errorCode) {
    if (errorCode != 'CART_ACCOUNT_CLOSED') {
      _lastCartReleaseCode = null;
      return;
    }
    if (errorCode == _lastCartReleaseCode || !mounted) return;
    _lastCartReleaseCode = errorCode;
    widget.sales.accountSaved();
    widget.checkout.reset();
    _editingAccountId = null;
    _inlineDetail = null;
    _noticeCode = 'CART_ACCOUNT_CLOSED';
    _notice = operatorErrorMessage(context, 'CART_ACCOUNT_CLOSED');
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
    // NOT `PERMISSION_DENIED`, and the distinction is the whole point of this guard. The
    // API answers 401 `AUTHENTICATION_REQUIRED` when the operator session is no longer
    // live — expired, locked from another surface, ended by a role change — and that is the
    // case worth returning to the PIN for. `PERMISSION_DENIED` is a 403 on a LIVE session:
    // the role lacks a permission, and signing in again cannot change it. Listing the 403
    // here locked the till and dropped it to the PIN pad on every operator switch; a
    // commissioning session reproduced it with a role holding all 145 permissions, which
    // is what ruled out "a role is missing something" and left the guard itself.
    final lost =
        errorCode == 'AUTHENTICATION_REQUIRED' ||
        errorCode == 'OPERATOR_SESSION_ENDED' ||
        errorCode == 'UNAUTHORIZED';
    if (!lost) return false;
    final permissions = OperatorPermissions(
      widget.entry.state.operator?.permissions ?? const [],
    );
    if (!permissions.allowsAny(const ['sale.lifecycle', 'cart.write'])) {
      return false;
    }
    _leaving = true;
    // Use a microtask, not addPostFrameCallback: dropping to the PIN must run
    // even if no further frame is pumped, and it also keeps `lock()` (which
    // mutates state) out of the current build/listener turn.
    scheduleMicrotask(() async {
      if (!mounted) return;
      // No notice here on purpose: the till is about to drop to the PIN pad,
      // and that screen IS the message. A bar saying "your session ended"
      // while the keypad is already replacing the catalog is a caption for
      // something the operator can see for themselves.
      await widget.entry.lock();
    });
    return true;
  }

  void _saleChanged() {
    if (!mounted) return;
    setState(() {});
    if (widget.sales.state.readyForNextCustomer) _requestMobileOrderStart();
    final rawErrorCode = widget.sales.state.errorCode;
    final missingPrepaymentSale =
        (rawErrorCode == 'RESOURCE_NOT_FOUND' ||
            rawErrorCode == 'SALE_NOT_FOUND') &&
        widget.cart.state.cart?.firedOrderId != null;
    // A fired account has an order for the kitchen but intentionally has no
    // "current sale" until checkout begins. The account resume explains that
    // distinction already; painting the missing pre-payment sale as an error
    // put a permanent generic banner over a healthy account.
    final errorCode = missingPrepaymentSale ? null : rawErrorCode;
    final offline =
        widget.connectivity.state == PosConnectivity.offline ||
        widget.connectivity.state == PosConnectivity.degraded ||
        widget.connectivity.state == PosConnectivity.blocked;
    if (errorCode != null && errorCode != _lastSaleErrorCode && !offline) {
      _lastSaleErrorCode = errorCode;
      if (!_reauthIfSessionLost(errorCode)) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            setState(() {
              _noticeCode = errorCode;
              _noticeDetails = null;
              _notice = operatorErrorMessage(context, errorCode);
            });
          }
        });
      }
    } else if (errorCode == null) {
      _lastSaleErrorCode = null;
      if (_noticeCode != null &&
          _notice != null &&
          widget.cart.state.errorCode == null) {
        setState(() {
          _notice = null;
          _noticeCode = null;
          _noticeDetails = null;
        });
      }
    }
    if (widget.sales.state.readyForNextCustomer) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _search.clear();
          widget.catalog.search('');
          _searchFocus.requestFocus();
          // THE CURSOR, NOT THE KEYBOARD — AND ON ANDROID THE TWO ARRIVE TOGETHER.
          //
          // Putting the cursor back in the search field is the "ready for the next customer"
          // feedback, and on a desktop till that is all it is. On the iMin it also raises Gboard:
          // this callback fires the moment a sale commits, so the keyboard landed on top of
          // `Pagado` and covered the half of the screen the next action sits in — measured on
          // 2026-10-11, where the instrumented build named this very field
          // (`ValueKey('hardware-barcode-search')`, empty, focused) as the one that took focus while
          // the charge committed. The cursor is still wanted (the scanner wedge routes while a text
          // input has focus, and the operator's next keystroke belongs there), so the keyboard is
          // put away instead of the focus being dropped.
          // ANDROID ANSWERS A FOCUS CHANGE LATER. `showSoftInput` is asynchronous, so a hide issued
          // in this same callback lands BEFORE the platform's show and the keyboard wins the race —
          // measured twice on the iMin (`mInputShown=true` ten seconds after `Pagado`). The hide
          // waits for that answer to arrive.
          Future<void>.delayed(const Duration(milliseconds: 250), () {
            unawaited(
              SystemChannels.textInput.invokeMethod<void>('TextInput.hide'),
            );
          });
          // No "ready for the next customer" bar. Clearing the search and
          // putting the cursor back in it IS the feedback: the till is visibly
          // ready, and a bar that slides up to say so only covers the bottom
          // of the screen - it landed exactly where the sale-complete dialog
          // puts "Nuevo pedido", so a tap aimed there dismissed the bar and
          // did nothing else.
        }
      });
    }
  }

  @override
  void dispose() {
    _readyTicker?.cancel();
    _readyAudio.dispose();
    _lineStatuses.dispose();
    widget.notificationOpen?.removeListener(_onKitchenNotificationOpen);
    _scanSubscription?.cancel();
    widget.catalog.removeListener(_changed);
    widget.cart.removeListener(_changed);
    widget.cash.removeListener(_changed);
    widget.sales.removeListener(_saleChanged);
    widget.connectivity.removeListener(_changed);
    _search.dispose();
    _scroll.dispose();
    _searchFocus.dispose();
    _newSaleFocus.dispose();
    _overflowFocus.dispose();
    _accountFocus.dispose();
    super.dispose();
  }

  /// `Nueva venta`, with the one thing it never said out loud.
  ///
  /// Starting a sale while one is in progress ABANDONS that sale, so the operator
  /// is asked first and told what is at stake: how many lines are unbilled, and
  /// that nothing is charged for them. With an empty cart there is nothing to
  /// abandon and the question would be noise. The escape matters because a cart
  /// whose checkout draft holds a payment claim can be neither paid nor cancelled
  /// — this is the only way out of it that does not kill the app.
  ///
  /// ON AN OPEN-ACCOUNTS SERVER the account on screen is put down, not thrown away:
  /// the till saves it and opens the next one, which is why an operator who wants to
  /// keep serving a seated guest can start a takeout account beside them.
  ///
  /// A BARE ACCOUNT IS THE EXCEPTION, AND IT NEVER REACHES THE SERVER. An account
  /// with no lines, no table, no name and no fired order is the draft the session
  /// opened with — saving it would write a record nobody can charge and spend the
  /// next account number, once per tap. The owner hit exactly that on 2026-10-13:
  /// "solo se acumulan si spamean el botón". So the tap keeps the account it already
  /// has, clears the capture screen, and stops there. `Nueva cuenta` stands down
  /// before this in `_canStartNewAccount`; the guard here is what makes the rule
  /// hold for the other callers (the Cuentas workspace and the mobile order start).
  Future<void> _newSale(BuildContext context) async {
    final l = AppLocalizations.of(context);
    if (_accountRestoring) {
      _showAccountRestoreNotice();
      return;
    }
    if (widget.cart.supportsOpenAccounts) {
      if (_accountTransition) return;
      final open = widget.cart.state.cart;
      if (open == null) {
        // A refused write on the previous, already-closed account can leave a
        // validation failure in the controller after its cart is gone. Starting
        // from Cuentas is a new decision: clear that stale refusal before the
        // service-type step, or the empty order paints an endless spinner.
        widget.cart.clearLocal();
        setState(() {
          _section = TillSurface.order;
          _editingAccountId = null;
          _inlineDetail = null;
          _notice = null;
        });
        await _startOrderAfterParking();
        return;
      }
      if (accountIsBare(open)) {
        if (mounted) {
          setState(() {
            _editingAccountId = null;
            _section = TillSurface.order;
            _inlineDetail = null;
            _orderTypeTouched = false;
            _orderType = open.fulfillmentType;
            _noticeCode = null;
            _notice = null;
          });
          // The capture screen resets, which is the visible answer to the tap: the
          // search empties and the menu returns to its first row. That is the same
          // feedback a committed sale gives on this till.
          _search.clear();
          widget.catalog.search('');
          if (_scroll.hasClients) _scroll.jumpTo(0);
        }
        await _startOrderAfterParking();
        return;
      }
      setState(() => _accountTransition = true);
      try {
        if (widget.cart.state.cart != null) {
          // Account switching is local-first. Persist any command still in the
          // in-memory lane, then let the next `pos.cart.open` park the previous
          // account on the server. Calling `saveAccount` here raced the command
          // queue: a sent line could leave an accepted in-memory command behind,
          // `saveAccount` answered busy without an API request, and the top-bar
          // action surfaced an old CART_VALIDATION_FAILED banner over a healthy
          // account.
          final preserved = await widget.cart.preserveForAccountSwitch();
          if (!preserved) {
            if (mounted) {
              setState(() {
                _noticeCode = 'CART_LOCAL_STORAGE_FAILED';
                _notice =
                    'No se pudo guardar la cuenta actual en este equipo. Vuelve a intentarlo antes de cambiar de cuenta.';
              });
            }
            return;
          }
          widget.sales.accountSaved();
          widget.cart.clearLocal();
          widget.checkout.reset();
        }
        if (mounted) {
          setState(() {
            _editingAccountId = null;
            _section = TillSurface.order;
            _inlineDetail = null;
            _orderTypeTouched = false;
            _orderType = 'dine_in';
            _noticeCode = null;
            _notice = null;
          });
        }
      } finally {
        if (mounted) setState(() => _accountTransition = false);
      }
      await _startOrderAfterParking();
      return;
    }
    final lines = widget.cart.state.cart?.items.length ?? 0;
    if (lines > 0) {
      final confirmed = await showPosDialog<bool>(
        context: context,
        builder: (dialogContext) => PosAlertDialog(
          title: Text(l.newSaleConfirmTitle),
          content: Text(l.newSaleConfirmBody(lines)),
          actions: [
            PosTextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(l.keepCartAction),
            ),
            PosButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(l.newSaleAction),
            ),
          ],
        ),
      );
      if (confirmed != true) return;
      await widget.sales.newSale(abandonCurrent: true);
      return;
    }
    await widget.sales.newSale();
  }

  /// One entry point for a new account.
  ///
  /// The operator chooses the service context first. Dine-in asks for the table
  /// before the first product. Takeaway keeps the account tableless. The form
  /// uses one action and one vocabulary; fulfillment remains the server's
  /// existing `dine_in` or `takeout` fact.
  Future<void> _startOrderAfterParking() async {
    if (!mounted || !widget.cart.supportsOpenAccounts) return;
    unawaited(_warmOrderTableData());
    final type = await showOrderTypePicker(context);
    if (type == null || !mounted) return;
    _consumeModalPointer();
    if (type == 'dine_in' && widget.floorPlan != null) {
      final table = await _chooseOrderTable();
      if (table != null && mounted) await _openTableAccount(table);
      return;
    }
    await _openTablelessAccount(type);
  }

  Future<bool> _openTablelessAccount(String type) async {
    final entry = widget.entry.state;
    final merchant = entry.selectedTenant?.id;
    final location = entry.selectedBranch?.id;
    final operator = entry.operator?.id;
    if (merchant == null || location == null || operator == null) return false;
    if (widget.cart.state.cart == null) {
      await widget.cart.open(merchant, location, operator);
      if (widget.cart.state.cart == null) {
        if (mounted) _refuseCartWrite();
        return false;
      }
    }
    if (widget.cart.state.cart?.fulfillmentType != type) {
      await widget.cart.setFulfillment(type);
    }
    if (!mounted || widget.cart.state.cart?.fulfillmentType != type) {
      if (mounted) _refuseCartWrite();
      return false;
    }
    final openedCart = widget.cart.state.cart!;
    _preparedMobileCartId = openedCart.id;
    _promptedMobileCartId = openedCart.id;
    setState(() {
      _section = TillSurface.order;
      _editingAccountId = null;
      _inlineDetail = null;
      _pendingOrderType = null;
      _orderType = type;
      _orderTypeTouched = false;
      _noticeCode = null;
      _notice = null;
    });
    return true;
  }

  Future<bool> _addProduct({
    required String productId,
    String? variantId,
    List<Map<String, Object?>> modifiers = const [],
    int quantity = 1,
    String? note,
    int courseNumber = 1,
    ProvisionalLine? provisional,
  }) async {
    if (_accountRestoring) {
      _refuseCartWrite();
      return false;
    }
    if (widget.cart.state.cart == null) {
      if (_mobileDevice && !await _prepareMobileOrder()) return false;
      if (widget.cart.state.cart == null) {
        // A failed sale-history read must not discard a cart the local-first
        // opener has already created. The cart is the order the operator is
        // building; the history snapshot can catch up after replay.
        await widget.sales.newSale();
        if (widget.cart.state.cart == null) {
          final entry = widget.entry.state;
          final merchant = entry.selectedTenant?.id;
          final location = entry.selectedBranch?.id;
          final operator = entry.operator?.id;
          if (merchant != null && location != null && operator != null) {
            await widget.cart.open(merchant, location, operator);
          }
        }
        if (widget.cart.state.cart == null) return false;
        if (_pendingOrderType != null) {
          await widget.cart.setFulfillment(_pendingOrderType!);
          if (widget.cart.state.cart?.fulfillmentType != _pendingOrderType) {
            return false;
          }
          _pendingOrderType = null;
        }
      }
    }
    return widget.cart.add(
      productId: productId,
      variantId: variantId,
      modifiers: modifiers,
      quantity: quantity,
      note: note,
      courseNumber: courseNumber,
      provisional: provisional,
    );
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
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final surfaces = tillSurfacesFor(
      access,
      hasFloorPlan: widget.floorPlan != null,
      hasKitchenBoard: widget.kitchenBoard != null,
      hasIncomingOrders: widget.incomingOrders != null,
      // Per merchant, not per release: ONCA does not take other channels' orders
      // today, and the till hides the surface instead of losing it.
      incomingOrdersEntitled: merchantCarriesFeature(
        kIncomingOrdersFeature,
        entryState.operator?.entitlements ?? const [],
      ),
      kdsDevice: _kdsDevice,
    );
    // With no operator loaded the shell has no role to follow — a frame before
    // the turn is ready, or a test harness that mounts the surface directly — so
    // it keeps the order surface. In the app the shell mounts only on `ready`,
    // which always carries an operator.
    final landing = entryState.operator == null
        ? TillSurface.order
        : landingSurface(surfaces);
    final selected = surfaces.contains(_section) ? _section! : landing;
    final orderVisible = selected == TillSurface.order;
    return PosPage(
      bottomNavigationBar: _primaryNav(context, spanish, surfaces, selected),
      body: Stack(
        fit: StackFit.expand,
        children: [
          if (landing == TillSurface.order)
            Offstage(
              key: const ValueKey('workspace-order'),
              offstage: !orderVisible,
              child: ExcludeFocus(
                excluding: !orderVisible,
                child: TickerMode(
                  enabled: orderVisible,
                  child: _orderPage(context, l, state, permissions, access),
                ),
              ),
            ),
          if (surfaces.contains(TillSurface.cash) &&
              (_cashVisited || selected == TillSurface.cash))
            Offstage(
              key: const ValueKey('workspace-cash'),
              offstage: selected != TillSurface.cash,
              child: ExcludeFocus(
                excluding: selected != TillSurface.cash,
                child: TickerMode(
                  enabled: selected == TillSurface.cash,
                  child: _destinationPage(
                    context,
                    l,
                    permissions,
                    TillSurface.cash,
                  ),
                ),
              ),
            ),
          if (surfaces.contains(TillSurface.sales) &&
              (_salesVisited || selected == TillSurface.sales))
            Offstage(
              key: const ValueKey('workspace-sales'),
              offstage: selected != TillSurface.sales,
              child: ExcludeFocus(
                excluding: selected != TillSurface.sales,
                child: TickerMode(
                  enabled: selected == TillSurface.sales,
                  child: _saleCenter(
                    permissions,
                    active: selected == TillSurface.sales,
                  ),
                ),
              ),
            ),
          if (!orderVisible &&
              selected != TillSurface.cash &&
              selected != TillSurface.sales)
            KeyedSubtree(
              key: ValueKey(selected),
              child: _destinationPage(context, l, permissions, selected),
            ),
        ],
      ),
    );
  }

  Widget _orderPage(
    BuildContext context,
    AppLocalizations l,
    CatalogState state,
    OperatorPermissions permissions,
    OperatorActionAccess access,
  ) {
    final entryState = widget.entry.state;
    final canWriteCart = access.canWriteCart;
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final showOverflow =
        access.showSaleActions ||
        (permissions.allows('customer.search') &&
            widget.customerValue != null) ||
        (access.showInventory && widget.inventory != null) ||
        (permissions.allows('hardware.read') && widget.hardware != null) ||
        access.showRecovery ||
        kDebugMode;
    final compactHeader =
        MediaQuery.sizeOf(context).width < 1100 ||
        MediaQuery.textScalerOf(context).scale(16) > 22;
    final largeText = MediaQuery.textScalerOf(context).scale(16) > 22;
    Future<void> selectServiceType(String value) async {
      if (_accountTransition || _orderStart != null) return;
      // LEAVING A TABLE BEHIND IS A DECISION, AND THE TILL SAYS SO FIRST.
      //
      // A takeout account has no table: the server clears it and hands the table
      // back to the floor plan, empty. That is a fact about the room, not only about
      // the cart, and the operator is the one person who can see whether the guests
      // are still sitting there — so the question is asked before the table is given
      // up, and everything the account carries stays put either way.
      final current = widget.cart.state.cart;
      if (current == null) {
        _consumeModalPointer();
        if (_mobileDevice && value == 'dine_in') {
          final table = await _chooseOrderTable();
          if (table == null || !mounted) return;
          await _openTableAccount(table);
          return;
        }
        await _openTablelessAccount(value);
        return;
      }
      if (value == 'takeout' &&
          current.tableId != null &&
          !await _confirmTableRelease(current)) {
        return;
      }
      if (_mobileDevice &&
          value == 'dine_in' &&
          widget.cart.state.cart?.tableId == null) {
        if (!await _assignAccountTable()) return;
      } else {
        await widget.cart.setFulfillment(value);
      }
      if (!mounted) return;
      setState(() {
        _orderTypeTouched = false;
        _orderType = widget.cart.state.cart?.fulfillmentType ?? _orderType;
      });
      if (_orderType != value) _refuseCartWrite();
    }

    // THE ORDER TYPE, DRAWN WHEREVER IT IS CALLED FOR.
    //
    // A function and not a value, because the row above the comanda and the strip
    // on the compact app bar are two different boxes — one hands out leftover
    // width, the other is exactly as wide as the window — and the same widget
    // instance cannot be measured in both.
    Widget orderTypeControl() => Align(
      alignment: Alignment.centerLeft,
      child: compactHeader && largeText
          ? PosSelect<String>(
              value: _orderType,
              items: [
                PosSelectItem(
                  value: 'dine_in',
                  child: Text(spanish ? 'Comer aquí' : 'Dine in'),
                ),
                PosSelectItem(
                  value: 'takeout',
                  child: Text(spanish ? 'Para llevar' : 'Takeout'),
                ),
              ],
              onChanged: (value) {
                if (value != null) selectServiceType(value);
              },
            )
          : PosSegmented<String>(
              showSelectedIcon: false,
              style: PosSegmented.styleFrom(
                selectedBackgroundColor:
                    PosTheme.of(context).colorScheme.midnight
                    ? PosTheme.of(context).colorScheme.primaryContainer
                    : PosTheme.of(context).colorScheme.primary,
                selectedForegroundColor:
                    PosTheme.of(context).colorScheme.midnight
                    ? PosTheme.of(context).colorScheme.onPrimaryContainer
                    : PosTheme.of(context).colorScheme.onPrimary,
              ),
              segments: [
                PosSegment(
                  value: 'dine_in',
                  icon: const PosIcon(PosGlyphs.restaurantOutlined, size: 18),
                  label: Text(spanish ? 'Comer aquí' : 'Dine in'),
                ),
                PosSegment(
                  value: 'takeout',
                  icon: const PosIcon(
                    PosGlyphs.takeoutDiningOutlined,
                    size: 18,
                  ),
                  label: Text(spanish ? 'Para llevar' : 'Takeout'),
                ),
              ],
              selected: {_orderType},
              onSelectionChanged: (selection) {
                selectServiceType(selection.first);
              },
            ),
    );
    // THE BUYER SITS WITH THE ORDER TYPE.
    //
    // The customer control used to be a row of its own inside the comanda —
    // "Asignar cliente", in words, on every cart that had no customer — and then
    // briefly a glyph beside the table. The owner put it here (2026-10-12), beside
    // the order type, because that is the moment the operator settles how the sale
    // leaves the counter and who it belongs to, and the two belong to one decision.
    // It stays a glyph: on the counter till the column beside the toggle has about
    // seventy logical pixels of room, which is a 48-pixel control and not a label.
    // The name travels in the tooltip, and the glyph itself changes state — a
    // person with a plus while the sale has no buyer, the plain person after that.
    final canAttachCustomer = permissions.allows('sale.lifecycle');

    // THE ORDER TYPE SITS IN A BOX, AND THE BUYER'S BUTTON SITS BESIDE IT.
    //
    // The owner asked for the buyer's control to line up with the container below
    // and to be wider, its marks centred (2026-10-12). Two things make that row
    // behave:
    //
    // 1. The order type goes inside an `Expanded`. A `Row` hands a non-flexible
    //    child an unbounded width, and the segmented control answers unbounded
    //    width by growing — 72 logical pixels of yellow stripe on every screen
    //    that drew this row, which is how these two lines were found. Inside a box
    //    the control measures against something real.
    // 2. `FittedBox` with `scaleDown`, because the segmented control cannot shrink
    //    on its own either: given less room than its two segments need, it scales
    //    by a fraction of a percent instead of striping. On the counter till it is
    //    never asked to: the segments measure 265.7 of the column's 344.
    Widget orderTypeSlot() => Expanded(
      child: FittedBox(
        fit: BoxFit.scaleDown,
        alignment: Alignment.centerLeft,
        child: orderTypeControl(),
      ),
    );

    // The buyer's button closes the row on the panel's own edge. 72 logical pixels
    // at the till: the segments are 48 tall, so this is the same height and half
    // again as wide, which is the room the two marks need — a person, ten pixels of
    // air, and a plus — with the pair centred in it.
    final serviceRow = Row(
      children: [
        orderTypeSlot(),
        if (canAttachCustomer) ...[
          const SizedBox(width: UmiSpacing.sm),
          SizedBox(width: 72, child: _customerAction(context, l, room: true)),
        ],
      ],
    );

    // The compact app bar gives the order type a strip of its own, 56 logical pixels
    // tall and as wide as the window, and at the largest text the toggle alone fills
    // it. There the buyer's control keeps its own square and the toggle keeps what is
    // left, because a strip that cannot grow has no room to hand out.
    final compactServiceRow = Row(
      children: [
        orderTypeSlot(),
        if (canAttachCustomer) ...[
          const SizedBox(width: UmiSpacing.sm),
          _customerAction(context, l, room: false),
        ],
      ],
    );
    final currentCart = widget.cart.state.cart;
    final compactTotal = currentCart == null
        ? null
        : CatalogMoney.fromJson(
            TotalsPreview.fromJson(currentCart.totals).grandTotal,
          );
    final orderButton =
        MediaQuery.sizeOf(context).width < 900 &&
            canWriteCart &&
            _inlineDetail == null
        ? PosOrderButton.extended(
            onPressed: () => _showCartSheet(
              context,
              permissions,
              canWriteCart: canWriteCart,
            ),
            icon: const PosIcon(PosGlyphs.shoppingCartOutlined),
            label: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(l.cartTitle),
                if (compactTotal != null) ...[
                  const SizedBox(width: 16),
                  Text(
                    formatMinorUnits(
                      compactTotal.minorUnits,
                      compactTotal.currency,
                    ),
                  ),
                ],
              ],
            ),
          )
        : null;
    final syncSummary = syncLaneSummary(
      context,
      cloud: widget.connectivity.state,
      hub: widget.connectivity.hubState,
      pending: widget.cart.pendingSyncCount,
    );
    final header = PosHeader(
      toolbarHeight: compactHeader ? 56 : 72,
      // The order context (PoloTab's "Para llevar" pill) takes the title slot —
      // the barista sets dine-in vs takeout here before building the order.
      titleSpacing: UmiSpacing.md,
      actionsInline: compactHeader && !largeText,
      title: StationHeading(
        title: entryState.selectedBranch?.name ?? l.cartTitle,
      ),
      bottom: compactHeader
          ? PreferredSize(
              preferredSize: const Size.fromHeight(56),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: compactServiceRow,
              ),
            )
          : null,
      actions: [
        // Status — connectivity, compact. Visibility of system status.
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
          child: Semantics(
            liveRegion: true,
            label: syncSummary,
            // Status, not a control. `PosTag` publishes `checked` on web
            // (PosSurface's chip.dart does that for every chip), so without
            // excluding it the bar announces "En línea, checkbox, not
            // checked" — a setting the operator can never tick. The label
            // above stays, so the status is still read out.
            child: ExcludeSemantics(
              child: compactHeader
                  ? PosTooltip(
                      message: syncSummary,
                      child: SizedBox.square(
                        dimension: 32,
                        child: Center(
                          child: PosIcon(
                            widget.connectivity.state == PosConnectivity.online
                                ? PosGlyphs.cloudDoneOutlined
                                : PosGlyphs.cloudOffOutlined,
                            size: 20,
                          ),
                        ),
                      ),
                    )
                  : PosTag(
                      avatar: PosIcon(
                        widget.connectivity.state == PosConnectivity.online
                            ? PosGlyphs.cloudDoneOutlined
                            : PosGlyphs.cloudOffOutlined,
                        size: 18,
                      ),
                      // A local command is normal work. The count stays in the
                      // tooltip; the label names the connection the operator
                      // can act on.
                      label: Text(
                        connectivityLabel(context, widget.connectivity.state),
                      ),
                    ),
            ),
          ),
        ),
        // Primary, labelled, high-frequency actions (top-bar redesign).
        if (access.canWriteCart && _canStartNewAccount)
          _BarAction(
            icon: PosGlyphs.addShoppingCartOutlined,
            focusNode: access.showSaleActions ? _newSaleFocus : null,
            compact: compactHeader,
            label: spanish ? 'Iniciar pedido' : 'Start order',
            onPressed: () => _newSale(context),
          ),
        // NO ACCOUNTS BUTTON UP HERE. The accounts workspace is one of the
        // destinations the sidebar already carries on every screen, and the owner
        // asked for it off the top bar so the row is the actions that are about THIS
        // sale — start another one, open the menu — and not a second copy of the
        // navigation (2026-10-12). `_showOpenAccounts` is what the sidebar's own
        // destination and the menu still call.
        // Overflow — rare / admin actions (progressive disclosure).
        if (showOverflow)
          PosMenuButton<String>(
            tooltip: spanish ? 'Más' : 'More',
            focusNode: _overflowFocus,
            icon: const PosIcon(PosGlyphs.moreVert),
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
                              (!permissions.allows('hardware.printer.print') &&
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
                  PosGlyphs.pauseCircleOutline,
                  l.suspendSaleAction,
                ),
                _overflowItem(
                  'cancel',
                  PosGlyphs.cancelOutlined,
                  l.cancelSaleAction,
                ),
              ],
              if (permissions.allows('customer.search') &&
                  widget.customerValue != null)
                _overflowItem(
                  'customers',
                  PosGlyphs.peopleAltOutlined,
                  spanish ? 'Centro de clientes' : 'Customer center',
                ),
              if (access.showInventory && widget.inventory != null)
                _overflowItem(
                  'inventory',
                  PosGlyphs.inventory2Outlined,
                  spanish ? 'Inventario' : 'Inventory',
                ),
              if (permissions.allows('hardware.read') &&
                  widget.hardware != null)
                _overflowItem(
                  'hardware',
                  PosGlyphs.devicesOtherOutlined,
                  'Hardware',
                ),
              if (access.showRecovery)
                _overflowItem(
                  'recovery',
                  PosGlyphs.syncProblemOutlined,
                  AppLocalizations.of(context).recoveryCenterTitle,
                ),
              if (kDebugMode)
                _overflowItem(
                  'diagnostics',
                  PosGlyphs.policyOutlined,
                  spanish ? 'Diagnóstico' : 'Diagnostics',
                ),
            ],
          ),
        // Account — identity + Lock + Logout, consolidated.
        _AccountMenu(
          focusNode: _accountFocus,
          operatorName: widget.entry.operatorName,
          branch: widget.entry.state.selectedBranch?.name,
          onLock: () => _leaveOperator(lock: true),
          onLogout: () => _leaveOperator(lock: false),
        ),
      ],
    );
    return LayoutBuilder(
      builder: (context, box) {
        final size = Size(box.maxWidth, box.maxHeight);
        if (_lastOrderSize != size) {
          _lastOrderSize = size;
          if (_searchFocus.hasFocus) _revealSearch();
        }
        // A short working area needs one scroll, rather than a fixed toolbar
        // consuming the field's entire viewport. Keep the order trigger outside.
        final scrollHeader = box.maxHeight < 440 && _inlineDetail == null;
        final headerLayout = (
          size,
          compactHeader,
          largeText,
          scrollHeader,
          Localizations.localeOf(context),
        );
        if (_lastHeaderLayout != headerLayout) {
          _lastHeaderLayout = headerLayout;
          for (final node in [_newSaleFocus, _overflowFocus, _accountFocus]) {
            if (!node.hasPrimaryFocus) continue;
            WidgetsBinding.instance.addPostFrameCallback((_) {
              final target = node.context;
              if (mounted &&
                  target != null &&
                  target.mounted &&
                  node.canRequestFocus &&
                  (ModalRoute.of(context)?.isCurrent ?? true)) {
                node.requestFocus();
                Scrollable.ensureVisible(target);
              }
            });
          }
        }
        return PosPage(
          appBar: scrollHeader ? null : header,
          body: SafeArea(
            child: Column(
              children: [
                Expanded(
                  child: Padding(
                    padding: EdgeInsets.all(compactHeader ? UmiSpacing.md : 20),
                    child: _catalogBody(
                      context,
                      l,
                      state,
                      permissions,
                      canWriteCart,
                      compactHeader ? null : serviceRow,
                      scrollingHeader: scrollHeader ? header : null,
                    ),
                  ),
                ),
                if (orderButton != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: SizedBox(width: double.infinity, child: orderButton),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  /// The trading day the server put the cart the till is working on, which is the day
  /// the account list has to judge "today" by. Null before the first cart exists, and
  /// then the list falls back to its own 04:00 boundary.
  String? _currentBusinessDate() {
    final cart = widget.cart.state.cart;
    if (cart == null) return null;
    final date = TotalsPreview.fromJson(cart.totals).businessDate;
    return date.isEmpty ? null : date;
  }

  Widget _destinationPage(
    BuildContext context,
    AppLocalizations l,
    OperatorPermissions permissions,
    TillSurface selected,
  ) => switch (selected) {
    TillSurface.order => const SizedBox.shrink(),
    TillSurface.cash => CashCenter(
      controller: widget.cash,
      permissions: permissions,
      embedded: true,
      onHandoffCompleted: widget.entry.lock,
    ),
    TillSurface.sales => _saleCenter(permissions),
    TillSurface.tables =>
      widget.cart.supportsOpenAccounts && permissions.allows('cart.write')
          ? AccountsWorkspace(
              notice: _notice,
              watchedAccount: _noticeCode == 'CART_ACCOUNT_BUSY'
                  ? _blockedAccount
                  : null,
              readAccount: (account) => widget.cart.readAccount(
                account,
                widget.entry.state.operator!.id,
              ),
              onAccountReleased: () {
                if (!mounted || _noticeCode != 'CART_ACCOUNT_BUSY') return;
                setState(() {
                  _blockedAccount = null;
                  _notice = null;
                  _noticeCode = null;
                  _noticeDetails = null;
                });
              },
              withoutTable: _accountsWithoutTable,
              onViewChanged: (value) =>
                  setState(() => _accountsWithoutTable = value),
              load: () async {
                final accounts = await widget.cart.openAccounts(
                  widget.entry.state.selectedTenant!.id,
                  widget.entry.state.selectedBranch!.id,
                  widget.entry.state.operator!.id,
                );
                if (mounted) {
                  setState(() => _openAccountCount = accounts.length);
                }
                return accounts;
              },
              onSelected: (account) => unawaited(_resumeAccount(account)),
              onCancelCarriedOver: permissions.allows('sale.lifecycle')
                  ? widget.sales.cancelCarriedOver
                  : null,
              onDismissNotice: () {
                if (!mounted) return;
                setState(() {
                  _notice = null;
                  _noticeCode = null;
                  _noticeDetails = null;
                });
              },
              // The workspace offers the same action as the top bar, so it stands
              // down on the same bare account. The tile is what hides here: a
              // disabled "Nueva cuenta sin mesa" beside an empty account that is
              // already on screen says less than its absence does.
              onNewAccount: _canStartNewAccount
                  ? () => unawaited(_newSale(context))
                  : null,
              busy: _accountTransition,
              currentBusinessDate: _currentBusinessDate(),
              tables: FloorPlanSurface(
                controller: widget.floorPlan!,
                entry: widget.entry,
                tableState: widget.tableState,
                embedded: true,
                directAccounts: true,
                onOpenAccount: _openTableAccount,
                onOpenTemporaryAccount: permissions.allows('cart.write')
                    ? _openTemporaryAccount
                    : null,
                onSetUpTables: () => unawaited(_createFirstTableAccount()),
              ),
            )
          : FloorPlanSurface(
              controller: widget.floorPlan!,
              entry: widget.entry,
              tableState: widget.tableState,
              embedded: true,
            ),
    TillSurface.kitchen => KitchenBoardSurface(
      controller: widget.kitchenBoard!,
      entry: widget.entry,
      connectivity: widget.connectivity,
      embedded: true,
    ),
    TillSurface.orders => IncomingOrdersSurface(
      incoming: widget.incomingOrders!,
      cart: widget.cart,
      merchantId: widget.entry.state.selectedTenant!.id,
      locationId: widget.entry.state.selectedBranch!.id,
      operatorSessionId: widget.entry.state.operator!.id,
      embedded: true,
      onAdopted: () => setState(() => _setSection(TillSurface.order)),
    ),
    TillSurface.settings => DisplaySettingsSurface(
      embedded: true,
      onLock: () => _leaveOperator(lock: true),
      onLogout: () => _leaveOperator(lock: false),
    ),
  };

  Widget? _primaryNav(
    BuildContext context,
    bool spanish,
    List<TillSurface> surfaces,
    TillSurface selected,
  ) {
    if (surfaces.length < 2) return null;
    return PosNavigation(
      selectedIndex: surfaces.indexOf(selected).clamp(0, surfaces.length - 1),
      onDestinationSelected: (index) {
        if (surfaces[index] == selected) return;
        FocusManager.instance.primaryFocus?.unfocus();
        setState(() {
          _cashVisited =
              _cashVisited ||
              selected == TillSurface.cash ||
              surfaces[index] == TillSurface.cash;
          _setSection(surfaces[index]);
        });
      },
      destinations: [
        for (final surface in surfaces)
          switch (surface) {
            TillSurface.order => PosDestination(
              key: ValueKey(surface),
              icon: const PosIcon(PosGlyphs.receiptLongOutlined),
              label: spanish ? 'Comanda' : 'Order',
            ),
            TillSurface.cash => PosDestination(
              key: ValueKey(surface),
              icon: PosBadge(
                isLabelVisible: widget.cash.activeShiftId == null,
                child: const PosIcon(PosGlyphs.pointOfSaleOutlined),
              ),
              label: spanish ? 'Caja' : 'Cash',
            ),
            TillSurface.sales => PosDestination(
              key: ValueKey(surface),
              icon: const PosIcon(PosGlyphs.receiptOutlined),
              label: spanish ? 'Ventas' : 'Sales',
            ),
            TillSurface.tables => PosDestination(
              key: ValueKey(surface),
              icon: PosBadge.count(
                count: _openAccountCount,
                isLabelVisible: _openAccountCount > 0,
                child: const PosIcon(PosGlyphs.tableRestaurantOutlined),
              ),
              label:
                  widget.cart.supportsOpenAccounts &&
                      OperatorPermissions(
                        widget.entry.state.operator?.permissions ?? const [],
                      ).allows('cart.write')
                  ? (spanish ? 'Cuentas' : 'Accounts')
                  : (spanish ? 'Mesas' : 'Tables'),
            ),
            TillSurface.kitchen => PosDestination(
              key: ValueKey(surface),
              icon: const PosIcon(PosGlyphs.restaurantMenuOutlined),
              label: AppLocalizations.of(context).kitchenBoardTitle,
            ),
            TillSurface.orders => PosDestination(
              key: ValueKey(surface),
              icon: const PosIcon(PosGlyphs.inboxOutlined),
              label: spanish ? 'Pedidos' : 'Orders',
            ),
            TillSurface.settings => PosDestination(
              key: ValueKey(surface),
              icon: const PosIcon(PosGlyphs.tuneOutlined),
              label: spanish ? 'Ajustes' : 'Settings',
            ),
          },
      ],
    );
  }

  /// The menu is the workspace; the order is a document to its right. The
  /// category index retains its position across widths and the order docks on
  /// narrow devices. One detail owner survives every layout change.
  Widget _catalogBody(
    BuildContext context,
    AppLocalizations l,
    CatalogState state,
    OperatorPermissions permissions,
    bool canWriteCart,
    Widget? serviceType, {
    Widget? scrollingHeader,
  }) {
    final keyboard = MediaQuery.viewInsetsOf(context).bottom > 0;
    final wide = MediaQuery.sizeOf(context).width >= 900;
    final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
    final search = Builder(
      key: _searchAnchor,
      builder: (context) => PosField(
        key: const ValueKey('hardware-barcode-search'),
        controller: _search,
        focusNode: _searchFocus,
        onChanged: (value) {
          widget.catalog.search(value);
          setState(() {});
        },
        decoration: PosFieldDecoration(
          prefixIcon: const PosIcon(PosGlyphs.search),
          hintText: l.catalogSearchHint,
          suffixIcon: _search.text.isEmpty
              ? null
              : PosIconButton(
                  onPressed: () {
                    _search.clear();
                    widget.catalog.search('');
                    setState(() {});
                  },
                  icon: const PosIcon(PosGlyphs.clear),
                ),
        ),
      ),
    );
    final frequent = !keyboard && _frequentTop.isNotEmpty && canWriteCart
        ? _FrequentRail(
            products: _frequentTop,
            onTap: (id) => _showDetail(id, canWrite: canWriteCart),
          )
        : null;
    final categories = _CategoryTabs(
      textScale: textScale,
      tabs: [
        _CategoryTab(
          label: l.allCategories,
          color: PosTheme.of(context).colorScheme.primary,
          selected: state.selectedCategoryId == null,
          onTap: () => widget.catalog.selectCategory(null),
        ),
        ...state.categories.map(
          (category) => _CategoryTab(
            label: category.name,
            color: _ProductPlaceholder.categoryColor(category, category.name),
            selected: state.selectedCategoryId == category.id,
            onTap: category.enabled
                ? () => widget.catalog.selectCategory(category.id)
                : null,
          ),
        ),
      ],
    );
    final scrollingProducts = scrollingHeader == null
        ? null
        : _content(
            context,
            state,
            scrollHeaders: [
              scrollingHeader,
              const SizedBox(height: 8),
              search,
              if (!keyboard) ...[const SizedBox(height: 8), categories],
              if (frequent != null) ...[const SizedBox(height: 8), frequent],
              const SizedBox(height: 8),
            ],
          );
    final productPane = Column(
      children: [
        LayoutBuilder(
          builder: (context, box) {
            final showHeading =
                !keyboard && box.maxWidth >= 650 && textScale < 1.5;
            if (!showHeading) return search;
            return Row(
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    Localizations.localeOf(context).languageCode == 'es'
                        ? 'La carta'
                        : 'The menu',
                    style: PosTheme.of(
                      context,
                    ).textTheme.headlineMedium!.copyWith(fontSize: 32),
                  ),
                ),
                const SizedBox(width: 24),
                Expanded(child: search),
              ],
            );
          },
        ),
        const SizedBox(height: 8),
        categories,
        if (frequent != null) ...[const SizedBox(height: 12), frequent],
        const SizedBox(height: 12),
        Expanded(child: _content(context, state)),
      ],
    );

    // Read the selection once. The closures below outlive the frame that built
    // them — the add awaits the API before it reports back — so dereferencing
    // the mutable field inside them crashed the add when the pane had already
    // been cleared.
    final inlineDetail = _inlineDetail;
    final inlineDetailItem = _inlineDetailItem;
    final detailPane = inlineDetail == null
        ? null
        : _Detail(
            inlineDetail,
            key: _detailKey,
            cart: widget.cart,
            addProduct: _addProduct,
            canWrite: canWriteCart,
            item: inlineDetailItem,
            onRecord: inlineDetailItem == null
                ? () => _recordFrequent(
                    inlineDetail.id,
                    inlineDetail.name,
                    inlineDetail.price,
                  )
                : null,
            onClose: () => setState(() {
              _inlineDetail = null;
              _inlineDetailItem = null;
            }),
          );

    if (!wide) {
      if (detailPane != null) return detailPane;
      if (scrollingProducts != null) return scrollingProducts;
      if (textScale >= 1.5) {
        return _content(
          context,
          state,
          scrollHeaders: [
            search,
            if (!keyboard) ...[
              const SizedBox(height: UmiSpacing.sm),
              categories,
            ],
            if (frequent != null) ...[
              const SizedBox(height: UmiSpacing.sm),
              frequent,
            ],
            const SizedBox(height: UmiSpacing.sm),
          ],
        );
      }
      return Column(
        children: [
          search,
          if (frequent != null) ...[
            const SizedBox(height: UmiSpacing.md),
            frequent,
          ],
          if (!keyboard) ...[const SizedBox(height: UmiSpacing.md), categories],
          const SizedBox(height: UmiSpacing.sm),
          Expanded(child: _content(context, state)),
        ],
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: detailPane ?? scrollingProducts ?? productPane),
        const SizedBox(width: 24),
        SizedBox(
          width: MediaQuery.sizeOf(context).width >= 1440 ? 380 : 344,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (serviceType != null) ...[
                serviceType,
                const SizedBox(height: 12),
              ],
              Expanded(
                child: _CartPanel(
                  controller: widget.cart,
                  restoringAccount: _restoringAccount,
                  onNewSale: () => _newSale(context),
                  lineStatuses: _currentLineStatuses,
                  checkout: widget.checkout,
                  cash: widget.cash,
                  entry: widget.entry,
                  permissions: permissions,
                  sales: widget.sales,
                  customerValue: widget.customerValue,
                  deviceChannel: widget.deviceChannel,
                  onPrint: _receiptPrinter,
                  orderType: _orderType,
                  beforeCheckout: _prepareCheckout,
                  beforeFire: _mobileDevice ? _prepareCheckout : null,
                  onAssignTable:
                      canWriteCart &&
                          widget.cart.supportsAccountDetails &&
                          widget.floorPlan != null
                      ? _assignAccountTable
                      : null,
                  onSave:
                      canWriteCart &&
                          widget.cart.supportsOpenAccounts &&
                          _editingAccount
                      ? _saveAccount
                      : null,
                  onEdit: (item) => _showDetail(
                    item.productId,
                    item: item,
                    canWrite: canWriteCart,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  /// Print this sale's receipt on this till — the ONE place both screens come
  /// through.
  ///
  /// The sale's completion screen ("Ver comprobante") and Ventas ("Abrir recibo")
  /// show the same dialog, so they must be able to print the same way. Building the
  /// hardware scope twice is how the two would drift: a session id read from
  /// different state, a register that one of them forgot. There is one scope, and it
  /// is the one the till is already using to charge.
  ///
  /// The paper is a DUPLICATE by the time this runs — what the sale printed is the
  /// original — and the server decides the rest: an official print already on file
  /// becomes a controlled reprint marked COPIA.
  /// The print request both screens share, or null when this till has no hardware
  /// service (a desktop/dev run) — the dialog then shows no print button at all,
  /// which is the honest state.
  ReceiptPrintRequest? get _receiptPrinter =>
      widget.hardware == null ? null : _printReceipt;

  Future<void> _printReceipt(
    String receiptId,
    Map<String, Object?> receiptSnapshot,
  ) async {
    final hardware = widget.hardware;
    if (hardware == null) {
      throw StateError('HARDWARE_RECEIPT_PRINTER_UNAVAILABLE');
    }
    final entry = widget.entry.state;
    await hardware.printAuthoritativeReceipt(
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
      receiptSnapshot: receiptSnapshot,
    );
  }

  Widget _saleCenter(OperatorPermissions permissions, {bool active = true}) =>
      SaleCenterSurface(
        active: active,
        lifecycle: widget.sales,
        permissions: permissions,
        exceptions: widget.exceptions,
        embedded: true,
        onResumed: () => setState(() => _setSection(TillSurface.order)),
        onPrint: _receiptPrinter,
        onKitchenStatus: widget.kitchenStatus == null
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
    await showPosDialog<void>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(
          spanish ? 'Diagnóstico de autorización' : 'Authorization diagnostics',
        ),
        content: PosSelectableText(
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
          PosTextButton(
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
    final permissions = OperatorPermissions(
      widget.entry.state.operator?.permissions ?? const [],
    );
    final safe = await widget.sales.prepareForOperatorExit(
      useCartAuthority: !permissions.allows('sale.lifecycle'),
    );
    if (!mounted) return;
    if (!safe) {
      // The open sale could not be parked. Locking is meant to preserve it, so
      // for a possibly-recoverable failure keep the operator here and let them
      // retry. But never trap them: logging out ALWAYS proceeds, and even a
      // lock falls through when the operator has lost authority over the sale
      // (their session was ended server-side, e.g. after a role change) —
      // there is nothing left to preserve and nothing they can do here.
      final code = widget.sales.state.errorCode;
      // Same vocabulary as `_reauthIfSessionLost`: a dead session answers 401, so a 403 is
      // never read as "authority lost". Letting a 403 fall through to the logout would
      // abandon an open sale for a role gap that has nothing to do with the sale.
      final authorityLost =
          code == 'AUTHENTICATION_REQUIRED' ||
          code == 'OPERATOR_SESSION_ENDED' ||
          code == 'UNAUTHORIZED';
      if (lock && !authorityLost) {
        _leaving = false;
        setState(
          () => _notice = AppLocalizations.of(context).saleLifecycleError,
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
      deviceId: device.id,
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

  Future<void> _recoverInBackground() async {
    try {
      await _recover();
    } on AppException catch (error) {
      // Recovery is durable work, not a prerequisite for opening the menu.
      // Keep its transport signal honest without replacing the till with an
      // unrelated failure while the queue retries from the journal.
      if (error.category == AppErrorCategory.transport ||
          error.category == AppErrorCategory.timeout) {
        widget.connectivity.apiFailure();
      } else {
        widget.connectivity.apiReachable(authorityValid: true);
      }
    } catch (_) {
      // The recovery centre owns the actionable failure state.
    } finally {
      unawaited(_refreshOpenAccountCount());
    }
  }

  Future<void> _recover() async {
    final scope = _scope();
    if (scope == null) return;
    // `offline/replay/begin` needs `offline.replay`. It used to run on every
    // start, so a role without the permission threw here and the catch reported
    // the network as unstable — a startup dependency disguised as an offline
    // permission (plan §2.1). The call follows the permission now; a role that
    // needs recovery reaches it on purpose from the recovery centre.
    final permissions = OperatorPermissions(
      widget.entry.state.operator?.permissions ?? const [],
    );
    if (!permissions.allows('offline.replay')) return;
    await widget.offlineRecovery?.recover(scope);
  }

  Widget _content(
    BuildContext context,
    CatalogState state, {
    List<Widget> scrollHeaders = const [],
  }) {
    final l = AppLocalizations.of(context);
    final body = switch (state.phase) {
      CatalogPhase.idle ||
      CatalogPhase.loading => _Skeleton(label: l.catalogLoading),
      CatalogPhase.empty => _Message(
        l.catalogEmpty,
        PosGlyphs.inventory2Outlined,
        widget.catalog.refresh,
      ),
      CatalogPhase.noResults => _Message(
        l.catalogNoResults,
        PosGlyphs.searchOff,
        null,
      ),
      CatalogPhase.permissionDenied => _Message(
        l.catalogPermissionDenied,
        PosGlyphs.lockOutline,
        null,
      ),
      CatalogPhase.networkFailure => _Message(
        l.catalogNetworkError,
        PosGlyphs.cloudOff,
        widget.catalog.refresh,
      ),
      CatalogPhase.failure => _Message(
        l.catalogUnexpectedError,
        PosGlyphs.errorOutline,
        widget.catalog.refresh,
      ),
      CatalogPhase.ready => LayoutBuilder(
        builder: (context, size) {
          final textScale = MediaQuery.textScalerOf(context).scale(16) / 16;
          final window = MediaQuery.sizeOf(context);
          final shortLandscape = window.width >= 900 && window.height < 650;
          final columns = textScale < 1.5
              ? (size.maxWidth / (shortLandscape ? 240 : 180)).floor().clamp(
                  2,
                  7,
                )
              : (size.maxWidth / (180 * textScale)).floor().clamp(1, 7);
          // Keep the barista's fast path to sellable café items (audit F8):
          // a zero-price product (space rental, placeholders) cannot be
          // charged, so it does not belong in the sale grid.
          final products = state.products
              .where(
                (product) =>
                    CatalogMoney.fromJson(product.price).minorUnits > 0,
              )
              .toList(growable: false);
          final gridDelegate = SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            mainAxisExtent:
                (shortLandscape
                    ? 108
                    : window.shortestSide < 650
                    ? 168
                    : 206) +
                124 * (textScale - 1).clamp(0, 3),
          );
          Widget itemBuilder(BuildContext context, int index) =>
              index == products.length
              ? const Center(child: PosSpinner())
              : _ProductCard(
                  compact: shortLandscape,
                  product: products[index],
                  onTap: () => products[index].availability == 'enabled'
                      ? _showDetail(
                          products[index].id,
                          summary: products[index],
                          canWrite: OperatorPermissions(
                            widget.entry.state.operator?.permissions ??
                                const [],
                          ).allows('cart.write'),
                        )
                      : _refuseUnavailable(products[index].name),
                );
          final count = products.length + (state.loadingMore ? 1 : 0);
          if (scrollHeaders.isNotEmpty) {
            return CustomScrollView(
              key: const PageStorageKey('catalog-grid'),
              controller: _scroll,
              slivers: [
                for (final header in scrollHeaders)
                  SliverToBoxAdapter(child: header),
                SliverGrid(
                  gridDelegate: gridDelegate,
                  delegate: SliverChildBuilderDelegate(
                    itemBuilder,
                    childCount: count,
                  ),
                ),
              ],
            );
          }
          return GridView.builder(
            key: const PageStorageKey('catalog-grid'),
            controller: _scroll,
            itemCount: count,
            gridDelegate: gridDelegate,
            itemBuilder: itemBuilder,
          );
        },
      ),
    };
    final content =
        scrollHeaders.isNotEmpty && state.phase != CatalogPhase.ready
        ? CustomScrollView(
            slivers: [
              for (final header in scrollHeaders)
                SliverToBoxAdapter(child: header),
              SliverFillRemaining(hasScrollBody: true, child: body),
            ],
          )
        : body;
    final notice = _notice;
    if (notice == null) return content;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: UmiSpacing.sm),
          child: InlineNotice(message: notice),
        ),
        Expanded(child: content),
      ],
    );
  }

  Future<void> _showDetail(
    String id, {
    CartItem? item,
    CatalogProductSummary? summary,
    bool? canWrite,
    int? scanGeneration,
  }) async {
    if (_menuTapSuppressed) return;
    try {
      if (item == null && !await _prepareMobileOrder()) return;
      if (!mounted) return;
      if (item == null &&
          summary != null &&
          !summary.hasVariants &&
          !summary.hasModifiers) {
        final permitted =
            canWrite ??
            OperatorPermissions(
              widget.entry.state.operator?.permissions ?? const [],
            ).allows('cart.write');
        if (!permitted) {
          _refuseCartWrite();
          return;
        }
        final added = await _addProduct(
          productId: summary.id,
          provisional: ProvisionalLine.fromSummary(product: summary),
        );
        if (!added) {
          _refuseCartWrite();
          return;
        }
        _recordFrequent(summary.id, summary.name, summary.price);
        return;
      }
      final detail = await widget.catalog.detail(id);
      if (!mounted ||
          (scanGeneration != null && !_scanCurrent(scanGeneration))) {
        return;
      }
      // The menu draws this product as unavailable, and the server refuses its line.
      // Refusing here too keeps the two answers the same one: a tap on a card the
      // barista can see is dimmed never reaches a sheet whose save button cannot work.
      if (detail.availability != 'enabled') {
        _refuseUnavailable(detail.name);
        return;
      }
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
        final added = await _addProduct(
          productId: detail.id,
          provisional: ProvisionalLine.fromSelection(product: detail),
        );
        if (!added) {
          _refuseCartWrite();
          return;
        }
        _recordFrequent(detail.id, detail.name, detail.price);
        return;
      }
      setState(() {
        _inlineDetail = detail;
        _inlineDetailItem = item;
        _detailKey = GlobalKey<_DetailState>();
      });
    } on AppException catch (error) {
      if (!mounted) return;
      // The detail fetch is authorized against the operator session, so a lost
      // session shows up here too — bounce to the PIN instead of a dead-end
      // "catalog unavailable" toast.
      if (_reauthIfSessionLost(error.code)) return;
      // No answer is not a broken catalogue. The grid is being served from the
      // till's own copy, and the only thing missing is this one product's
      // options — which were never fetched on this terminal. Say that, instead
      // of painting "the catalogue is unavailable" over a menu that is right in
      // front of the operator.
      final offline =
          error.category == AppErrorCategory.transport ||
          error.category == AppErrorCategory.timeout ||
          error.category == AppErrorCategory.server;
      if (offline) {
        final spanish = Localizations.localeOf(context).languageCode == 'es';
        setState(
          () => _notice = spanish
              ? 'Sin conexión: las opciones de este producto aún no están guardadas en esta terminal.'
              : 'Offline: this product’s options are not saved on this terminal yet.',
        );
        return;
      }
      setState(
        () => _notice = AppLocalizations.of(context).catalogUnexpectedError,
      );
    } catch (_) {
      if (mounted) {
        setState(
          () => _notice = AppLocalizations.of(context).catalogUnexpectedError,
        );
      }
    }
  }
}

PosMenuItem<String> _overflowItem(String value, PosGlyph icon, String label) =>
    PosMenuItem<String>(
      value: value,
      child: Row(
        children: [
          PosIcon(icon, size: 20),
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
    this.focusNode,
    this.compact = false,
  });
  final PosGlyph icon;
  final String label;

  final VoidCallback onPressed;
  final FocusNode? focusNode;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 2),
      child: PosIconButton(
        onPressed: onPressed,
        focusNode: focusNode,
        tooltip: label,
        style: PosIconButton.styleFrom(
          foregroundColor: palette.onSurface,
          minimumSize: const Size(0, UmiTouchTarget.minimum),
          padding: compact
              ? const EdgeInsets.all(12)
              : const EdgeInsets.symmetric(
                  horizontal: UmiSpacing.md,
                  vertical: 12,
                ),
        ),
        icon: compact
            ? PosIcon(icon)
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  PosIcon(icon, size: 20),
                  const SizedBox(width: 8),
                  Text(label, style: theme.textTheme.labelLarge),
                ],
              ),
      ),
    );
  }
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
    this.focusNode,
  });
  final String? operatorName;
  final String? branch;
  final VoidCallback onLock;
  final VoidCallback onLogout;
  final FocusNode? focusNode;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    return PosMenuButton<String>(
      tooltip: spanish ? 'Cuenta' : 'Account',
      focusNode: focusNode,
      onSelected: (value) {
        if (value == 'lock') {
          onLock();
        } else if (value == 'logout') {
          onLogout();
        }
      },
      itemBuilder: (_) => [
        if (operatorName != null || branch != null) ...[
          PosMenuItem<String>(
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
          const PosMenuDivider(),
        ],
        PosMenuItem<String>(
          value: 'lock',
          child: Row(
            children: [
              const PosIcon(PosGlyphs.lockOutline, size: 20),
              const SizedBox(width: UmiSpacing.md),
              Text(l.lockAction),
            ],
          ),
        ),
        PosMenuItem<String>(
          value: 'logout',
          child: Row(
            children: [
              const PosIcon(PosGlyphs.logout, size: 20),
              const SizedBox(width: UmiSpacing.md),
              Text(l.logoutAction),
            ],
          ),
        ),
      ],
      // The row is what the operator aims at, so the row carries the floor.
      // (`PosMenuButton`'s own `tapTargetSize` route drops the
      // `aria-expanded` wrapper when it is padded, so the size lives here.)
      child: SizedBox(
        height: UmiTouchTarget.minimum,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const PosIcon(PosGlyphs.accountCircleOutlined),
              if (MediaQuery.sizeOf(context).width >= 800) ...[
                const SizedBox(width: UmiSpacing.sm),
                Text(
                  operatorName ?? branch ?? '—',
                  style: theme.textTheme.titleSmall,
                ),
                const PosIcon(PosGlyphs.arrowDropDown),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The slant of a folder ear's side, in logical pixels.
const _folderSlant = 10.0;

/// The radius of the ear's top corners.
const _folderRadius = 7.0;

/// The owner's proportions for the category tabs: 20% wider and 20% shorter than
/// the first pass, so the row reads as a flatter strip of dividers across the top
/// of the menu.
///
/// Two named factors rather than new numbers, because these are a proportion of a
/// shape the operator reads — the next adjustment is a conversation about the
/// proportion, not about a magic `45.6`. The label keeps its own size (the design
/// system owns type) and gains the room the wider ear gives it.
const _folderWidthFactor = 1.2;
const _folderHeightFactor = 0.8;

/// The extra height of the open ear, which stands in front of the others.
const _folderFront = 5.0 * _folderHeightFactor;

/// How far an ear tucks under the ear before it. This is what stacks the row.
const _folderOverlap = 18.0;

/// The room a label keeps to its left and to its right. The room on the left
/// clears the ear in front of it, so a covered label stays readable.
const _folderLead = 36.0;
const _folderTrail = 24.0;

/// The height of an ear. It grows with the text. The ear is the shape an
/// operator reads; the finger gets the taller box behind it, so the ear can
/// stay low without taking the till's touch floor with it.
double _folderEar(double textScale) =>
    (38 + 20 * (textScale - 1).clamp(0, 3)) * _folderHeightFactor;

/// HOW FAR A DIVIDER LIFTS OFF THE ONE BEHIND IT, in logical pixels.
///
/// The folder illusion is a stack, and a stack with no shadow reads as flat
/// colour: every divider covers its right-hand neighbour edge to edge, so nothing
/// says which one is in front except the overlap itself. A short shadow under each
/// ear — drawn from the same path it fills, so it follows the trapezoid and its
/// rounded corners — is what the metaphor was missing, and it is also what makes
/// the OPEN divider read as lifted out of the row.
const _folderShadowLift = 3.0;

/// THE BAND ACROSS THE TOP OF THE OPEN DIVIDER, in logical pixels.
///
/// The open divider has been marked three ways before this one: a 2 px outline in its
/// colour (a frame, not a divider), then a glow of the same colour behind it (light
/// that also fell onto the menu), and now a band along its own top edge. The band
/// says which one is open in the place a person looks for it — the edge — and it
/// costs the menu nothing: it is painted inside the shape, so it cannot spill.
const _folderStripHeight = 4.0;

/// The room a label keeps inside the ear it is drawn in, at the owner's wider
/// proportion. The shape is stretched as a whole — insets and box together — so
/// the label sits in it exactly where it sat before, with more ear around it.
const _folderLeadWide = _folderLead * _folderWidthFactor;
const _folderTrailWide = _folderTrail * _folderWidthFactor;

/// One divider of the folder: the category an operator can open.
final class _CategoryTab {
  const _CategoryTab({
    required this.label,
    required this.color,
    required this.selected,
    this.onTap,
  });
  final String label;
  final Color color;
  final bool selected;
  final VoidCallback? onTap;

  /// The label as the operator reads it on the divider.
  ///
  /// The owner asked for the category index in capitals: the row is an index of
  /// dividers, not a sentence, and capitals are what a folder tab wears. The
  /// category keeps the name it arrived with, so the screen reader still reads
  /// the word as it was written and every lookup by name still matches.
  String get displayLabel => label.toUpperCase();
}

/// The category index, drawn as the stacked tabs of a file folder.
///
/// Every ear is a trapezoid that tucks under the ear before it, so the row
/// reads as one divider behind another instead of a line of separate buttons.
/// Each ear keeps its category's own colour at full strength. The open one is
/// the divider the menu is open at, and it shows that by standing in front of
/// its neighbours, taller, on the paper of the panel: the fold line runs under
/// every other ear and stops where the menu is open.
final class _CategoryTabs extends StatelessWidget {
  const _CategoryTabs({required this.tabs, required this.textScale});
  final List<_CategoryTab> tabs;
  final double textScale;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final p = theme.colorScheme;
    final ear = _folderEar(textScale);
    // The finger aims at the box, which keeps the till's touch floor whatever
    // the ear measures. The strip gives the tallest box its room.
    final touch = math.max(UmiTouchTarget.minimum, ear + _folderFront);
    final strip = touch + 1;
    // A stack has to know where each ear starts, and a position needs a width.
    // The label is measured in the style it is drawn in — the open one is bold
    // — so no label is ever cut short by its own ear.
    final widths = [
      for (final tab in tabs)
        // A tab is 20% wider than the label needs: the label keeps its size and the
        // ear gains the room, which is what makes the row read as wider dividers
        // rather than as more text.
        (_labelWidth(context, theme.textTheme.labelLarge!, tab) +
                _folderLead +
                _folderTrail) *
            _folderWidthFactor,
    ];
    final starts = <double>[];
    var travelled = 0.0;
    for (final width in widths) {
      starts.add(travelled);
      travelled += width - _folderOverlap;
    }
    final content = tabs.isEmpty ? 0.0 : travelled + _folderOverlap;
    // Every ear covers the ear to its right, so the stack recedes to the right
    // the way a folder does. The open one paints last: it stands in front of
    // both of its neighbours, and the menu reads as open at that divider.
    final order = [
      for (var index = tabs.length - 1; index >= 0; index--)
        if (!tabs[index].selected) index,
      for (var index = tabs.length - 1; index >= 0; index--)
        if (tabs[index].selected) index,
    ];
    return LayoutBuilder(
      builder: (context, box) {
        final viewport = box.maxWidth.isFinite ? box.maxWidth : content;
        return SizedBox(
          height: strip,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SizedBox(
              width: math.max(content, viewport),
              height: strip,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  for (final index in order)
                    Positioned(
                      left: starts[index],
                      // Half a pixel puts the ear's own base line on the same
                      // pixel row as the line that follows the last ear.
                      bottom: .5,
                      child: _CategoryEar(
                        tab: tabs[index],
                        width: widths[index],
                        box: touch,
                        ear: ear + (tabs[index].selected ? _folderFront : 0),
                      ),
                    ),
                  // The edge of the folder, from the last ear to the end of the
                  // panel. The open ear covers its own part of this line.
                  Positioned(
                    left: content,
                    right: 0,
                    bottom: 0,
                    height: 1,
                    child: ColoredBox(color: p.outlineVariant),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  /// The width a label needs in the style it is drawn in.
  static double _labelWidth(
    BuildContext context,
    TextStyle style,
    _CategoryTab tab,
  ) {
    final painter = TextPainter(
      text: TextSpan(
        text: tab.displayLabel,
        style: style.copyWith(fontWeight: FontWeight.w700),
      ),
      textDirection: Directionality.of(context),
      textScaler: MediaQuery.textScalerOf(context),
      maxLines: 1,
    )..layout();
    final width = painter.width;
    painter.dispose();
    // A pixel of slack absorbs a rounding difference, so the label is never
    // elided by its own ear.
    return width.ceilToDouble() + 2;
  }
}

/// The ear of one divider.
final class _CategoryEar extends StatelessWidget {
  const _CategoryEar({
    required this.tab,
    required this.width,
    required this.box,
    required this.ear,
  });
  final _CategoryTab tab;
  final double width;

  /// The room the finger gets.
  final double box;

  /// The height of the shape itself, measured from the fold line up.
  final double ear;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final p = theme.colorScheme;
    final open = tab.selected;
    final enabled = tab.onTap != null;
    // THE COLOUR AT FULL STRENGTH, AND THE OPEN DIVIDER IS THE PANEL'S PAPER.
    //
    // A closed divider used to be the category's colour blended 20% toward white,
    // and that tint is what made dark ink the only readable choice — a tint cannot
    // carry white. The owner asked for white labels, and the two go together: the
    // fill has to be the colour the owner chose (which is also what this class has
    // claimed all along: "each ear keeps its category's own colour at full
    // strength"). The dark palette already used the full colour, so this also makes
    // the two palettes agree.
    //
    // Midnight keeps the exact category colour in a band. Neutral surfaces carry
    // the text. The open divider still joins the panel below it.
    final fill = !enabled
        ? p.surfaceContainerHighest
        : open
        ? p.background
        : p.midnight
        ? p.surfaceContainerHighest
        : tab.color;
    final ink = !enabled
        ? p.onSurfaceVariant
        : open || p.midnight
        ? p.onSurface
        : PosColors.white;
    return PosTapRegion(
      selected: open,
      semanticLabel: tab.label,
      onTap: tab.onTap,
      borderRadius: const BorderRadius.vertical(
        top: Radius.circular(_folderRadius),
      ),
      child: SizedBox(
        width: width,
        height: box,
        child: CustomPaint(
          painter: _FolderEarPainter(
            fill: fill,
            // The ink of the theme at low alpha: a shadow is a darker version of
            // what it falls on, and the palette owns both the paper and the ink.
            shadow: p.midnight
                ? PosColors.transparent
                : p.onSurface.withValues(alpha: p.dark ? .34 : .20),
            // Midnight shows the category band on each enabled divider.
            strip: (open || p.midnight) && enabled ? tab.color : null,
            line: p.outlineVariant,
            // The shape stands on the fold line, in the lower part of the box.
            height: ear,
            // The open ear is the divider the menu is open at: it covers the
            // fold line and joins the panel, and the others keep the line
            // under them.
            base: !open,
            merge: open ? 2 : 0,
          ),
          child: Padding(
            padding: const EdgeInsets.only(
              // The wider insets, so the label keeps its place in a tab that grew.
              left: _folderLeadWide,
              right: _folderTrailWide,
              bottom: 7,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Text(
                  tab.displayLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.labelLarge!.copyWith(
                    color: ink,
                    // 600 × 1.15 rounds to the bundled Bold face (700).
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The shape of one ear: a trapezoid that is narrower at its top, with the
/// slanted sides of a folder divider and rounded top corners.
final class _FolderEarPainter extends CustomPainter {
  const _FolderEarPainter({
    required this.fill,
    required this.shadow,
    required this.strip,
    required this.line,
    required this.height,
    required this.base,
    required this.merge,
  });
  final Color fill;

  /// The colour the ear casts on whatever is behind it. See `_folderShadowLift`.
  final Color shadow;

  /// The open divider's own colour, as the band along its top edge. Null for every
  /// closed ear. See `_folderStripHeight`.
  final Color? strip;

  /// The colour of the folder's own edge.
  final Color line;

  /// The height of the shape, measured from the bottom of the box up.
  final double height;

  /// True while the ear keeps the fold line under it.
  final bool base;

  /// How far the fill reaches below the ear, to cover the fold line.
  final double merge;

  @override
  void paint(Canvas canvas, Size size) {
    // LIGHT AROUND THE DIVIDER, AND NOTHING BELOW THE FOLD.
    //
    // The shadow and the glow go down first, from the SAME path the fill uses, so
    // both follow the trapezoid and its rounded corners — and the divider that
    // paints later (the open one, last of all) drops its own light on the
    // neighbours it covers on both sides.
    //
    // BOTH ARE CUT AT THE FOLD LINE, and that is the point of the clip. A blur of
    // the whole path bleeds downward past the divider's own base, where it is no
    // longer depth or a halo: it is a dark smudge or a coloured one lying ON the
    // menu the divider has just opened. The one edge of this shape that has to meet
    // the panel cleanly is the bottom one, so the clip ends exactly where the panel
    // begins; the top and both slants keep their shadow and their glow.
    canvas.save();
    canvas.clipRect(Rect.fromLTWH(0, 0, size.width, size.height));
    canvas.drawShadow(
      _ear(size, merge: merge),
      shadow,
      _folderShadowLift,
      false,
    );
    canvas.restore();
    // The fill is NOT clipped: the shape reaches below the fold line by `merge` so
    // it covers its own part of the line, and that is the divider joining the panel.
    canvas.drawPath(
      _ear(size, merge: merge),
      Paint()
        ..style = PaintingStyle.fill
        ..color = fill,
    );
    // THE BAND IS PAINTED INSIDE THE SHAPE, so it follows the trapezoid's top edge
    // and its rounded corners exactly, and it stops at the slants instead of
    // running past them. Clipping is the whole trick: a rectangle drawn on top would
    // be a rectangle.
    if (strip case final Color colour) {
      canvas.save();
      canvas.clipPath(_ear(size, merge: merge));
      canvas.drawRect(
        Rect.fromLTWH(0, size.height - height, size.width, _folderStripHeight),
        Paint()
          ..style = PaintingStyle.fill
          ..color = colour,
      );
      canvas.restore();
    }
    if (base) {
      canvas.drawLine(
        Offset(0, size.height),
        Offset(size.width, size.height),
        Paint()
          ..color = line
          ..strokeWidth = 1,
      );
    }
  }

  /// The divider's shape: a trapezoid with rounded top corners, standing on the
  /// fold line and, for the open one, reaching [merge] below it.
  ///
  /// One path for everything that touches this divider — the shadow, the glow and
  /// the fill — so the three can never disagree about where the shape is. It used
  /// to take a `closed` flag as well, for an outline that was inset by half its own
  /// stroke width; the outline is gone.
  Path _ear(Size size, {double merge = 0}) {
    final base = size.height + merge;
    final top = size.height - height;
    final path = Path()
      ..moveTo(0, base)
      ..lineTo(_folderSlant, top + _folderRadius)
      ..arcToPoint(
        Offset(_folderSlant + _folderRadius, top),
        radius: const Radius.circular(_folderRadius),
      )
      ..lineTo(size.width - _folderSlant - _folderRadius, top)
      ..arcToPoint(
        Offset(size.width - _folderSlant, top + _folderRadius),
        radius: const Radius.circular(_folderRadius),
      )
      ..lineTo(size.width, base);
    return path..close();
  }

  @override
  bool shouldRepaint(_FolderEarPainter old) =>
      old.fill != fill ||
      old.shadow != shadow ||
      old.strip != strip ||
      old.line != line ||
      old.height != height ||
      old.base != base ||
      old.merge != merge;
}

/// A quick-add rail of the register's most-added products (audit F9), so the
/// barista reaches the top drinks without scrolling the grid.
final class _FrequentRail extends StatelessWidget {
  const _FrequentRail({required this.products, required this.onTap});
  final List<FrequentProduct> products;
  final ValueChanged<String> onTap;

  String _money(Map<String, Object?> price) {
    final money = CatalogMoney.fromJson(price);
    return formatMinorUnits(money.minorUnits, money.currency);
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final theme = PosTheme.of(context);
    if (MediaQuery.textScalerOf(context).scale(16) >= 24) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            es ? 'Frecuentes' : 'Frequent',
            style: theme.textTheme.labelSmall,
          ),
          for (final product in products)
            PosListRow(
              contentPadding: EdgeInsets.zero,
              title: Text(product.name),
              subtitle: Text(_money(product.price)),
              onTap: () => onTap(product.id),
            ),
        ],
      );
    }
    return SizedBox(
      height: 48,
      child: Row(
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Text(
              es ? 'Frecuentes' : 'Frequent',
              style: theme.textTheme.labelSmall!.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: products.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (context, index) {
                final product = products[index];
                return PosActionTag(
                  label: Text('${product.name}  ·  ${_money(product.price)}'),
                  onPressed: () => onTap(product.id),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

final class _ProductCard extends StatelessWidget {
  const _ProductCard({
    required this.product,
    required this.onTap,
    this.compact = false,
  });
  final CatalogProductSummary product;
  final VoidCallback onTap;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final money = CatalogMoney.fromJson(product.price);
    final category = product.category == null
        ? null
        : CatalogCategory.fromJson(product.category!);
    final url = product.primaryMedia?['url'] as String?;
    final theme = PosTheme.of(context);
    final palette = theme.colorScheme;
    final amount = formatMinorUnits(money.minorUnits, money.currency);
    // A product the café marked unavailable (no stock, off the menu, not on sale yet)
    // still belongs on the grid: the barista has to RECOGNISE it to answer "no hay".
    // So the card dims and carries the words, and the words stay at full contrast —
    // they are the answer, not the decoration.
    final available = product.availability == 'enabled';
    if (compact) {
      return PosCard(
        margin: EdgeInsets.zero,
        child: PosTapRegion(
          semanticLabel:
              '${product.name}, $amount${available ? '' : ', ${l.unavailableLabel}'}',
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                SizedBox(
                  width: 48,
                  height: 48,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: url == null
                        ? _ProductPlaceholder(
                            name: product.name,
                            category: category,
                          )
                        : Image.network(
                            url,
                            fit: BoxFit.cover,
                            errorBuilder: (_, _, _) => _ProductPlaceholder(
                              name: product.name,
                              category: category,
                            ),
                          ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        product.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.titleMedium!.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        available ? amount : '${l.unavailableLabel} · $amount',
                        style: theme.textTheme.bodySmall!.copyWith(
                          color: palette.onSurfaceVariant,
                        ),
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
    return PosCard(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      clipBehavior: Clip.antiAlias,
      child: PosTapRegion(
        semanticLabel:
            '${product.name}, $amount${product.availability == 'enabled' ? '' : ', ${l.unavailableLabel}'}',
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Opacity(
              opacity: available ? 1 : .45,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: url == null
                            ? _ProductPlaceholder(
                                name: product.name,
                                category: category,
                              )
                            : Image.network(
                                url,
                                width: double.infinity,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => _ProductPlaceholder(
                                  name: product.name,
                                  category: category,
                                ),
                              ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 10, 4, 4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            product.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleMedium!.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            amount,
                            style: theme.textTheme.bodySmall!.copyWith(
                              color: palette.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (!available)
              Positioned(
                left: 8,
                top: 8,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: palette.surface,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: palette.outlineVariant),
                  ),
                  child: Text(
                    l.unavailableLabel,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: palette.onSurface,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// A product with no photo gets a solid block of its category's colour with its
/// own initials on top, so the barista recognizes it at a glance (audit F7).
///
/// The tile carries no drawing. An earlier revision painted a product sketch
/// behind the initials, and it was removed on the owner's instruction: the block
/// and the letters answer "which product" faster than a line drawing does, and
/// the drawing read as noise behind a name that is already on the card. This is
/// the previous design's behaviour, kept as one rule for every catalogue view.
///
/// The colour groups the tile by CATEGORY: the owner sets it in the dashboard
/// (`Categorías`), and when unset the terminal derives a stable hue from the
/// category name so a category still reads as one block. A product with no
/// category falls back to its own name.
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
    final palette = PosTheme.of(context).colorScheme;
    // Midnight keeps the category colour in an opaque band. Its neutral surface
    // carries the initials. Other themes retain their category blocks.
    final onColor = palette.midnight
        ? palette.onSurface
        : background.computeLuminance() > 0.5
        ? const Color(0xDD000000)
        : const Color(0xFFFFFFFF);
    return ColoredBox(
      color: palette.midnight ? palette.surfaceContainerHighest : background,
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (palette.midnight)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: 8,
              child: ColoredBox(color: background),
            ),
          Center(
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  _initials(name),
                  style: PosTheme.of(context).textTheme.headlineMedium!
                      .copyWith(
                        color: onColor,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1,
                      ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

final class _Detail extends StatefulWidget {
  const _Detail(
    this.detail, {
    required this.cart,
    required this.addProduct,
    required this.canWrite,
    this.item,
    this.onRecord,
    required this.onClose,
    super.key,
  });
  final CatalogProductDetail detail;
  final CartController cart;
  final Future<bool> Function({
    required String productId,
    String? variantId,
    List<Map<String, Object?>> modifiers,
    int quantity,
    String? note,
    int courseNumber,
    ProvisionalLine? provisional,
  })
  addProduct;
  final bool canWrite;
  final CartItem? item;
  final VoidCallback? onRecord;

  /// Return from the detail to the catalog after closing or submitting.
  final VoidCallback onClose;
  @override
  State<_Detail> createState() => _DetailState();
}

final class _DetailState extends State<_Detail> {
  String? variantId;
  final selectedModifiers = <String, int>{};
  final note = TextEditingController();
  final detailScroll = ScrollController();
  int quantity = 1;

  /// Which course the line belongs to. A new line starts on the first course,
  /// and an edited one starts where the line already is — so the control states
  /// a fact rather than asking a question the operator did not arrive to answer.
  int course = CourseControl.minCourse;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    if (item == null) {
      // One variant is not a choice. Preselecting it keeps the add button live
      // instead of leaving a dead end the operator cannot read.
      final variants = widget.detail.variants;
      if (variants.length == 1) variantId = variants.first['id'] as String?;
      return;
    }
    variantId = item.variant?['variantId'] as String?;
    for (final modifier in item.modifiers) {
      selectedModifiers[modifier['modifierId']! as String] =
          (modifier['quantity']! as num).toInt();
    }
    note.text = item.note ?? '';
    quantity = item.quantity;
    course = item.courseNumber;
  }

  @override
  void dispose() {
    note.dispose();
    detailScroll.dispose();
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
    // The plus is this row's own sign; the formatter owns the minus.
    final currency = delta['currency'] as String? ?? '';
    final amount = formatMinorUnits(minor, currency);
    return minor > 0 ? '+$amount' : amount;
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

  /// Says why the line did not land, and leaves the pane open so the choice
  /// survives for the retry. `noSale` names the one refusal the operator can
  /// act on by themselves.
  void _refuse(bool noSale) {
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final message = noSale
        ? (spanish
              ? 'No hay una venta abierta. Vuelve a entrar y reinténtalo.'
              : 'There is no open sale. Sign in again and retry.')
        : (spanish
              ? 'No se pudo agregar el producto. Reinténtalo.'
              : 'The product was not added. Try again.');
    showPosFeedback(context, message);
  }

  /// One option group rendered per its menu rules (audit F1): a single-choice
  /// group (`maxSelections == 1`) is single-select chips; a multi-choice group
  /// caps at `maxSelections`; a required group shows a clear, coloured hint.
  /// Option tiles laid out in rows that are level with one another.
  ///
  /// A `Wrap` gives every tile its own natural height, so an option that carries
  /// a surcharge (one line of name, one of price) stood taller than the option
  /// beside it and every row read as ragged. Here the tallest tile in a row sets
  /// the row and the rest stretch to it. The row is also the only safe place to
  /// absorb the 2 px border a SELECTED tile draws where an unselected one draws
  /// 1 px - a pinned tile height has to guess that difference, and guessing it
  /// wrong paints an overflow stripe in a debug build.
  Widget _optionRows(List<Widget> tiles) => LayoutBuilder(
    builder: (context, constraints) {
      const gap = UmiSpacing.sm;
      final perRow = math.max(
        1,
        ((constraints.maxWidth + gap) / (_OptionCard.width + gap)).floor(),
      );
      final rows = <List<Widget>>[];
      for (var start = 0; start < tiles.length; start += perRow) {
        rows.add(tiles.sublist(start, math.min(start + perRow, tiles.length)));
      }
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var row = 0; row < rows.length; row++) ...[
            if (row > 0) const SizedBox(height: gap),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var column = 0; column < rows[row].length; column++) ...[
                    if (column > 0) const SizedBox(width: gap),
                    rows[row][column],
                  ],
                ],
              ),
            ),
          ],
        ],
      );
    },
  );

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
                  style: PosTheme.of(context).textTheme.titleMedium,
                ),
              ),
              if (hint != null) ...[
                const SizedBox(width: UmiSpacing.sm),
                Text(
                  hint,
                  style: PosTheme.of(context).textTheme.labelMedium?.copyWith(
                    color: unmet
                        ? PosTheme.of(context).colorScheme.error
                        : PosTheme.of(context).colorScheme.outline,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: UmiSpacing.sm),
          _optionRows(
            modifiers.map((modifier) {
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
      Text(detail.name, style: PosTheme.of(context).textTheme.headlineMedium),
      Text(formatMinorUnits(money.minorUnits, money.currency)),
      if (detail.description != null) Text(detail.description!),
      if (detail.sku != null || detail.barcode != null)
        PosDisclosure(
          title: Text(l.productInformationLabel),
          children: [
            if (detail.sku != null) Text('SKU: ${detail.sku}'),
            if (detail.barcode != null)
              Text('${l.productBarcodeLabel}: ${detail.barcode}'),
          ],
        ),
      if (detail.taxRateBasisPoints > 0) Text(l.taxIncludedLabel),
      if (detail.variants.isNotEmpty) ...[
        const SizedBox(height: 16),
        Row(
          children: [
            Flexible(
              child: Text(
                l.variantsLabel,
                style: PosTheme.of(context).textTheme.titleLarge,
              ),
            ),
            // A dead button with no reason is the thing the pilot keeps
            // reporting. The same rule the modifier groups follow applies here:
            // say what is still missing, where it is missing.
            if (variantId == null) ...[
              const SizedBox(width: UmiSpacing.sm),
              Text(
                Localizations.localeOf(context).languageCode == 'es'
                    ? 'Elige una'
                    : 'Choose one',
                style: PosTheme.of(context).textTheme.labelMedium?.copyWith(
                  color: PosTheme.of(context).colorScheme.error,
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: UmiSpacing.sm),
        _optionRows(
          detail.variants
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
        Text(
          l.modifiersLabel,
          style: PosTheme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: UmiSpacing.md),
        ...detail.optionGroups.map(_buildOptionGroup),
      ],
      const SizedBox(height: UmiSpacing.md),
      PosField(
        controller: note,
        maxLength: 500,
        decoration: PosFieldDecoration(labelText: l.cartNoteLabel),
      ),
      // LABELLED, BECAUSE THE COURSE STEPPER SITS TWO ROWS BELOW.
      //
      // Two bare `− 1 +` rows in one pane read as the same control written twice,
      // and the owner asked why there were two on 2026-10-12. They are different
      // facts about the line — how many of this item, and which course it belongs
      // to — so both rows say which one they are.
      Row(
        children: [
          Expanded(
            child: Text(
              l.cartQuantityLabel,
              style: PosTheme.of(context).textTheme.titleSmall,
            ),
          ),
          const SizedBox(width: UmiSpacing.sm),
          PosIconButton(
            tooltip: l.decreaseQuantity,
            onPressed: quantity > 1 ? () => setState(() => quantity--) : null,
            icon: const PosIcon(PosGlyphs.remove),
          ),
          SizedBox(
            width: 32,
            child: Text(
              '$quantity',
              textAlign: TextAlign.center,
              style: PosTheme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ),
          PosIconButton(
            tooltip: l.increaseQuantity,
            onPressed: quantity < 999 ? () => setState(() => quantity++) : null,
            icon: const PosIcon(PosGlyphs.add),
          ),
        ],
      ),
      const SizedBox(height: UmiSpacing.md),
      // Which round the dish belongs to (§8H step 4). It sits with quantity and
      // note because it is the same kind of fact about the line, and it is the
      // only place the operator can set it before the kitchen ever sees the
      // ticket.
      CourseControl(
        course: course,
        enabled: widget.canWrite,
        hint: l.cartCourseHint,
        onChanged: (value) => setState(() => course = value),
      ),
      const SizedBox(height: 24),
      const SizedBox(height: UmiSpacing.md),
    ];
    final submit = PosButton(
      onPressed:
          !widget.canWrite ||
              (detail.variants.isNotEmpty && variantId == null) ||
              !_requiredOptionsSatisfied()
          ? null
          : () async {
              final modifiers = selectedModifiers.entries
                  .map((e) => {'modifierId': e.key, 'quantity': e.value})
                  .toList();
              // An add that FAILS must say so. It used to close the pane as
              // if it had worked, or leave it open with the button dead — the
              // operator's read was "nothing happened", and the line was
              // simply lost.
              try {
                final landed = widget.item == null
                    ? await widget.addProduct(
                        productId: detail.id,
                        variantId: variantId,
                        modifiers: modifiers,
                        quantity: quantity,
                        note: note.text,
                        courseNumber: course,
                        provisional: ProvisionalLine.fromSelection(
                          product: detail,
                          variantId: variantId,
                          modifierQuantities: {
                            for (final modifier in modifiers)
                              modifier['modifierId']! as String:
                                  (modifier['quantity']! as num).toInt(),
                          },
                        ),
                      )
                    : await widget.cart.edit(
                        item: widget.item!,
                        variantId: variantId,
                        modifiers: modifiers,
                        quantity: quantity,
                        note: note.text,
                        courseNumber: course,
                      );
                if (!landed) {
                  // The API refused the write and the cart holds the reason. Closing
                  // the pane on a refusal is how a line disappears without a word.
                  if (mounted) {
                    _refuse(widget.cart.state.errorCode == 'CART_NOT_OPEN');
                  }
                  return;
                }
                if (widget.item == null) {
                  widget.onRecord?.call();
                }
              } on AppException catch (error) {
                if (mounted) _refuse(error.code == 'CART_NOT_OPEN');
                return;
              } catch (_) {
                if (mounted) _refuse(false);
                return;
              }
              if (mounted) widget.onClose();
            },
      child: Text(
        widget.item == null ? l.addToCartAction : l.saveCartLineAction,
      ),
    );
    final footer = Padding(
      padding: const EdgeInsets.all(UmiSpacing.md),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (detail.variants.isNotEmpty && variantId == null)
            Text(l.productVariantRequiredHint)
          else if (!_requiredOptionsSatisfied())
            Text(l.productOptionsRequiredHint),
          const SizedBox(height: UmiSpacing.sm),
          submit,
        ],
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: PosTextButton.icon(
            icon: const PosIcon(PosGlyphs.arrowBack),
            label: Text(l.catalogTitle),
            onPressed: widget.onClose,
          ),
        ),
        const PosDivider(height: 1),
        Expanded(
          child: RawScrollbar(
            controller: detailScroll,
            thumbVisibility: true,
            child: ListView(
              controller: detailScroll,
              padding: const EdgeInsets.all(UmiSpacing.lg),
              children: children,
            ),
          ),
        ),
        const PosDivider(height: 1),
        footer,
      ],
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

  /// The one width `_optionRows` packs rows with. Height is the row's business:
  /// see `_optionRows`.
  static const double width = 200;

  final String label;
  final String? priceLabel;
  final bool selected;
  final bool disabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    final accent = scheme.primary;
    return Opacity(
      opacity: disabled ? .45 : 1,
      child: SizedBox(
        width: width,
        child: PosSurface(
          color: selected
              ? accent.withValues(alpha: .16)
              : scheme.surfaceContainerHighest,
          borderRadius: BorderRadius.circular(UmiRadius.control),
          child: PosTapRegion(
            onTap: disabled ? null : onTap,
            selected: selected,
            borderRadius: BorderRadius.circular(UmiRadius.control),
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: UmiSpacing.md,
                vertical: UmiSpacing.sm,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(UmiRadius.control),
                border: Border.all(
                  color: selected ? accent : scheme.onSurfaceVariant,
                  width: selected ? 2 : 1,
                ),
              ),
              child: Row(
                children: [
                  PosIcon(
                    selected
                        ? PosGlyphs.checkCircle
                        : PosGlyphs.radioButtonUnchecked,
                    size: 18,
                    color: selected ? accent : scheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: UmiSpacing.sm),
                  Expanded(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          label,
                          style: PosTheme.of(context).textTheme.bodyMedium
                              ?.copyWith(
                                fontWeight: selected
                                    ? FontWeight.w600
                                    : FontWeight.w400,
                              ),
                        ),
                        // THE PRICE LINE ONLY EXISTS WHEN THERE IS A PRICE.
                        //
                        // A variant has no price of its own, and this used to draw
                        // `Text('')` for it anyway: an empty line of `bodySmall`
                        // height under the name, which pushed the name above the
                        // card's centre. The owner read that as "centra el texto
                        // verticalmente" (2026-10-12). The row centres what it is
                        // given; it was being given a blank line.
                        if ((priceLabel ?? '').isNotEmpty)
                          Text(
                            priceLabel!,
                            style: PosTheme.of(context).textTheme.bodySmall
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
      itemBuilder: (_, _) => const PosCard(child: Center(child: PosSpinner())),
    ),
  );
}

final class _Message extends StatelessWidget {
  const _Message(this.message, this.icon, this.retry);
  final String message;
  final PosGlyph icon;
  final VoidCallback? retry;
  @override
  // Scrollable, so a short viewport — a phone with the keyboard up — scrolls the
  // message instead of pushing a debug stripe over the sale (plan §2.1 finding 8).
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) => SingleChildScrollView(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          minHeight: constraints.hasBoundedHeight ? constraints.maxHeight : 0,
        ),
        child: Center(
          child: Semantics(
            liveRegion: true,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                PosIcon(icon, size: 52),
                const SizedBox(height: 16),
                Text(message, textAlign: TextAlign.center),
                if (retry != null) ...[
                  const SizedBox(height: 16),
                  PosButton(
                    onPressed: retry,
                    child: Text(AppLocalizations.of(context).retryAction),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

final class _CartPanel extends StatelessWidget {
  const _CartPanel({
    required this.controller,
    required this.restoringAccount,
    this.onNewSale,
    required this.lineStatuses,
    required this.checkout,
    required this.cash,
    required this.entry,
    required this.permissions,
    required this.sales,
    required this.customerValue,
    required this.deviceChannel,
    this.onPrint,
    required this.onEdit,
    this.orderType,
    this.onClose,
    this.onSave,
    this.onAssignTable,
    this.beforeCheckout,
    this.beforeFire,
  });
  final CartController controller;
  final bool restoringAccount;
  final Future<void> Function()? onNewSale;
  final Map<String, String> lineStatuses;
  final CheckoutController checkout;
  final CashController cash;
  final EntryController entry;
  final OperatorPermissions permissions;
  final SaleLifecycleController sales;
  final CustomerValueController? customerValue;
  final DeviceChannelSocketClient? deviceChannel;

  /// The sale's receipt, printed from the completion screen. Null on a till with no
  /// hardware service, which is what leaves the dialog without a print button.
  final ReceiptPrintRequest? onPrint;
  final ValueChanged<CartItem> onEdit;
  final String? orderType;
  final VoidCallback? onClose;
  final Future<void> Function()? onSave;
  final Future<void> Function()? onAssignTable;
  final Future<bool> Function()? beforeCheckout;
  final Future<bool> Function()? beforeFire;

  Future<void> _openCheckout(BuildContext context, {bool split = false}) async {
    if (beforeCheckout != null && !await beforeCheckout!()) return;
    if (!context.mounted) return;
    if (split) {
      await showSplitCheckout(
        context,
        checkout: checkout,
        cashShiftId: cash.activeShiftId,
        cart: controller,
        entry: entry,
        sales: sales,
      );
      return;
    }
    await showCheckoutSheet(
      context,
      checkout: checkout,
      cashShiftId: cash.activeShiftId,
      cart: controller,
      entry: entry,
      sales: sales,
      customerValue: customerValue,
      deviceChannel: deviceChannel,
      // The sale's completion screen prints through the same call
      // Ventas uses. It is the customer asking for their receipt at
      // the counter — the most ordinary reason a ticket is printed
      // after the sale — and it was the one screen with no way to.
      onPrint: onPrint,
      // A charge refused for a missing shift hands the
      // recovery decision here, where the cash state
      // lives: reclaim a drawer whose terminal is gone,
      // otherwise take the till's own shift back. The
      // returned id is what the retry uses.
      onOpenCashShift: permissions.allows('cash.shift.open')
          ? () async {
              final continueCheckout = await showCashCenter(
                context,
                controller: cash,
                permissions: permissions,
                onHandoffCompleted: entry.lock,
                returnToCheckout: true,
              );
              return continueCheckout == true ? cash.activeShiftId : null;
            }
          : null,
      onRecoverCashShift: (holdState) async {
        if (holdState == 'held_by_orphaned_till') {
          final orphaned = cash.reclaimableRegisters;
          if (orphaned.isEmpty) return null;
          await cash.reclaimRegister(orphaned.first['id']! as String);
          return cash.activeShiftId;
        }
        // A paused shift is this till's own and the
        // session still matches, so the server resumes it
        // for the operator who is standing here. The till
        // asks that operator for their PIN first: the
        // drawer sat unattended while the shift was
        // paused, and whoever takes it back says so.
        //
        // A drawer the server says this TERMINAL holds is taken
        // back by the id the refusal named. The cash screen's idea
        // of "the current shift" can be a load old — and after an
        // app update it is exactly the shift the till cannot see —
        // so the recovery names the shift instead of guessing at it.
        final held = checkout.state.holdShiftId;
        debugPrint(
          '[umipos] checkout recovery: hold=${checkout.state.holdState} held=$held',
        );
        if (held != null) {
          final resumed = await cash.resumeShiftById(held);
          if (resumed != null) return resumed;
        }
        if (cash.canResumePausedShift) {
          if (!context.mounted) return null;
          return _resumePausedShiftWithPin(context, cash);
        }
        return cash.recoverOwnShift();
      },
    );
  }

  Future<void> _cancelSentLine(BuildContext context, CartItem item) async {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final reason = await showPosDialog<String>(
      context: context,
      builder: (dialog) => PosAlertDialog(
        title: Text(es ? 'Cancelar producto enviado' : 'Cancel sent product'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(item.productName),
              Text(
                es
                    ? 'Selecciona el motivo. Si cocina ya empezó el platillo, se pedirá autorización.'
                    : 'Select the reason. If the kitchen already started the dish, an approval will be asked for.',
              ),
              for (final option in <(String, String)>[
                (
                  'customer_changed',
                  _sentLineVoidReasonLabel(es, 'customer_changed'),
                ),
                (
                  'operator_mistake',
                  _sentLineVoidReasonLabel(es, 'operator_mistake'),
                ),
                ('duplicate', _sentLineVoidReasonLabel(es, 'duplicate')),
                ('other', _sentLineVoidReasonLabel(es, 'other')),
              ])
                PosTextButton(
                  onPressed: () => Navigator.pop(dialog, option.$1),
                  child: Text(option.$2),
                ),
            ],
          ),
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialog),
            child: Text(es ? 'Volver' : 'Back'),
          ),
        ],
      ),
    );
    if (reason == null) return;
    var cancelled = await controller.cancelSentLine(item, reason);
    // The kitchen already has this dish on the fire. The cancel is still possible — the
    // plate will exist either way, and voiding it is what keeps the bill honest and the
    // waste visible — but it takes a manager, whose PIN turns into an elevation bound to
    // THIS line, THIS reason and THIS cart version.
    if (!cancelled &&
        controller.state.errorCode == 'KITCHEN_PREPARATION_STARTED' &&
        controller.supportsVoidAfterPreparationApproval &&
        context.mounted) {
      final approval = await _approveVoidAfterPreparation(
        context,
        item,
        reason,
      );
      // Nobody authorized it (the dialog was abandoned) — the refusal the server already
      // gave is then shown below, because that sentence is what says the kitchen owns the
      // line. A blank screen would leave the operator re-tapping the delete button.
      if (approval != null && context.mounted) {
        cancelled = await controller.cancelSentLine(
          item,
          reason,
          approvalId: approval.approvalId,
          actionFingerprint: approval.fingerprint,
        );
      }
    }
    if (!cancelled && context.mounted) {
      final code = controller.state.errorCode;
      showPosFeedback(
        context,
        code != null
            ? operatorErrorMessage(context, code)
            : es
            ? 'Espera a que termine el envío anterior y vuelve a intentarlo.'
            : 'Wait for the previous send to finish, then try again.',
      );
    }
  }

  /// The manager's PIN, asked for over the one act it authorizes.
  ///
  /// The dialog is the till's shared approval surface, so what the manager reads is the
  /// dish, the price that stops being charged and the reason — the three facts of a void
  /// — rather than a register this act does not touch.
  ///
  /// A refusal is not the end: the API tells a locked till apart from a PIN that matched
  /// nothing, and the dialog comes back with the sentence that says which. Abandoning it
  /// returns null, and the caller stays on the refusal the server already gave — so the
  /// line visibly stays on the account, with the sentence that explains why.
  Future<({String approvalId, String fingerprint})?>
  _approveVoidAfterPreparation(
    BuildContext context,
    CartItem item,
    String reasonCode,
  ) async {
    final l = AppLocalizations.of(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    final price = PriceSnapshot.fromJson(item.price);
    final money = CatalogMoney.fromJson(price.lineTotal);
    final prompt = ManagerApprovalPrompt(
      operation: l.sentLineVoidApprovalOperation,
      amount: formatMinorUnits(money.minorUnits, money.currency),
      reason: _sentLineVoidReasonLabel(es, reasonCode),
      reasonLabel: l.sentLineVoidApprovalReasonLabel,
      cancelLabel: l.sentLineVoidApprovalCancelAction,
    );
    ApprovalRefusal? refusal;
    while (context.mounted) {
      final managerPin = await showManagerApprovalDialog(
        context,
        request: prompt,
        failure: refusal?.message,
        retryable: refusal?.retryable ?? true,
      );
      if (managerPin == null || !context.mounted) return null;
      try {
        return await controller.approveVoidAfterPreparation(
          item: item,
          reasonCode: reasonCode,
          managerPin: managerPin,
        );
      } on AppException catch (error) {
        if (!context.mounted) return null;
        refusal = approvalRefusal(l, error.code);
      }
    }
    return null;
  }

  /// The four reasons a sent line can be cancelled for, said the same way wherever the
  /// till writes them: the operator picks one here, and the manager authorizing the void
  /// of an already-started dish reads the same sentence on the approval.
  String _sentLineVoidReasonLabel(bool es, String reasonCode) =>
      switch (reasonCode) {
        'customer_changed' =>
          es ? 'El cliente cambió el pedido' : 'Customer changed the order',
        'operator_mistake' => es ? 'Error de captura' : 'Entry error',
        'duplicate' => es ? 'Producto duplicado' : 'Duplicate product',
        _ => es ? 'Otro motivo' : 'Other reason',
      };

  Future<void> _clearAccount(BuildContext context, AppLocalizations l) async {
    if (controller.isWriting) return;
    final confirmed = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(l.confirmClearCartTitle),
        content: Text(l.confirmClearCartBody),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(l.closeAction),
          ),
          PosButton.tonal(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(l.clearCartAction),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) await controller.clear();
  }

  String _money(Map<String, Object?> value) {
    final currency = value['currency'] as String? ?? '';
    final minor = (value['minorUnits'] as num?)?.toInt() ?? 0;
    return formatMinorUnits(minor, currency);
  }

  Widget _heading(
    BuildContext context,
    AppLocalizations l, {
    bool showClose = true,
  }) {
    final theme = PosTheme.of(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    final takeout = orderType == 'takeout';
    final label = takeout
        ? (es ? 'Para llevar' : 'Takeout')
        : (es ? 'Comer aquí' : 'Dine in');
    final cart = controller.state.cart;
    final title = Semantics(
      header: true,
      child: PosTooltip(
        message: cart == null
            ? l.cartTitle
            : [
                accountReference(cart),
                cart.operatorName,
              ].whereType<String>().join(' · '),
        child: Text(
          cart == null ? l.cartTitle : accountDisplayTitle(cart, spanish: es),
          style: theme.textTheme.headlineSmall,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
    final contextLabel = Semantics(
      label: label,
      child: ExcludeSemantics(
        child: PosTag(
          visualDensity: PosVisualDensity.compact,
          avatar: PosIcon(
            takeout
                ? PosGlyphs.takeoutDiningOutlined
                : PosGlyphs.restaurantOutlined,
            size: 16,
          ),
          label: Text(label),
        ),
      ),
    );
    final largeText = MediaQuery.textScalerOf(context).scale(16) > 22;
    return Row(
      children: [
        Expanded(
          child: largeText
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [title, if (orderType != null) contextLabel],
                )
              : title,
        ),
        if (!largeText && orderType != null) contextLabel,
        if (permissions.allows('cart.write') &&
            controller.state.cart?.items.isNotEmpty == true &&
            controller.state.cart?.firedOrderId == null)
          PosMenuButton<String>(
            tooltip: es ? 'Opciones de cuenta' : 'Account options',
            icon: const PosIcon(PosGlyphs.moreVert),
            itemBuilder: (_) => [
              PosMenuItem(
                value: 'clear',
                child: Text(es ? 'Vaciar cuenta' : 'Clear account'),
              ),
            ],
            onSelected: (_) => _clearAccount(context, l),
          ),
        if (showClose && onClose != null) ...[
          const SizedBox(width: 8),
          PosIconButton(
            tooltip: l.closeOrderAction,
            onPressed: onClose,
            icon: const PosIcon(PosGlyphs.close),
          ),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    // The action words remain visible; tooltips carry the complete phrases.
    final spanish = Localizations.localeOf(context).languageCode == 'es';
    final cart = controller.state.cart;
    if (cart == null) {
      return PosCard(
        child: Column(
          children: [
            _heading(context, l),
            Expanded(
              child: Center(
                child: restoringAccount
                    ? Padding(
                        padding: const EdgeInsets.all(UmiSpacing.md),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const PosSpinner(),
                            const SizedBox(height: UmiSpacing.md),
                            Text(
                              l.cartRestoringAccount,
                              textAlign: TextAlign.center,
                            ),
                          ],
                        ),
                      )
                    : controller.state.phase == CartPhase.failure ||
                          controller.state.phase == CartPhase.validationFailure
                    ? Padding(
                        padding: const EdgeInsets.all(UmiSpacing.md),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              controller.state.errorCode == null
                                  ? l.cartUnavailable
                                  : operatorErrorMessage(
                                      context,
                                      controller.state.errorCode!,
                                    ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: UmiSpacing.md),
                            PosButton(
                              onPressed:
                                  controller.state.phase ==
                                      CartPhase.validationFailure
                                  ? onNewSale ?? () => sales.newSale()
                                  : () => sales.newSale(),
                              child: Text(
                                controller.state.phase ==
                                        CartPhase.validationFailure
                                    ? (spanish
                                          ? 'Iniciar pedido'
                                          : 'Start order')
                                    : l.retryAction,
                              ),
                            ),
                          ],
                        ),
                      )
                    : controller.state.phase == CartPhase.idle
                    ? PosButton(
                        onPressed: onNewSale ?? () => sales.newSale(),
                        child: Text(spanish ? 'Iniciar pedido' : 'Start order'),
                      )
                    : const PosSpinner(),
              ),
            ),
          ],
        ),
      );
    }
    final items = cart.items.map(CartItem.fromJson).toList(growable: false);
    final totals = TotalsPreview.fromJson(cart.totals);
    final discounts = DiscountPreview.fromJson(totals.discounts);
    final canSplit =
        permissions.allows('checkout.commit') &&
        checkout.supportsPartialPayments;
    // A partial payment needs a method that can carry it. The location policy
    // may allow only cash, and cash needs an open shift. Without this check the
    // button is enabled and opens a split screen that cannot record anything.
    //
    // BEFORE THE POLICY HAS LOADED, there is nothing to judge yet. The checkout
    // sheet loads that policy on open and refuses honestly if no split-capable
    // tender exists. Treating "not loaded" as "not available" disabled the
    // control on its first use, when no shift had been opened or checkout had
    // never been visited; the sheet could have loaded the answer itself.
    final policy = checkout.policy;
    final partialTenderReady =
        policy == null ||
        cash.activeShiftId != null ||
        policy.manualTerminalEnabled == true ||
        policy.bankTransferEnabled == true;
    // The fired order (ADR 2026-10-07-pos-fired-order §5). Once the cart carries a
    // fired order the server freezes it, so the line controls and the clear action
    // go with it — an edit the server will refuse is a button that lies. The
    // checkout stays live: it settles the fired order in place.
    final fired = cart.firedOrderId != null;
    // The second round (plan §8.2 F6): a fired cart accepts NEW lines. They arrive
    // unfired, are editable, and the fire action sends them.
    final unfiredCount = items.where((item) => !item.fired).length;
    final lines = <Widget>[
      if (cart.accountName != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Text(
            cart.accountName!,
            style: PosTheme.of(context).textTheme.bodySmall,
          ),
        ),
      // NO NAME FIELD ON THE COMANDA. The account is identified by its folio and,
      // when it has one, by its table — the two things the server already knows and
      // both of them printed above. A name the operator had to type to tell one
      // tableless account from another was work the folio had already done, and the
      // owner asked for it to go (2026-10-12).
      //
      // THE TABLE'S OWN ROW, AND NO LEGEND ABOVE IT.
      //
      // It used to say "Sin mesa" and then offer the table, so an unassigned
      // account spent a line saying nothing. The owner cut the legend (2026-10-12)
      // and the row kept one thing: where the food goes, named by its own state —
      // "Agregar mesa" while the account has no table, the table's own name once it
      // does. The buyer is not here any more: that control sits beside the order
      // type, where the sale is opened and the customer is decided.
      if (onAssignTable != null || cart.tableName != null)
        Padding(
          padding: const EdgeInsets.only(bottom: UmiSpacing.sm),
          child: Align(
            alignment: Alignment.centerLeft,
            child: PosTextButton.icon(
              onPressed: controller.isWriting ? null : onAssignTable,
              icon: const PosIcon(PosGlyphs.tableRestaurantOutlined),
              label: Text(
                cart.tableName ?? (spanish ? 'Agregar mesa' : 'Add table'),
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
        ),
      if (items.isEmpty)
        StationEmptyOrder(message: l.cartEmpty)
      else
        // The panel is the scroll view; this list is its content, so it must
        // not try to scroll on its own.
        ListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: items.length,
          itemBuilder: (context, index) {
            final item = items[index];
            final price = PriceSnapshot.fromJson(item.price);
            return Semantics(
              label: '${item.productName}, ${item.quantity}',
              child: Column(
                children: [
                  PosListRow(
                    contentPadding: EdgeInsets.zero,
                    title: Text(item.productName),
                    subtitle: Text(
                      [
                        // A course other than the first is said on
                        // the line itself, because it is a fact
                        // about the dish and the operator has to be
                        // able to check it without opening the
                        // sheet again. Course 1 stays quiet.
                        if (item.courseNumber != 1)
                          l.cartCourseCurrent(item.courseNumber),
                        if (item.variant != null)
                          item.variant!['name'] as String,
                        ...item.modifiers.map((m) => m['name'] as String),
                        if (item.note != null) item.note!,
                      ].join(' · '),
                    ),
                    trailing: Text(_money(price.lineTotal)),
                  ),
                  Row(
                    children: [
                      PosIconButton(
                        tooltip: l.decreaseQuantity,
                        onPressed:
                            permissions.allows('cart.write') && !item.fired
                            ? () => controller.quantity(item, item.quantity - 1)
                            : null,
                        icon: const PosIcon(PosGlyphs.remove),
                      ),
                      Text('${item.quantity}'),
                      PosIconButton(
                        tooltip: l.increaseQuantity,
                        onPressed:
                            permissions.allows('cart.write') &&
                                !item.fired &&
                                item.quantity < 999
                            ? () => controller.quantity(item, item.quantity + 1)
                            : null,
                        icon: const PosIcon(PosGlyphs.add),
                      ),
                      // A line the kitchen already has: the cart says so
                      // on the line, because that is what the operator
                      // checks before adding a second round (plan §8.2 F6).
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(right: UmiSpacing.sm),
                          child: Text(
                            kitchenCartLineLabel(
                              item,
                              lineStatuses,
                              spanish: spanish,
                            ),
                            style: PosTheme.of(context).textTheme.labelSmall
                                ?.copyWith(
                                  color: PosTheme.of(
                                    context,
                                  ).colorScheme.primary,
                                ),
                          ),
                        ),
                      ),
                      PosIconButton(
                        tooltip: l.editCartLineAction,
                        onPressed:
                            permissions.allows('cart.write') && !item.fired
                            ? () => onEdit(item)
                            : null,
                        icon: const PosIcon(PosGlyphs.editOutlined),
                      ),
                      PosIconButton(
                        key: ValueKey('repeat-cart-line-${item.id}'),
                        tooltip: l.repeatCartLineAction,
                        onPressed:
                            permissions.allows('cart.write') &&
                                !controller.isWriting
                            ? () => controller.repeat(item)
                            : null,
                        icon: const PosIcon(PosGlyphs.syncAlt),
                      ),
                      PosIconButton(
                        tooltip: l.removeFromCartAction,
                        onPressed:
                            !permissions.allows('cart.write') ||
                                controller.isWriting
                            ? null
                            : !item.fired
                            ? () => controller.remove(item)
                            : permissions.allows('order.fire') &&
                                  controller.supportsSentLineCancellation
                            ? () => _cancelSentLine(context, item)
                            : null,
                        icon: const PosIcon(PosGlyphs.deleteOutline),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
      const StationRule(),
      _Total(label: l.subtotalLabel, value: _money(totals.subtotal)),
      _Total(label: l.taxLabel, value: _money(totals.tax)),
      _Total(label: l.discountLabel, value: _money(discounts.total)),
      // A cart whose every line already reached the kitchen says
      // so here; the fire action itself waits in the pinned row
      // below with the other two (plan §8.2 F6).
      if (permissions.allows('order.fire') && fired && unfiredCount == 0)
        Padding(
          padding: const EdgeInsets.only(top: UmiSpacing.sm),
          child: Row(
            children: [
              PosIcon(
                PosGlyphs.soupKitchenOutlined,
                size: 18,
                color: PosTheme.of(context).colorScheme.primary,
              ),
              const SizedBox(width: UmiSpacing.sm),
              Expanded(
                child: Text(
                  spanish ? 'Enviado · Cuenta abierta' : 'Sent · Account open',
                  style: PosTheme.of(context).textTheme.bodyMedium,
                ),
              ),
            ],
          ),
        ),
    ];
    final footer = <Widget>[
      // The canonical total stays immediately before the action group.
      const StationRule(),
      _Total(
        label: l.totalLabel,
        value: _money(totals.grandTotal),
        emphasized: true,
      ),
      const SizedBox(height: UmiSpacing.sm),
      if (onSave != null)
        PosOutlineButton.icon(
          onPressed: controller.isWriting ? null : onSave,
          icon: const PosIcon(PosGlyphs.pauseCircleOutline),
          label: Text(spanish ? 'Guardar y salir' : 'Save and leave'),
        ),
      _CartActions(
        labels: [
          if (permissions.allows('order.fire') && unfiredCount > 0)
            spanish ? 'Enviar a cocina' : 'Send to kitchen',
          if (canSplit) l.splitCheckAction,
          if (permissions.allows('checkout.commit')) l.checkoutAction,
        ],
        buttons: [
          // Send to the kitchen before the money (ADR 2026-10-07 §5).
          // It only exists while there is something new to send.
          if (permissions.allows('order.fire') && unfiredCount > 0) ...[
            PosTooltip(
              message: l.fireOrderAction,
              // The arrow points the way the food goes — up, to the kitchen —
              // and the word stays beside it so the action is still read, not
              // guessed at from a picture.
              child: PosButton.tonalIcon(
                onPressed: controller.isWriting
                    ? null
                    : () async {
                        if (beforeFire != null && !await beforeFire!()) return;
                        final result = await controller.fire();
                        if (!context.mounted) return;
                        if (result == null) {
                          showPosFeedback(
                            context,
                            operatorErrorMessage(
                              context,
                              controller.state.errorCode ?? '',
                            ),
                          );
                        }
                      },
                icon: const PosIcon(PosGlyphs.arrowUpward),
                label: Text(spanish ? 'Enviar a cocina' : 'Send to kitchen'),
              ),
            ),
          ],
          if (canSplit)
            PosOutlineButton.icon(
              key: const ValueKey('account-split-check'),
              onPressed:
                  items.isEmpty ||
                      controller.isWriting ||
                      !checkout.canCollectPartialPayments ||
                      !partialTenderReady
                  ? null
                  : () => _openCheckout(context, split: true),
              icon: const PosIcon(PosGlyphs.callSplit),
              label: Text(l.splitCheckAction),
            ),
          if (permissions.allows('checkout.commit'))
            PosButton.icon(
              style: PosButton.styleFrom(
                backgroundColor: PosTheme.of(context).colorScheme.action,
                // WHITE INK, ASKED FOR BY THE OWNER (2026-10-12). Cobrar is the
                // money button and it was the one action carrying dark ink on its
                // own fill; the owner wants its label and its banknote in white,
                // read the same way on every palette. The fill is the signal blue
                // (or Midnight's navy band, where white is what it always had).
                foregroundColor: PosColors.white,
                disabledBackgroundColor: PosTheme.of(
                  context,
                ).colorScheme.surfaceContainerHighest,
                disabledForegroundColor: PosTheme.of(
                  context,
                ).colorScheme.onSurfaceVariant,
                side:
                    PosTheme.of(context).colorScheme.midnight &&
                        items.isNotEmpty &&
                        permissions.allows('checkout.commit')
                    ? BorderSide(color: PosTheme.of(context).colorScheme.signal)
                    : null,
              ),
              onPressed:
                  items.isEmpty ||
                      !permissions.allows('checkout.commit') ||
                      controller.isWriting
                  ? null
                  : () => _openCheckout(context),
              icon: const PosIcon(PosGlyphs.paymentsOutlined),
              label: Text(l.checkoutAction),
            ),
        ],
      ),
    ];
    return PosCard(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(6),
        side: BorderSide(
          color: PosTheme.of(context).colorScheme.outlineVariant,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            top: BorderSide(
              color: PosTheme.of(context).colorScheme.primary,
              width: 4,
            ),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.md),
          // Pin the total and actions while a usable line viewport remains.
          // With less height, the whole document scrolls under a fixed close.
          child: LayoutBuilder(
            builder: (context, box) {
              final scale = MediaQuery.textScalerOf(context).scale(16) / 16;
              if (box.maxHeight < 208 * scale) {
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (onClose != null)
                      Align(
                        alignment: Alignment.centerRight,
                        child: PosIconButton(
                          tooltip: l.closeOrderAction,
                          onPressed: onClose,
                          icon: const PosIcon(PosGlyphs.close),
                        ),
                      ),
                    Expanded(
                      child: ListView(
                        children: [
                          _heading(context, l, showClose: false),
                          const StationRule(),
                          ...lines,
                          ...footer,
                        ],
                      ),
                    ),
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _heading(context, l),
                  const StationRule(),
                  Expanded(child: ListView(children: lines)),
                  ...footer,
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

final class _CartActions extends StatelessWidget {
  const _CartActions({required this.labels, required this.buttons});
  final List<String> labels;
  final List<Widget> buttons;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, box) {
      assert(labels.length == buttons.length);
      if (buttons.isEmpty) return const SizedBox.shrink();
      if (buttons.length == 1) {
        return SizedBox(width: double.infinity, child: buttons.single);
      }
      final style = PosTheme.of(context).textTheme.labelLarge!;
      final widths = <double>[];
      for (final label in labels) {
        final text = TextPainter(
          text: TextSpan(text: label, style: style),
          textDirection: Directionality.of(context),
          textScaler: MediaQuery.textScalerOf(context),
          locale: Localizations.localeOf(context),
          maxLines: 1,
        )..layout();
        widths.add(math.max(48, text.width.ceilToDouble() + 32));
        text.dispose();
      }
      Widget row(List<Widget> group) => Row(
        children: [
          for (var i = 0; i < group.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(child: group[i]),
          ],
        ],
      );
      bool fits(List<double> sizes) =>
          box.maxWidth >=
          sizes.reduce(math.max) * sizes.length + 8 * (sizes.length - 1);
      if (fits(widths)) {
        return row(buttons);
      }
      final secondary = buttons.sublist(0, buttons.length - 1);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (fits(widths.sublist(0, secondary.length)))
            row(secondary)
          else
            for (var i = 0; i < secondary.length; i++) ...[
              if (i > 0) const SizedBox(height: 8),
              secondary[i],
            ],
          const SizedBox(height: 8),
          buttons.last,
        ],
      );
    },
  );
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
        Expanded(child: Text(label)),
        const SizedBox(width: UmiSpacing.sm),
        // MONEY NEVER WRAPS. A total that reads `MXN` / `245.0` / `0` down three lines is a number
        // nobody can take in at the counter, and `Extra large` on the till produced exactly that
        // (measured on the iMin D3-504 on 2026-10-11: the order panel's total at 2× text scale, and
        // the same widget draws every money row of the panel). The amount is laid out on ONE line and
        // scaled DOWN when the row cannot hold it — never ellipsized, because a money figure that
        // hides digits is worse than a smaller one.
        Flexible(
          child: FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerRight,
            child: Text(
              value,
              maxLines: 1,
              softWrap: false,
              textAlign: TextAlign.right,
              style: emphasized
                  ? PosTheme.of(context).textTheme.bodyLarge!.copyWith(
                      fontSize: 24,
                      height: 1.25,
                      fontWeight: FontWeight.w600,
                    )
                  : null,
            ),
          ),
        ),
      ],
    ),
  );
}

/// Bring this till's paused shift back, with the operator's PIN in front of it.
///
/// The charge was refused because the shift is paused, and a retry re-sends the
/// same refused payload — resuming is the only thing that moves the sale
/// forward. The ask stays on screen until the shift is back or the operator
/// walks away from it: a PIN the server refused is a sentence about that PIN,
/// not an empty checkout. Returns the shift to charge against, or null when the
/// operator closed the pad, which leaves the refusal and the cart where they
/// were.
Future<String?> _resumePausedShiftWithPin(
  BuildContext context,
  CashController cash,
) async {
  final l = AppLocalizations.of(context);
  String? failure;
  var retryable = true;
  while (true) {
    if (!context.mounted) return null;
    final pin = await showOperatorPinDialog(
      context,
      title: l.resumeShiftAction,
      confirmLabel: l.resumeShiftAndRetryAction,
      failure: failure,
      retryable: retryable,
    );
    if (pin == null || !context.mounted) return null;
    try {
      final outcome = await cash.resumePausedShiftWithPin(pin: pin);
      if (outcome.ok) return outcome.shiftId;
      if (!context.mounted) return null;
      failure = _operatorPinRefusal(context, l, outcome.errorCode);
      retryable = outcome.errorCode != 'PIN_LOCKED';
    } on AppException catch (error) {
      if (!context.mounted) return null;
      failure = _operatorPinRefusal(context, l, error.code);
      retryable = error.code != 'PIN_LOCKED';
    }
  }
}

/// What the server's refusal means to the person typing the PIN.
///
/// A locked PIN and a PIN that matched nothing are different facts: the first
/// stops the keypad, the second invites another try.
String _operatorPinRefusal(
  BuildContext context,
  AppLocalizations l,
  String? code,
) => switch (code) {
  'PIN_LOCKED' => l.operatorPinLocked,
  'RATE_LIMITED' => l.operatorPinRateLimited,
  'PERMISSION_DENIED' => l.operatorPinInvalid,
  _ => operatorErrorMessage(context, code ?? ''),
};
