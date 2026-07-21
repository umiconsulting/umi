import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';
import { PgService } from '../../shared/database/pg.service';

/**
 * The identity resolver — the TS replacement for the dropped core.resolve_contact
 * SECURITY DEFINER RPC (a bypass-RLS hole). It writes the federated identity graph
 * (tenant.contact ← tenant.contact_identity, tenant.contact ← tenant.customer)
 * deterministically, on the BYPASSRLS worker pool with explicit tenant_id
 * predicates (both callers — cash self-registration + WhatsApp ingress — are
 * unauthenticated), or composed into a caller's transaction via `client`.
 *
 * DETERMINISTIC-FIRST (mirrors the old RPC's ladder): normalize → look up the
 * per-channel dedup spine → reuse, else create under an advisory lock with
 * ON CONFLICT + re-select-the-winner. A NULL normalized value never mints
 * duplicates: it falls back to a synthesized deterministic external_id guarded by
 * the (tenant_id, channel_id, external_id) partial-unique.
 *
 * CROSS-CHANNEL UNIFICATION (deterministic only): phone-family channels
 * (normalization_rule='e164' → phone/whatsapp/sms) that share the same E.164
 * resolve to ONE contact. Lookups for a phone-family channel search the whole
 * family, and a canonical `phone` identity is attached to the contact — so cash
 * (phone) and WhatsApp reach the same customer. Non-phone channels dedup only
 * within their own channel (no probabilistic merge here).
 */
@Injectable()
export class IdentityResolver {
  private readonly logger = new Logger(IdentityResolver.name);

  /** key → channel row. Global catalog, process-lifetime memoized. */
  private channelCache = new Map<string, ChannelRow>();
  /** ids of the e164 phone-family channels (phone/whatsapp/sms), lazily loaded. */
  private phoneFamily: { ids: string[]; phoneId: string } | null = null;

  constructor(private readonly pg: PgService) {}

  /** The canonical global channel catalog (mirrors the 11_tenant_core seed). */
  static readonly CANONICAL_CHANNELS: ReadonlyArray<
    [key: string, namespace: string | null, rule: NormalizationRule, det: boolean, trust: number]
  > = [
    ['phone', null, 'e164', true, 0.9],
    ['whatsapp', 'meta', 'e164', true, 0.85],
    ['sms', null, 'e164', true, 0.85],
    ['email', null, 'lower', true, 0.8],
    ['instagram', 'meta', 'none', false, 0.6],
    ['messenger', 'meta', 'none', false, 0.6],
    ['pos', null, 'none', false, 0.5],
    ['web', null, 'none', false, 0.5],
    ['manual', null, 'none', false, 0.5],
  ];

  /**
   * Idempotently upsert the canonical channel catalog on the worker pool. The DDL
   * seeds it too — this is a bootstrap safety net for environments that manage
   * reference data from the app. Clears the memo so a re-seed is observed.
   */
  async seedChannels(): Promise<void> {
    for (const [key, ns, rule, det, trust] of IdentityResolver.CANONICAL_CHANNELS) {
      await this.pg.query(
        `INSERT INTO tenant.channel (key, namespace, normalization_rule, deterministic_matchable, default_trust)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO NOTHING`,
        [key, ns, rule, det, trust],
      );
    }
    this.channelCache.clear();
    this.phoneFamily = null;
  }

  /** Resolve (and memoize) a channel row by key. Throws on an unknown channel. */
  async resolveChannel(channelKey: string, client?: PoolClient): Promise<ChannelRow> {
    const cached = this.channelCache.get(channelKey);
    if (cached) return cached;
    const { rows } = await this.run<ChannelRow>(
      client ?? null,
      `SELECT id::text AS id, key,
              normalization_rule AS "normalizationRule",
              deterministic_matchable AS "deterministicMatchable"
       FROM tenant.channel WHERE key = $1 LIMIT 1`,
      [channelKey],
    );
    const row = rows[0];
    if (!row) {
      throw new Error(
        `identity: unknown channel '${channelKey}' — is tenant.channel seeded?`,
      );
    }
    this.channelCache.set(channelKey, row);
    return row;
  }

