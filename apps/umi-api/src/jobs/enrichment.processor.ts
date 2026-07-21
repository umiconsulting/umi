import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUES } from './queues';
import { workerOptions, JobPriority } from './job-options';
import { BaseProcessor } from './base.processor';
import { DeadLetterService } from './dead-letter.service';
import { EnqueueService } from './enqueue.service';
import { VoyageAdapter } from '../shared/adapters/voyage.adapter';
import { MemoryService, type CustomerFacts } from '../modules/conversations/memory.service';
import { MemoryRepository } from '../modules/conversations/memory.repository';
import { MessagesRepository } from '../modules/conversations/messages.repository';
import { ConversationsRepository } from '../modules/conversations/conversations.repository';
import { ProductsRepository } from '../modules/conversations/products.repository';

/**
 * Enrichment queue consumer (Phase 3d) — async, background-priority work that
 * never blocks a turn: message embeddings, rolling summaries, customer-fact
 * extraction, product embeddings, and the embedding backfill. Ported from the
 * `job-worker` enrichment processors; rebound to canonical `comms.*`/`ops.*` via
 * the conversation repos + MemoryService.
 */

const PRODUCT_EMBED_BATCH = 100;
const BACKFILL_BATCH = 50;

function buildProductEmbedText(p: {
  name: string;
  category: string | null;
  variants: Array<{ name: string }>;
}): string {
  const base = [p.name, p.category].filter(Boolean).join(' ');
  const variantNames = p.variants.map((v) => v.name).filter(Boolean);
  return variantNames.length > 0 ? `${base}: ${variantNames.join(', ')}` : base;
}

@Processor(QUEUES.enrichment, workerOptions(QUEUES.enrichment))
export class EnrichmentProcessor extends BaseProcessor {
  constructor(
    deadLetters: DeadLetterService,
    private readonly enqueue: EnqueueService,
    private readonly voyage: VoyageAdapter,
    private readonly memory: MemoryService,
    private readonly memoryRepo: MemoryRepository,
    private readonly messages: MessagesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly products: ProductsRepository,
  ) {
    super(deadLetters);
  }

  async process(job: Job): Promise<void> {
    const p = (job.data ?? {}) as Record<string, unknown>;
    switch (job.name) {
      case 'message.embed':
        return this.messageEmbed(p);
      case 'conversation.summarize':
        return this.summarize(p);
      case 'customer.extract_facts':
        return this.extractFacts(p);
      case 'product.embed':
        return this.productEmbed(p);
      case 'embed.backfill':
        return this.embedBackfill(p);
      default:
        this.logger.warn(`unknown enrichment job: ${job.name} #${job.id}`);
    }
  }

  private async messageEmbed(p: Record<string, unknown>): Promise<void> {
    const userId = p.user_message_id as string | undefined;
    const assistantId = p.assistant_message_id as string | undefined;
    const userText = String(p.user_text ?? '').trim();
    const assistantText = String(p.assistant_text ?? '').trim();
    // Only embed sides with BOTH an id and non-empty text. Never embed an empty
    // string — it would persist a meaningless vector and hide the row from the
    // backfill (which looks for name_embedding IS NULL).
    const targets: Array<{ id: string; text: string }> = [];
    if (userId && userText) targets.push({ id: userId, text: userText });
    if (assistantId && assistantText) targets.push({ id: assistantId, text: assistantText });
    if (!targets.length) return;
    const embeddings = await this.voyage.generateEmbeddings(targets.map((t) => t.text));
    if (!embeddings) return; // adapter logged; non-fatal (backfill catches it later)
    const model = this.voyage.embeddingModel;
    await Promise.all(
      targets.map((t, i) =>
        embeddings[i]
          ? this.messages.updateEmbedding(t.id, embeddings[i], model)
          : Promise.resolve(),
      ),
    );
  }

  private async summarize(p: Record<string, unknown>): Promise<void> {
    const conversationId = String(p.conversation_id ?? '');
    if (!conversationId) return;
    const conv = await this.conversations.loadById(conversationId);
    if (!conv) return;
    const total = await this.messages.countMessages(conversationId);
    if (total <= 8) return;
    const batch = Math.min(total - 8, 16);
    const older = await this.messages.getOlderMessages(conversationId, 8, batch);
    if (!older.length) return;
    const chronological = [...older].reverse();
    const summary = await this.memory.generateSummary(chronological, conv.summary);
    if (summary) await this.conversations.setSummary(conversationId, summary);
  }

  private async extractFacts(p: Record<string, unknown>): Promise<void> {
    const tenantId = String(p.business_id ?? '');
    const personId = String(p.person_id ?? '');
    const conversationId = p.conversation_id as string | undefined;
    if (!tenantId || !personId || !conversationId) return;
    const recent = await this.messages.getRecentMessages(conversationId, 12);
    if (!recent.length) return;
    const chronological = [...recent].reverse();
    const existing = (await this.memoryRepo.getCustomerFacts(
      tenantId,
      personId,
    )) as CustomerFacts | null;
    const facts = await this.memory.extractCustomerFacts(chronological, existing);
    if (!facts) return;
    await this.memoryRepo.upsertCustomerFacts(
      tenantId,
      personId,
      facts as unknown as Record<string, unknown>,
    );
  }

  private async productEmbed(p: Record<string, unknown>): Promise<void> {
    const tenantId = String(p.business_id ?? '');
    if (!tenantId) throw new Error('product.embed requires business_id');
    const batchSize = (p.batch_size as number) ?? PRODUCT_EMBED_BATCH;
    const rows = await this.products.listNeedingEmbedding(tenantId, batchSize);
    if (!rows.length) return;
    const embeddings = await this.voyage.generateEmbeddings(rows.map(buildProductEmbedText));
    if (!embeddings) throw new Error('voyage batch failed — retry');
    const model = this.voyage.embeddingModel;
    await Promise.all(
      rows.map((row, i) =>
        embeddings[i]
          ? this.products.updateNameEmbedding(row.id, embeddings[i], model)
          : Promise.resolve(),
      ),
    );
    if (rows.length === batchSize) {
      await this.enqueue.enqueue(QUEUES.enrichment, 'product.embed', p, {
        priority: JobPriority.Background,
      });
    }
  }

  private async embedBackfill(p: Record<string, unknown>): Promise<void> {
    const batchSize = (p.batch_size as number) ?? BACKFILL_BATCH;
    const tenantId = p.business_id as string | undefined;
    const msgs = await this.messages.listNeedingEmbedding(batchSize, tenantId);
    if (!msgs.length) return;
    const embeddings = await this.voyage.generateEmbeddings(msgs.map((m) => m.content));
    if (!embeddings) throw new Error('voyage batch failed — retry');
    const model = this.voyage.embeddingModel;
    await Promise.all(
      msgs.map((m, i) =>
        embeddings[i]
          ? this.messages.updateEmbedding(m.id, embeddings[i], model)
          : Promise.resolve(),
      ),
    );
    if (msgs.length === batchSize) {
      await this.enqueue.enqueue(QUEUES.enrichment, 'embed.backfill', p, {
        priority: JobPriority.Background,
      });
    }
  }
}
