/**
 * What the paper's code says, for a machine.
 *
 * A code that carries only a UUID is a key, not a document: nothing reads it without a
 * resolver, and a scanner at a till without one learns nothing. Mexico's own fiscal paper
 * answers this the other way — the CFDI's printed QR carries the verification URL AND the
 * folio fiscal, both RFCs, the total and the last eight characters of the digital seal, so
 * the expression itself says what the document is (Anexo 20 v4.0, "Especificación técnica
 * del código de barras bidimensional").
 *
 * Umi's expression follows that shape at the size a café needs: the key, and enough context
 * that the paper can be read without asking anybody.
 *
 *   UMI1|R=<receipt uuid>|T=<ticket folio>|D=<business date>|C=<currency>|A=<total>
 *
 * Versioned (`UMI1`) and field-labelled, so a reader can be added later without guessing
 * what it is looking at. `A` is in minor units, the unit the ledger itself uses, so the
 * value cannot drift from the money by a rounding rule.
 *
 * Nothing consumes this yet: the till prints it and the thermal adapter draws it, and the
 * screen's own bars are still decorative (`receipt_document.dart`). It is the key that makes
 * the rest possible, and it is deliberately readable by a person as well.
 */
export function receiptBarcodeExpression(input: {
  receiptId: string;
  folio: string;
  businessDate: string;
  currency: string;
  totalMinorUnits: number;
}): string {
  return [
    'UMI1',
    `R=${input.receiptId}`,
    `T=${input.folio}`,
    `D=${input.businessDate}`,
    `C=${input.currency}`,
    `A=${input.totalMinorUnits}`,
  ].join('|');
}
