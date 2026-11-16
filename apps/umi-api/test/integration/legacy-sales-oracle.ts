import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from './metrics-parity-normalize';

/**
 * The frozen legacy sales summary. The old endpoint is gone after gate 3, so the
 * parity tests read this shape from the captured JSON and never call the old
 * repository.
 */
export interface LegacySalesSummary {
  merchantId: string;
  locationId: string | null;
  range: string;
  currency: string | null;
  bucket: 'hour' | 'day';
  totals: {
    netSalesMinorUnits: number;
    orders: number;
    averageTicketMinorUnits: number;
    itemsSold: number;
    discountMinorUnits: number;
    tipsMinorUnits: number;
    priorNetSalesMinorUnits: number | null;
  };
  paymentMix: { method: string; amountMinorUnits: number }[];
  channelMix: { channel: string; netSalesMinorUnits: number; orders: number }[];
  productMix: {
    productId: string | null;
    productName: string;
    category: string | null;
    units: number;
    netMinorUnits: number;
  }[];
  byOperator: { key: string; units: number; netMinorUnits: number }[];
  byHour: { key: string; units: number; netMinorUnits: number }[];
  series: { label: string; amountMinorUnits: number }[];
  capturedAt: string;
}

export interface LegacyCase {
  caseId: string;
  capturedAt: string;
  legacyCommit: string;
  request: { range: string; locationId: string | null; asOf: string | null; method?: string };
  productAliases: Record<string, string>;
  response: LegacySalesSummary;
}

interface ManifestCase {
  caseId: string;
  file: string;
  rawSha256: string;
  normalizedLegacySha256: string;
  ledgerLegacySha256: string | null;
  ledgerFreshSha256: string | null;
}

interface Manifest {
  record: string;
  legacyCommit: string;
  captureCommand: string;
  cases: ManifestCase[];
}

const FIXTURE_ROOT = join(__dirname, '../fixtures/semantic-gate3/legacy');

let cachedManifest: Manifest | null = null;

function manifest(): Manifest {
  if (!cachedManifest) {
    cachedManifest = JSON.parse(
      readFileSync(join(FIXTURE_ROOT, 'manifest.json'), 'utf8'),
    ) as Manifest;
  }
  return cachedManifest;
}

export function legacyManifest(): Manifest {
  return manifest();
}

/** Read one frozen case and verify its stored bytes against the manifest. */
export function loadLegacyCase(caseId: string): LegacyCase {
  const entry = manifest().cases.find((row) => row.caseId === caseId);
  if (!entry) throw new Error(`the frozen oracle has no case ${caseId}`);
  const text = readFileSync(join(FIXTURE_ROOT, entry.file), 'utf8');
  if (sha256(text) !== entry.rawSha256)
    throw new Error(`the frozen oracle file changed for ${caseId}`);
  return JSON.parse(text) as LegacyCase;
}
