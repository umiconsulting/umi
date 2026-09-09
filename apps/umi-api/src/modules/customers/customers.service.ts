import { Injectable } from '@nestjs/common';
import { formatMxn, iso } from '../../shared/format/money';
import { isProductStatusActive } from '@umi/contract';
import { AnthropicAdapter } from '../../shared/adapters/anthropic.adapter';
import { MerchantsRepository } from '../merchants/merchants.repository';
import { CustomersRepository, type Row } from './customers.repository';
import {
  averageTicketCents,
  classifyCustomerSegment,
  daysBetween,
  visitsPerMonth,
  SEGMENT_THRESHOLDS,
  type SegmentThresholds,
} from './customer-kpis';

type Products = Record<string, { status?: string } | undefined>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

function productActive(products: Products, key: string): boolean {
  const status = products[key]?.status;
  return isProductStatusActive(status);
}

function normalizeCustomerPhone(phone: string | null): string | null {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+52${digits.slice(-10)}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('521')) return `+52${digits.slice(-10)}`;
  if (digits.startsWith('0') && digits.length > 10) return `+52${digits.slice(-10)}`;
  return `+${digits}`;
}

/** Opaque keyset cursor for the message transcript: base64url of {occurredAt,id}. */
function encodeMessageCursor(cursor: { occurredAt: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode a transcript cursor; a missing or malformed cursor means "start from newest". */
function decodeMessageCursor(raw: string | undefined): { occurredAt: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      parsed &&
      typeof parsed.occurredAt === 'string' &&
      typeof parsed.id === 'string' &&
      UUID_RE.test(parsed.id)
    ) {
      return { occurredAt: parsed.occurredAt, id: parsed.id };
    }
  } catch {
    // fall through: treat a corrupt cursor as no cursor rather than 500ing
  }
  return null;
}

/** Opaque keyset cursor for the customer list: base64url of {ts,id}. */
function encodeListCursor(cursor: { ts: string; id: string }): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode a list cursor; a missing or malformed cursor means "start from the top". */
function decodeListCursor(raw: string | undefined): { ts: string; id: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      parsed &&
      typeof parsed.ts === 'string' &&
      typeof parsed.id === 'string' &&
      UUID_RE.test(parsed.id)
    ) {
      return { ts: parsed.ts, id: parsed.id };
    }
  } catch {
    // corrupt cursor → start from the top
  }
  return null;
}

// The AI portrait is cheap-stale: a 6-hour, size-bounded in-memory cache keyed by a
// fingerprint of the inputs means the Haiku call fires only when the customer's
// facts, conversation summaries or KPIs actually move — not on every tab open.
const DESCRIPTION_TTL_MS = 6 * 60 * 60 * 1000;
const DESCRIPTION_CACHE_MAX = 500;

// Spanish, plain language (lenguaje claro) — the portrait is read by café owners.
// The model gets facts + conversation summaries + KPIs and MUST NOT invent.
const PORTRAIT_SYSTEM = `Eres el analista de clientes de un café. Escribes un retrato breve de UN cliente para el dueño del negocio.

Reglas:
- Escribe en español claro y sencillo (lenguaje llano). Usa frases cortas.
- Máximo 3 frases y 50 palabras. Solo el párrafo: sin títulos, sin listas, sin emojis.
- Usa solo los datos que te doy. No inventes nada. Si hay pocos datos, di solo lo que se sabe.
- Interpreta los datos, no los repitas como tabla. Habla de sus hábitos, lo que pide, su valor y su ritmo de visita.
- Si el segmento es "at_risk" (en riesgo) o "lapsed" (inactivo), dilo con claridad para que el dueño actúe.

Segmentos: prospect=sin compras aún; new=cliente nuevo; regular=cliente frecuente; vip=frecuente y de alto gasto; at_risk=antes venía seguido y ya se tardó; lapsed=hace mucho que no viene.`;

/** Cheap, stable fingerprint of the portrait inputs (djb2 over the JSON). */
function fingerprintPortrait(value: unknown): string {
  const json = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + json.length.toString(36);
}

