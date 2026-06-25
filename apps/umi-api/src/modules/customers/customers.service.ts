import { Injectable } from '@nestjs/common';
import { formatMxn, iso } from '../../shared/format/money';
import { PRODUCT_ACTIVE_STATUSES } from '../auth/entitlement.guard';
import { TenantsRepository } from '../tenants/tenants.repository';
import {
  CustomersRepository,
  type Row,
} from './customers.repository';

type Products = Record<string, { status?: string } | undefined>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}

function productActive(products: Products, key: string): boolean {
  const status = products[key]?.status;
  return !!status && PRODUCT_ACTIVE_STATUSES.has(status);
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

/**
 * Customer 360 read service. Maps repository rows into the exact dashboard DTOs
 * (server.js `platformCustomerDto` + the per-domain detail mappers). Product
 * availability is derived from the tenant's `product_instances`.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly repo: CustomersRepository,
    private readonly tenants: TenantsRepository,
  ) {}

  /** Tenant product map (drives availability flags in the DTOs). */
  loadProducts(tenantId: string): Promise<Products> {
    return this.tenants.loadProducts(tenantId);
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
      Number(row.merge_candidate_count || 0) > 0 ||
      Number(row.data_quality_count || 0) > 0;
    const factsCount = Number(row.memory_count || 0);
    const lastTouchAt = iso(row.last_touch_at || row.updated_at || row.created_at);

    return {
      id: row.id,
      displayName: row.display_name || row.normalized_phone || row.phone || row.email || 'Unknown customer',
      phone: row.phone || row.normalized_phone || '',
      normalizedPhone: row.normalized_phone || normalizeCustomerPhone(row.phone),
      email: row.email || '',
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      lastTouchAt,
      status: needsReview ? 'needs_review' : hasOrders || hasCash || hasWhatsapp ? 'active' : 'new',
      products: {
        whatsapp: { available: conversaflowAvailable, active: hasWhatsapp, source: hasWhatsapp ? 'conversaflow' : 'none', conversations: Number(row.conversation_count || 0), activeConversations: Number(row.active_conversations || 0) },
        cash: { available: cashAvailable, active: hasCash, source: hasCash ? 'cash' : 'none' },
        orders: { available: kdsAvailable || conversaflowAvailable, active: hasOrders, source: hasOrders ? 'commerce' : 'none' },
        giftCards: { available: cashAvailable, active: Number(row.gift_card_count || 0) > 0, source: Number(row.gift_card_count || 0) > 0 ? 'cash' : 'none' },
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
        summary: factsCount > 0 ? `${factsCount} memory item${factsCount === 1 ? '' : 's'}` : 'No extracted facts yet',
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
    tenantId: string,
    products: Products,
    options: { page?: string; limit?: string; search?: string; filter?: string; contactId?: string } = {},
  ) {
    const page = Math.max(1, parseInt(options.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(options.limit || '20') || 20, 100));
    const search = String(options.search || '').trim().slice(0, 80);
    const filter = String(options.filter || '').trim().slice(0, 24);
    const contactId = String(options.contactId || '').trim();
    const contactUuid = isUuid(contactId) ? contactId : tenantId;

    const { rows, total } = await this.repo.listCustomers(tenantId, {
      page,
      limit,
      search,
      filter,
      contactId,
      contactUuid,
    });
    const customers = rows.map((r) => this.customerDto(r, products));
    return {
      customers,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      source: 'core.people',
    };
  }

  async detail(tenantId: string, products: Products, contactId: string) {
    if (!isUuid(contactId)) return null;
    const list = await this.list(tenantId, products, { page: '1', limit: '1', contactId });
    const customer = list.customers[0] || null;
    if (!customer) return null;
    const [timeline, conversations, orders, cash, identity] = await Promise.all([
      this.timeline(tenantId, contactId),
      this.conversations(tenantId, contactId),
      this.orders(tenantId, contactId),
      this.cash(tenantId, products, contactId),
      this.identity(tenantId, contactId),
    ]);
    return { customer, timeline, conversations, orders, cash, identity };
  }

  async timeline(tenantId: string, contactId: string) {
    const rows = await this.repo.timeline(tenantId, contactId);
    return rows.map((row) => ({ ...row, occurredAt: iso(row.occurred_at) }));
  }

  async conversations(tenantId: string, contactId: string) {
    const rows = await this.repo.conversations(tenantId, contactId);
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

  async orders(tenantId: string, contactId: string) {
    const rows = await this.repo.orders(tenantId, contactId);
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

  async cash(tenantId: string, products: Products, contactId: string) {
    const row = await this.repo.cash(tenantId, contactId);
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

  async identity(tenantId: string, contactId: string) {
    const { identities, candidates, findings } = await this.repo.identity(
      tenantId,
      contactId,
    );
    return {
      identities: identities.map((row) => ({ ...row, createdAt: iso(row.created_at) })),
      mergeCandidates: candidates.map((row) => ({ ...row, createdAt: iso(row.created_at), resolvedAt: iso(row.resolved_at) })),
      findings: findings.map((row) => ({ ...row, createdAt: iso(row.created_at), resolvedAt: iso(row.resolved_at) })),
    };
  }

  async conversationsList(tenantId: string, query: { page?: string; limit?: string }) {
    const page = Math.max(1, parseInt(query.page || '1') || 1);
    const limit = Math.max(1, Math.min(parseInt(query.limit || '20') || 20, 100));
    const skip = (page - 1) * limit;
    const { rows, total } = await this.repo.conversationsList(tenantId, limit, skip);
    return {
      conversations: rows,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async insights(tenantId: string, products: Products) {
    const payload = await this.list(tenantId, products, { page: '1', limit: '100' });
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
        totalCustomers: payload.total,
        whatsappCustomers,
        cashCustomers,
        memoryReady,
        needsReview,
        activeConversations,
      },
      insights: [
        { key: 'customer-growth', label: 'Customer base', value: payload.total, action: 'Open Customers', target: '/customers', status: payload.total > 0 ? 'ready' : 'empty' },
        { key: 'whatsapp-health', label: 'WhatsApp customers', value: whatsappCustomers, action: 'Review WhatsApp tab', target: '/customers?filter=whatsapp', status: productActive(products, 'conversaflow') ? 'ready' : 'unavailable' },
        { key: 'memory-health', label: 'Memory context ready', value: memoryReady, action: 'Review customers without memory', target: '/customers?filter=memory', status: memoryReady > 0 ? 'ready' : 'needs_attention' },
        { key: 'identity-quality', label: 'Identity review', value: needsReview, action: 'Review Data tabs', target: '/customers?filter=review', status: needsReview > 0 ? 'needs_attention' : 'ready' },
      ],
    };
  }
}