  /**
   * The single resolve-or-create entry point. Returns the stable contact +
   * customer ids for the given (channel, value). Composable: pass `client` to run
   * inside the caller's transaction (e.g. cash register composing card creation);
   * otherwise runs in its own worker transaction.
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

    // A NULL normalized value would escape the dedup unique (NULLS DISTINCT), so
    // synthesize a stable external_id and rely on the external_id partial-unique.
    const externalKey =
      input.externalId ??
      (normalized == null ? this.deriveExternalKey(input) : null);

    // Phone-family lookups search the whole family (phone/whatsapp/sms) so a
    // shared E.164 unifies; other channels dedup within themselves.
    const lookupChannelIds = isPhoneFamily
      ? (await this.getPhoneFamily(c)).ids
      : [channel.id];

    let contactId = await this.findContact(
      c,
      tenantId,
      lookupChannelIds,
      normalized,
      channel.id,
      externalKey,
    );
    let created = false;

    if (!contactId) {
      // Serialize concurrent first-sightings of the same identity.
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [
        `${tenantId}:${normalized ?? `${channel.id}:${externalKey}`}`,
      ]);
      contactId = await this.findContact(
        c,
        tenantId,
        lookupChannelIds,
        normalized,
        channel.id,
        externalKey,
      );
      if (!contactId) {
        contactId = await this.createContact(c, tenantId);
        created = true;
      }
    }

    // Ensure THIS channel's reachability row exists on the contact (idempotent).
    await this.ensureIdentity(c, {
      tenantId,
      contactId,
      channelId: channel.id,
      normalized,
      externalId: externalKey,
      displayValue: input.rawValue,
      collectedVia: input.collectedVia ?? channelKey,
      verified: input.verified ?? false,
    });

    // Deterministic cross-channel unification: attach the canonical `phone`
    // identity so cash(phone) and whatsapp/sms share this contact.
    if (isPhoneFamily && channelKey !== 'phone' && normalized) {
      const { phoneId } = await this.getPhoneFamily(c);
      await this.ensureIdentity(c, {
        tenantId,
        contactId,
        channelId: phoneId,
        normalized,
        externalId: null,
        displayValue: input.rawValue,
        collectedVia: `unified:${channelKey}`,
        verified: false,
      });
    }

    const customerId = await this.ensureCustomer(c, tenantId, contactId, {
      name: input.displayName ?? null,
    });
    return { contactId, customerId, created };
  }

  /**
   * Lookup-ONLY (no create) over the deterministic spine. Used by public read
   * paths (cash-register.findExisting, cash-write.findPersonCard). Phone-family
   * values match across the family.
   */
  async lookupIdentity(input: LookupInput): Promise<LookupResult | null> {
    const channel = await this.resolveChannel(input.channelKey);
    const normalized =
      input.normalizedValue ??
      (input.rawValue != null
        ? await this.normalize(null, input.channelKey, input.rawValue)
        : null);
    const isPhoneFamily = channel.normalizationRule === 'e164' && normalized != null;
    const lookupChannelIds = isPhoneFamily
      ? (await this.getPhoneFamily(null)).ids
      : [channel.id];

    const contactId = await this.findContact(
      null,
      input.tenantId,
      lookupChannelIds,
      normalized,
      channel.id,
      input.externalId ?? null,
    );
    if (!contactId) return null;
    const { rows } = await this.run<{ customerId: string | null }>(
      null,
      `SELECT id::text AS "customerId" FROM tenant.customer
       WHERE tenant_id = $1::uuid AND contact_id = $2::uuid LIMIT 1`,
      [input.tenantId, contactId],
    );
    return { contactId, customerId: rows[0]?.customerId ?? null };
  }

