import '../../core/theme/pos_ui.dart';

Future<String?> showOrderTypePicker(BuildContext context) {
  final es = Localizations.localeOf(context).languageCode == 'es';
  return showPosDialog<String>(
    context: context,
    builder: (dialog) => PosAlertDialog(
      title: Text(
        es ? '¿Dónde se sirve este pedido?' : 'Where is this order served?',
      ),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              es
                  ? 'Elige dónde se sirve esta cuenta.'
                  : 'Choose where this account is served.',
            ),
            const SizedBox(height: 16),
            PosButton.tonal(
              onPressed: () => Navigator.pop(dialog, 'dine_in'),
              child: Row(
                children: [
                  const PosIcon(PosGlyphs.restaurantOutlined, size: 22),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(es ? 'Comer aquí' : 'Dine in'),
                        Text(
                          es
                              ? 'Servicio en el local'
                              : 'Service at this location',
                          style: PosTheme.of(dialog).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            PosOutlineButton(
              onPressed: () => Navigator.pop(dialog, 'takeout'),
              child: Row(
                children: [
                  const PosIcon(PosGlyphs.takeoutDiningOutlined, size: 22),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(es ? 'Para llevar' : 'Takeaway'),
                        Text(
                          es ? 'Sin mesa' : 'No table',
                          style: PosTheme.of(dialog).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        PosTextButton(
          onPressed: () => Navigator.pop(dialog),
          child: Text(es ? 'Cancelar' : 'Cancel'),
        ),
      ],
    ),
  );
}

class OrderServiceChoice extends StatelessWidget {
  const OrderServiceChoice({
    required this.onSelect,
    required this.onCancel,
    this.chooseTable = false,
    super.key,
  });
  final ValueChanged<String> onSelect;
  final VoidCallback onCancel;
  final bool chooseTable;

  @override
  Widget build(BuildContext context) {
    final es = Localizations.localeOf(context).languageCode == 'es';
    final theme = PosTheme.of(context);
    return Container(
      key: const ValueKey('catalog-service-choice'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            es ? 'Servicio del nuevo pedido' : 'Service for the new order',
            style: theme.textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              PosOutlineButton(
                autofocus: true,
                onPressed: () => onSelect('dine_in'),
                child: Text(
                  chooseTable
                      ? (es
                            ? 'Comer aquí · Elegir mesa'
                            : 'Dine in · Choose table')
                      : (es ? 'Comer aquí' : 'Dine in'),
                ),
              ),
              PosOutlineButton(
                onPressed: () => onSelect('takeout'),
                child: Text(es ? 'Para llevar' : 'Takeaway'),
              ),
              PosTextButton(
                onPressed: onCancel,
                child: Text(es ? 'Volver' : 'Back'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
