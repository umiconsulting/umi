import 'dart:async';

import 'package:flutter/material.dart';
import 'package:umi_contract/umi_contract.dart';

import '../../core/theme/umi_theme.dart';
import '../entry/entry_controller.dart';
import 'kitchen_board_controller.dart';

/// Opens the unified KDS mode (PoloTab pattern): the same app, on a device that
/// runs the kitchen, shows the order board full-screen.
Future<void> showKitchenBoard(
  BuildContext context, {
  required KitchenBoardController controller,
  required EntryController entry,
}) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    fullscreenDialog: true,
    builder: (_) => KitchenBoardSurface(controller: controller, entry: entry),
  ),
);

final class KitchenBoardSurface extends StatefulWidget {
  const KitchenBoardSurface({
    required this.controller,
    required this.entry,
    super.key,
  });
  final KitchenBoardController controller;
  final EntryController entry;

  @override
  State<KitchenBoardSurface> createState() => _KitchenBoardSurfaceState();
}

class _KitchenBoardSurfaceState extends State<KitchenBoardSurface> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _load();
    // The kitchen board refreshes on its own so a cook never taps to see a new
    // ticket. (A realtime feed replaces this poll once device identity unifies.)
    _ticker = Timer.periodic(const Duration(seconds: 8), (_) => _load());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    widget.controller.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  void _load() {
    final state = widget.entry.state;
    final merchant = state.selectedTenant?.id;
    final location = state.selectedBranch?.id;
    final operator = state.operator?.id;
    if (merchant == null || location == null || operator == null) return;
    unawaited(
      widget.controller.load(
        merchant,
        PosKitchenOrderQuery(locationId: location, operatorSessionId: operator),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final state = widget.controller.state;
    return Scaffold(
      appBar: AppBar(
        title: Text(es ? 'Cocina' : 'Kitchen'),
        actions: [
          IconButton(
            tooltip: es ? 'Actualizar' : 'Refresh',
            onPressed: _load,
            icon: const Icon(Icons.refresh),
          ),
          IconButton(
            tooltip: es ? 'Cerrar' : 'Close',
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(Icons.close),
          ),
        ],
      ),
      body: SafeArea(
        child: switch (state.phase) {
          KitchenBoardPhase.loading when state.orders.isEmpty => const Center(
            child: CircularProgressIndicator(),
          ),
          KitchenBoardPhase.failure when state.orders.isEmpty => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.cloud_off_outlined, size: 56),
                const SizedBox(height: UmiSpacing.md),
                Text(
                  es
                      ? 'No se pudo cargar la cocina.'
                      : 'Could not load the kitchen.',
                ),
                const SizedBox(height: UmiSpacing.md),
                FilledButton(
                  onPressed: _load,
                  child: Text(es ? 'Reintentar' : 'Retry'),
                ),
              ],
            ),
          ),
          _ when state.orders.isEmpty => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.restaurant_menu_outlined,
                  size: 56,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: UmiSpacing.md),
                Text(
                  es ? 'Sin comandas en cocina.' : 'No kitchen tickets.',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ],
            ),
          ),
          _ => SingleChildScrollView(
            padding: const EdgeInsets.all(UmiSpacing.md),
            child: Wrap(
              spacing: UmiSpacing.md,
              runSpacing: UmiSpacing.md,
              children: [
                for (final order in state.orders)
                  _TicketCard(order: order, es: es),
              ],
            ),
          ),
        },
      ),
    );
  }
}

final class _TicketCard extends StatelessWidget {
  const _TicketCard({required this.order, required this.es});
  final KitchenOrderProjection order;
  final bool es;

  ({Color color, String label}) _statusStyle(
    ColorScheme scheme,
  ) => switch (order.status) {
    'ready' => (color: const Color(0xFF3cb44b), label: es ? 'Listo' : 'Ready'),
    'partially_ready' => (
      color: const Color(0xFFf58231),
      label: es ? 'Parcial' : 'Partial',
    ),
    'in_preparation' => (
      color: const Color(0xFF2E7DFF),
      label: es ? 'En preparación' : 'Preparing',
    ),
    'exception' => (color: scheme.error, label: es ? 'Excepción' : 'Exception'),
    _ => (color: scheme.outline, label: es ? 'En cola' : 'Queued'),
  };