/**
 * Customer 360 read service. Maps repository rows into the exact dashboard DTOs
 * (server.js `platformCustomerDto` + the per-domain detail mappers). Product
 * availability is derived from the merchant's `product_instances`.
 */
@Injectable()
export class CustomersService {
  /** contactId:fingerprint → the generated portrait, with an expiry. */
  private readonly descriptionCache = new Map<string, { text: string; expires: number }>();

  constructor(
    private readonly repo: CustomersRepository,
    private readonly merchants: MerchantsRepository,
    private readonly anthropic: AnthropicAdapter,
  ) {}

  /** Merchant product map (drives availability flags in the DTOs). */
  loadProducts(merchantId: string): Promise<Products> {
    return this.merchants.loadProducts(merchantId);
  }

  private customerDto(row: Row, products: Products) {
    const identityList = Array.isArray(row.identities) ? row.identities : [];
    const cashAvailable = productActive(products, 'cash');
    const conversaflowAvailable = productActive(products, 'conversaflow');
    const kdsAvailable = productActive(products, 'kds');
    const hasCash = Number(row.loyalty_count || 0) > 0;
    const hasWhatsapp =
      Number(row.conversation_count || 0) > 0 ||
      identityList.some((i: Row) => i.identity_type === 'whatsapp');
    const hasOrders = Number(row.orders_count || 0) > 0;
    const needsReview =
      Number(row.merge_candidate_count || 0) > 0 || Number(row.data_quality_count || 0) > 0;
    const factsCount = Number(row.memory_count || 0);
    const lastTouchAt = iso(row.last_touch_at || row.updated_at || row.created_at);

    return {
      id: row.id,
      displayName:
        row.display_name || row.normalized_phone || row.phone || row.email || 'Unknown customer',
      phone: row.phone || row.normalized_phone || '',
      normalizedPhone: row.normalized_phone || normalizeCustomerPhone(row.phone),
      email: row.email || '',
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      lastTouchAt,
      status: needsReview ? 'needs_review' : hasOrders || hasCash || hasWhatsapp ? 'active' : 'new',
      products: {
        whatsapp: {
          available: conversaflowAvailable,
          active: hasWhatsapp,
          source: hasWhatsapp ? 'conversaflow' : 'none',
          conversations: Number(row.conversation_count || 0),
          activeConversations: Number(row.active_conversations || 0),
        },
        cash: { available: cashAvailable, active: hasCash, source: hasCash ? 'cash' : 'none' },
        orders: {
          available: kdsAvailable || conversaflowAvailable,
          active: hasOrders,
          source: hasOrders ? 'commerce' : 'none',
        },
        giftCards: {
          available: cashAvailable,
          active: Number(row.gift_card_count || 0) > 0,
          source: Number(row.gift_card_count || 0) > 0 ? 'cash' : 'none',
        },
      },
      value: {
        orders: Number(row.orders_count || 0),
        totalSpendCents: Number(row.total_spend_cents || 0),
        totalSpend: formatMxn(Number(row.total_spend_cents || 0)),
        visits: Number(row.total_visits || 0),
        walletBalanceCents: Number(row.wallet_balance_cents || 0),
        walletBalance: formatMxn(Number(row.wallet_balance_cents || 0)),
      },
      memory: {
        factsCount,
        embeddingHealth: factsCount > 0 ? 'context_ready' : 'no_memory_yet',
        summary:
          factsCount > 0
            ? `${factsCount} memory item${factsCount === 1 ? '' : 's'}`
            : 'No extracted facts yet',
      },
      dataQuality: {
        mergeCandidates: Number(row.merge_candidate_count || 0),
        findings: Number(row.data_quality_count || 0),
        needsReview,
      },
      identities: identityList,
    };
  }

