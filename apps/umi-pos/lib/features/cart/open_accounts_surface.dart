import 'dart:async';

import 'package:umi_contract/umi_contract.dart';

import '../../core/errors/app_error.dart';
import '../../core/errors/operator_error_message.dart';
import '../../core/theme/pos_ui.dart';
import '../../shared/business_day.dart';
import '../../shared/money.dart';
import '../../shared/widgets/inline_notice.dart';
import 'account_details_surface.dart';

class OpenAccountsDialog extends StatelessWidget {
  const OpenAccountsDialog({
    required this.load,
    required this.operatorSessionId,
    this.clock = DateTime.now,
    this.currentBusinessDate,
    super.key,
  });
  final Future<List<Cart>> Function() load;
  final String operatorSessionId;

  /// Where "now" comes from. Only tests replace it; production reads the device clock,
  /// which is the approximation the operational-day boundary is built on.
  final DateTime Function() clock;

  /// The date the server calls today, when the caller has it. See [OpenAccountsList].
  final String? currentBusinessDate;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return PosAlertDialog(
      title: Text(es ? 'Cuentas abiertas' : 'Open accounts'),
      content: SizedBox(
        width: 540,
        height: 420,
        child: OpenAccountsList(
          load: load,
          operatorSessionId: operatorSessionId,
          clock: clock,
          currentBusinessDate: currentBusinessDate,
          onSelected: (cart) => Navigator.pop(context, cart),
        ),
      ),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(es ? 'Cerrar' : 'Close'),
        ),
      ],
    );
  }
}

/// Reuses the same account selection in a page and a dialog.
class OpenAccountsList extends StatefulWidget {
  const OpenAccountsList({
    required this.load,
    required this.onSelected,
    this.operatorSessionId,
    this.tablelessOnly = false,
    this.showFulfillmentFilter = false,
    this.showDateFilter = false,
    this.onCancelCarriedOver,
    this.clock = DateTime.now,
    this.currentBusinessDate,
    this.watchedAccount,
    this.readAccount,
    this.onAccountReleased,
    super.key,
  });
  final Future<List<Cart>> Function() load;
  final ValueChanged<Cart> onSelected;
  final String? operatorSessionId;
  final bool tablelessOnly;
  final bool showFulfillmentFilter;
  final bool showDateFilter;
  final Future<void> Function(List<Cart>)? onCancelCarriedOver;
  final DateTime Function() clock;
  final Cart? watchedAccount;
  final Future<Cart> Function(Cart)? readAccount;
  final VoidCallback? onAccountReleased;

  /// The business date on the till's active cart. It can be stale when the till
  /// resumes an account from a previous day. In that case, use the device's 04:00
  /// operational-day boundary as a fallback.
  final String? currentBusinessDate;

  @override
  State<OpenAccountsList> createState() => _OpenAccountsListState();
}

class _OpenAccountsListState extends State<OpenAccountsList> {
  static const _maxCancelSelection = 50;
  final _search = TextEditingController();
  List<Cart>? _accounts;
  String? _error;
  bool _loading = false;
  String? _fulfillmentType;
  bool _previousDaysOnly = false;
  final Set<String> _selectedIds = {};
  bool _cancelling = false;
  String? _cancelError;
  bool _selectionLimitReached = false;
  Timer? _availabilityTimer;
  late final AppLifecycleListener _lifecycle;
  bool _checkingAvailability = false;
  bool _resumed = true;

  @override
  void initState() {
    super.initState();
    _lifecycle = AppLifecycleListener(
      onStateChange: (state) {
        _resumed = state == AppLifecycleState.resumed;
        _scheduleAvailability();
      },
    );
    _load();
    _scheduleAvailability();
  }

