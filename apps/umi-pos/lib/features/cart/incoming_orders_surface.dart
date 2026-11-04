import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
import '../../shared/money.dart';
import '../../shared/widgets/station_document.dart';
import '../../shared/widgets/status_card.dart';
import 'cart_controller.dart';
import 'incoming_orders_controller.dart';

/// Present the incoming-orders surface: the WhatsApp / web orders this till can pick up
/// (ADR 2026-09-13-pos-channel-attribution). Picking one binds the active cart to it — which
/// freezes the channel on the eventual committed sale — and adopts the bound cart so the
/// operator rings the items on this till.
Future<void> showIncomingOrders(
  BuildContext context, {
  required IncomingOrdersController incoming,
  required CartController cart,
  required String merchantId,
  required String locationId,
  required String operatorSessionId,
}) => Navigator.of(context).push<void>(
  PosPageRoute<void>(
    builder: (_) => IncomingOrdersSurface(
      incoming: incoming,
      cart: cart,
      merchantId: merchantId,
      locationId: locationId,
      operatorSessionId: operatorSessionId,
    ),
  ),
);

final class IncomingOrdersSurface extends StatefulWidget {
  const IncomingOrdersSurface({
    required this.incoming,
    required this.cart,
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
    this.embedded = false,
    this.onAdopted,
    super.key,
  });
  final bool embedded;
  final VoidCallback? onAdopted;
  final IncomingOrdersController incoming;
  final CartController cart;
  final String merchantId;
  final String locationId;
  final String operatorSessionId;

  @override
  State<IncomingOrdersSurface> createState() => IncomingOrdersSurfaceState();
}

final class IncomingOrdersSurfaceState extends State<IncomingOrdersSurface> {
  String? _selectedId;
  @override
  void initState() {
    super.initState();
    widget.incoming.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _reload();
    });
  }

  @override
  void dispose() {
    widget.incoming.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _take(PosIncomingOrder order) async {
    final cart = widget.cart.state.cart;
    if (cart == null) return;
    final bound = await widget.incoming.pickUp(cart, order);
    if (bound != null && mounted) {
      widget.cart.restore(bound);
      if (widget.onAdopted != null) {
        widget.onAdopted!();
      } else {
        Navigator.pop(context);
      }
    }
  }

  Future<void> _reload() => widget.incoming.load(
    widget.merchantId,
    widget.locationId,
    widget.operatorSessionId,
  );

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.incoming.state;
    return PosPage(
      appBar: PosHeader(
        automaticallyImplyLeading: false,
        title: StationHeading(
          title: l.incomingOrdersTitle,
          subtitle: Localizations.localeOf(context).languageCode == 'es'
              ? 'Menú digital'
              : 'Digital menu',
        ),
        leading: widget.embedded
            ? null
            : PosIconButton(
                tooltip: l.closeAction,
                onPressed: () => Navigator.pop(context),
                icon: const PosIcon(PosGlyphs.arrowBack),
              ),
        actions: [
          if (state.phase == IncomingOrdersPhase.ready)
            PosTag(
              label: Text(
                Localizations.localeOf(context).languageCode == 'es'
                    ? '${state.orders.length} por revisar'
                    : '${state.orders.length} to review',
              ),
            ),
          PosIconButton(
            tooltip: l.refreshAction,
            onPressed:
                state.phase == IncomingOrdersPhase.loading || state.binding
                ? null
                : _reload,
            icon: const PosIcon(PosGlyphs.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: _body(l, state),
        ),
      ),
    );
  }

  Widget _body(AppLocalizations l, IncomingOrdersState state) {
    switch (state.phase) {
      case IncomingOrdersPhase.idle:
      case IncomingOrdersPhase.loading:
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const PosProgress(),
              const SizedBox(height: UmiSpacing.md),
              Semantics(
                liveRegion: true,
                child: Text(
                  l.incomingOrdersLoading,
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        );
      case IncomingOrdersPhase.failure:
        return StatusCard(
          icon: PosGlyphs.cloudOff,
          title: l.incomingOrdersError,
          message: l.incomingOrdersErrorDescription,
          action: PosButton.icon(
            onPressed: _reload,
            icon: const PosIcon(PosGlyphs.refresh),
            label: Text(l.retryAction),
          ),
        );
      case IncomingOrdersPhase.ready:
        if (state.orders.isEmpty) {
          return StatusCard(
            icon: PosGlyphs.inventory2Outlined,
            title: l.incomingOrdersEmpty,
            message: l.incomingOrdersEmptyDescription,
            action: PosOutlineButton.icon(
              onPressed: _reload,
              icon: const PosIcon(PosGlyphs.refresh),
              label: Text(l.refreshAction),
            ),
          );
        }
        return LayoutBuilder(
          builder: (context, box) {
            final wide = box.maxWidth >= 720;
            final selected = state.orders
                .where((order) => order.orderId == _selectedId)
                .firstOrNull;
            final effective = selected ?? (wide ? state.orders.first : null);
            Widget detail(PosIncomingOrder order) => SingleChildScrollView(
              key: const ValueKey('incoming-detail'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!wide)
                    Align(
                      alignment: Alignment.centerLeft,
                      child: PosTextButton.icon(
                        onPressed: () => setState(() => _selectedId = null),
                        icon: const PosIcon(PosGlyphs.arrowBack),
                        label: Text(
                          Localizations.localeOf(context).languageCode == 'es'
                              ? 'Todos los pedidos'
                              : 'All orders',
                        ),
                      ),
                    ),
                  _OrderCard(
                    order: order,
                    binding: state.binding,
                    onTake: () => _take(order),
                  ),
                ],
              ),
            );
            final list = ListView.separated(
              key: const ValueKey('incoming-list'),
              padding: const EdgeInsets.all(12),
              itemCount: state.orders.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (_, index) {
                final order = state.orders[index];
                return PosListRow(
                  key: ValueKey('incoming-${order.orderId}'),
                  contentPadding: const EdgeInsets.all(16),
                  selected: effective?.orderId == order.orderId,
                  title: Text(order.reference ?? order.orderId),
                  subtitle: Text(
                    [
                      if (order.customerName != null) order.customerName!,
                      _incomingStatus(order, context),
                    ].join(' · '),
                  ),
                  onTap: () => setState(() => _selectedId = order.orderId),
                  trailing: const PosIcon(PosGlyphs.chevronRight, size: 18),
                );
              },
            );
            if (!wide) return effective == null ? list : detail(effective);
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  width: 304,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: PosTheme.of(context).colorScheme.background,
                      border: Border(
                        right: BorderSide(
                          color: PosTheme.of(
                            context,
                          ).colorScheme.outlineVariant,
                        ),
                      ),
                    ),
                    child: list,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(child: detail(effective!)),
              ],
            );
          },
        );
    }
  }
}