  async list(
    merchantId: string,
    products: Products,
    options: {
      limit?: string;
      search?: string;
      filter?: string;
      contactId?: string;
      cursor?: string;
    } = {},
  ) {
    const limit = Math.max(1, Math.min(parseInt(options.limit || '20') || 20, 100));
    const search = String(options.search || '')
      .trim()
      .slice(0, 80);
    const filter = String(options.filter || '')
      .trim()
      .slice(0, 24);
    const contactId = String(options.contactId || '').trim();
    const contactUuid = isUuid(contactId) ? contactId : merchantId;
    const cursor = decodeListCursor(options.cursor);

    const { rows, nextCursor } = await this.repo.listCustomers(merchantId, {
      limit,
      search,
      filter,
      contactId,
      contactUuid,
      cursorTs: cursor?.ts ?? null,
      cursorId: cursor?.id ?? null,
    });
    const customers = rows.map((r) => this.customerDto(r, products));
    return {
      customers,
      nextCursor: nextCursor ? encodeListCursor(nextCursor) : null,
      source: 'merchant.customer',
    };
  }

  /** Cheap total for the insights header — a plain count, no laterals. */
  async count(merchantId: string): Promise<number> {
    return this.repo.countCustomers(merchantId);
  }

  async detail(merchantId: string, products: Products, contactId: string) {
    if (!isUuid(contactId)) return null;
    const list = await this.list(merchantId, products, { limit: '1', contactId });
    const customer = list.customers[0] || null;
    if (!customer) return null;
    const [kpis, timeline, conversations, orders, cash, identity] = await Promise.all([
      this.kpis(merchantId, contactId),
      this.timeline(merchantId, contactId),
      this.conversations(merchantId, contactId),
      this.orders(merchantId, contactId),
      this.cash(merchantId, products, contactId),
      this.identity(merchantId, contactId),
    ]);
    return { customer, kpis, timeline, conversations, orders, cash, identity };
  }

  /**
   * The Overview-tab KPI block for one customer: the restaurant guest-card metrics
   * (spend · average ticket · visits · recency), the cadence/preference texture
   * (frequency, tenure, favourites, channel mix, daypart), the margin signals
   * (tip/refund/discount) and one RFM-style segment. Money is formatted es-MX;
   * `segment`, `recencyDays`, `tenureDays` etc. stay raw for the UI to localise.
   */
  private kpisDto(
    raw: {
      agg: Row;
      favorites: Row[];
      category: Row | null;
      daypart: Row | null;
    },
    thresholds: SegmentThresholds,
  ) {
    const agg = raw.agg || {};
    const orders = Number(agg.orders_count || 0);
    const visits = Number(agg.visit_days || 0);
    const totalSpendCents = Number(agg.total_spend_cents || 0);
    const grossCents = Number(agg.gross_cents || 0);
    const discountCents = Number(agg.discount_cents || 0);
    const firstOrderAt = iso(agg.first_order_at);
    const lastOrderAt = iso(agg.last_order_at);
    const nowIso = new Date().toISOString();
    const recencyDays = daysBetween(lastOrderAt, nowIso);
    const tenureDays = daysBetween(firstOrderAt, nowIso);
    const avgTicketCents = averageTicketCents(totalSpendCents, orders);
    const frequencyPerMonth = visitsPerMonth(visits, tenureDays);
    const segment = classifyCustomerSegment(
      { orders, visits, totalSpendCents, recencyDays, tenureDays },
      thresholds,
    );

    const dineIn = Number(agg.dine_in_orders || 0);
    const pickup = Number(agg.pickup_orders || 0);
    const delivery = Number(agg.delivery_orders || 0);
    const unspecified = Number(agg.unspecified_orders || 0);
    const channelTotal = dineIn + pickup + delivery + unspecified;
    // The dominant channel is the plurality across ALL orders — including those
    // with no fulfillment_type set. So a customer whose orders are mostly
    // unspecified reads "Sin especificar", not a channel that only 3% of orders
    // used (WhatsApp/POS orders often carry no fulfillment_type).
    const dominantChannel =
      [
        { key: 'dine_in', orders: dineIn },
        { key: 'pickup', orders: pickup },
        { key: 'delivery', orders: delivery },
        { key: 'unspecified', orders: unspecified },
      ]
        .filter((x) => x.orders > 0)
        .sort((a, b) => b.orders - a.orders)[0]?.key ?? null;

    const tipTotalCents = Number(agg.tip_total_cents || 0);
    const tippedReceipts = Number(agg.tipped_receipts || 0);
    const avgTipWhenTippedCents = tippedReceipts > 0 ? Math.round(tipTotalCents / tippedReceipts) : 0;

    const refundedOrders = Number(agg.refunded_orders || 0);
    const refundRate = orders > 0 ? refundedOrders / orders : 0;
    const discountRate = grossCents > 0 ? discountCents / grossCents : 0;

    const daypartBucket =
      raw.daypart && raw.daypart.daypart_bucket != null ? Number(raw.daypart.daypart_bucket) : null;
    const daypartDow =
      raw.daypart && raw.daypart.dow_local != null ? Number(raw.daypart.dow_local) : null;

    return {
      orders,
      visits,
      spend: {
        totalCents: totalSpendCents,
        total: formatMxn(totalSpendCents),
        avgTicketCents,
        avgTicket: formatMxn(avgTicketCents),
      },
      firstOrderAt,
      lastOrderAt,
      recencyDays,
      tenureDays,
      frequencyPerMonth,
      segment,
      favorites: (raw.favorites || []).map((f) => ({
        name: f.name,
        units: Number(f.units || 0),
        timesOrdered: Number(f.times_ordered || 0),
      })),
      topCategory: raw.category
        ? { name: raw.category.category, units: Number(raw.category.units || 0) }
        : null,
      channelMix: {
        dineIn,
        pickup,
        delivery,
        unspecified,
        total: channelTotal,
        dominant: dominantChannel,
      },
      daypart: { bucket: daypartBucket, dow: daypartDow },
      // Tip is only present on POS receipts that had a customer attached, so it is
      // "on attributed POS receipts", flagged by `attributed`, never "per visit".
      tips: {
        totalCents: tipTotalCents,
        total: formatMxn(tipTotalCents),
        tippedReceipts,
        avgWhenTippedCents: avgTipWhenTippedCents,
        avgWhenTipped: formatMxn(avgTipWhenTippedCents),
        attributed: tippedReceipts > 0,
      },
      refunds: { refundedOrders, rate: refundRate },
      discounts: { totalCents: discountCents, total: formatMxn(discountCents), rate: discountRate },
    };
  }

