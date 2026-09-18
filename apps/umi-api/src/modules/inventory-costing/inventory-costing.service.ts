import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  InventoryCostBasisList,
  InventoryCostBasisQuery,
  InventoryCostingDay,
  InventoryCostingDayQuery,
  InventoryCostingDays,
  InventoryPlate,
  InventoryPlateComponent,
  InventoryPlateList,
  InventoryPlateQuery,
  InventoryRecipeCostHistory,
  InventoryRecipeCostPoint,
  InventoryRecipeCostQuery,
  InventoryUsageVariance,
  InventoryUsageVarianceLine,
  InventoryUsageVarianceQuery,
  LowStockForecast,
  LowStockForecastItem,
  LowStockForecastQuery,
  MenuEngineering,
  MenuEngineeringItem,
  MenuEngineeringQuery,
  UncostedItem,
} from '@umi/contract';
import { PlateCostDefect, UnitOfMeasure } from '@umi/contract';
import { getRequestContext } from '../../shared/database/request-context';
import { MetricsService } from '../../shared/operations/metrics.service';
import type { MerchantAccess } from '../auth/auth.types';
import { resolveLocationAuthority } from '../auth/location-authority';
import {
  divideRoundHalfUp,
  dailyRateQuantity,
  daysOfCover,
  margin,
  observedDays,
  plateCostMinor,
  pow10,
  quantityCostMinor,
  shiftBusinessDate,
  sumScaled,
  toBigInt,
  toSafeNumber,
  weightedAverageUnitCost,
  type CostBucket,
} from './inventory-costing-domain';
import {
  InventoryCostingRepository,
  type ItemRow,
  type RecipeCostRow,
  type RecipeCostVersionRow,
  type SoldProductRow,
  type VarianceLedgerRow,
} from './inventory-costing.repository';

/**
 * The costing view (plan §8E steps 5 and 6), as the console reads it.
 *
 * WHY THE CONSOLE AND NOT THE TILL. "Owners trust the cost number" is the plan's own
 * goal for this workstream, and an owner is at a desk, not at a counter. So these are
 * session-authenticated console reads gated by `merchant.manage` — the same key the
 * floor plan and purchasing use — rather than the till's device-bound `inventory.*`
 * keys, which a browser session does not carry.
 *
 * EVERY ANSWER IS BUILT FROM THREE THINGS AND NOTHING ELSE: what the business paid
 * (receipt lines), what a plate is made of (the recipe, expanded exactly as the sale
 * path expands it), and what actually left the shelf (the ledger's `sale_committed`
 * rows). There is no fourth source, and in particular there is no place where a
 * missing cost becomes a zero.
 */
@Injectable()
export class InventoryCostingService {
  constructor(
    private readonly repo: InventoryCostingRepository,
    private readonly metrics: MetricsService,
  ) {}

  private correlationId(): string {
    return getRequestContext()?.requestId ?? 'unknown';
  }

  // ── Step 5, first half: the cost basis per item ────────────────────────────