  /** INSERT-or-reuse the one customer per contact. */
  async ensureCustomer(
    c: PoolClient | null,
    tenantId: string,
    contactId: string,
    patch?: { name?: string | null; bornAt?: string | null },
  ): Promise<string> {
    // COALESCE so an incoming null never clobbers an existing name/born_at.
    const { rows } = await this.run<{ id: string }>(
      c,
      `INSERT INTO tenant.customer (tenant_id, contact_id, name, born_at)
         VALUES ($1::uuid, $2::uuid, nullif($3, ''), $4::date)
       ON CONFLICT (tenant_id, contact_id) DO UPDATE
         SET name = COALESCE(tenant.customer.name, EXCLUDED.name),
             born_at = COALESCE(tenant.customer.born_at, EXCLUDED.born_at),
             updated_at = now()
       RETURNING id::text AS id`,
      [tenantId, contactId, patch?.name ?? null, patch?.bornAt ?? null],
    );
    return rows[0].id;
  }

  /** Replaces cash-register.updatePerson: profile only, never reachability. */
  async updateCustomerProfile(
    tenantId: string,
    customerId: string,
    patch: { name?: string | null; bornAt?: string | null },
    client?: PoolClient,
  ): Promise<void> {
    await this.run(
      client ?? null,
      `UPDATE tenant.customer
         SET name = COALESCE($3, name),
             born_at = COALESCE($4::date, born_at),
             updated_at = now()
       WHERE tenant_id = $1::uuid AND id = $2::uuid`,
      [tenantId, customerId, patch.name ?? null, patch.bornAt ?? null],
    );
  }

  /**
   * The customer's name + the channel reply address (WhatsApp's as-received
   * +521… display_value that Twilio must reply to — avoids error 63015).
   * Replaces identity.getPerson/getPersonName.
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
              ci.normalized_value AS "canonicalValue",
              ci.display_value    AS "replyAddress"
       FROM tenant.customer cu
       LEFT JOIN LATERAL (
         SELECT i.normalized_value, i.display_value
         FROM tenant.contact_identity i
         JOIN tenant.channel ch ON ch.id = i.channel_id
         WHERE i.tenant_id = cu.tenant_id
           AND i.contact_id = cu.contact_id
           AND ch.key = $3
         ORDER BY i.is_primary DESC, i.last_seen_at DESC
         LIMIT 1
       ) ci ON true
       WHERE cu.tenant_id = $1::uuid AND cu.id = $2::uuid
       LIMIT 1`,
      [tenantId, customerId, channelKey],
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

  /** DB-side normalize (immutable, identical to any backfill). */
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

  /** ids of the e164 phone-family channels + the canonical `phone` id. */
  private async getPhoneFamily(
    c: PoolClient | null,
  ): Promise<{ ids: string[]; phoneId: string }> {
    if (this.phoneFamily) return this.phoneFamily;
    const { rows } = await this.run<{ id: string; key: string }>(
      c,
      `SELECT id::text AS id, key FROM tenant.channel WHERE normalization_rule = 'e164'`,
      [],
    );
    const phone = rows.find((r) => r.key === 'phone');
    if (!phone) {
      throw new Error('identity: canonical `phone` channel missing from catalog');
    }
    this.phoneFamily = { ids: rows.map((r) => r.id), phoneId: phone.id };
    return this.phoneFamily;
  }

  /**
   * A stable external_id for identities with no normalized value, so they can't
   * escape the dedup unique via NULLS DISTINCT. Phone-like → last-10 digits;
   * otherwise a source-tagged key (falls back to a random uuid only when there is
   * genuinely nothing deterministic to key on).
   */
  private deriveExternalKey(input: ResolveInput): string {
    const digits = (input.rawValue ?? '').replace(/\D/g, '');
    if (digits.length >= 10) return `last10:${digits.slice(-10)}`;
    const src = input.collectedVia ?? input.channelKey ?? 'unknown';
    return `src:${src}:${input.externalId ?? input.rawValue ?? randomUUID()}`;
  }