  /** Compute the Overview KPI block for one customer. */
  async kpis(merchantId: string, contactId: string) {
    const [raw, overrides] = await Promise.all([
      this.repo.kpis(merchantId, contactId),
      this.merchants.loadSegmentThresholds(merchantId),
    ]);
    // Owner overrides win over the code defaults; missing keys keep the shipped value.
    const thresholds = { ...SEGMENT_THRESHOLDS, ...overrides };
    return this.kpisDto(raw, thresholds);
  }

  /**
   * The AI customer portrait: a short Spanish sentence set, synthesised by Haiku
   * from the customer's extracted facts, recent conversation summaries and KPIs.
   * The embeddings feed this indirectly — the facts were extracted from embedded
   * messages — so no vector is read here. Fail-safe by design: a missing API key or
   * a model error returns `{ description: null }`, and the tab simply hides the card.
   */
  async describe(
    merchantId: string,
    contactId: string,
  ): Promise<{ description: string | null; generated: boolean; segment: string | null }> {
    if (!isUuid(contactId)) return { description: null, generated: false, segment: null };

    const [factRows, summaryRows, kpi] = await Promise.all([
      this.repo.factsFor(merchantId, contactId),
      this.repo.conversationSummaries(merchantId, contactId, 5),
      this.kpis(merchantId, contactId),
    ]);

    const facts: Record<string, unknown> = {};
    for (const r of factRows) facts[String(r.key)] = r.value;
    const summaries = summaryRows
      .map((r) => String(r.summary || '').trim())
      .filter(Boolean)
      .slice(0, 5);

    // Nothing to describe: no orders, no facts, no summaries.
    if (kpi.orders === 0 && Object.keys(facts).length === 0 && summaries.length === 0) {
      return { description: null, generated: false, segment: kpi.segment };
    }

    const input = {
      stats: {
        lifetimeSpend: kpi.spend.total,
        averageTicket: kpi.spend.avgTicket,
        visits: kpi.visits,
        orders: kpi.orders,
        visitsPerMonth: kpi.frequencyPerMonth,
        daysSinceLastVisit: kpi.recencyDays,
        tenureDays: kpi.tenureDays,
        segment: kpi.segment,
        favorites: kpi.favorites.map((f) => f.name),
        topCategory: kpi.topCategory?.name ?? null,
        channelMix: kpi.channelMix,
        daypart: kpi.daypart,
      },
      facts,
      conversationSummaries: summaries,
    };

    const key = `${contactId}:${fingerprintPortrait(input)}`;
    const now = Date.now();
    const cached = this.descriptionCache.get(key);
    if (cached && cached.expires > now) {
      return { description: cached.text, generated: false, segment: kpi.segment };
    }

    const completion = await this.anthropic.createCompletion({
      maxTokens: 220,
      system: PORTRAIT_SYSTEM,
      userMessage: JSON.stringify(input),
    });
    const text = completion?.text?.trim() || null;
    if (text) {
      this.descriptionCache.set(key, { text, expires: now + DESCRIPTION_TTL_MS });
      this.pruneDescriptionCache();
    }
    return { description: text, generated: Boolean(text), segment: kpi.segment };
  }

