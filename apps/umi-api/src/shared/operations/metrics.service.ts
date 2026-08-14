import { Injectable } from '@nestjs/common';

const MAX_SERIES = 2_000;

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  increment(name: string, labels: Record<string, string> = {}, amount = 1): void {
    const key = metricKey(name, labels);
    this.makeRoom(this.counters, key);
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  observe(name: string, milliseconds: number, labels: Record<string, string> = {}): void {
    const key = metricKey(name, labels);
    this.makeRoom(this.durations, key);
    const current = this.durations.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += milliseconds;
    current.maxMs = Math.max(current.maxMs, milliseconds);
    this.durations.set(key, current);
  }

  snapshot(): object {
    return {
      counters: Object.fromEntries(this.counters),
      durations: Object.fromEntries(this.durations),
    };
  }

  private makeRoom<T>(store: Map<string, T>, key: string): void {
    if (store.has(key) || store.size < MAX_SERIES) return;
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

function metricKey(name: string, labels: Record<string, string>): string {
  const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const suffix = Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value.replace(/[^a-zA-Z0-9_.:/-]/g, '_')}`)
    .join(',');
  return suffix ? `${safeName}{${suffix}}` : safeName;
}