  /** Find a contact by normalized value (across channelIds) then by external_id. */
  private async findContact(
    c: PoolClient | null,
    tenantId: string,
    channelIds: string[],
    normalized: string | null,
    externalChannelId: string,
    externalId: string | null,
  ): Promise<string | null> {
    if (normalized != null) {
      const { rows } = await this.run<{ contactId: string }>(
        c,
        `SELECT contact_id::text AS "contactId"
         FROM tenant.contact_identity
         WHERE tenant_id = $1::uuid
           AND channel_id = ANY($2::uuid[])
           AND normalized_value = $3
         ORDER BY is_primary DESC, last_seen_at DESC
         LIMIT 1`,
        [tenantId, channelIds, normalized],
      );
      if (rows[0]) return rows[0].contactId;
    }
    if (externalId != null) {
      const { rows } = await this.run<{ contactId: string }>(
        c,
        `SELECT contact_id::text AS "contactId"
         FROM tenant.contact_identity
         WHERE tenant_id = $1::uuid
           AND channel_id = $2::uuid
           AND external_id = $3
         LIMIT 1`,
        [tenantId, externalChannelId, externalId],
      );
      if (rows[0]) return rows[0].contactId;
    }
    return null;
  }

  private async createContact(
    c: PoolClient,
    tenantId: string,
  ): Promise<string> {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO tenant.contact (tenant_id) VALUES ($1::uuid) RETURNING id::text AS id`,
      [tenantId],
    );
    return rows[0].id;
  }

  /**
   * Idempotent reachability upsert. Value-keyed rows conflict on
   * (tenant_id, channel_id, normalized_value); external-only rows conflict on the
   * (tenant_id, channel_id, external_id) partial-unique. is_primary is set only
   * when the contact has no primary for this channel yet.
   */
  private async ensureIdentity(
    c: PoolClient,
    i: {
      tenantId: string;
      contactId: string;
      channelId: string;
      normalized: string | null;
      externalId: string | null;
      displayValue: string | null;
      collectedVia: string | null;
      verified: boolean;
    },
  ): Promise<void> {
    // First primary for (contact, channel)? Keeps the partial-unique satisfied.
    const { rows: existing } = await c.query<{ n: string }>(
      `SELECT 1 AS n FROM tenant.contact_identity
       WHERE tenant_id = $1::uuid AND contact_id = $2::uuid AND channel_id = $3::uuid
         AND is_primary LIMIT 1`,
      [i.tenantId, i.contactId, i.channelId],
    );
    const isPrimary = existing.length === 0;
    const conflictTarget =
      i.normalized != null
        ? '(tenant_id, channel_id, normalized_value)'
        : '(tenant_id, channel_id, external_id) WHERE external_id IS NOT NULL';

    await c.query(
      `INSERT INTO tenant.contact_identity
         (tenant_id, contact_id, channel_id, normalized_value, external_id,
          display_value, collected_via, match_type, is_primary, verified_at, last_seen_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, 'deterministic', $8,
               CASE WHEN $9 THEN now() ELSE NULL END, now())
       ON CONFLICT ${conflictTarget} DO UPDATE
         SET last_seen_at = now(),
             verified_at = COALESCE(tenant.contact_identity.verified_at,
                                    EXCLUDED.verified_at),
             display_value = COALESCE(tenant.contact_identity.display_value,
                                      EXCLUDED.display_value)`,
      [
        i.tenantId,
        i.contactId,
        i.channelId,
        i.normalized,
        i.externalId,
        i.displayValue,
        i.collectedVia,
        isPrimary,
        i.verified,
      ],
    );
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
  deterministicMatchable: boolean;
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
  customerId: string | null;
}

export interface ReplyContext {
  name: string | null;
  canonicalValue: string | null;
  replyAddress: string | null;
}
