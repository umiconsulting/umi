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
    final dark = scheme.dark;
    final (label, icon, foreground, background) = switch (fulfillmentType) {
      'dine_in' => (
        l10n.kitchenFulfillmentDineIn,
        PosGlyphs.tableRestaurantOutlined,
        dark ? const Color(0xFFA8C7FA) : const Color(0xFF174EA6),
        dark ? const Color(0xFF15325A) : const Color(0xFFE8F0FE),
      ),
      'takeout' => (
        l10n.kitchenFulfillmentTakeout,
        PosGlyphs.shoppingBagOutlined,
        dark ? const Color(0xFFD8B4FE) : const Color(0xFF6B21A8),
        dark ? const Color(0xFF3B1D58) : const Color(0xFFF3E8FF),
      ),
      'delivery' => (
        l10n.kitchenFulfillmentDelivery,
        PosGlyphs.routeOutlined,
        scheme.onSurfaceVariant,
        scheme.surface,
      ),
      _ => (
        l10n.kitchenFulfillmentUnknown,
        PosGlyphs.helpOutline,
        scheme.onSurfaceVariant,
        scheme.surface,
      ),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: UmiSpacing.sm,
        vertical: 4,
      ),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: foreground.withValues(alpha: .45)),
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
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
