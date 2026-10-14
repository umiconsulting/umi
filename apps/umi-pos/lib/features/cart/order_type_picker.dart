import '../../core/theme/pos_ui.dart';

Future<String?> showOrderTypePicker(BuildContext context) {
  final es = Localizations.localeOf(context).languageCode == 'es';
  return showPosDialog<String>(
    context: context,
    builder: (dialog) => PosAlertDialog(
      title: Text(es ? 'Tipo de pedido' : 'Order type'),
      content: SizedBox(
        width: 400,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            PosButton.tonal(
              onPressed: () => Navigator.pop(dialog, 'dine_in'),
              child: Text(es ? 'Comer aquí' : 'Dine in'),
            ),
            const SizedBox(height: 12),
            PosOutlineButton(
              onPressed: () => Navigator.pop(dialog, 'takeout'),
              child: Text(es ? 'Para llevar' : 'Takeout'),
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