  async costBasis(
    access: MerchantAccess,
    query: InventoryCostBasisQuery,
  ): Promise<InventoryCostBasisList> {
    const [items, basis] = await Promise.all([
      this.repo.items(access.merchantId),
      this.repo.readCostBasis(access.merchantId),
    ]);
    const buckets = groupBuckets(basis.buckets);
    const counts = new Map(basis.counts.map((row) => [row.inventoryItemId, row]));

    const rows = items
      .filter((item) => item.active)
      .flatMap((item) => {
        const itemBuckets = buckets.get(item.inventoryItemId) ?? [];
        const average = weightedAverageUnitCost(itemBuckets);
        if (!average && !query.includeWithoutReceipts) return [];
        const count = counts.get(item.inventoryItemId);
        return [
          {
            inventoryItemId: item.inventoryItemId,
            publicReference: item.publicReference,
            displayName: item.displayName,
            baseUnit: item.baseUnit,
            quantityScale: item.quantityScale,
            basis: average ? ('weighted_average_of_receipts' as const) : ('no_receipts' as const),
            unitCostMinor: average ? toSafeNumber(average.unitCostMinor) : null,
            receiptCount: count ? toSafeNumber(toBigInt(count.receiptCount)) : 0,
            receiptLineCount: count ? toSafeNumber(toBigInt(count.receiptLineCount)) : 0,
            receivedQuantity: quantityAtScale(
              sumScaled(
                itemBuckets.map((b) => ({ value: b.quantity, scale: b.scale })),
                scaleOf(item),
              ),
              scaleOf(item),
              item.baseUnit,
            ),
            lowestUnitCostMinor: average ? toSafeNumber(average.lowestUnitCostMinor) : null,
            highestUnitCostMinor: average ? toSafeNumber(average.highestUnitCostMinor) : null,
          },
        ];
      });

    return {
      items: rows,
      receiptLocations: basis.locations,
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
  }

  // ── Step 5, second half: per plate ─────────────────────────────────────────

  async plates(access: MerchantAccess, query: InventoryPlateQuery): Promise<InventoryPlateList> {
    const today = await this.repo.currentBusinessDate(access.merchantId);
    const to = query.consumptionTo ?? today;
    const from = query.consumptionFrom ?? shiftBusinessDate(to, -27);
    assertWindow(from, to, 400);

    const [items, basis, plates, consumption] = await Promise.all([
      this.repo.items(access.merchantId),
      this.repo.readCostBasis(access.merchantId),
      this.repo.readPlates(access.merchantId, {
        productId: query.productId ?? null,
        variantId: query.variantId ?? null,
        includeUnmapped: query.includeUnmapped,
      }),
      this.repo.readPlateConsumption(access.merchantId, from, to),
    ]);

    const itemsById = new Map(items.map((item) => [item.inventoryItemId, item]));
    const unitCosts = unitCostsByItem(basis.buckets);
    const consumptionByPlate = new Map<string, Map<string, bigint>>();
    for (const row of consumption) {
      const item = itemsById.get(row.inventoryItemId);
      if (!item) continue;
      const key = plateKey(row.productId, row.variantId);
      const forItem = consumptionByPlate.get(key) ?? new Map<string, bigint>();
      const previous = forItem.get(row.inventoryItemId) ?? 0n;
      forItem.set(
        row.inventoryItemId,
        previous + sumScaled([{ value: toBigInt(row.quantity), scale: row.scale }], scaleOf(item)),
      );
      consumptionByPlate.set(key, forItem);
    }

    const componentsByMapping = new Map<
      string,
      {
        inventoryItemId: string;
        source: 'direct' | 'recipe_component';
        quantity: bigint | null;
        scale: number;
      }[]
    >();
    for (const row of plates.components) {
      const list = componentsByMapping.get(row.mappingId) ?? [];
      list.push({
        inventoryItemId: row.inventoryItemId,
        source: row.source,
        quantity: row.quantity === null ? null : toBigInt(row.quantity),
        scale: row.quantityScale,
      });
      componentsByMapping.set(row.mappingId, list);
    }

    const rows: InventoryPlate[] = [];
    for (const mapping of plates.mappings.slice(0, query.limit)) {
      const uncosted: UncostedItem[] = [];
      const defects = new Set<PlateCostDefect>();
      const consumed = mapping.mappingId
        ? (consumptionByPlate.get(plateKey(mapping.productId, mapping.variantId)) ?? new Map())
        : new Map<string, bigint>();
      const planned = mapping.mappingId ? (componentsByMapping.get(mapping.mappingId) ?? []) : [];

      const components: InventoryPlateComponent[] = [];
      const costed: { quantity: bigint; scale: number; unitCostMinor: bigint }[] = [];
      const named = new Set<string>();

      for (const component of planned) {
        const item = itemsById.get(component.inventoryItemId);
        if (!item) continue;
        named.add(component.inventoryItemId);
        const unitCost = unitCosts.get(component.inventoryItemId) ?? null;
        if (component.quantity === null) {
          defects.add('unit_conversion_not_exact');
          uncosted.push(uncostedItem(item, 'unit_conversion_not_exact'));
        } else if (unitCost === null) {
          defects.add('no_cost_basis');
          uncosted.push(uncostedItem(item, 'no_cost_basis'));
        } else if (component.quantity > 0n) {
          costed.push({
            quantity: component.quantity,
            scale: component.scale,
            unitCostMinor: unitCost,
          });
        }
        components.push({
          inventoryItemId: item.inventoryItemId,
          publicReference: item.publicReference,
          displayName: item.displayName,
          quantity: quantityAtScale(component.quantity ?? 0n, scaleOf(item), item.baseUnit),
          unitCostMinor: unitCost === null ? null : toSafeNumber(unitCost),
          lineCostMinor:
            component.quantity === null || unitCost === null
              ? null
              : toSafeNumber(
                  quantityCostMinor(
                    { value: component.quantity, scale: component.scale },
                    unitCost,
                  ),
                ),
          hasCostBasis: unitCost !== null,
          consumedQuantity: quantityAtScale(
            consumed.get(item.inventoryItemId) ?? 0n,
            scaleOf(item),
            item.baseUnit,
          ),
          source: component.source,
        });
      }

      // Stock these sales took out that the BASE recipe does not name: a modifier's
      // extra portion. It is not part of the plate's recipe cost, and reporting it
      // nowhere would hide real consumption, so it arrives with a quantity of zero and
      // its own source — the day's cost of goods is where its money is.
      for (const [inventoryItemId, consumedQuantity] of consumed) {
        if (named.has(inventoryItemId) || consumedQuantity === 0n) continue;
        const item = itemsById.get(inventoryItemId);
        if (!item) continue;
        const unitCost = unitCosts.get(inventoryItemId) ?? null;
        components.push({
          inventoryItemId: item.inventoryItemId,
          publicReference: item.publicReference,
          displayName: item.displayName,
          quantity: quantityAtScale(0n, scaleOf(item), item.baseUnit),
          unitCostMinor: unitCost === null ? null : toSafeNumber(unitCost),
          lineCostMinor: null,
          hasCostBasis: unitCost !== null,
          consumedQuantity: quantityAtScale(consumedQuantity, scaleOf(item), item.baseUnit),
          source: 'modifier_component',
        });
      }

      let state: InventoryPlate['state'];
      if (!mapping.mappingId) {
        defects.add('no_inventory_mapping');
        state = 'not_costed';
      } else if (mapping.mappingType === 'non_stock') {
        defects.add('non_stock_mapping');
        state = 'not_costed';
      } else if (planned.length === 0) {
        defects.add('no_recipe_components');
        state = 'incomplete';
      } else if (defects.size > 0) {
        state = 'incomplete';
      } else {
        state = 'complete';
      }

      const priceMinor =
        toBigInt(mapping.productPriceMinor) + toBigInt(mapping.variantPriceDeltaMinor);
      const costMinor = state === 'complete' ? plateCostMinor(costed) : null;
      const plateMargin = costMinor === null ? null : margin(priceMinor, costMinor);

      rows.push({
        productId: mapping.productId,
        productName: mapping.productName,
        productActive: mapping.productActive,
        variantId: mapping.variantId,
        variantName: mapping.variantName,
        mappingType: mapping.mappingId ? mapping.mappingType : null,
        priceMinor: toSafeNumber(priceMinor),
        costMinor: costMinor === null ? null : toSafeNumber(costMinor),
        marginMinor: plateMargin === null ? null : toSafeNumber(plateMargin.marginMinor),
        marginBasisPoints:
          plateMargin?.marginBasisPoints == null
            ? null
            : toSafeNumber(plateMargin.marginBasisPoints),
        state,
        defects: [...defects],
        uncostedItems: uncosted,
        components,
      });
    }

    return {
      plates: rows,
      consumptionFrom: from,
      consumptionTo: to,
      truncated: plates.mappings.length > query.limit,
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
  }

  // ── Step 5, third part: per day ────────────────────────────────────────────

  async days(
    access: MerchantAccess,
    query: InventoryCostingDayQuery,
  ): Promise<InventoryCostingDays> {
    const locationId = readLocationScope(access, query.locationId ?? null);
    const today = await this.repo.currentBusinessDate(access.merchantId);
    const to = query.to ?? today;
    const from = query.from ?? shiftBusinessDate(to, -13);
    assertWindow(from, to, 366);

    const [items, basis, read] = await Promise.all([
      this.repo.items(access.merchantId),
      this.repo.readCostBasis(access.merchantId),
      this.repo.readDays(access.merchantId, from, to, locationId),
    ]);
    const itemsById = new Map(items.map((item) => [item.inventoryItemId, item]));
    const unitCosts = unitCostsByItem(basis.buckets);
    const revenue = new Map(read.revenue.map((row) => [row.businessDate, row]));
    const plates = new Map(read.plates.map((row) => [row.businessDate, row]));
    const unmappedByDay = new Map<
      string,
      { productId: string; productName: string; lines: number }[]
    >();
    for (const row of read.unmapped) {
      const list = unmappedByDay.get(row.businessDate) ?? [];
      list.push({
        productId: row.productId,
        productName: row.productName,
        lines: toSafeNumber(toBigInt(row.lines)),
      });
      unmappedByDay.set(row.businessDate, list);
    }

    const consumptionByDay = new Map<
      string,
      Map<string, { quantities: { value: bigint; scale: number }[]; scale: number }>
    >();
    for (const row of read.consumption) {
      const item = itemsById.get(row.inventoryItemId);
      if (!item) continue;
      const forDay = consumptionByDay.get(row.businessDate) ?? new Map();
      const entry = forDay.get(row.inventoryItemId) ?? { quantities: [], scale: scaleOf(item) };
      entry.quantities.push({ value: toBigInt(row.quantity), scale: row.scale });
      forDay.set(row.inventoryItemId, entry);
      consumptionByDay.set(row.businessDate, forDay);
    }

    const dates = [
      ...new Set([...revenue.keys(), ...consumptionByDay.keys(), ...unmappedByDay.keys()]),
    ].sort();
    const rows: InventoryCostingDay[] = dates.map((businessDate) => {
      const day = revenue.get(businessDate);
      const consumed = consumptionByDay.get(businessDate) ?? new Map();
      const uncosted: UncostedItem[] = [];
      let numerator = 0n;
      let scale = 0;
      for (const entry of consumed.values()) {
        if (entry.scale > scale) scale = entry.scale;
      }
      for (const [inventoryItemId, entry] of consumed) {
        const item = itemsById.get(inventoryItemId);
        const unitCost = unitCosts.get(inventoryItemId) ?? null;
        if (!item) continue;
        if (unitCost === null) {
          const zeroOnly = sumScaled(entry.quantities, entry.scale) === 0n;
          if (!zeroOnly) uncosted.push(uncostedItem(item, 'no_cost_basis'));
          continue;
        }
        // One rounding for the whole day: every item's cost is summed at the day's
        // common denominator and the total is rounded once.
        for (const quantity of entry.quantities) {
          numerator += quantity.value * BigInt(10) ** BigInt(scale - quantity.scale) * unitCost;
        }
      }
      // One rounding for the whole day, through the same function the rest of the module
      // rounds with — a second implementation of half-up is a second answer.
      const scaleFactor = pow10(scale);
      const costMinor = uncosted.length > 0 ? null : divideRoundHalfUp(numerator, scaleFactor);
      const revenueMinor = toBigInt(day?.revenueMinor);
      const grandTotalMinor = toBigInt(day?.grandTotalMinor);
      const dayMargin = costMinor === null ? null : margin(revenueMinor, costMinor);
      /*
       * AN UNTRACKED DAY IS NOT A FREE ONE. If any sale line on the day sold a product
       * that no active mapping describes, the stock behind it never reached the ledger,
       * so the cost of goods is UNKNOWN — and the day is reported incomplete with the
       * products named. Without this, a café that has not mapped its menu yet would read
       * a hundred percent margin on every day it has ever traded, which is the most
       * expensive kind of wrong a costing view can be.
       */
      const unmapped = unmappedByDay.get(businessDate) ?? [];
      const unmappedLines = unmapped.reduce((total, entry) => total + entry.lines, 0);
      const incomplete = uncosted.length > 0 || unmappedLines > 0;
      return {
        businessDate,
        revenueMinor: toSafeNumber(revenueMinor),
        grandTotalMinor: toSafeNumber(grandTotalMinor),
        costMinor: incomplete || costMinor === null ? null : toSafeNumber(costMinor),
        marginMinor: incomplete || dayMargin === null ? null : toSafeNumber(dayMargin.marginMinor),
        marginBasisPoints:
          incomplete || dayMargin?.marginBasisPoints == null
            ? null
            : toSafeNumber(dayMargin.marginBasisPoints),
        salesCount: toSafeNumber(toBigInt(day?.salesCount)),
        platesSold: toSafeNumber(toBigInt(plates.get(businessDate)?.platesSold)),
        salesLinesWithoutMapping: unmappedLines,
        uncostedProducts: unmapped.slice(0, 200).map((entry) => ({
          productId: entry.productId,
          productName: entry.productName,
        })),
        state: incomplete ? 'incomplete' : 'complete',
        uncostedItems: uncosted,
      };
    });

    return {
      days: rows,
      from,
      to,
      locationId,
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
  }

  // ── Step 6: the low-stock forecast ─────────────────────────────────────────

  async lowStock(access: MerchantAccess, query: LowStockForecastQuery): Promise<LowStockForecast> {
    const locationId = readLocationScope(access, query.locationId ?? null);
    const today = await this.repo.currentBusinessDate(access.merchantId);
    const to = today;
    const from = shiftBusinessDate(to, -(query.windowDays - 1));

    const [items, basis, read] = await Promise.all([
      this.repo.items(access.merchantId),
      this.repo.readCostBasis(access.merchantId),
      this.repo.readLowStock(access.merchantId, from, to, locationId),
    ]);
    const unitCosts = unitCostsByItem(basis.buckets);
    const onHandByItem = new Map(
      read.onHand.map((row) => [row.inventoryItemId, toBigInt(row.onHand)]),
    );
    const statsByItem = new Map(read.dayStats.map((row) => [row.inventoryItemId, row]));
    const bucketsByItem = new Map<string, { value: bigint; scale: number }[]>();
    for (const row of read.buckets) {
      const list = bucketsByItem.get(row.inventoryItemId) ?? [];
      list.push({ value: toBigInt(row.quantity), scale: row.scale });
      bucketsByItem.set(row.inventoryItemId, list);
    }

    const rows: LowStockForecastItem[] = [];
    for (const item of items) {
      if (!item.active) continue;
      const scale = scaleOf(item);
      const onHand = onHandByItem.get(item.inventoryItemId) ?? 0n;
      const buckets = bucketsByItem.get(item.inventoryItemId) ?? [];
      const consumed = sumScaled(buckets, scale);
      const stats = statsByItem.get(item.inventoryItemId);
      const observed = observedDays(
        query.windowDays,
        from,
        to,
        stats?.firstConsumption ? shortDate(stats.firstConsumption) : null,
      );
      const rate = dailyRateQuantity(consumed, observed);
      const unitCost = unitCosts.get(item.inventoryItemId) ?? null;
      const threshold = item.lowStockThreshold === null ? null : toBigInt(item.lowStockThreshold);
      const belowThreshold = threshold !== null && onHand <= threshold;
      if (query.belowThresholdOnly && !belowThreshold) continue;
      rows.push({
        inventoryItemId: item.inventoryItemId,
        publicReference: item.publicReference,
        displayName: item.displayName,
        baseUnit: item.baseUnit,
        quantityScale: scale,
        onHand: quantityAtScale(onHand, scale, item.baseUnit),
        lowStockThreshold:
          threshold === null ? null : quantityAtScale(threshold, scale, item.baseUnit),
        belowThreshold,
        consumedQuantity: quantityAtScale(consumed, scale, item.baseUnit),
        dailyRateQuantity: rate === null ? null : quantityAtScale(rate, scale, item.baseUnit),
        daysOfCover: daysOfCover(onHand, consumed, observed),
        daysWithConsumption: stats ? toSafeNumber(toBigInt(stats.daysWithConsumption)) : 0,
        observedDays: observed,
        insufficientHistory: observed < query.windowDays,
        hasCostBasis: unitCost !== null,
        unitCostMinor: unitCost === null ? null : toSafeNumber(unitCost),
        onHandValueMinor:
          unitCost === null
            ? null
            : toSafeNumber(quantityCostMinor({ value: onHand, scale }, unitCost)),
      });
    }

    // The list's job is to be acted on, so it is ordered by urgency: what is already
    // below its threshold first, then whatever runs out soonest, then by name. Items
    // with no consumption at all sort last — they are not urgent, they are unused.
    rows.sort((a, b) => {
      if (a.belowThreshold !== b.belowThreshold) return a.belowThreshold ? -1 : 1;
      const left = a.daysOfCover ?? Number.MAX_SAFE_INTEGER;
      const right = b.daysOfCover ?? Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return a.displayName.localeCompare(b.displayName);
    });

    return {
      items: rows,
      from,
      to,
      windowDays: query.windowDays,
      locationId,
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
  }

  // ── Step 7: the variance, the cost history and the menu classes (plan §9) ───

  /**
   * THE VARIANCE READ (plan D6, D7 and §9).
   *
   * Every quantity is on the AVAILABLE basis — on-hand minus reserved, damaged and
   * quarantined — because that is the pool the availability guard measures and the
   * only basis on which a damaged or quarantined item appears as usage at all.
   *
   * THE DECOMPOSITION SUMS BY CONSTRUCTION: the parts come from the same ledger rows
   * as the actual usage, and `unexplained` is defined as what the named parts do not
   * cover. That remainder is the headline number: a single total hides the reason.
   */
  async usageVariance(
    access: MerchantAccess,
    query: InventoryUsageVarianceQuery,
  ): Promise<InventoryUsageVariance> {
    const locationId = readLocationScope(access, query.locationId ?? null);
    const today = await this.repo.currentBusinessDate(access.merchantId);
    const to = query.to ?? today;
    const from = query.from ?? shiftBusinessDate(to, -27);
    assertWindow(from, to, 400);

    const [items, ledger, theoretical] = await Promise.all([
      this.repo.items(access.merchantId),
      this.repo.readVariance(access.merchantId, from, to, locationId),
      this.repo.readTheoreticalUsage(access.merchantId, from, to, locationId),
    ]);

    const ledgerByItem = new Map<string, VarianceLedgerRow[]>();
    for (const row of ledger) {
      const list = ledgerByItem.get(row.inventoryItemId) ?? [];
      list.push(row);
      ledgerByItem.set(row.inventoryItemId, list);
    }
    // The theoretical side arrives as exact rationals, one per (item, sold quantity)
    // pair, and is summed as rationals so the division happens ONCE per item.
    const theoreticalByItem = new Map<string, Rational>();
    for (const row of theoretical) {
      // Postgres hands a `numeric` over as text with its scale attached, so the exact
      // reader is what turns `1000.0000000000000` back into the integer it is.
      const denominator = exactInteger(row.denominator);
      if (denominator <= 0n) continue;
      const term = { numerator: exactInteger(row.numerator), denominator };
      theoreticalByItem.set(
        row.inventoryItemId,
        addRational(
          theoreticalByItem.get(row.inventoryItemId) ?? { numerator: 0n, denominator: 1n },
          term,
        ),
      );
    }

    const only = query.inventoryItemId ?? null;
    const lines: InventoryUsageVarianceLine[] = [];
    for (const item of items) {
      if (only !== null && item.inventoryItemId !== only) continue;
      const rows = ledgerByItem.get(item.inventoryItemId) ?? [];
      const theoreticalTerm = theoreticalByItem.get(item.inventoryItemId);
      // An item with no ledger row and no sale to explain is not a line. A caller that
      // NAMES an item gets its line even when the period is quiet.
      if (rows.length === 0 && theoreticalTerm === undefined && only === null) continue;

      const scale = scaleOf(item);
      const sum = (pick: (row: VarianceLedgerRow) => string): bigint =>
        sumSignedScaled(
          rows.map((row) => ({ value: toBigInt(pick(row)), scale: row.scale })),
          scale,
        );
      /*
       * A NEGATIVE AVAILABLE POOL IS NOT REPRESENTABLE, and the contract says so: the
       * opening and the closing are non-negative. A merchant whose items allow negative
       * stock can reach one, and the honest thing to do with a pool that cannot exist is
       * to floor it at zero rather than to fail the whole report.
       */
      const opening = nonNegative(sum((row) => row.opening));
      const closing = nonNegative(sum((row) => row.closing));
      const received = sum((row) => row.received);
      const produced = sum((row) => row.produced);
      const waste = sum((row) => row.waste);
      const damage = sum((row) => row.damage);
      const countCorrection = sum((row) => row.countCorrection);
      const yieldLoss = sum((row) => row.yieldLoss);

      const actualUsage = opening + received + produced - closing;
      const theoreticalUsage =
        theoreticalTerm === undefined
          ? 0n
          : divideRoundHalfUp(
              theoreticalTerm.numerator * pow10(scale),
              theoreticalTerm.denominator,
            );
      const variance = actualUsage - theoreticalUsage;
      // The remainder is DEFINED as what the named parts leave: the report cannot show
      // a decomposition that does not sum.
      const unexplained = variance - waste - damage - countCorrection - yieldLoss;
      const unit = unitOf(item);

      lines.push({
        inventoryItemId: item.inventoryItemId,
        publicReference: item.publicReference,
        displayName: item.displayName,
        unit,
        quantityScale: scale,
        openingQuantity: quantityAtScale(opening, scale, unit),
        receivedQuantity: quantityAtScale(received, scale, unit),
        productionProducedQuantity: quantityAtScale(produced, scale, unit),
        closingQuantity: quantityAtScale(closing, scale, unit),
        actualUsageQuantity: quantityAtScale(actualUsage, scale, unit),
        theoreticalUsageQuantity: quantityAtScale(nonNegative(theoreticalUsage), scale, unit),
        varianceQuantity: quantityAtScale(variance, scale, unit),
        wasteQuantity: quantityAtScale(waste, scale, unit),
        damageQuantity: quantityAtScale(damage, scale, unit),
        countCorrectionQuantity: quantityAtScale(countCorrection, scale, unit),
        yieldLossQuantity: quantityAtScale(yieldLoss, scale, unit),
        unexplainedQuantity: quantityAtScale(unexplained, scale, unit),
      });
      if (lines.length >= 1000) break;
    }
    lines.sort((left, right) => left.displayName.localeCompare(right.displayName));

    const result: InventoryUsageVariance = {
      basis: 'available_stock',
      lines,
      from,
      to,
      locationId,
      totalVarianceQuantity: scaledTotal(lines.map((line) => line.varianceQuantity.value)),
      totalUnexplainedQuantity: scaledTotal(lines.map((line) => line.unexplainedQuantity.value)),
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
    // A LEVEL, SET ON EVERY READ: the gauge reports the latest unexplained remainder,
    // not the sum of every time somebody looked (see `metrics.service.ts`).
    this.metrics.gauge(
      'inventory.variance.unexplained_quantity',
      result.totalUnexplainedQuantity.value,
      { basis: result.basis },
    );
    return result;
  }

  /**
   * THE COST HISTORY (plan D3 and §9.5): every recipe version in the window with the
   * cost it computed when it was written.
   *
   * A VERSION WITH NO STORED POINT IS COSTED NOW, at the read's own moment, and says
   * so through `capturedAt`. That is the only honest answer for a version written
   * before the point existed, and the timestamp is what tells the two apart.
   */
  async recipeCostHistory(
    access: MerchantAccess,
    query: InventoryRecipeCostQuery,
  ): Promise<InventoryRecipeCostHistory> {
    const today = await this.repo.currentBusinessDate(access.merchantId);
    const to = query.to ?? today;
    const from = query.from ?? shiftBusinessDate(to, -27);
    assertWindow(from, to, 400);

    const versions = await this.repo.readRecipeCostVersions(access.merchantId, {
      recipeId: query.recipeId ?? null,
      productId: query.productId ?? null,
      from,
      to,
    });
    const asOf = new Date().toISOString();
    const legacyIds = [
      ...new Set(
        versions
          .filter((version) => version.computedAt === null)
          .map((version) => version.recipeId),
      ),
    ];
    const [basis, rows] = await Promise.all([
      legacyIds.length > 0 ? this.repo.readCostBasis(access.merchantId) : Promise.resolve(null),
      this.repo.readRecipeCostRows(access.merchantId, legacyIds),
    ]);
    // The SAME basis the recipe read uses, and the same keyed map: an item nobody
    // delivered stays ABSENT, so a missing cost never becomes a zero.
    const unitCosts = basis === null ? new Map<string, bigint>() : unitCostsByItem(basis.buckets);
    const rowsByRecipe = new Map<string, RecipeCostRow[]>();
    for (const row of rows) {
      const list = rowsByRecipe.get(row.recipeId) ?? [];
      list.push(row);
      rowsByRecipe.set(row.recipeId, list);
    }

    /*
     * ONE ENTRY PER TARGET, and its points are the versions of that target in order.
     * The entry's own `recipeId` is the NEWEST version, because that is the version a
     * caller writes against; each point carries its own id and version, so an older
     * point is still addressable.
     */
    const groups = new Map<
      string,
      {
        recipeId: string;
        version: number;
        productId: string | null;
        targetItemId: string | null;
        targetName: string;
        versions: RecipeCostVersionRow[];
      }
    >();
    for (const version of versions) {
      const key = `${version.productId ?? 'none'}::${version.variantId ?? 'none'}::${
        version.targetItemId ?? 'none'
      }`;
      const group = groups.get(key) ?? {
        recipeId: version.recipeId,
        version: version.version,
        productId: version.productId,
        targetItemId: version.targetItemId,
        targetName: version.targetName,
        versions: [],
      };
      if (version.version > group.version) {
        group.recipeId = version.recipeId;
        group.version = version.version;
      }
      group.versions.push(version);
      groups.set(key, group);
    }

    const recipes = [...groups.values()]
      .sort((left, right) => left.targetName.localeCompare(right.targetName))
      .slice(0, 200)
      .map((group) => ({
        recipeId: group.recipeId,
        productId: group.productId,
        targetItemId: group.targetItemId,
        targetName: group.targetName,
        points: group.versions
          .sort((left, right) => left.version - right.version)
          .slice(0, 500)
          .map((version) => costPoint(version, rowsByRecipe, unitCosts, asOf)),
      }));

    return { recipes, asOf, correlationId: this.correlationId() };
  }

  /**
   * MENU ENGINEERING (plan D16 and §9.5): margin times popularity, over a period.
   *
   * THE PLATE COST IS THE PLATE READ'S OWN. `plates` answers the live product price,
   * the live variant delta and the exploded plate cost, and this read groups those
   * rows per product rather than pricing the menu a second time.
   *
   * CLASSIFICATION RULE: an item is compared with the MEAN of each axis across the
   * items in the period — the popularity axis is the item's share of the units sold,
   * and the margin axis is its per-unit contribution margin. At or above both is a
   * star, below popularity and at or above margin is a plow horse, at or above
   * popularity and below margin is a puzzle, below both is a dog. An item whose plate
   * has no cost is `unclassified`, and it is left out of both means: a missing cost is
   * not a low margin.
   */
  async menuEngineering(
    access: MerchantAccess,
    query: MenuEngineeringQuery,
  ): Promise<MenuEngineering> {
    const locationId = readLocationScope(access, query.locationId ?? null);
    const today = await this.repo.currentBusinessDate(access.merchantId);
    const to = query.to ?? today;
    const from = query.from ?? shiftBusinessDate(to, -27);
    assertWindow(from, to, 400);

    const [sold, plates] = await Promise.all([
      this.repo.readSoldProducts(access.merchantId, from, to, locationId),
      this.plates(access, {
        includeUnmapped: true,
        limit: 200,
        consumptionFrom: from,
        consumptionTo: to,
      }),
    ]);

    const soldByProduct = new Map<string, SoldProductRow[]>();
    for (const row of sold) {
      const list = soldByProduct.get(row.productId) ?? [];
      list.push(row);
      soldByProduct.set(row.productId, list);
    }
    const plateByKey = new Map(
      plates.plates.map((plate) => [plateKey(plate.productId, plate.variantId), plate]),
    );
    const totalSold = sold.reduce((total, row) => total + toBigInt(row.soldQuantity), 0n);

    const items: MenuEngineeringItem[] = [];
    for (const [productId, rows] of soldByProduct) {
      const soldQuantity = rows.reduce((total, row) => total + toBigInt(row.soldQuantity), 0n);
      /*
       * ONE PLATE PER PRODUCT. A product sold under a single variant prices at that
       * variant's mapping; a product sold under several prices at the mapping that
       * names no variant, which is the base plate. `rows` is ordered by what sold
       * most, so the fallback names the variant that actually carried the product.
       */
      const variants = new Set(rows.map((row) => row.variantId ?? 'none'));
      const chosen =
        (variants.size === 1 ? plateByKey.get(`${productId}::${[...variants][0]}`) : undefined) ??
        plateByKey.get(`${productId}::none`) ??
        plateByKey.get(`${productId}::${rows[0].variantId ?? 'none'}`);
      const priceMinor =
        chosen === undefined ? toBigInt(rows[0].soldPriceMinor) : toBigInt(chosen.priceMinor);
      const plateCostMinor = chosen?.costMinor == null ? null : toBigInt(chosen.costMinor);
      const marginMinor = plateCostMinor === null ? null : priceMinor - plateCostMinor;

      items.push({
        productId,
        productName: chosen?.productName ?? rows[0].productName,
        soldQuantity: toSafeNumber(soldQuantity),
        priceMinor: toSafeNumber(priceMinor),
        plateCostMinor: plateCostMinor === null ? null : toSafeNumber(plateCostMinor),
        marginMinor: marginMinor === null ? null : toSafeNumber(marginMinor),
        marginBasisPoints:
          marginMinor === null || priceMinor === 0n
            ? null
            : toSafeNumber(divideRoundHalfUp(marginMinor * 10_000n, priceMinor)),
        popularityShareBasisPoints: shareBasisPoints(soldQuantity, totalSold),
        marginShareBasisPoints: 0,
        classification: 'unclassified',
      });
    }

    const totalMargin = items.reduce(
      (total, item) =>
        total +
        (item.marginMinor === null ? 0n : BigInt(item.soldQuantity) * BigInt(item.marginMinor)),
      0n,
    );
    for (const item of items) {
      const itemMargin =
        item.marginMinor === null ? null : BigInt(item.soldQuantity) * BigInt(item.marginMinor);
      item.marginShareBasisPoints =
        itemMargin === null ? 0 : shareBasisPoints(itemMargin, totalMargin);
    }

    /*
     * THE MEANS ARE EXACT. Comparing `value x count` with the sum avoids rounding a
     * mean at all, so an item that sits exactly on the average is at or above it.
     */
    const costed = items.filter((item) => item.marginMinor !== null);
    const count = BigInt(costed.length);
    const popularitySum = costed.reduce(
      (total, item) => total + BigInt(item.popularityShareBasisPoints),
      0n,
    );
    const marginSum = costed.reduce((total, item) => total + BigInt(item.marginMinor ?? 0), 0n);
    for (const item of items) {
      if (item.marginMinor === null) continue;
      const popular = BigInt(item.popularityShareBasisPoints) * count >= popularitySum;
      const highMargin = BigInt(item.marginMinor) * count >= marginSum;
      item.classification =
        popular && highMargin
          ? 'star'
          : !popular && highMargin
            ? 'plow_horse'
            : popular && !highMargin
              ? 'puzzle'
              : 'dog';
    }

    items.sort(
      (left, right) =>
        right.soldQuantity - left.soldQuantity || left.productName.localeCompare(right.productName),
    );

    return {
      items: items.slice(0, query.limit),
      from,
      to,
      locationId,
      asOf: new Date().toISOString(),
      correlationId: this.correlationId(),
    };
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * WHICH BRANCHES A READ COVERS.
 *
 * A REQUESTED branch goes through `resolveLocationAuthority`, so a session that may not
 * see it is refused rather than quietly given the whole business. An OMITTED one falls
 * back to the session's own branch when it has one — narrowing is always safe — and to
 * the whole merchant when it does not.
 *
 * The difference from the write path is the point, and it is not a loosening. A bound
 * cashier still reads her own branch only; what this avoids is the write helper's third
 * behaviour, a 403 for a session with no branch and no `location.switch`, which would
 * make a merchant-wide costing read impossible for exactly the merchant-level roles that
 * are supposed to have it.
 */
function readLocationScope(access: MerchantAccess, requested: string | null): string | null {
  if (requested) return resolveLocationAuthority(access, requested);
  return access.locationId ?? null;
}

/** Receipts grouped by item, ready for the weighted average. */
function groupBuckets(
  rows: readonly {
    inventoryItemId: string;
    scale: number;
    unitCostMinor: string;
    quantity: string;
  }[],
) {
  const grouped = new Map<string, CostBucket[]>();
  for (const row of rows) {
    const list = grouped.get(row.inventoryItemId) ?? [];
    list.push({
      quantity: toBigInt(row.quantity),
      scale: row.scale,
      unitCostMinor: toBigInt(row.unitCostMinor),
    });
    grouped.set(row.inventoryItemId, list);
  }
  return grouped;
}

/** The item's own scale, which is the grid every answer is expressed on. */
function scaleOf(item: ItemRow): number {
  return item.quantityScale;
}

/** The one cost per item, from the same weighted average the basis view reports. */
function unitCostsByItem(
  rows: readonly {
    inventoryItemId: string;
    scale: number;
    unitCostMinor: string;
    quantity: string;
  }[],
): Map<string, bigint> {
  const costs = new Map<string, bigint>();
  for (const [inventoryItemId, buckets] of groupBuckets(rows)) {
    const average = weightedAverageUnitCost(buckets);
    if (average) costs.set(inventoryItemId, average.unitCostMinor);
  }
  return costs;
}

/**
 * A quantity for the contract. The unit is re-validated rather than cast: the column
 * has a CHECK constraint, and a cast that trusted it would turn a schema mistake into
 * an invalid payload instead of a loud failure.
 */
function quantityAtScale(value: bigint, scale: number, unit: string) {
  const parsed = UnitOfMeasure.safeParse(unit);
  if (!parsed.success) throw new Error(`quantityAtScale: unknown unit: ${unit}`);
  return { value: toSafeNumber(value), scale, unit: parsed.data };
}

function uncostedItem(item: ItemRow, defect: PlateCostDefect): UncostedItem {
  return {
    inventoryItemId: item.inventoryItemId,
    publicReference: item.publicReference,
    displayName: item.displayName,
    defect,
  };
}

/**
 * A plate's identity: a product, and a variant when the catalogue has one. A mapping
 * with no variant prices the bare product; one with a variant prices that variant.
 */
function plateKey(productId: string | null, variantId: string | null): string {
  return `${productId ?? 'none'}::${variantId ?? 'none'}`;
}

/** `min`/`max` on dates arrive as timestamps from some drivers; only the day matters. */
function shortDate(value: string): string {
  return value.slice(0, 10);
}

function assertWindow(from: string, to: string, maxDays: number): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'business dates required',
    });
  }
  if (from > to) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'the window ends before it starts',
    });
  }
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
  if (days + 1 > maxDays) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: `the window may not exceed ${maxDays} days`,
    });
  }
}

