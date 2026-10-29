import 'package:umi_contract/umi_contract.dart';

import '../../core/localization/app_localizations.dart';
import '../../core/security/operator_permissions.dart';
import '../../core/theme/pos_ui.dart';
import '../entry/entry_controller.dart';
import 'kitchen_board_controller.dart';
import 'kitchen_fulfillment_badge.dart';
import 'kitchen_ticket_age.dart';

/// Work without a station needs an explicit routing decision, regardless of age.
class KitchenUnassignedSurface extends StatelessWidget {
  const KitchenUnassignedSurface({
    required this.controller,
    required this.entry,
    this.clock = DateTime.now,
    super.key,
  });

  final KitchenBoardController controller;
  final EntryController entry;
  final DateTime Function() clock;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    return AnimatedBuilder(
      animation: Listenable.merge([controller, entry]),
      builder: (context, _) {
        final permissions = OperatorPermissions(
          entry.state.operator?.permissions ?? const [],
        );
        final canRead = permissions.allows('kitchen.read');
        final orders = controller.unassignedOrders;
        return PosPage(
          appBar: PosHeader(
            title: Text(es ? 'Sin estación' : 'Unassigned'),
            actions: [
              PosIconButton(
                tooltip: es ? 'Actualizar' : 'Refresh',
                onPressed: controller.unassignedLoading
                    ? null
                    : controller.refresh,
                icon: const PosIcon(PosGlyphs.refresh),
              ),
            ],
          ),
          body: !canRead
              ? Center(
                  child: Text(
                    es
                        ? 'No tienes permiso para ver esta bandeja.'
                        : 'You cannot view this queue.',
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(20),
                  children: [
                    Text(
                      es
                          ? 'Estos productos no tienen estación. Puedes asignar estaciones a productos y categorías desde Cocina en la consola de administración.\n\nDespués, actualiza esta bandeja y revisa la fecha antes de aplicar las rutas actuales. Las comandas permanecen hasta resolverlas; cambiar de día no las borra.'
                          : 'These items have no station. You can assign stations to products and categories in Kitchen in the administration console.\n\nThen refresh this queue and check the date before applying the current routes. Tickets remain until resolved; a new day does not remove them.',
                    ),
                    const SizedBox(height: 12),
                    if (controller.unassignedErrorCode != null)
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          controller.unassignedErrorCode ==
                                  'KITCHEN_UNASSIGNED_UNAVAILABLE'
                              ? (es
                                    ? 'No se pudo actualizar esta bandeja. Actualiza antes de resolver una comanda.'
                                    : 'Could not refresh this queue. Refresh before resolving a ticket.')
                              : (es
                                    ? 'No pudimos confirmar la acción. La comanda o las rutas pudieron cambiar. Actualiza y revisa la información antes de intentar de nuevo.'
                                    : 'We could not confirm the action. The ticket or routes may have changed. Refresh and review the details before trying again.'),
                        ),
                      ),
                    if (controller.lastUnassignedResult case final result?)
                      Semantics(
                        liveRegion: true,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          child: Text(
                            result.discardedItems > 0
                                ? (es
                                      ? '${result.discardedItems} productos cancelados descartados.'
                                      : '${result.discardedItems} cancelled items dismissed.')
                                : (es
                                      ? '${result.resolvedItems} productos enviados a su estación. ${result.remainingItems} siguen sin estación.'
                                      : '${result.resolvedItems} items sent to their station. ${result.remainingItems} remain unassigned.'),
                          ),
                        ),
                      ),
                    if (!controller.unassignedLoaded)
                      Text(es ? 'Cargando comandas…' : 'Loading tickets…')
                    else if (orders.isEmpty)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 24),
                        child: Text(
                          es
                              ? 'No hay productos sin estación.'
                              : 'There are no unassigned items.',
                        ),
                      ),
                    for (final order in orders)
                      _ticket(context, order, permissions, es),
                  ],
                ),
        );
      },
    );
  }

  Widget _ticket(
    BuildContext context,
    KitchenUnassignedOrderProjection order,
    OperatorPermissions permissions,
    bool es,
  ) {
    final cancelled = order.status == 'cancelled';
    final l10n = AppLocalizations.of(context);
    final queuedAt = DateTime.tryParse(order.queuedAt);
    final age = queuedAt == null
        ? null
        : formatTicketAge(
            clock().difference(queuedAt),
            now: l10n.kitchenElapsedNow,
            minutes: l10n.kitchenElapsedMinutes,
            hoursMinutes: l10n.kitchenElapsedHoursMinutes,
            daysHours: l10n.kitchenElapsedDaysHours,
          );
    final proposed = {
      for (final route in order.proposedRoutes) route['itemId']: route,
    };
    final canRoute = order.proposedRoutes.any(
      (route) => route['stationId'] != null,
    );
    final blocked =
        controller.unassignedBusyTarget != null ||
        controller.unassignedLoading ||
        controller.unassignedErrorCode == 'KITCHEN_UNASSIGNED_UNAVAILABLE';
    final scheme = PosTheme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: PosSurface(
        key: ValueKey('unassigned-ticket-${order.id}'),
        color: scheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    order.publicReference,
                    style: PosTheme.of(context).textTheme.titleLarge,
                  ),
                  KitchenFulfillmentBadge(
                    fulfillmentType: order.fulfillmentType,
                  ),
                ],
              ),
              Text('${es ? 'Fecha' : 'Date'}: ${order.businessDate}'),
              if (age != null) Text('${es ? 'Antigüedad' : 'Age'}: $age'),
              Text(
                cancelled
                    ? (es ? 'Cancelado' : 'Cancelled')
                    : (es ? 'Sin estación' : 'Unassigned'),
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: cancelled ? scheme.error : scheme.onSurface,
                ),
              ),
              const PosDivider(),
              for (final raw in order.items) ...[
                Text('${raw['quantity']} × ${raw['productName']}'),
                if (!cancelled)
                  Text(
                    proposed[raw['id']]?['stationName'] != null
                        ? '${es ? 'Destino actual' : 'Current destination'}: ${proposed[raw['id']]!['stationName']}'
                        : (es
                              ? 'Sin ruta disponible. Asigna una estación al producto o su categoría desde Cocina en la consola de administración.'
                              : 'No route available. Assign a station to this product or its category in Kitchen in the administration console.'),
                  ),
                const SizedBox(height: 8),
              ],
              if (cancelled && permissions.allows('kitchen.cancel_ack'))
                Align(
                  alignment: Alignment.centerRight,
                  child: PosButton(
                    key: ValueKey('discard-unassigned-${order.id}'),
                    onPressed: blocked
                        ? null
                        : () => controller.discardUnassigned(order),
                    child: Text(es ? 'Descartar' : 'Dismiss'),
                  ),
                )
              else if (!cancelled &&
                  permissions.allows('kitchen.station.manage'))
                Align(
                  alignment: Alignment.centerRight,
                  child: PosButton(
                    key: ValueKey('resolve-unassigned-${order.id}'),
                    onPressed: blocked || !canRoute
                        ? null
                        : () => _confirmRoutes(context, order, es),
                    child: Text(
                      es ? 'Aplicar rutas actuales' : 'Apply current routes',
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _confirmRoutes(
    BuildContext context,
    KitchenUnassignedOrderProjection order,
    bool es,
  ) async {
    final accepted = await showPosDialog<bool>(
      context: context,
      builder: (dialog) => PosAlertDialog(
        title: Text(
          es
              ? '¿Enviar estos productos a preparar?'
              : 'Send these items for preparation?',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${order.publicReference} · ${order.businessDate}'),
            const SizedBox(height: 12),
            for (final route in order.proposedRoutes)
              Text(
                '${route['productName']} → ${route['stationName'] ?? (es ? 'sigue sin estación' : 'remains unassigned')}',
              ),
            const SizedBox(height: 12),
            Text(
              es
                  ? 'Confirma que este pedido todavía debe prepararse. Sólo se enviarán los productos con destino disponible.'
                  : 'Confirm this order still needs preparation. Only items with an available destination will be sent.',
            ),
          ],
        ),
        actions: [
          PosTextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: Text(es ? 'Volver' : 'Back'),
          ),
          PosButton(
            key: const ValueKey('confirm-unassigned-routes'),
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(
              es
                  ? 'Sí, enviar a estas estaciones'
                  : 'Yes, send to these stations',
            ),
          ),
        ],
      ),
    );
    if (accepted != true || !context.mounted) return;
    await controller.resolveUnassigned(order);
  }
}
