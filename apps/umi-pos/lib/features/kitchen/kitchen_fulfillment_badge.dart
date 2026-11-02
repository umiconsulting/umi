import '../../core/localization/app_localizations.dart';
import '../../core/theme/pos_ui.dart';
import '../../core/theme/umi_theme.dart';

/// Shows the declared order type independently of preparation and priority.
class KitchenFulfillmentBadge extends StatelessWidget {
  const KitchenFulfillmentBadge({required this.fulfillmentType, super.key});

  final String? fulfillmentType;

  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final scheme = theme.colorScheme;
    final l10n = AppLocalizations.of(context);
    final (label, icon) = switch (fulfillmentType) {
      'dine_in' => (
        l10n.kitchenFulfillmentDineIn,
        PosGlyphs.tableRestaurantOutlined,
      ),
      'takeout' => (
        l10n.kitchenFulfillmentTakeout,
        PosGlyphs.shoppingBagOutlined,
      ),
      'delivery' => (l10n.kitchenFulfillmentDelivery, PosGlyphs.routeOutlined),
      _ => (l10n.kitchenFulfillmentUnknown, PosGlyphs.helpOutline),
    };
    final foreground = scheme.onSurface;
    final background = scheme.surfaceContainerHigh;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UmiSpacing.sm,
        vertical: 7,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ExcludeSemantics(child: PosIcon(icon, size: 16, color: foreground)),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: theme.textTheme.labelMedium?.copyWith(
                color: foreground,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