// ── The variance's arithmetic ─────────────────────────────────────────────────

/**
 * Several quantities at several scales, added and expressed at one scale. The SIGNED
 * twin of the domain module's `sumScaled`: a ledger sum can legitimately be negative
 * (a count correction that added stock), and refusing the sign would refuse a true
 * answer. The sum happens at a common denominator and is rounded ONCE, exactly as the
 * domain module documents.
 */
function sumSignedScaled(
  quantities: readonly { value: bigint; scale: number }[],
  targetScale: number,
): bigint {
  if (quantities.length === 0) return 0n;
  let scale = targetScale;
  for (const quantity of quantities) {
    if (quantity.scale > scale) scale = quantity.scale;
  }
  let numerator = 0n;
  for (const quantity of quantities) {
    numerator += quantity.value * pow10(scale - quantity.scale);
  }
  if (scale === targetScale) return numerator;
  return divideRoundHalfUp(numerator, pow10(scale - targetScale));
}

/** An exact rational, kept so a sum of explosions is divided only once. */
type Rational = { numerator: bigint; denominator: bigint };

/** `a + b` as an exact rational, reduced so the numbers stay small. */
function addRational(left: Rational, right: Rational): Rational {
  let numerator = left.numerator * right.denominator + right.numerator * left.denominator;
  let denominator = left.denominator * right.denominator;
  const divisor = greatestCommonDivisor(numerator < 0n ? -numerator : numerator, denominator);
  if (divisor > 1n) {
    numerator /= divisor;
    denominator /= divisor;
  }
  return { numerator, denominator };
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a === 0n ? 1n : a;
}

