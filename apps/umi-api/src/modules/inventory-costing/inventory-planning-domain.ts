/** Calendar dates use the merchant's business date from PostgreSQL. */
export function shiftDate(date: string, offset: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
export function purchaseHorizon(today: string, days: number[]): string[] {
  if (!days.length) return [];
  for (let n = 1; n <= 7; n++) {
    if (days.includes(weekday(shiftDate(today, n))))
      return Array.from({ length: n }, (_, i) => shiftDate(today, i));
  }
  return [];
}
export type Fraction = { n: bigint; d: bigint };
export function add(a: Fraction, b: Fraction): Fraction {
  let n = a.n * b.d + b.n * a.d;
  let d = a.d * b.d;
  let x = n;
  let y = d;
  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  if (x !== 0n) {
    n /= x;
    d /= x;
  }
  return { n, d };
}
export function ceil(a: Fraction): bigint {
  return (a.n + a.d - 1n) / a.d;
}
export function predictDay(
  history: Map<string, bigint>,
  firstDay: string | null,
  target: string,
  cutoff: string,
): Fraction | null {
  if (!firstDay) return null;
  let count = 0;
  let total = 0n;
  for (let n = 1; n <= 56; n++) {
    const day = shiftDate(cutoff, -n);
    if (day < firstDay || weekday(day) !== weekday(target)) continue;
    count++;
    total += history.get(day) ?? 0n;
  }
  return count < 4 ? null : { n: total, d: BigInt(count) };
}
export function predictPeriod(
  history: Map<string, bigint>,
  firstDay: string | null,
  dates: string[],
  cutoff: string,
): Fraction | null {
  if (!dates.length) return null;
  let total: Fraction = { n: 0n, d: 1n };
  for (const date of dates) {
    const day = predictDay(history, firstDay, date, cutoff);
    if (!day) return null;
    total = add(total, day);
  }
  return total;
}
export function holdout(
  history: Map<string, bigint>,
  firstDay: string | null,
  today: string,
  training = history,
) {
  const cutoff = shiftDate(today, -7);
  let error = 0;
  let baselineError = 0;
  let evaluatedDays = 0;
  for (let i = 0; i < 7; i++) {
    const day = shiftDate(cutoff, i);
    const estimate = predictDay(training, firstDay, day, cutoff);
    if (!estimate) continue;
    const actual = Number(history.get(day) ?? 0n);
    error += Math.abs(Number(estimate.n) / Number(estimate.d) - actual);
    baselineError += Math.abs(Number(training.get(shiftDate(day, -7)) ?? 0n) - actual);
    evaluatedDays++;
  }
  return {
    evaluatedDays,
    mae: evaluatedDays ? error / evaluatedDays : null,
    baselineMae: evaluatedDays ? baselineError / evaluatedDays : null,
  };
}

export type PlanningEdge = { itemId: string; quantity: Fraction };
export type PlanningStock = { available: bigint; minimum: bigint; components?: PlanningEdge[] };
/** Aggregate all parents before netting shared preparations, so stock is used exactly once. */
export function netRequirements(initial: Map<string, Fraction>, stock: Map<string, PlanningStock>) {
  const indegree = new Map([...stock.keys()].map((id) => [id, 0]));
  for (const item of stock.values())
    for (const edge of item.components ?? []) {
      if (!stock.has(edge.itemId) || edge.quantity.d <= 0n || edge.quantity.n < 0n) return null;
      indegree.set(edge.itemId, indegree.get(edge.itemId)! + 1);
    }
  if ([...initial.keys()].some((id) => !stock.has(id))) return null;
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  const demand = new Map(initial);
  const result = new Map<string, { consumption: bigint; suggested: bigint; prepare: boolean }>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    const item = stock.get(id)!;
    const consumption = ceil(demand.get(id) ?? { n: 0n, d: 1n });
    const missing = consumption + item.minimum - item.available;
    const suggested = missing > 0n ? missing : 0n;
    if (item.components?.length === 0) return null;
    result.set(id, { consumption, suggested, prepare: item.components !== undefined });
    for (const edge of item.components ?? []) {
      demand.set(
        edge.itemId,
        add(demand.get(edge.itemId) ?? { n: 0n, d: 1n }, {
          n: suggested * edge.quantity.n,
          d: edge.quantity.d,
        }),
      );
      indegree.set(edge.itemId, indegree.get(edge.itemId)! - 1);
      if (indegree.get(edge.itemId) === 0) queue.push(edge.itemId);
    }
  }
  return result.size === stock.size ? result : null;
}
