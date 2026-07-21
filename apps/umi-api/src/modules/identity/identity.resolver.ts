import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { PgService } from '../../shared/database/pg.service';

/**
 * The identity resolver — the TS replacement for the dropped core.resolve_contact
 * SECURITY DEFINER RPC (a bypass-RLS hole). It resolves-or-creates a customer for a
 * (channel, value) deterministically on the BYPASSRLS worker pool with explicit
 * business_id predicates (both callers — cash self-registration + WhatsApp ingress —
 * are unauthenticated), or composed into a caller's transaction via `client`.
 *
 * FLAT identity model (build-v3, owner decision 2026-07-09, see
 * docs/architecture/2026-07-09-enterprise-conceptual-review.md): the central concept
 * is the **Customer** — "a person the café knows, identified by their Mexican mobile
 * phone," reachable through one or more channels. `tenant.contact` is one reachability
 * row per channel (channel_id + raw + normalized) pointing straight at the customer
 * (`contact.customer_id`). There is NO probabilistic-resolution engine (`contact_identity`
 * + `channel` catalog + confidence/match_type were proven inert and dropped): phone is
 * an UNVERIFIED soft key, dedup is soft via `customer.merged_into_id`.
 *
 * DETERMINISTIC-FIRST: normalize → look up the phone-family reachability spine → reuse
 * the customer, else create one under an advisory lock (re-check inside). A NULL
 * normalized value never unifies (it just gets its own reachability row). Cross-channel
 * unification is natural: phone/whatsapp/sms all normalize to the same E.164, so a match
 * on `(business_id, normalized_value)` across the phone family reaches one customer.
 */
@Injectable()
export class IdentityResolver {
  private readonly logger = new Logger(IdentityResolver.name);

  /** key → channel row (id + code-side normalization rule). Process-lifetime memoized. */
  private channelCache = new Map<string, ChannelRow>();
  /** ids of the e164 phone-family channels (phone/whatsapp/sms), lazily loaded. */
  private phoneFamily: { ids: string[] } | null = null;

  constructor(private readonly pg: PgService) {}

  /**
   * The canonical global channel catalog. Normalization rules live HERE (code-side):
   * the flat model keeps no normalization_rule column on umi.channel_type.
   */
  static readonly CANONICAL_CHANNELS: ReadonlyArray<
    [key: string, rule: NormalizationRule]
  > = [
    ['phone', 'e164'],
    ['whatsapp', 'e164'],
    ['sms', 'e164'],
    ['email', 'lower'],
    ['instagram', 'none'],
    ['messenger', 'none'],
    ['pos', 'none'],
    ['web', 'none'],
    ['manual', 'none'],
  ];

  private static readonly RULE_BY_KEY: ReadonlyMap<string, NormalizationRule> =
    new Map(IdentityResolver.CANONICAL_CHANNELS);

  private static readonly PHONE_FAMILY_KEYS: readonly string[] =
    IdentityResolver.CANONICAL_CHANNELS.filter(([, r]) => r === 'e164').map(([k]) => k);

  /**
   * Idempotently ensure the channel catalog exists on the worker pool. The DDL seeds
   * umi.channel_type — this is a bootstrap safety net for environments that manage
   * reference data from the app. Clears the memo so a re-seed is observed.
   */
  async seedChannels(): Promise<void> {
    for (const [key] of IdentityResolver.CANONICAL_CHANNELS) {
      await this.pg.query(
        `INSERT INTO umi.channel_type (key, name)
         VALUES ($1, initcap($1))
         ON CONFLICT (key) DO NOTHING`,
        [key],
      );
    }
    this.channelCache.clear();
    this.phoneFamily = null;
  }

  /** Resolve (and memoize) a channel by key: its umi.channel_type id + code-side rule. */
  async resolveChannel(channelKey: string, client?: PoolClient): Promise<ChannelRow> {
    const cached = this.channelCache.get(channelKey);
    if (cached) return cached;
    const { rows } = await this.run<{ id: string; key: string }>(
      client ?? null,
      `SELECT id::text AS id, key FROM umi.channel_type WHERE key = $1 LIMIT 1`,
      [channelKey],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(
        `identity: unknown channel '${channelKey}' — is umi.channel_type seeded?`,
      );
    }
    const channel: ChannelRow = {
      id: row.id,
      key: row.key,
      normalizationRule: IdentityResolver.RULE_BY_KEY.get(channelKey) ?? 'none',
    };
    this.channelCache.set(channelKey, channel);
    return channel;
  }