function nonNegative(value: bigint): bigint {
  return value < 0n ? 0n : value;
}

/** The item's own unit, re-validated rather than cast, as the contract demands. */
function unitOf(item: ItemRow) {
  const parsed = UnitOfMeasure.safeParse(item.baseUnit);
  if (!parsed.success) throw new Error(`unitOf: unknown unit: ${item.baseUnit}`);
  return parsed.data;
}

/**
 * THE TOTAL OF A COLUMN OF LINES. Each line is expressed in its own item's unit, so a
 * cross-item total has no unit of its own: it is the arithmetic sum of the lines'
 * scaled values, and the response states `unit` rather than pretending the items share
 * one. The per-item lines are what an owner acts on; the total exists so the answer is
 * self-checking.
 */
function scaledTotal(values: readonly number[]) {
  return {
    value: toSafeNumber(values.reduce((total, value) => total + BigInt(value), 0n)),
    scale: 0,
    unit: 'unit' as const,
  };
}

/** A share of a total in basis points. A total of zero has no share to give. */
function shareBasisPoints(value: bigint, total: bigint): number {
  if (total === 0n) return 0;
  const negative = total < 0n !== value < 0n;
  const magnitude = divideRoundHalfUp(
    (value < 0n ? -value : value) * 10_000n,
    total < 0n ? -total : total,
  );
  return toSafeNumber(negative ? -magnitude : magnitude);
}

