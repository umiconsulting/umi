import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), '../../docs/migration/build-v3/42_pos_kitchen.sql'),
  'utf8',
);
const concurrencyHarness = readFileSync(
  resolve(process.cwd(), '../../scripts/umi-pos-kds-concurrency-check.sh'),
  'utf8',
);
const repositoryConcurrency = readFileSync(
  resolve(process.cwd(), 'src/modules/kds/kds.repository.integration.spec.ts'),
  'utf8',
);

describe('Gate 4A kitchen migration', () => {
  it('keeps kitchen state separate from commercial order state', () => {
    expect(migration).toContain('create table merchant.kitchen_order');
    expect(migration).toContain('source_order_id');
    expect(migration).toContain('unique (merchant_id, source_order_id)');
    expect(migration).not.toMatch(/update\s+merchant\.customer_order\s+set\s+status/i);
  });

  it('persists routed item state, ordered events, and command recovery', () => {
    expect(migration).toContain('create table merchant.kitchen_order_item');
    expect(migration).toContain('create table merchant.kitchen_event');
    expect(migration).toContain('create table merchant.kitchen_command');
    expect(migration).toContain('unique (merchant_id, idempotency_key)');
    expect(migration).toContain('aggregate_version');
  });

  it('uses exact station scope and never a null station wildcard', () => {
    expect(migration).toContain('station_id');
    expect(migration).toContain('create table merchant.kitchen_device_station');
    expect(migration).toContain('foreign key (merchant_id,location_id,station_id)');
    expect(migration).not.toMatch(/station_id\s+is\s+null\s+or/i);
  });

  it('protects kitchen tables with forced RLS and immutable events', () => {
    for (const table of [
      'kitchen_order',
      'kitchen_order_item',
      'kitchen_event',
      'kitchen_command',
      'kitchen_device_station',
    ]) {
      expect(migration).toContain(`alter table merchant.${table} enable row level security`);
      expect(migration).toContain(`alter table merchant.${table} force row level security`);
    }
    expect(migration).toContain('kitchen_event_append_only');
  });

  it('executes the race matrix through independent repository transactions', () => {
    expect(concurrencyHarness).toContain('kds.repository.integration.spec.ts');
    expect(repositoryConcurrency).toContain('Promise.all');
    for (const scenario of [
      'two KDS devices that start the same order',
      'two devices that mark the same item ready',
      'ready versus cancel',
      'ready versus recall',
      'complete versus recall',
      'snapshot while the status changes',
      'repeated event through command recovery',
      'sale projection retry',
      'station reassignment',
      'cancellation during preparation',
    ]) {
      expect(repositoryConcurrency).toContain(scenario);
    }
  });
});