  /**
   * The single resolve-or-create entry point. Returns the stable contact + customer
   * ids for the given (channel, value). Composable: pass `client` to run inside the
   * caller's transaction (e.g. cash register composing card creation); otherwise runs
   * in its own worker transaction.
   */
  async resolveIdentity(input: ResolveInput): Promise<ResolvedIdentity> {
    if (input.client) return this.resolveWithin(input.client, input);
    return this.pg.workerTx((c) => this.resolveWithin(c, input));
  }

  private async resolveWithin(
    c: PoolClient,
    input: ResolveInput,
  ): Promise<ResolvedIdentity> {
    const { tenantId, channelKey } = input;
    const channel = await this.resolveChannel(channelKey, c);
    const normalized = await this.normalize(c, channelKey, input.rawValue);
    const isPhoneFamily = channel.normalizationRule === 'e164' && normalized != null;

    // Phone-family lookups search the whole family (phone/whatsapp/sms) so a shared
    // E.164 unifies; other channels dedup within themselves. A NULL normalized value
    // cannot unify — it always mints a fresh reachability row (soft-key model).
    const lookupChannelIds = isPhoneFamily
      ? await this.getPhoneFamily(c)
      : [channel.id];

    // Serialize the WHOLE resolve under one advisory lock keyed on the identity:
    // createCustomer AND ensureContact both do find-then-write, and tenant.contact
    // has no unique (soft-key model), so a concurrent resolve for the same identity
    // could otherwise mint a duplicate customer OR a duplicate reachability row.
    // Different identities hash to different keys, so unrelated resolves never contend.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
      `${tenantId}:${normalized ?? `${channel.id}:new`}`,
    ]);
    let found =
      normalized == null
        ? null
        : await this.findCustomer(c, tenantId, lookupChannelIds, normalized);
    // O-3 / L15: before minting a person, fall back to an EXACT raw match. A raw value
    // we cannot normalize (Mayela's `+52` + only eight national digits) normalizes to
    // NULL honestly — but without this fallback it would mint a FRESH customer on every
    // registration attempt, orphaning her card, her stamp and her wallet pass.
    if (found == null) {
      found = await this.findCustomerByRaw(c, tenantId, lookupChannelIds, input.rawValue);
    }
    const customerId =
      found ?? (await this.createCustomer(c, tenantId, input.displayName ?? null));
    const created = found == null;

    // Ensure THIS channel's reachability row exists on the customer (idempotent). For
    // WhatsApp this stores the as-received +521… reply address (see getReplyContext).
    const contactId = await this.ensureContact(c, {
      tenantId,
      customerId,
      channelId: channel.id,
      isPhoneFamily: channel.normalizationRule === 'e164',
      rawValue: input.rawValue,
      normalized,
      verified: input.verified ?? false,
      channelKey,
    });

    return { contactId, customerId, created };
  }

  /**
   * Lookup-ONLY (no create) over the reachability spine. Phone-family values match
   * across the family. Returns the surviving customer (follows merged_into_id).
   */
  async lookupIdentity(input: LookupInput): Promise<LookupResult | null> {
    const channel = await this.resolveChannel(input.channelKey);
    const normalized =
      input.normalizedValue ??
      (input.rawValue != null
        ? await this.normalize(null, input.channelKey, input.rawValue)
        : null);
    if (normalized == null) return null;
    const isPhoneFamily = channel.normalizationRule === 'e164';
    const lookupChannelIds = isPhoneFamily
      ? await this.getPhoneFamily(null)
      : [channel.id];

    const { rows } = await this.run<{ contactId: string; customerId: string }>(
      null,
      `SELECT c.id::text        AS "contactId",
              coalesce(m.id, cu.id)::text AS "customerId"
         FROM tenant.contact c
         JOIN tenant.customer cu ON cu.id = c.customer_id
         LEFT JOIN tenant.customer m ON m.id = cu.merged_into_id
        WHERE c.business_id = $1::uuid
          AND c.channel_id = ANY($2::uuid[])
          AND c.normalized_value = $3
        ORDER BY c.is_primary DESC, c.updated_at DESC
        LIMIT 1`,
      [input.tenantId, lookupChannelIds, normalized],
    );
    const r = rows[0];
    return r ? { contactId: r.contactId, customerId: r.customerId } : null;
  }

  /**
   * The customer's name + the channel reply address (WhatsApp's as-received +521…
   * raw_phone_number that Twilio must reply to — avoids error 63015). `canonicalValue`
   * is the E.164 anchor. Replaces identity.getPerson/getPersonName.
   */
  async getReplyContext(
    tenantId: string,
    customerId: string,
    channelKey = 'whatsapp',
  ): Promise<ReplyContext | null> {
    const { rows } = await this.run<{
      name: string | null;
      canonicalValue: string | null;
      replyAddress: string | null;
    }>(
      null,
      `SELECT cu.name,
              anchor.normalized_value AS "canonicalValue",
              coalesce(reply.raw_phone_number, anchor.normalized_value) AS "replyAddress"
       FROM tenant.customer cu
       LEFT JOIN LATERAL (
         SELECT co.normalized_value
         FROM tenant.contact co
         JOIN umi.channel_type ch ON ch.id = co.channel_id
         WHERE co.business_id = cu.business_id
           AND co.customer_id = cu.id
           AND ch.key = ANY($3::text[])
           AND co.normalized_value IS NOT NULL
         ORDER BY co.is_primary DESC, co.updated_at DESC
         LIMIT 1
       ) anchor ON true
       LEFT JOIN LATERAL (
         SELECT co.raw_phone_number
         FROM tenant.contact co
         JOIN umi.channel_type ch ON ch.id = co.channel_id
         WHERE co.business_id = cu.business_id
           AND co.customer_id = cu.id
           AND ch.key = $4
         ORDER BY co.is_primary DESC, co.updated_at DESC
         LIMIT 1
       ) reply ON true
       WHERE cu.business_id = $1::uuid AND cu.id = $2::uuid
       LIMIT 1`,
      [tenantId, customerId, IdentityResolver.PHONE_FAMILY_KEYS, channelKey],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      name: r.name,
      canonicalValue: r.canonicalValue,
      replyAddress: r.replyAddress ?? r.canonicalValue,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** DB-side normalize (immutable, identical to the backfill's core.normalize_phone). */
  private async normalize(
    c: PoolClient | null,
    channelKey: string,
    rawValue: string | null | undefined,
  ): Promise<string | null> {
    const { rows } = await this.run<{ n: string | null }>(
      c,
      `SELECT tenant.normalize_identity($1, $2) AS n`,
      [channelKey, rawValue ?? null],
    );
    return rows[0]?.n ?? null;
  }

  /** ids of the e164 phone-family channels (phone/whatsapp/sms). */
  private async getPhoneFamily(c: PoolClient | null): Promise<string[]> {
    if (this.phoneFamily) return this.phoneFamily.ids;
    const { rows } = await this.run<{ id: string }>(
      c,
      `SELECT id::text AS id FROM umi.channel_type WHERE key = ANY($1::text[])`,
      [IdentityResolver.PHONE_FAMILY_KEYS],
    );
    if (rows.length === 0) {
      throw new Error('identity: phone-family channels missing from umi.channel_type');
    }
    this.phoneFamily = { ids: rows.map((r) => r.id) };
    return this.phoneFamily.ids;
  }

  /**
   * Find the surviving customer reachable at `normalized` across `channelIds`.
   * Follows customer.merged_into_id so a soft-merged duplicate resolves to its target.
   */
  private async findCustomer(
    c: PoolClient | null,
    tenantId: string,
    channelIds: string[],
    normalized: string,
  ): Promise<string | null> {
    const { rows } = await this.run<{ customerId: string }>(
      c,
      `SELECT coalesce(m.id, cu.id)::text AS "customerId"
         FROM tenant.contact ct
         JOIN tenant.customer cu ON cu.id = ct.customer_id
         LEFT JOIN tenant.customer m ON m.id = cu.merged_into_id
        WHERE ct.business_id = $1::uuid
          AND ct.channel_id = ANY($2::uuid[])
          AND ct.normalized_value = $3
        ORDER BY ct.is_primary DESC, ct.updated_at DESC
        LIMIT 1`,
      [tenantId, channelIds, normalized],
    );
    return rows[0]?.customerId ?? null;
  }

  /**
   * O-3 fallback: find the customer by an EXACT raw value, for raws that cannot be
   * normalized (so `normalized_value` is NULL and the deterministic spine can't match).
   * Without this, every registration attempt with such a number mints a new person.
   */
  private async findCustomerByRaw(
    c: PoolClient | null,
    tenantId: string,
    channelIds: string[],
    rawValue: string | null,
  ): Promise<string | null> {
    const raw = (rawValue ?? '').trim();
    if (raw === '') return null;
    const { rows } = await this.run<{ customerId: string }>(
      c,
      `SELECT coalesce(m.id, cu.id)::text AS "customerId"
         FROM tenant.contact ct
         JOIN tenant.customer cu ON cu.id = ct.customer_id
         LEFT JOIN tenant.customer m ON m.id = cu.merged_into_id
        WHERE ct.business_id = $1::uuid
          AND ct.channel_id = ANY($2::uuid[])
          AND (ct.raw_phone_number = $3 OR ct.raw_value = $3)
        ORDER BY ct.is_primary DESC, ct.updated_at DESC
        LIMIT 1`,
      [tenantId, channelIds, raw],
    );
    return rows[0]?.customerId ?? null;
  }

  private async createCustomer(
    c: PoolClient,
    tenantId: string,
    name: string | null,
  ): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO tenant.customer (business_id, name)
         VALUES ($1::uuid, nullif($2, ''))
       RETURNING id::text AS id`,
      [tenantId, name],
    );
    return rows[0].id;
  }

  /**
   * Idempotent per-channel reachability upsert. One reachability row per
   * (customer, channel, normalized_value): reuse it if present (refresh updated_at +
   * upgrade verification), else insert. First row for (customer, channel) is primary.
   * Phone-family stores the raw as-received number in raw_phone_number; other channels
   * store it in raw_value. No unique constraint exists (phone is a soft key), so the
   * caller must hold the advisory lock when a create is possible.
   */
  private async ensureContact(
    c: PoolClient,
    i: {
      tenantId: string;
      customerId: string;
      channelId: string;
      isPhoneFamily: boolean;
      rawValue: string | null;
      normalized: string | null;
      verified: boolean;
      channelKey: string;
    },
  ): Promise<string> {
    const { rows: existing } = await c.query<{ id: string }>(
      `SELECT id::text AS id FROM tenant.contact
        WHERE business_id = $1::uuid AND customer_id = $2::uuid AND channel_id = $3::uuid
          AND normalized_value IS NOT DISTINCT FROM $4
        LIMIT 1`,
      [i.tenantId, i.customerId, i.channelId, i.normalized],
    );
    const verifiedVia = i.verified && i.channelKey === 'whatsapp'
      ? 'whatsapp_inbound'
      : 'self_asserted';
    if (existing[0]) {
      // Refresh; only ever upgrade verified false→true (whatsapp_inbound proves it).
      await c.query(
        `UPDATE tenant.contact
            SET updated_at = now(),
                verified = tenant.contact.verified OR $2,
                verified_via = CASE WHEN $2 AND NOT tenant.contact.verified
                                    THEN $3 ELSE tenant.contact.verified_via END
          WHERE id = $1::uuid`,
        [existing[0].id, i.verified, verifiedVia],
      );
      return existing[0].id;
    }

    const { rows: primaryExists } = await c.query<{ n: number }>(
      `SELECT 1 AS n FROM tenant.contact
        WHERE business_id = $1::uuid AND customer_id = $2::uuid AND channel_id = $3::uuid
          AND is_primary LIMIT 1`,
      [i.tenantId, i.customerId, i.channelId],
    );
    const isPrimary = primaryExists.length === 0;

    // normalized_value is NOT supplied: tenant.tg_contact_normalize derives it from the
    // raw value (BACKFILL_METHODOLOGY L15). The app writing its own normalization here is
    // exactly what kept the corruption self-consistent; `api` is also REVOKEd on the column.
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO tenant.contact
         (business_id, customer_id, channel_id, raw_phone_number, raw_value,
          is_primary, verified, verified_via)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)
       RETURNING id::text AS id`,
      [
        i.tenantId,
        i.customerId,
        i.channelId,
        i.isPhoneFamily ? i.rawValue : null,
        i.isPhoneFamily ? null : i.rawValue,
        isPrimary,
        i.verified,
        i.verified ? verifiedVia : 'self_asserted',
      ],
    );
    return rows[0].id;
  }

  /** Run on the given client, else the worker pool. */
  private run<T extends QueryResultRow>(
    c: PoolClient | null,
    text: string,
    params: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    return c
      ? (c.query<T>(text, params as unknown[]) as Promise<{
          rows: T[];
          rowCount: number | null;
        }>)
      : this.pg.query<T>(text, params);
  }
}

// ── types ──────────────────────────────────────────────────────────────────
type NormalizationRule = 'e164' | 'lower' | 'none';

interface ChannelRow {
  id: string;
  key: string;
  normalizationRule: NormalizationRule;
}

export interface ResolveInput {
  tenantId: string;
  channelKey: string;
  rawValue: string;
  externalId?: string | null;
  displayName?: string | null;
  collectedVia?: string | null;
  verified?: boolean;
  /** Compose into the caller's transaction instead of a fresh worker txn. */
  client?: PoolClient;
}

export interface ResolvedIdentity {
  contactId: string;
  customerId: string;
  created: boolean;
}

export interface LookupInput {
  tenantId: string;
  channelKey: string;
  rawValue?: string;
  normalizedValue?: string;
  externalId?: string | null;
}

export interface LookupResult {
  contactId: string;
  customerId: string;
}

export interface ReplyContext {
  name: string | null;
  canonicalValue: string | null;
  replyAddress: string | null;
}