// ── The one recipe-version cost path ──────────────────────────────────────────

/**
 * What the cost arithmetic needs from one row of a recipe explosion. Stated as its own
 * shape because the authoring module's write path and this read both cost a version,
 * and they must run the SAME arithmetic rather than two implementations.
 */
export type RecipeCostExplosionRow = {
  readonly inventoryItemId: string;
  readonly numerator: string;
  readonly denominator: string;
  readonly quantityScale: number;
  readonly hasRecipe: boolean;
};

/** One version's cost, and why it could not be built when it could not. */
export type RecipeCostOutcome = {
  readonly costMinor: bigint | null;
  readonly defects: PlateCostDefect[];
};

/**
 * The exact rational of an explosion row, divided at the item's OWN scale.
 *
 * THE DIVISION MUST BE EXACT, and this is the same test the checkout applies to a sold
 * line (`INVENTORY_QUANTITY_NOT_EXACT`). A line that does not divide is reported with
 * its FLOORED quantity and `exact: false`; the caller then refuses to price the recipe
 * at all, because a cost on a rounded quantity is a cost nobody can reconcile.
 */
export function explodedQuantity(row: RecipeCostExplosionRow): { value: bigint; exact: boolean } {
  const numerator = exactInteger(row.numerator) * pow10(row.quantityScale);
  const denominator = exactInteger(row.denominator);
  if (denominator <= 0n) throw new Error('explodedQuantity: a denominator that is not positive');
  return { value: numerator / denominator, exact: numerator % denominator === 0n };
}

