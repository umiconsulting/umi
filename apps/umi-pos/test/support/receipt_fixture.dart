import 'package:umi_contract/umi_contract.dart';

Map<String, Object?> money(int minor) => {
  'currency': 'MXN',
  'minorUnits': minor,
};

/// [receiptRef] defaults to the legacy shape on purpose: most tests want the receipt a café
/// already has, and the short ticket folio is the new case that names itself.
ReceiptSnapshot receiptTestSnapshot({String? merchantLogoUrl, String? receiptRef}) {
  return ReceiptSnapshot(
    receiptRef: receiptRef ?? 'POS-80b6d99a-9cca-4546-a84f-74897cde50f8',
    merchantId: 'merchant',
    locationId: 'location',
    issuedAt: '2026-10-08T12:00:00Z',
    businessDate: '2026-10-08',
    merchantName: 'Café Estación',
    merchantLogoUrl: merchantLogoUrl,
    locationName: 'Centro',
    lines: [
      ReceiptLineSnapshot(
        lineRef: 'line',
        description: 'Cappuccino con leche de avena',
        quantity: 3,
        unitPrice: money(6200),
        lineTotal: money(18100),
        variantName: 'Chico',
        modifiers: ['Leche de avena'],
        note: 'Café de piñón · sin azúcar',
      ).toJson(),
    ],
    subtotal: money(18600),
    taxTotal: money(1230),
    discountTotal: money(500),
    tip: money(400),
    grandTotal: money(18500),
    currency: 'MXN',
    version: 1,
  );
}