  String _elapsed() {
    final queued = DateTime.tryParse(order.queuedAt);
    if (queued == null) return '';
    final mins = DateTime.now().toUtc().difference(queued.toUtc()).inMinutes;
    return mins <= 0 ? (es ? 'ahora' : 'now') : '$mins min';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = _statusStyle(scheme);
    final urgent = order.priority == 'urgent';
    final high = order.priority == 'high';
    final accent = urgent
        ? scheme.error
        : high
        ? const Color(0xFFf58231)
        : status.color;
    final items = order.items.map(KitchenOrderItem.fromJson).toList();
    return SizedBox(
      width: 300,
      child: Material(
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(height: 4, color: accent),
            Padding(
              padding: const EdgeInsets.all(UmiSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          order.publicReference,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      Text(
                        _elapsed(),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      _Pill(color: status.color, label: status.label),
                      if (urgent || high) ...[
                        const SizedBox(width: UmiSpacing.sm),
                        _Pill(
                          color: accent,
                          label: urgent
                              ? (es ? 'Urgente' : 'Urgent')
                              : (es ? 'Alta' : 'High'),
                        ),
                      ],
                    ],
                  ),
                  const Divider(height: UmiSpacing.lg),
                  for (final item in items)
                    // A voided/cancelled line (e.g. a refund cancelled the un-started work)
                    // is struck through, not removed — the cook must see it was pulled, the
                    // Toast pattern ("(VOIDED)" with lines through the item), not have it
                    // silently vanish.
                    Builder(
                      builder: (context) {
                        final voided =
                            item.status == 'cancelled' || item.status == 'exception';
                        return Padding(
                          padding: const EdgeInsets.only(bottom: UmiSpacing.sm),
                          child: Opacity(
                            opacity: voided ? 0.55 : 1,
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                SizedBox(
                                  width: 28,
                                  child: Text(
                                    '${item.quantity}×',
                                    style: Theme.of(context).textTheme.titleSmall
                                        ?.copyWith(
                                          fontWeight: FontWeight.w700,
                                          decoration: voided
                                              ? TextDecoration.lineThrough
                                              : null,
                                        ),
                                  ),
                                ),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Flexible(
                                            child: Text(
                                              item.productName,
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .bodyLarge
                                                  ?.copyWith(
                                                    decoration: voided
                                                        ? TextDecoration.lineThrough
                                                        : null,
                                                    color: voided
                                                        ? scheme.onSurfaceVariant
                                                        : null,
                                                  ),
                                            ),
                                          ),
                                          if (voided) ...[
                                            const SizedBox(width: UmiSpacing.sm),
                                            Container(
                                              padding: const EdgeInsets.symmetric(
                                                horizontal: 6,
                                                vertical: 1,
                                              ),
                                              decoration: BoxDecoration(
                                                color: scheme.error.withValues(
                                                  alpha: .16,
                                                ),
                                                borderRadius:
                                                    BorderRadius.circular(6),
                                              ),
                                              child: Text(
                                                es ? 'ANULADO' : 'VOIDED',
                                                style: Theme.of(context)
                                                    .textTheme
                                                    .labelSmall
                                                    ?.copyWith(
                                                      color: scheme.error,
                                                      fontWeight: FontWeight.w700,
                                                      letterSpacing: 0.5,
                                                    ),
                                              ),
                                            ),
                                          ],
                                        ],
                                      ),
                                      if (item.variantName != null ||
                                          item.modifiers.isNotEmpty)
                                        Text(
                                          [
                                            if (item.variantName != null)
                                              item.variantName!,
                                            ...item.modifiers,
                                          ].join(' · '),
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.copyWith(
                                                color: scheme.onSurfaceVariant,
                                                decoration: voided
                                                    ? TextDecoration.lineThrough
                                                    : null,
                                              ),
                                        ),
                                      if (item.preparationNote != null)
                                        Text(
                                          item.preparationNote!,
                                          style: Theme.of(context)
                                              .textTheme
                                              .bodySmall
                                              ?.copyWith(
                                                color: scheme.error,
                                                fontStyle: FontStyle.italic,
                                              ),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

final class _Pill extends StatelessWidget {
  const _Pill({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: UmiSpacing.sm, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: .18),
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: color),
    ),
    child: Text(
      label,
      style: Theme.of(context).textTheme.labelMedium?.copyWith(
        color: color,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}