/** A `numeric` Postgres handed over as text, read as an EXACT integer. */
export function exactInteger(value: string): bigint {
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2] !== undefined && /[1-9]/.test(match[2]))) {
    throw new Error(`exactInteger: not an integer: ${value}`);
  }
  return BigInt(match[1]);
}

/**
 * The cost of ONE unit of a recipe's yield, from the exploded RAW items only.
 *
 * EVERY WAY THIS NUMBER GOES WRONG IS EXCLUDED HERE:
 *
 *   · an intermediate row contributes nothing, or the prep is charged twice;
 *   · a line that does not divide at the item's scale makes the WHOLE cost null,
 *     because a rounded quantity cannot be reconciled with the ledger;
 *   · an item no receipt has priced makes the cost null. Zero would read as a hundred
 *     percent margin, which is the most expensive kind of wrong a cost can be;
 *   · an empty list of leaves is not a free recipe. It means the walk reached no raw
 *     item, so there is no cost to report.
 *
 * The sum is taken as exact rationals at a common denominator and rounded ONCE, by the
 * same function the plate view rounds with: a second implementation of half-up would be
 * a second answer. The defects are the REASON the cost is null, in the plate view's own
 * vocabulary, so a stored version can say why it has no cost rather than only that it
 * has none.
 */
