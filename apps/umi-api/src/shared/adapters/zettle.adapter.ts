import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/config.schema';

// Ported from umi-conversaflow `job-worker/processors/zettle-sync.ts` (the only
// live Zettle code). Pure I/O over the Zettle Product API — the sync MAPPING,
// upsert, mark-unavailable, and product.embed re-enqueue stay in the Phase 3e
// integrations processor; this adapter only fetches.
//
// Auth: the live system uses a single static ZETTLE_API_KEY as the bearer token
// against the `organizations/self` (single-account) endpoint. Per-tenant OAuth
// token exchange (`zettle-oauth-setup` — no live source to port) is deferred
// until multi-account Zettle is needed (port analysis §5).
const ZETTLE_PRODUCTS_API = 'https://products.izettle.com/organizations/self/products/v2';

export interface ZettlePrice {
  amount?: number; // minor units (cents)
}

export interface ZettleVariant {
  sku?: string | null;
  name?: string | null;
  description?: string | null;
  price?: ZettlePrice | null;
}

export interface ZettleProduct {
  uuid: string;
  name: string;
  description?: string | null;
  category?: { name?: string | null } | null;
  price?: ZettlePrice | null;
  variants?: ZettleVariant[] | null;
  deleted?: boolean;
  etag?: string | null;
}

@Injectable()
export class ZettleAdapter {
  private readonly logger = new Logger(ZettleAdapter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /**
   * Fetch the full product catalog for the configured Zettle account.
   *
   * Contract (mirrors the source's control flow so the engine retries correctly):
   *   - not configured → returns `null` (a deliberate skip, like the source's
   *     no-key path);
   *   - HTTP or network error → **throws** (transient — let BullMQ retry, then
   *     dead-letter), exactly as `zettle-sync.ts` threw on `!response.ok`;
   *   - success → the raw `ZettleProduct[]`.
   */
  async fetchProducts(): Promise<ZettleProduct[] | null> {
    const token = this.config.get('ZETTLE_API_KEY', { infer: true });
    if (!token) {
      this.logger.warn('zettle_adapter_missing_config');
      return null;
    }

    // Bound the external call so a hung socket can't stall the worker (and its
    // retries). AbortSignal.timeout rejects the fetch → throws → BullMQ retries.
    const res = await fetch(ZETTLE_PRODUCTS_API, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Zettle API error: ${res.status} - ${text}`);
    }

    return (await res.json()) as ZettleProduct[];
  }
}
