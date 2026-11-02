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
  @override
  void initState() {
    super.initState();
    widget.incoming.addListener(_changed);
    widget.incoming.load(
      widget.merchantId,
      widget.locationId,
      widget.operatorSessionId,
    );
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
        return ListView.separated(
          itemCount: state.orders.length,
          separatorBuilder: (_, _) => const SizedBox(height: UmiSpacing.sm),
          itemBuilder: (_, index) => _OrderCard(
            order: state.orders[index],
            binding: state.binding,
            onTake: () => _take(state.orders[index]),
          ),
        );
    }
  }
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
    return PosCard(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              [
                _channelLabel(order.channel),
                order.reference,
              ].whereType<String>().join(' · '),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              order.customerName ?? order.reference ?? order.orderId,
              style: theme.textTheme.headlineSmall?.copyWith(
                fontSize: 24,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                const PosIcon(PosGlyphs.shoppingBagOutlined, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    es
                        ? '${order.itemCount} productos'
                        : '${order.itemCount} items',
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: Text(l.totalLabel, style: theme.textTheme.bodySmall),
                ),
                Flexible(
                  flex: 2,
                  child: FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerRight,
                    child: Text(
                      formatMinorUnits(order.totalMinorUnits, 'MXN'),
                      style: theme.textTheme.headlineSmall,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            PosButton(
              onPressed: binding ? null : onTake,
              child: Row(
                children: [
                  Expanded(child: Text(l.incomingOrdersTake)),
                  const PosIcon(PosGlyphs.arrowForward, size: 18),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _channelLabel(String channel) {
    switch (channel) {
      case 'whatsapp':
        return 'WhatsApp';
      case 'web':
        return 'Web';
      case 'aggregator':
        return 'Delivery';
      default:
        return channel;
    }
  }
}