export function recipeCostOutcome(
  rows: readonly RecipeCostExplosionRow[],
  unitCosts: ReadonlyMap<string, bigint>,
): RecipeCostOutcome {
  const leaves = rows.filter((row) => !row.hasRecipe);
  if (leaves.length === 0) return { costMinor: null, defects: ['no_recipe_components'] };
  const defects = new Set<PlateCostDefect>();
  const costed: { quantity: bigint; scale: number; unitCostMinor: bigint }[] = [];
  for (const leaf of leaves) {
    const quantity = explodedQuantity(leaf);
    if (!quantity.exact) {
      defects.add('unit_conversion_not_exact');
      continue;
    }
    const unitCost = unitCosts.get(leaf.inventoryItemId);
    if (unitCost === undefined) {
      defects.add('no_cost_basis');
      continue;
    }
    costed.push({ quantity: quantity.value, scale: leaf.quantityScale, unitCostMinor: unitCost });
  }
  // Any defect makes the WHOLE cost unknown: a cost that silently dropped a line is
  // the one number this module must never print.
  if (defects.size > 0) return { costMinor: null, defects: [...defects] };
  return { costMinor: plateCostMinor(costed), defects: [] };
}

/** One recipe version's point in the cost history, stored or freshly computed. */
function costPoint(
  version: RecipeCostVersionRow,
  rows: ReadonlyMap<string, RecipeCostRow[]>,
  unitCosts: ReadonlyMap<string, bigint>,
  asOf: string,
): InventoryRecipeCostPoint {
  const stored = version.computedAt !== null;
  const outcome = stored
    ? {
        costMinor: version.computedCostMinor === null ? null : toBigInt(version.computedCostMinor),
        defects: storedDefects(version.computedDefects),
      }
    : recipeCostOutcome(rows.get(version.recipeId) ?? [], unitCosts);
  return {
    recipeId: version.recipeId,
    version: version.version,
    effectiveAt: new Date(version.effectiveAt).toISOString(),
    retiredAt: version.retiredAt === null ? null : new Date(version.retiredAt).toISOString(),
    costMinor: outcome.costMinor === null ? null : toSafeNumber(outcome.costMinor),
    defects: outcome.defects,
    // A stored point names when it was COMPUTED; a fresh one names the read that made it.
    capturedAt:
      stored && version.computedAt !== null ? new Date(version.computedAt).toISOString() : asOf,
  };
}

/** A stored defect list, kept to the vocabulary the contract publishes. */
function storedDefects(values: readonly string[] | null): PlateCostDefect[] {
  if (values === null) return [];
  const defects: PlateCostDefect[] = [];
  for (const value of values) {
    const parsed = PlateCostDefect.safeParse(value);
    if (parsed.success) defects.push(parsed.data);
  }
  return defects;
}
