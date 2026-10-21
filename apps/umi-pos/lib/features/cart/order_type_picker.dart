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
                          es ? 'Elegir una mesa' : 'Choose a table',
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
