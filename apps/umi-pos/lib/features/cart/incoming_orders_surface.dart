import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/theme/umi_theme.dart';
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
}) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  constraints: const BoxConstraints(maxWidth: 680),
  builder: (_) => _IncomingOrders(
    incoming: incoming,
    cart: cart,
    merchantId: merchantId,
    locationId: locationId,
    operatorSessionId: operatorSessionId,
  ),
);

final class _IncomingOrders extends StatefulWidget {
  const _IncomingOrders({
    required this.incoming,
    required this.cart,
    required this.merchantId,
    required this.locationId,
    required this.operatorSessionId,
  });
  final IncomingOrdersController incoming;
  final CartController cart;
  final String merchantId;
  final String locationId;
  final String operatorSessionId;

  @override
  State<_IncomingOrders> createState() => _IncomingOrdersState();
}

final class _IncomingOrdersState extends State<_IncomingOrders> {
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
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final state = widget.incoming.state;
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .7,
        child: Padding(
          padding: const EdgeInsets.all(UmiSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      l.incomingOrdersTitle,
                      style: Theme.of(context).textTheme.headlineMedium,
                    ),
                  ),
                  IconButton(
                    tooltip: l.closeAction,
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: UmiSpacing.md),
              Expanded(child: _body(l, state)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(AppLocalizations l, IncomingOrdersState state) {
    switch (state.phase) {
      case IncomingOrdersPhase.idle:
      case IncomingOrdersPhase.loading:
        return const Center(child: CircularProgressIndicator());
      case IncomingOrdersPhase.failure:
        return Center(child: Text(l.incomingOrdersError));
      case IncomingOrdersPhase.ready:
        if (state.orders.isEmpty) {
          return Center(child: Text(l.incomingOrdersEmpty));
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
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(UmiSpacing.md),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    order.customerName ?? order.reference ?? order.orderId,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: UmiSpacing.xs),
                  Text(
                    '${_channelLabel(order.channel)} · ${order.itemCount} · '
                    '\$${(order.totalMinorUnits / 100).toStringAsFixed(2)}',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
            const SizedBox(width: UmiSpacing.md),
            FilledButton(
              onPressed: binding ? null : onTake,
              child: Text(l.incomingOrdersTake),
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