  @override
  void didUpdateWidget(OpenAccountsList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.watchedAccount != widget.watchedAccount) {
      _scheduleAvailability();
    }
  }

  void _scheduleAvailability() {
    _availabilityTimer?.cancel();
    if (!mounted ||
        !_resumed ||
        widget.watchedAccount == null ||
        widget.readAccount == null) {
      return;
    }
    _availabilityTimer = Timer(const Duration(seconds: 5), () {
      unawaited(_checkAvailability());
    });
  }

  Future<void> _checkAvailability() async {
    final watched = widget.watchedAccount;
    final read = widget.readAccount;
    if (_checkingAvailability || watched == null || read == null) {
      _scheduleAvailability();
      return;
    }
    _checkingAvailability = true;
    try {
      final current = await read(watched);
      if (!mounted || !_resumed || widget.watchedAccount != watched) return;
      setState(() {
        _accounts = _accounts?.map((account) {
          return account.id == current.id && account.version <= current.version
              ? current
              : account;
        }).toList();
      });
      if (current.accountOwnerActive == false ||
          current.lifecycleState == 'suspended' ||
          current.operatorSessionId != watched.operatorSessionId) {
        widget.onAccountReleased?.call();
      }
    } on AppException catch (error) {
      if (!mounted || !_resumed || widget.watchedAccount != watched) return;
      if (error.code == 'CART_NOT_FOUND' ||
          error.code == 'CART_ACCOUNT_CLOSED') {
        setState(() {
          _accounts = _accounts?.where((a) => a.id != watched.id).toList();
        });
        widget.onAccountReleased?.call();
      }
      // A failed read cannot prove that another operator released the account.
    } finally {
      _checkingAvailability = false;
      _scheduleAvailability();
    }
  }

  @override
  void dispose() {
    _availabilityTimer?.cancel();
    _lifecycle.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final accounts = await widget.load();
      if (mounted) {
        setState(() {
          _accounts = accounts;
          _selectedIds.removeWhere(
            (id) => !accounts.any((account) => account.id == id),
          );
        });
      }
    } on AppException catch (error) {
      if (mounted) setState(() => _error = error.code);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _matches(Cart cart) {
    if (widget.tablelessOnly && cart.tableId != null) return false;
    if (_previousDaysOnly && !_carried(cart, widget.clock())) return false;
    if (_fulfillmentType != null && cart.fulfillmentType != _fulfillmentType) {
      return false;
    }
    final query = _search.text.trim().toLowerCase();
    if (query.isEmpty) return true;
    final fields = [
      cart.accountName,
      cart.tableName,
      cart.accountFolio,
      TotalsPreview.fromJson(cart.totals).businessDate,
      cart.operatorName,
    ].whereType<String>().join(' ').toLowerCase();
    return query.split(RegExp(r'\s+')).every(fields.contains);
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final visible = _accounts?.where(_matches).toList() ?? const <Cart>[];
    final selectable = visible
        .where((account) => _carried(account, widget.clock()))
        .toList();
    return Column(
      children: [
        if (widget.showDateFilter || widget.showFulfillmentFilter)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Wrap(
                spacing: 16,
                runSpacing: 8,
                children: [
                  if (widget.showDateFilter)
                    PosSegmented<bool>(
                      showSelectedIcon: false,
                      segments: [
                        PosSegment(
                          value: false,
                          label: Text(es ? 'Todas las fechas' : 'All dates'),
                        ),
                        PosSegment(
                          value: true,
                          label: Text(es ? 'Días anteriores' : 'Previous days'),
                        ),
                      ],
                      selected: {_previousDaysOnly},
                      onSelectionChanged: (value) => setState(() {
                        _previousDaysOnly = value.first;
                        _selectedIds.clear();
                        _cancelError = null;
                        _selectionLimitReached = false;
                      }),
                    ),
                  if (widget.showFulfillmentFilter)
                    PosSegmented<String>(
                      showSelectedIcon: false,
                      segments: [
                        PosSegment(
                          value: 'all',
                          label: Text(es ? 'Todas' : 'All'),
                        ),
                        PosSegment(
                          value: 'dine_in',
                          label: Text(es ? 'Comer aquí' : 'Dine in'),
                        ),
                        PosSegment(
                          value: 'takeout',
                          label: Text(es ? 'Para llevar' : 'Take away'),
                        ),
                      ],
                      selected: {_fulfillmentType ?? 'all'},
                      onSelectionChanged: (value) => setState(() {
                        _fulfillmentType = value.first == 'all'
                            ? null
                            : value.first;
                        _selectedIds.clear();
                      }),
                    ),
                ],
              ),
            ),
          ),
        Row(
          children: [
            Expanded(
              child: PosField(
                controller: _search,
                onChanged: (_) => setState(() => _selectedIds.clear()),
                decoration: PosFieldDecoration(
                  hintText: es ? 'Buscar cuenta' : 'Search accounts',
                  prefixIcon: const PosIcon(PosGlyphs.search),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : PosIconButton(
                          tooltip: es ? 'Borrar búsqueda' : 'Clear search',
                          onPressed: () => setState(() {
                            _search.clear();
                            _selectedIds.clear();
                          }),
                          icon: const PosIcon(PosGlyphs.close),
                        ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            PosIconButton(
              tooltip: es ? 'Actualizar' : 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const PosIcon(PosGlyphs.refresh),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (_previousDaysOnly &&
            widget.onCancelCarriedOver != null &&
            selectable.isNotEmpty) ...[
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.spaceBetween,
            children: [
              PosTextButton(
                onPressed: _cancelling || selectable.isEmpty
                    ? null
                    : () => setState(() {
                        final ids = selectable
                            .map((account) => account.id)
                            .toSet();
                        final firstBatch = ids
                            .take(_maxCancelSelection)
                            .toSet();
                        if (_selectedIds.containsAll(firstBatch)) {
                          _selectedIds.removeAll(ids);
                          _selectionLimitReached = false;
                        } else {
                          _selectedIds.addAll(firstBatch);
                          _selectionLimitReached =
                              ids.length > _maxCancelSelection;
                        }
                      }),
                child: Text(
                  _selectedIds.containsAll(
                            selectable
                                .take(_maxCancelSelection)
                                .map((a) => a.id),
                          ) &&
                          selectable.isNotEmpty
                      ? (es ? 'Quitar selección' : 'Clear selection')
                      : selectable.length > _maxCancelSelection
                      ? (es ? 'Seleccionar 50' : 'Select 50')
                      : (es ? 'Seleccionar todas' : 'Select all'),
                ),
              ),
              PosButton.tonal(
                onPressed: _cancelling || _selectedIds.isEmpty
                    ? null
                    : () => _confirmCancel(
                        selectable
                            .where((a) => _selectedIds.contains(a.id))
                            .toList(),
                      ),
                child: Text(
                  es
                      ? 'Anular seleccionadas (${_selectedIds.length})'
                      : 'Void selected (${_selectedIds.length})',
                ),
              ),
            ],
          ),
          if (_selectionLimitReached)
            InlineNotice(
              message: es
                  ? 'Puedes anular hasta 50 cuentas por operación.'
                  : 'You can void up to 50 accounts per operation.',
            ),
          const SizedBox(height: 12),
        ],
        if (_cancelError != null)
          InlineNotice(
            message: es
                ? 'No se anuló ninguna cuenta. ${operatorErrorMessage(context, _cancelError!)}'
                : 'No accounts were voided. ${operatorErrorMessage(context, _cancelError!)}',
            tone: InlineNoticeTone.warning,
          ),
        Expanded(
          child: _loading
              ? const Center(child: PosSpinner())
              : _error != null
              ? Center(child: Text(operatorErrorMessage(context, _error!)))
              : visible.isEmpty
              ? Center(
                  child: Text(
                    _accounts?.any(
                              (cart) =>
                                  !widget.tablelessOnly || cart.tableId == null,
                            ) !=
                            true
                        ? (es
                              ? 'No hay cuentas abiertas.'
                              : 'No open accounts.')
                        : _previousDaysOnly &&
                              _search.text.trim().isEmpty &&
                              _fulfillmentType == null
                        ? (es
                              ? 'No hay cuentas de días anteriores.'
                              : 'No accounts from previous days.')
                        : (es
                              ? 'No hay coincidencias.'
                              : 'No matching accounts.'),
                  ),
                )
              : _list(context, visible, es),
        ),
      ],
    );
  }

  Future<void> _confirmCancel(List<Cart> accounts) async {
    if (_cancelling || accounts.isEmpty || widget.onCancelCarriedOver == null) {
      return;
    }
    final es = Localizations.localeOf(context).languageCode == 'es';
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialogContext) => PosAlertDialog(
        title: Text(
          es ? 'Anular cuentas anteriores' : 'Void previous-day accounts',
        ),
        content: Text(
          es
              ? 'Se anularán ${accounts.length} ${accounts.length == 1 ? 'cuenta' : 'cuentas'} de días anteriores. Esta acción no se puede deshacer. Si alguna tiene un cobro o cambió de estado, no se anulará ninguna.'
              : '${accounts.length} previous-day ${accounts.length == 1 ? 'account' : 'accounts'} will be voided. This cannot be undone. If any account has a payment or changed state, none will be voided.',
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(es ? 'Volver' : 'Back'),
          ),
          PosButton.tonal(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(es ? 'Anular' : 'Void'),
          ),
        ],
      ),
    );
    if (accepted != true || !mounted) return;
    setState(() {
      _cancelling = true;
      _cancelError = null;
    });
    try {
      await widget.onCancelCarriedOver!(accounts);
      if (!mounted) return;
      setState(() {
        final ids = accounts.map((account) => account.id).toSet();
        _accounts = _accounts
            ?.where((account) => !ids.contains(account.id))
            .toList();
        _selectedIds.removeAll(ids);
      });
      await _load();
    } on AppException catch (error) {
      if (mounted) setState(() => _cancelError = error.code);
      await _load();
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  /// The day's own accounts first, because that is the work in front of the operator;
  /// the ones left over from a previous day go under their own heading and their own
  /// review message.
  ///
  /// Previous-day accounts need a visible review path. An unpaid check can be
  /// intentionally carried over, so the message does not imply automatic voiding.
  Widget _list(BuildContext context, List<Cart> visible, bool es) {
    final now = widget.clock();
    final carried = <Cart>[];
    final today = <Cart>[];
    for (final cart in visible) {
      (_carried(cart, now) ? carried : today).add(cart);
    }
    return ListView(
      children: [
        if (carried.isNotEmpty) ...[
          InlineNotice(
            message: es
                ? '${carried.length} ${carried.length == 1 ? 'cuenta quedó abierta' : 'cuentas quedaron abiertas'} de un día anterior. Revisa cada cuenta antes de cobrarla o anularla.'
                : '${carried.length} ${carried.length == 1 ? 'account was' : 'accounts were'} left open from a previous day. Review payments before charging or voiding.',
            tone: InlineNoticeTone.warning,
          ),
          const SizedBox(height: 12),
          _SectionLabel(
            text: es ? 'De un día anterior' : 'From a previous day',
          ),
          for (final cart in carried)
            _row(context, cart, es, carried: true, now: now),
          if (!_previousDaysOnly) ...[
            const SizedBox(height: 12),
            _SectionLabel(text: es ? 'De hoy' : 'Today'),
          ],
        ],
        for (final cart in today)
          _row(context, cart, es, carried: false, now: now),
      ],
    );
  }

  /// Whether this account belongs to a day before the one in progress.
  ///
  /// The server's date wins when it is current. The active cart can carry an older
  /// date, so it cannot always define today for the other open accounts.
  bool _carried(Cart cart, DateTime now) {
    final today = widget.currentBusinessDate;
    final localDay = operationalDayStart(now);
    final localDate = localDay.toIso8601String().substring(0, 10);
    if (today != null && today.isNotEmpty && today.compareTo(localDate) >= 0) {
      final accountDay = TotalsPreview.fromJson(cart.totals).businessDate;
      if (accountDay.isNotEmpty) return accountDay.compareTo(today) < 0;
    }
    return openedBeforeOperationalDayStart(cart.createdAt, now: now);
  }

  Widget _row(
    BuildContext context,
    Cart cart,
    bool es, {
    required bool carried,
    required DateTime now,
  }) {
    final pending = cart.items.where((line) => line['fired'] != true).length;
    final sent = cart.items.where((line) => line['fired'] == true).length;
    final totals = TotalsPreview.fromJson(cart.totals);
    final money = CatalogMoney.fromJson(totals.grandTotal);
    final age = elapsedSinceLabel(cart.createdAt, spanish: es, now: now);
    final details = [
      accountReference(cart),
      if (carried)
        '${es ? 'Fecha operativa' : 'Business date'}: ${totals.businessDate}',
      '${es ? 'Abrió' : 'Opened by'}: ${cart.operatorName ?? (es ? 'Sin nombre' : 'Unnamed')}',
      ?age,
      if (pending > 0)
        es
            ? '$pending ${pending == 1 ? 'pendiente' : 'pendientes'} de enviar'
            : '$pending not sent',
      if (sent > 0)
        es ? '$sent ${sent == 1 ? 'enviado' : 'enviados'}' : '$sent sent',
      if (pending + sent == 0) es ? 'Cuenta vacía' : 'Empty account',
    ].join('\n');
    final theme = PosTheme.of(context);
    final compact = MediaQuery.sizeOf(context).width < 600;
    final title = Text(
      [
        accountDisplayTitle(cart, spanish: es),
        if (carried && totals.businessDate.isNotEmpty) totals.businessDate,
        ?cart.tableName,
      ].join(' · '),
      maxLines: carried ? 2 : 1,
      overflow: TextOverflow.ellipsis,
    );
    return PosTooltip(
      message: details,
      child: PosListRow(
        key: ValueKey('open-account-${cart.id}'),
        leading:
            carried && _previousDaysOnly && widget.onCancelCarriedOver != null
            ? PosIconButton(
                tooltip: _selectedIds.contains(cart.id)
                    ? (es ? 'Quitar selección' : 'Deselect')
                    : (es ? 'Seleccionar cuenta' : 'Select account'),
                icon: PosIcon(
                  _selectedIds.contains(cart.id)
                      ? PosGlyphs.checkBox
                      : PosGlyphs.checkBoxOutlineBlank,
                ),
                onPressed: _cancelling
                    ? null
                    : () => setState(() {
                        if (_selectedIds.contains(cart.id)) {
                          _selectedIds.remove(cart.id);
                          _selectionLimitReached = false;
                        } else if (_selectedIds.length < _maxCancelSelection) {
                          _selectedIds.add(cart.id);
                        } else {
                          _selectionLimitReached = true;
                        }
                      }),
              )
            : PosIcon(
                cart.tableId == null
                    ? PosGlyphs.receiptLong
                    : PosGlyphs.tableRestaurantOutlined,
              ),
        title: carried && !compact
            ? Row(
                children: [
                  Expanded(child: title),
                  const SizedBox(width: 8),
                  PosBadge(
                    label: Text(es ? 'Anterior' : 'Earlier'),
                    backgroundColor: theme.colorScheme.tertiary.withValues(
                      alpha: .18,
                    ),
                  ),
                ],
              )
            : title,
        subtitle: Text(
          [
            if (carried && age != null) age,
            if (carried && compact) es ? 'Anterior' : 'Earlier',
            if (cart.tableId == null) es ? 'Sin mesa' : 'No table',
            ?cart.accountName,
            if (!carried) accountOpenedAt(context, cart),
            if (pending > 0) es ? 'Por enviar' : 'Not sent',
            if (pending == 0 && sent > 0) es ? 'Enviada' : 'Sent',
          ].join(' · '),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing:
            carried && _previousDaysOnly && widget.onCancelCarriedOver != null
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(formatMinorUnits(money.minorUnits, money.currency)),
                  PosTextButton(
                    onPressed: _cancelling
                        ? null
                        : () => _confirmCancel([cart]),
                    child: Text(es ? 'Anular' : 'Void'),
                  ),
                ],
              )
            : Text(formatMinorUnits(money.minorUnits, money.currency)),
        onTap: _cancelling
            ? null
            : _previousDaysOnly && widget.onCancelCarriedOver != null
            ? () => setState(() {
                if (_selectedIds.contains(cart.id)) {
                  _selectedIds.remove(cart.id);
                  _selectionLimitReached = false;
                } else if (_selectedIds.length < _maxCancelSelection) {
                  _selectedIds.add(cart.id);
                } else {
                  _selectionLimitReached = true;
                }
              })
            : () => widget.onSelected(cart),
      ),
    );
  }
}

/// A quiet heading over a group of rows. It never carries a number: the count that
/// matters is the one the notice above it already says out loud.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(left: 4, top: 4, bottom: 8),
      child: Text(
        text.toUpperCase(),
        style: theme.textTheme.labelMedium?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
          letterSpacing: .8,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
