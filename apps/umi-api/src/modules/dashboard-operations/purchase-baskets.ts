import { BASKETS_TOO_COMPLEX_CODE, type SalesAnalysisQuery } from '@umi/contract';
import type { AnalysisGroup, AnalysisSale } from './sales-analysis';

const ratio = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null;

function retainedLines(sale: AnalysisSale, query: SalesAnalysisQuery) {
  const returnedByLine = new Map<string, number>();
  if (query.refundView === 'sale_result') {
    for (const refund of sale.refunds) {
      for (const entry of refund.quantities) {
        returnedByLine.set(entry.lineId, (returnedByLine.get(entry.lineId) ?? 0) + entry.quantity);
      }
    }
  }
  return sale.lines.map((line) => {
    const returned = returnedByLine.get(line.id) ?? 0;
    return { ...line, quantity: Math.max(0, line.quantity - returned) };
  });
}

function buildBaskets(sales: AnalysisSale[], query: SalesAnalysisQuery) {
  const baskets = new Map<string, Set<string>>();
  const names = new Map<string, string>();
  const distribution = new Map<number, number>();
  let ticketsWithoutProducts = 0;
  for (const sale of sales) {
    const lines = retainedLines(sale, query);
    const units = lines.reduce((sum, line) => sum + line.quantity, 0);
    distribution.set(units, (distribution.get(units) ?? 0) + 1);
    const products = lines.filter((line) => line.productId && line.quantity > 0);
    if (products.length === 0) ticketsWithoutProducts++;
    if (query.basketUnit === 'table_visit' && !sale.visitId) continue;
    const key = query.basketUnit === 'table_visit' ? `${sale.locationId}:${sale.visitId}` : sale.id;
    const basket = baskets.get(key) ?? new Set<string>();
    for (const product of products) {
      basket.add(product.productId!);
      names.set(product.productId!, product.name);
    }
    baskets.set(key, basket);
  }
  return { baskets: [...baskets.values()], names, distribution, ticketsWithoutProducts };
}

function countPairs(baskets: Set<string>[]) {
  const singles = new Map<string, number>();
  const pairs = new Map<string, { a: string; b: string; count: number }>();
  // Limit retained patterns and actual pair work independently of distinct pairs.
  const patterns = new Map<string, { products: string[]; count: number }>();
  const maxPatterns = 1000;
  const maxPairEvaluations = 5_000_000;
  let evaluations = 0;
  function count(products: string[], weight: number) {
    evaluations += (products.length * (products.length - 1)) / 2;
    if (evaluations > maxPairEvaluations) throw new RangeError(BASKETS_TOO_COMPLEX_CODE);
    for (const product of products) singles.set(product, (singles.get(product) ?? 0) + weight);
    for (let a = 0; a < products.length; a++) {
      for (let b = a + 1; b < products.length; b++) {
        const key = `${products[a]}:${products[b]}`;
        const pair = pairs.get(key) ?? { a: products[a], b: products[b], count: 0 };
        pair.count += weight;
        pairs.set(key, pair);
        if (pairs.size > 100_000) throw new RangeError(BASKETS_TOO_COMPLEX_CODE);
      }
    }
  }
  for (const basket of baskets) {
    const products = [...basket].sort();
    if ((products.length * (products.length - 1)) / 2 > 100_000)
      throw new RangeError(BASKETS_TOO_COMPLEX_CODE);
    if (products.length < 8) {
      count(products, 1);
      continue;
    }
    const key = JSON.stringify(products);
    const pattern = patterns.get(key);
    if (pattern) pattern.count++;
    else if (patterns.size < maxPatterns) patterns.set(key, { products, count: 1 });
    else count(products, 1);
  }
  for (const { products, count: weight } of patterns.values()) {
    count(products, weight);
  }
  return { singles, pairs };
}

function selectedGroups(
  baskets: Set<string>[],
  groups: AnalysisGroup[],
  query: SalesAnalysisQuery,
) {
  const a = groups.find((group) => group.key === query.groupA);
  const b = groups.find((group) => group.key === query.groupB);
  const productsA = new Set(a?.productIds ?? []);
  const productsB = new Set(b?.productIds ?? []);
  let basketsWithA = 0;
  let basketsWithB = 0;
  let basketsWithBoth = 0;
  for (const basket of baskets) {
    const presentA: string[] = [];
    const presentB: string[] = [];
    for (const product of basket) {
      if (productsA.has(product)) presentA.push(product);
      if (productsB.has(product)) presentB.push(product);
    }
    if (presentA.length) basketsWithA++;
    if (presentB.length) basketsWithB++;
    if (presentA.some((first) => presentB.some((second) => first !== second))) basketsWithBoth++;
  }
  const confidenceAtoB = a && b ? ratio(basketsWithBoth, basketsWithA) : null;
  const presenceB = ratio(basketsWithB, baskets.length);
  return {
    a: a?.name ?? null,
    b: b?.name ?? null,
    basketsWithA,
    basketsWithB,
    basketsWithBoth,
    support: a && b ? ratio(basketsWithBoth, baskets.length) : null,
    confidenceAtoB,
    lift: confidenceAtoB !== null && presenceB ? confidenceAtoB / presenceB : null,
    overlappingProducts: [...productsA].filter((product) => productsB.has(product)).length,
  };
}

export function analyzeBaskets(
  allSales: AnalysisSale[],
  query: SalesAnalysisQuery,
  groups: AnalysisGroup[],
) {
  const sales = allSales.filter((sale) => sale.day >= query.from && sale.day <= query.to);
  const { baskets, names, distribution, ticketsWithoutProducts } = buildBaskets(sales, query);
  const { singles, pairs } = countPairs(baskets);
  const rankedPairs = [...pairs.values()].sort(
    (a, b) => b.count - a.count || a.a.localeCompare(b.a) || a.b.localeCompare(b.b),
  );
  let refundedUnits = 0;
  for (const sale of allSales) {
    for (const refund of sale.refunds) {
      const day = query.refundView === 'sale_result' ? sale.day : refund.day;
      if (day < query.from || day > query.to) continue;
      for (const line of refund.quantities) refundedUnits += line.quantity;
    }
  }
  return {
    coverage: {
      baskets: baskets.length,
      ticketsWithVisit: sales.filter((sale) => sale.visitId).length,
      ticketsWithoutVisit: sales.filter((sale) => !sale.visitId).length,
      ticketsWithoutProducts,
      refundedUnits,
      legacyDiscountTickets: sales.filter((sale) => sale.legacyDiscount).length,
      pairsAvailable: pairs.size,
      categoriesUseCurrentCatalog: true as const,
    },
    unitsDistribution: [...distribution]
      .sort(([a], [b]) => a - b)
      .map(([units, tickets]) => ({ units, tickets })),
    pairs: rankedPairs.slice(0, 100).map((pair) => ({
      productAId: pair.a,
      productAName: names.get(pair.a)!,
      productBId: pair.b,
      productBName: names.get(pair.b)!,
      baskets: pair.count,
      basketsWithA: singles.get(pair.a)!,
      basketsWithB: singles.get(pair.b)!,
      support: ratio(pair.count, baskets.length),
      confidenceAtoB: ratio(pair.count, singles.get(pair.a)!),
      confidenceBtoA: ratio(pair.count, singles.get(pair.b)!),
      lift: ratio(pair.count * baskets.length, singles.get(pair.a)! * singles.get(pair.b)!),
    })),
    selectedGroups: selectedGroups(baskets, groups, query),
  };
}