String _incomingStatus(PosIncomingOrder order, BuildContext context) {
  final es = Localizations.localeOf(context).languageCode == 'es';
  final status = switch (order.status) {
    'placed' => es ? 'Recibido' : 'Received',
    'confirmed' => es ? 'Confirmado' : 'Confirmed',
    'preparing' => es ? 'En preparación' : 'Preparing',
    'ready' => es ? 'Listo' : 'Ready',
    'completed' => es ? 'Completado' : 'Completed',
    'cancelled' => es ? 'Cancelado' : 'Cancelled',
    _ => order.status,
  };
  final placed = DateTime.tryParse(order.placedAt ?? '');
  final minutes = placed == null
      ? null
      : DateTime.now().difference(placed).inMinutes;
  return [
    status,
    if (minutes != null && minutes >= 0)
      es ? 'Hace $minutes min' : '$minutes min ago',
  ].join(' · ');
}

final class _OrderCard extends StatelessWidget {
  const _OrderCard({
    required this.order,
    required this.binding,
    required this.onTake,
  });
  final PosIncomingOrder order;
  final bool binding;
  final VoidCallback onTake;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = PosTheme.of(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(switch (order.channel) {
            'whatsapp' => 'WhatsApp',
            'web' => 'Web',
            'aggregator' => 'Delivery',
            _ => order.channel,
          }, style: theme.textTheme.bodySmall),
          const SizedBox(height: 8),
          Text(
            order.reference ?? order.orderId,
            style: theme.textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          Text(
            order.customerName ??
                (es ? 'Cliente no indicado' : 'Customer not provided'),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: 16),
          Text(
            _incomingStatus(order, context),
            style: theme.textTheme.bodyMedium,
          ),
          const PosDivider(),
          Text(
            es
                ? '${order.itemCount} líneas de productos'
                : '${order.itemCount} product lines',
          ),
          const SizedBox(height: 16),
          Text(
            es
                ? 'El detalle de productos, notas y horario de entrega no está disponible en esta terminal. Al atender se vincula la referencia; captura y verifica los productos antes de cobrar.'
                : 'Product details, notes and pickup time are unavailable on this terminal. Taking the order links its reference; enter and verify the items before charging.',
          ),
          const SizedBox(height: 24),
          Text(
            es ? 'Total del pedido de origen' : 'Source order total',
            style: theme.textTheme.bodySmall,
          ),
          Text(
            formatMinorUnits(order.totalMinorUnits, 'MXN'),
            style: theme.textTheme.headlineSmall,
          ),
          const SizedBox(height: 24),
          PosButton(
            onPressed: binding ? null : onTake,
            child: Text(l.incomingOrdersTake),
          ),
        ],
      ),
    );
  }
}