  /** Drop expired entries; if still over the cap, evict oldest-inserted first. */
  private pruneDescriptionCache() {
    const now = Date.now();
    for (const [k, v] of this.descriptionCache) {
      if (v.expires <= now) this.descriptionCache.delete(k);
    }
    while (this.descriptionCache.size > DESCRIPTION_CACHE_MAX) {
      const oldest = this.descriptionCache.keys().next().value;
      if (oldest === undefined) break;
      this.descriptionCache.delete(oldest);
    }
  }

  async timeline(merchantId: string, contactId: string) {
    const rows = await this.repo.timeline(merchantId, contactId);
    return rows.map((row) => ({ ...row, occurredAt: iso(row.occurred_at) }));
  }

  async conversations(merchantId: string, contactId: string) {
    const rows = await this.repo.conversations(merchantId, contactId);
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      openedAt: iso(row.opened_at),
      closedAt: iso(row.closed_at),
      updatedAt: iso(row.updated_at),
      lastMessageAt: iso(row.lastMessageAt),
      messageCount: Number(row.messageCount || 0),
      summary: row.metadata?.summary || row.metadata?.current_state || '',
    }));
  }

  /**
   * One conversation's transcript, returned oldest-first for display. The repo
   * reads newest-first for keyset paging (fetch older with `?cursor=`); we reverse
   * here so the caller renders top-to-bottom. `nextCursor` is non-null only while
   * older messages remain.
   */
  async messages(
    merchantId: string,
    contactId: string,
    conversationId: string,
    options: { cursor?: string; limit?: string } = {},
  ) {
    if (!isUuid(contactId) || !isUuid(conversationId)) {
      return { messages: [], nextCursor: null };
    }
    const limit = Math.max(1, Math.min(parseInt(options.limit || '30') || 30, 100));
    const cursor = decodeMessageCursor(options.cursor);
    // limit + 1 probes for a further page without a second COUNT query.
    const rows = await this.repo.messages(merchantId, contactId, conversationId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const oldest = page[page.length - 1];
    const nextCursor =
      hasMore && oldest
        ? encodeMessageCursor({ occurredAt: String(oldest.occurred_cursor), id: oldest.id })
        : null;
    const messages = page
      .map((row) => ({
        id: row.id,
        direction: row.direction,
        sender: row.sender,
        body: row.body || '',
        deliveryStatus: row.delivery_status || null,
        occurredAt: iso(row.occurred_at),
        createdAt: iso(row.created_at),
      }))
      .reverse();
    return { messages, nextCursor };
  }

  async orders(merchantId: string, contactId: string) {
    const rows = await this.repo.orders(merchantId, contactId);
    return rows.map((row) => ({
      id: row.id,
      orderNumber: row.order_number,
      sourceProduct: row.source_product,
      status: row.status,
      channel: row.channel,
      totalCents: Number(row.total_cents || 0),
      total: formatMxn(Number(row.total_cents || 0)),
      placedAt: iso(row.placed_at || row.created_at),
      updatedAt: iso(row.updated_at),
    }));
  }

  async cash(merchantId: string, products: Products, contactId: string) {
    const row = await this.repo.cash(merchantId, contactId);
    const available = productActive(products, 'cash');
    if (!row) return { available, source: 'cash', account: null };
    return {
      available,
      source: 'cash',
      account: {
        loyaltyAccountId: row.loyaltyAccountId,
        status: row.status,
        loyaltyCardId: row.loyaltyCardId,
        cardNumber: row.card_number,
        balanceCents: Number(row.balance_cents || 0),
        balance: formatMxn(Number(row.balance_cents || 0)),
        totalVisits: Number(row.total_visits || 0),
        visitsThisCycle: Number(row.visits_this_cycle || 0),
        pendingRewards: Number(row.pending_rewards || 0),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      },
    };
  }

  async identity(merchantId: string, contactId: string) {
    const { identities, candidates, findings } = await this.repo.identity(merchantId, contactId);
    return {
      identities: identities.map((row) => ({ ...row, createdAt: iso(row.created_at) })),
      mergeCandidates: candidates.map((row) => ({
        ...row,
        createdAt: iso(row.created_at),
        resolvedAt: iso(row.resolved_at),
      })),
      findings: findings.map((row) => ({
        ...row,
        createdAt: iso(row.created_at),
        resolvedAt: iso(row.resolved_at),
      })),
    };
  }

  async conversationsList(merchantId: string, query: { page?: string; limit?: string }) {
    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(query.limit || '20') || 20, 100));
    const skip = (page - 1) * limit;
    const { rows, total } = await this.repo.conversationsList(merchantId, limit, skip);
    return {
      conversations: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * The triage queue for the WhatsApp supervision surface: conversations where the
   * customer is waiting on a reply, oldest-waiting first.
   */
  async triage(merchantId: string, options: { limit?: string } = {}) {
    const limit = Math.max(1, Math.min(parseInt(options.limit || '50') || 50, 100));
    const rows = await this.repo.triage(merchantId, limit);
    return {
      conversations: rows.map((row) => ({
        id: row.id,
        customerId: row.customer_id,
        customerName: row.customer_name || null,
        customerPhone: row.customer_phone || null,
        status: row.status,
        summary: row.summary || '',
        lastSender: row.last_sender,
        lastMessage: row.last_message || '',
        waitingSince: iso(row.waiting_since),
      })),
      total: rows.length,
    };
  }

  async insights(merchantId: string, products: Products) {
    const payload = await this.list(merchantId, products, { limit: '100' });
    const total = await this.count(merchantId);
    const customers = payload.customers || [];
    const whatsappCustomers = customers.filter((c) => c.products?.whatsapp?.active).length;
    const cashCustomers = customers.filter((c) => c.products?.cash?.active).length;
    const needsReview = customers.filter((c) => c.dataQuality?.needsReview).length;
    const memoryReady = customers.filter((c) => c.memory?.factsCount > 0).length;
    const activeConversations = customers.reduce(
      (sum, c) => sum + (c.products?.whatsapp?.activeConversations || 0),
      0,
    );
    return {
      source: payload.source,
      generatedAt: new Date().toISOString(),
      metrics: {
        totalCustomers: total,
        whatsappCustomers,
        cashCustomers,
        memoryReady,
        needsReview,
        activeConversations,
      },
      insights: [
        {
          key: 'customer-growth',
          label: 'Customer base',
          value: total,
          action: 'Open Customers',
          target: '/customers',
          status: total > 0 ? 'ready' : 'empty',
        },
        {
          key: 'whatsapp-health',
          label: 'WhatsApp customers',
          value: whatsappCustomers,
          action: 'Review WhatsApp tab',
          target: '/customers?filter=whatsapp',
          status: productActive(products, 'conversaflow') ? 'ready' : 'unavailable',
        },
        {
          key: 'memory-health',
          label: 'Memory context ready',
          value: memoryReady,
          action: 'Review customers without memory',
          target: '/customers?filter=memory',
          status: memoryReady > 0 ? 'ready' : 'needs_attention',
        },
        {
          key: 'identity-quality',
          label: 'Identity review',
          value: needsReview,
          action: 'Review Data tabs',
          target: '/customers?filter=review',
          status: needsReview > 0 ? 'needs_attention' : 'ready',
        },
      ],
    };
  }
}
