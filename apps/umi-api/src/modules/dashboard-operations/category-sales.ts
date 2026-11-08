import type { SalesAnalysisCategory, SalesAnalysisQuery } from '@umi/contract';
import type { AnalysisSale } from './sales-analysis';

interface CategorizedProduct {
  id: string;
  categoryId: string | null;
  category: string | null;
  categoryColor: string | null;
}
interface Attribution {
  productId: string | null;
  merchandiseMinorUnits?: number | null;
}

export function analyzeCategorySales(
  sales: AnalysisSale[],
  query: SalesAnalysisQuery,
  products: CategorizedProduct[],
): SalesAnalysisCategory[] {
  const catalog = new Map(products.map((product) => [product.id, product]));
  const categories = new Map<string, SalesAnalysisCategory>();
  const within = (day: string) => day >= query.from && day <= query.to;
  function add(
    field: 'merchandiseMinorUnits' | 'refundsMinorUnits',
    amount: number,
    attribution?: Attribution,
  ) {
    if (!amount) return;
    const product = attribution?.productId ? catalog.get(attribution.productId) : undefined;
    const categoryId = product?.categoryId ?? null;
    const key = !attribution
      ? 'unattributed'
      : categoryId
        ? `category:${categoryId}`
        : 'uncategorized';
    const row = categories.get(key) ?? {
      key,
      categoryId,
      label: categoryId ? (product?.category ?? null) : null,
      color: categoryId ? (product?.categoryColor ?? null) : null,
      merchandiseMinorUnits: 0,
      refundsMinorUnits: 0,
      netMinorUnits: 0,
    };
    row[field] += amount;
    row.netMinorUnits = row.merchandiseMinorUnits - row.refundsMinorUnits;
    if (!Number.isSafeInteger(row[field]) || !Number.isSafeInteger(row.netMinorUnits)) {
      throw new RangeError('REPORT_AMOUNT_OUT_OF_RANGE');
    }
    categories.set(key, row);
  }
  function attribute(
    field: 'merchandiseMinorUnits' | 'refundsMinorUnits',
    total: number,
    lines: Attribution[],
  ) {
    const known = lines.filter(
      (line) =>
        Number.isSafeInteger(line.merchandiseMinorUnits) && line.merchandiseMinorUnits! >= 0,
    );
    const sum = known.reduce((value, line) => value + BigInt(line.merchandiseMinorUnits!), 0n);
    // A conflicting receipt cannot establish a trustworthy category allocation.
    if (sum > BigInt(total)) {
      add(field, total);
      return;
    }
    for (const line of known) add(field, line.merchandiseMinorUnits!, line);
    add(field, total - Number(sum));
  }
  for (const sale of sales) {
    const purchased = within(sale.day);
    if (purchased) attribute('merchandiseMinorUnits', sale.merchandiseMinorUnits, sale.lines);
    const lines = new Map(sale.lines.map((line) => [line.id, line]));
    for (const refund of sale.refunds) {
      if (!(query.refundView === 'sale_result' ? purchased : within(refund.day))) continue;
      attribute(
        'refundsMinorUnits',
        refund.merchandiseMinorUnits,
        refund.quantities.map((line) => ({
          productId: lines.get(line.lineId)?.productId ?? null,
          merchandiseMinorUnits: line.merchandiseMinorUnits,
        })),
      );
    }
  }
  return [...categories.values()].sort(
    (a, b) => b.netMinorUnits - a.netMinorUnits || a.key.localeCompare(b.key),
  );
}
