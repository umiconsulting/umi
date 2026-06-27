import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions, JobPriority } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { EnqueueService } from './enqueue.service';
import { ZettleAdapter } from '../shared/adapters/zettle.adapter';
import { ProductsRepository } from '../modules/conversations/products.repository';
import type { ProductVariant } from '../modules/conversations/tools/product-search';

/**
 * Integrations queue consumer (Phase 3d) — `zettle.sync`. Pulls the Zettle
 * catalog via the adapter and upserts `ops.products` (rebound from the legacy
 * `transactions`/`products` columns): price_cents = Zettle minor units (centavos)
 * direct; variant prices = amount/100 (pesos, Zettle-native jsonb); category
 * get-or-create; absent products marked unavailable. Then enqueues `product.embed`
 * to (re)embed changed rows. Worker-only.
 */
@Processor(QUEUES.integrations, workerOptions(QUEUES.integrations))
export class IntegrationsProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly zettle: ZettleAdapter,
    private readonly products: ProductsRepository,
    private readonly enqueue: EnqueueService,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'zettle.sync') {
      this.logger.warn(`unknown integrations job: ${job.name} #${job.id}`);
      return;
    }
    const tenantId = String((job.data as Record<string, unknown>)?.tenant_id ?? '');
    if (!tenantId) throw new Error('zettle.sync requires tenant_id');

    const catalog = await this.zettle.fetchProducts();
    if (catalog === null) return; // not configured — deliberate skip (adapter logged)

    let errors = 0;
    for (const product of catalog) {
      try {
        const variants: ProductVariant[] = (product.variants ?? []).map((v) => ({
          sku: v.sku ?? null,
          name: v.name || v.description || 'Unnamed',
          price: v.price?.amount ? v.price.amount / 100 : 0, // pesos (Zettle-native jsonb)
        }));
        const firstVariantCents = product.variants?.[0]?.price?.amount;
        const priceCents = firstVariantCents ?? product.price?.amount ?? 0; // centavos
        const categoryId = await this.products.getOrCreateCategory(tenantId, product.category?.name ?? null);
        await this.products.upsertFromZettle(tenantId, {
          zettleUuid: product.uuid,
          name: product.name,
          description: product.description ?? null,
          categoryId,
          priceCents,
          variants,
          isAvailable: !product.deleted && product.etag !== 'DELETED',
        });
      } catch (err) {
        errors++;
        this.logger.warn(
          `zettle_sync_product_error "${product.name}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const uuids = catalog.map((p) => p.uuid);
    if (uuids.length > 0) await this.products.markUnavailableExcept(tenantId, uuids);

    // (Re)embed changed/new products (the upsert nulled name_embedding on change).
    await this.enqueue.enqueue(
      QUEUES.enrichment,
      'product.embed',
      { tenant_id: tenantId },
      { priority: JobPriority.Background },
    );

    if (errors > 0) {
      throw new Error(`zettle.sync completed with ${errors}/${catalog.length} product errors`);
    }
    this.logger.log(`zettle_sync_complete synced=${catalog.length} tenant=${tenantId}`);
  }
}
