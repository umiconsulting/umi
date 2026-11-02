import '../../core/theme/pos_ui.dart';
import '../../core/theme/umi_theme.dart';

final class PaymentMethodTile extends StatelessWidget {
  const PaymentMethodTile({
    super.key,
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final PosGlyph icon;
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = PosTheme.of(context).colorScheme;
    return Semantics(
      selected: selected,
      enabled: onTap != null,
      child: PosSurface(
        color: selected ? scheme.primaryContainer : scheme.surface,
        borderRadius: BorderRadius.circular(8),
        child: PosTapRegion(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: selected ? scheme.primary : scheme.outlineVariant,
                width: 1,
              ),
            ),
            child: Row(
              children: [
                PosIcon(
                  icon,
                  color: selected
                      ? scheme.onPrimaryContainer
                      : scheme.onSurfaceVariant,
                ),
                const SizedBox(width: UmiSpacing.sm),
                Expanded(
                  child: Text(
                    label,
                    style: PosTheme.of(context).textTheme.bodySmall?.copyWith(
                      color: selected
                          ? scheme.onPrimaryContainer
                          : scheme.onSurface,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (selected)
                  PosIcon(
                    PosGlyphs.checkCircle,
                    color: scheme.primary,
                    size: 20,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
