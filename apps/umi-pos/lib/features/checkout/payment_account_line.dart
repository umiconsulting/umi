import 'package:umi_contract/umi_contract.dart';
import 'package:umi_pos/core/theme/pos_ui.dart';

import '../cash/money_input.dart';

/// Read-only account detail shared by full and partial payment.
class PaymentAccountLine extends StatelessWidget {
  const PaymentAccountLine({required this.item, super.key});
  final CartItem item;
  @override
  Widget build(BuildContext context) {
    final theme = PosTheme.of(context);
    final es = Localizations.localeOf(context).languageCode == 'es';
    final price = PriceSnapshot.fromJson(item.price);
    final total = CatalogMoney.fromJson(price.lineTotal);
    final details = [
      if (item.variant != null) item.variant!['name'],
      ...item.modifiers.map((m) => m['name']),
      item.note,
    ].whereType<String>().join(' · ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(4),
              ),
              child: Text('${item.quantity}', style: theme.textTheme.bodySmall),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.productName, style: theme.textTheme.bodyMedium),
                  if (details.isNotEmpty)
                    Text(details, style: theme.textTheme.bodySmall),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              formatMinorUnits(total.minorUnits, total.currency),
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          item.fired
              ? (es ? 'Enviado' : 'Sent')
              : (es ? 'Pendiente de enviar' : 'Not sent'),
          style: theme.textTheme.bodySmall,
        ),
      ],
    );
  }
}
