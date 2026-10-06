import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PgService } from '../../shared/database/pg.service';
import { LOYALTY_CARD_STATE_SQL, type LoyaltyCardState } from '../../shared/loyalty/card-state.sql';
import { weekdayInZone } from '../../shared/format/weekday';

/**
 * All wallet-pass SQL.
 *
 * WHY THE WORKER POOL. Apple's web service authenticates a request with
 * `(serialNumber, authenticationToken)` and nothing else. It carries no session,
 * no user and no merchant — Apple knows none of them — so there is no RLS context
 * to run under and `withMerchant` would throw. This is the same shape as the KDS
 * iPad path and the auth substrate: the worker pool, plus an explicit
 * `merchant_id = $1` predicate on every merchant-scoped statement.
 *
 * Two further reasons the app pool cannot serve this path:
 *   1. `runtime.pass_device` is in the sealed `runtime` schema.
 *   2. `merchant.loyalty_wallet_pass.web_service_token` is column-locked away
 *      from the `api` role in `90_rls.sql:190`, and this path must read it.
 *
 * Isolation comes from the token itself. A caller who cannot present the token
 * that was signed into the pass sees nothing.
 */
@Injectable()
export class WalletPassRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Resolve a merchant from the handle in the frozen pass URL.
   *
   * `handle` is permanent. It is a path segment of the `webServiceURL` inside
   * every issued pass. Do not give the same handle to a different merchant.
   * See `20_merchant.sql:33`.
   */
  async merchantByHandle(handle: string): Promise<{ id: string; name: string } | null> {
    const { rows } = await this.pg.query<{ id: string; name: string }>(
      `SELECT id::text, name FROM merchant.merchant WHERE handle = $1 LIMIT 1`,
      [handle],
    );
    return rows[0] ?? null;
  }

  /**
   * The café's secondary colour, by handle — the stamp-strip background.
   *
   * Its own query because the image route has no card and no customer, and must
   * stay servable when the rest of the pass data is not.
   */
  async secondaryColourForHandle(handle: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ secondary_color: string | null }>(
      `SELECT p.secondary_color
       FROM merchant.merchant AS m
       JOIN merchant.loyalty_program AS p ON p.merchant_id = m.id
       WHERE m.handle = $1
       LIMIT 1`,
      [handle],
    );
    return rows[0]?.secondary_color ?? null;
  }

  /** Which café a card belongs to. Used where only the card id is in hand. */
  async merchantForCard(cardId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ merchant_id: string }>(
      `SELECT merchant_id::text FROM merchant.loyalty_card WHERE id = $1::uuid`,
      [cardId],
    );
    return rows[0]?.merchant_id ?? null;
  }

  /** The loyalty card a signed-in customer holds at this café, if any. */
  async cardForCustomer(merchantId: string, customerId: string): Promise<string | null> {
    const { rows } = await this.pg.query<{ id: string }>(
      `SELECT id::text FROM merchant.loyalty_card
       WHERE merchant_id = $1::uuid AND customer_id = $2::uuid AND status = 'active'
       ORDER BY issued_at ASC
       LIMIT 1`,
      [merchantId, customerId],
    );
    return rows[0]?.id ?? null;
  }

  /**
   * The Apple pass row for a card: the existing one, or a new one.
   *
   * NEVER REGENERATE. A card that already has a pass keeps its serial and its
   * token, because a customer may already hold that pass — issuing new values
   * would orphan the copy on their phone, which would then authenticate against
   * nothing. The insert is therefore an upsert whose conflict branch changes no
   * column and simply returns what is already stored.
   *
   * `DO NOTHING` cannot be used here: it returns no row on conflict, and the
   * caller could not tell "already exists" from "insert failed".
   */
  async findOrCreateApplePass(
    cardId: string,
    serial: string,
    token: string,
  ): Promise<{ walletPassId: string; serialNumber: string; webServiceToken: string }> {
    const { rows } = await this.pg.query<{
      id: string;
      external_object_id: string;
      web_service_token: string;
    }>(
      `INSERT INTO merchant.loyalty_wallet_pass
         (card_id, platform, external_object_id, web_service_token)
       VALUES ($1::uuid, 'apple', $2, $3)
       ON CONFLICT (card_id, platform) DO UPDATE
         SET updated_at = merchant.loyalty_wallet_pass.updated_at
       RETURNING id::text, external_object_id, web_service_token`,
      [cardId, serial, token],
    );
    const row = rows[0];
    return {
      walletPassId: row.id,
      serialNumber: row.external_object_id,
      webServiceToken: row.web_service_token,
    };
  }

  /**
   * Apple's authentication, in full.
   *
   * The token is fetched by serial and then compared in constant time, rather
   * than matched inside the WHERE clause. A SQL `=` on text short-circuits at the
   * first differing byte, which leaks the token one byte at a time to anyone who
   * can measure response time. The token is a bearer secret for a customer's pass
   * and it can never be rotated, because the copy in their Wallet is immutable —
   * so it is worth comparing properly.
   */
  async authenticate(serial: string, token: string): Promise<AuthenticatedPass | null> {
    const { rows } = await this.pg.query<AuthenticatedPassRow>(
      `SELECT wp.id::text            AS wallet_pass_id,
              wp.web_service_token   AS web_service_token,
              wp.external_object_id  AS serial_number,
              c.id::text             AS card_id,
              c.merchant_id::text    AS merchant_id,
              c.updated_at           AS card_updated_at
       FROM merchant.loyalty_wallet_pass AS wp
       JOIN merchant.loyalty_card AS c ON c.id = wp.card_id
       WHERE wp.platform = 'apple' AND wp.external_object_id = $1 AND wp.status = 'active'
       LIMIT 1`,
      [serial],
    );
    const row = rows[0];
    if (!row?.web_service_token) return null;
    if (!constantTimeEquals(row.web_service_token, token)) return null;
    return {
      walletPassId: row.wallet_pass_id,
      cardId: row.card_id,
      merchantId: row.merchant_id,
      serialNumber: row.serial_number,
      // Carried so the rebuilt pass can be signed with the SAME token. A render
      // that invented a new one would hand the phone a pass whose next callback
      // is a 401 — every pass would go silent one update after deploy.
      webServiceToken: row.web_service_token,
      cardUpdatedAt: row.card_updated_at,
    };
  }

  /**
   * Record a device against a pass. Returns `true` when the registration is new,
   * because Apple distinguishes 201 (created) from 200 (already registered).
   */
  async registerDevice(
    walletPassId: string,
    deviceIdentifier: string,
    pushToken: string,
  ): Promise<boolean> {
    const { rows } = await this.pg.query<{ inserted: boolean }>(
      `INSERT INTO runtime.pass_device (wallet_pass_id, device_identifier, push_token)
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT (wallet_pass_id, device_identifier)
         DO UPDATE SET push_token = EXCLUDED.push_token
       RETURNING (xmax = 0) AS inserted`,
      [walletPassId, deviceIdentifier, pushToken],
    );
    return rows[0]?.inserted ?? false;
  }

  /**
   * The APNs device tokens registered against one card's Apple pass.
   *
   * A card with no rows is the ordinary case for a customer who saved the pass to
   * Google Wallet, or who never added it at all. It is not an error.
   */
  async pushTokensForCard(cardId: string): Promise<string[]> {
    const { rows } = await this.pg.query<{ push_token: string }>(
      `SELECT d.push_token
       FROM runtime.pass_device AS d
       JOIN merchant.loyalty_wallet_pass AS wp ON wp.id = d.wallet_pass_id
       WHERE wp.card_id = $1::uuid
         AND wp.platform = 'apple'
         AND wp.status = 'active'
         AND d.push_token IS NOT NULL`,
      [cardId],
    );
    return rows.map((r) => r.push_token);
  }

  /** Every card at one café that has an issued Apple pass. */
  async cardsWithApplePass(merchantId: string): Promise<string[]> {
    const { rows } = await this.pg.query<{ card_id: string }>(
      `SELECT wp.card_id::text
       FROM merchant.loyalty_wallet_pass AS wp
       JOIN merchant.loyalty_card AS c ON c.id = wp.card_id
       WHERE c.merchant_id = $1::uuid
         AND wp.platform = 'apple'
         AND wp.status = 'active'
         AND wp.external_object_id IS NOT NULL`,
      [merchantId],
    );
    return rows.map((r) => r.card_id);
  }

  /**
   * Mark cards as changed so Apple's next poll reports them.
   *
   * `loyalty_card.updated_at` is the change signal the web service compares
   * against `passesUpdatedSince`. A push with no touched timestamp wakes the phone
   * and then tells it nothing changed.
   */
  async touchCards(cardIds: string[]): Promise<void> {
    if (cardIds.length === 0) return;
    await this.pg.query(
      `UPDATE merchant.loyalty_card SET updated_at = now() WHERE id = ANY($1::uuid[])`,
      [cardIds],
    );
  }

  async unregisterDevice(walletPassId: string, deviceIdentifier: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM runtime.pass_device
       WHERE wallet_pass_id = $1::uuid AND device_identifier = $2`,
      [walletPassId, deviceIdentifier],
    );
  }

  /**
   * The serials this device holds that changed after `since`, for one merchant.
   *
   * Apple polls this and then re-downloads only what it names. `loyalty_card`
   * carries `updated_at`, and the scan path touches it on every visit, so the
   * card row is the change signal.
   */
  async serialsUpdatedSince(
    merchantId: string,
    deviceIdentifier: string,
    since: Date,
  ): Promise<string[]> {
    const { rows } = await this.pg.query<{ serial_number: string }>(
      `SELECT wp.external_object_id AS serial_number
       FROM runtime.pass_device AS d
       JOIN merchant.loyalty_wallet_pass AS wp ON wp.id = d.wallet_pass_id
       JOIN merchant.loyalty_card AS c ON c.id = wp.card_id
       WHERE d.device_identifier = $2
         AND c.merchant_id = $1::uuid
         AND wp.platform = 'apple'
         AND wp.status = 'active'
         AND wp.external_object_id IS NOT NULL
         AND c.updated_at > $3`,
      [merchantId, deviceIdentifier, since],
    );
    return rows.map((r) => r.serial_number);
  }

  /**
   * PASS HEALTH — the standing detector for the silent failure.
   *
   * An Apple pass that stops updating never reports an error. It stays
   * installed, it opens, and its barcode scans; only the number goes stale.
   * Four failure paths log and none of them counts, so the only way to see the
   * class is to ask the database how many passes look abandoned.
   *
   * Two different questions, deliberately kept apart:
   *
   *   `unregistered` — a pass that exists with NO device registration. The
   *     phone never completed the handshake, so no push can ever reach it.
   *
   *   `stale` — a pass whose device IS registered, but whose card has not
   *     changed in `staleDays`. On its own this is not a fault: a customer who
   *     has not visited has nothing to update. It is a TREND to read, not an
   *     alarm to fire, and it is the number that moves when a token breaks.
   *
   * Scoped to Apple: Google needs no registration and its update is a PATCH.
   */
  async passHealth(
    staleDays = 30,
  ): Promise<{ total: number; unregistered: number; stale: number }> {
    const { rows } = await this.pg.query<{
      total: string;
      unregistered: string;
      stale: string;
    }>(
      `SELECT count(*)                                              AS total,
              count(*) FILTER (WHERE d.wallet_pass_id IS NULL)      AS unregistered,
              count(*) FILTER (WHERE d.wallet_pass_id IS NOT NULL
                                 AND c.updated_at < now() - ($1 || ' days')::interval) AS stale
         FROM merchant.loyalty_wallet_pass AS wp
         JOIN merchant.loyalty_card AS c ON c.id = wp.card_id
         LEFT JOIN LATERAL (
           SELECT 1 AS wallet_pass_id FROM runtime.pass_device pd
            WHERE pd.wallet_pass_id = wp.id LIMIT 1
         ) AS d ON true
        WHERE wp.platform = 'apple' AND wp.status = 'active'`,
      [String(staleDays)],
    );
    const r = rows[0];
    return {
      total: Number(r.total),
      unregistered: Number(r.unregistered),
      stale: Number(r.stale),
    };
  }

  /**
   * Everything the pass builder needs, for one card.
   *
   * The geofences are the part that fails silently. `locations` is rebuilt on
   * every render and is never carried forward from the pass already on the phone,
   * so a location row that arrives with a null `lat`/`lng`, or with a `status`
   * that is not exactly `'active'`, produces a pass with NO nearby behaviour and
   * no error anywhere. Treat an empty result here as a fact worth logging.
   */
  async renderData(merchantId: string, cardId: string): Promise<PassRenderData | null> {
    const [head, locations, state] = await Promise.all([
      this.pg.query<PassHeadRow>(
        `SELECT m.name                    AS merchant_name,
                m.handle                  AS merchant_handle,
                m.timezone                AS timezone,
                c.card_number             AS card_number,
                c.lifecycle_message       AS lifecycle_message,
                c.lifecycle_message_at    AS lifecycle_message_at,
                c.issued_at               AS issued_at,
                c.updated_at              AS card_updated_at,
                cu.name                   AS customer_name,
                p.pass_style              AS pass_style,
                p.primary_color           AS primary_color,
                p.secondary_color         AS secondary_color,
                p.logo_url                AS logo_url,
                p.strip_image_url         AS strip_image_url,
                p.promo_message           AS promo_message,
                p.promo_starts_at         AS promo_starts_at,
                p.promo_ends_at           AS promo_ends_at,
                p.promo_days              AS promo_days,
                p.topup_enabled           AS topup_enabled,
                -- Both builders read this (google-pass.service.ts:249,
                -- apple-pass.builder.ts:265). Omitting it here is why the
                -- Android reward line was empty after the port.
                p.birthday_reward_name    AS birthday_reward_name,
                r.name                    AS reward_name
         FROM merchant.loyalty_card AS c
         JOIN merchant.merchant AS m ON m.id = c.merchant_id
         LEFT JOIN merchant.customer AS cu ON cu.id = c.customer_id
         LEFT JOIN merchant.loyalty_program AS p ON p.merchant_id = c.merchant_id
         LEFT JOIN LATERAL (
           SELECT name FROM merchant.loyalty_reward
           WHERE merchant_id = c.merchant_id AND active AND type = 'stamps_free_item'
           ORDER BY created_at DESC NULLS LAST LIMIT 1
         ) AS r ON true
         WHERE c.merchant_id = $1::uuid AND c.id = $2::uuid`,
        [merchantId, cardId],
      ),
      this.pg.query<{ lat: string; lng: string }>(
        `SELECT lat::text, lng::text FROM merchant.location
         WHERE merchant_id = $1::uuid AND status = 'active'
           AND lat IS NOT NULL AND lng IS NOT NULL`,
        [merchantId],
      ),
      this.pg.query<LoyaltyCardState>(LOYALTY_CARD_STATE_SQL, [merchantId, cardId]),
    ]);

    const h = head.rows[0];
    const s = state.rows[0];
    if (!h || !s) return null;

    return {
      merchantName: h.merchant_name,
      merchantHandle: h.merchant_handle,
      timezone: h.timezone,
      cardNumber: h.card_number ?? s.card_number,
      customerName: h.customer_name,
      lifecycleMessage: h.lifecycle_message,
      lifecycleMessageAt: h.lifecycle_message_at,
      memberSince: h.issued_at,
      cardUpdatedAt: h.card_updated_at,
      passStyle: h.pass_style,
      primaryColor: h.primary_color,
      secondaryColor: h.secondary_color,
      logoUrl: h.logo_url,
      stripImageUrl: h.strip_image_url,
      promoMessage: activePromo(h),
      topupEnabled: h.topup_enabled ?? true,
      rewardName: h.reward_name,
      birthdayRewardName: h.birthday_reward_name,
      state: s,
      locations: locations.rows.map((l) => ({
        latitude: Number(l.lat),
        longitude: Number(l.lng),
      })),
    };
  }
}

// ─── types ───────────────────────────────────────────────────────────────────

export interface AuthenticatedPass {
  walletPassId: string;
  cardId: string;
  merchantId: string;
  serialNumber: string;
  /** Apple's `authenticationToken`. Immutable for the life of the pass. */
  webServiceToken: string;
  cardUpdatedAt: Date;
}

/** What `passHealth` counts. Two questions, never added together. */
export interface PassHealth {
  total: number;
  /** Passes with NO device registration. No push can ever reach them. */
  unregistered: number;
  /** Registered passes whose card has not changed in `staleDays`. A trend, not an alarm. */
  stale: number;
}

export interface PassRenderData {
  merchantName: string;
  merchantHandle: string | null;
  timezone: string;
  cardNumber: string;
  customerName: string | null;
  lifecycleMessage: string | null;
  lifecycleMessageAt: Date | null;
  memberSince: Date;
  cardUpdatedAt: Date;
  passStyle: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  logoUrl: string | null;
  stripImageUrl: string | null;
  promoMessage: string | null;
  topupEnabled: boolean;
  rewardName: string | null;
  birthdayRewardName: string | null;
  state: LoyaltyCardState;
  locations: { latitude: number; longitude: number }[];
}

interface AuthenticatedPassRow {
  wallet_pass_id: string;
  web_service_token: string | null;
  serial_number: string;
  card_id: string;
  merchant_id: string;
  card_updated_at: Date;
}

interface PassHeadRow {
  merchant_name: string;
  merchant_handle: string | null;
  timezone: string;
  card_number: string | null;
  lifecycle_message: string | null;
  lifecycle_message_at: Date | null;
  issued_at: Date;
  card_updated_at: Date;
  customer_name: string | null;
  pass_style: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  logo_url: string | null;
  strip_image_url: string | null;
  promo_message: string | null;
  promo_starts_at: Date | null;
  promo_ends_at: Date | null;
  promo_days: string | null;
  topup_enabled: boolean | null;
  reward_name: string | null;
  birthday_reward_name: string | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Compare two secrets without leaking their contents through response time. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a leak of the
  // length — but the length of a token we generate is a constant, so it tells an
  // attacker nothing they could not read from their own pass.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * The promotion to print on the pass right now, or null.
 *
 * `promo_days` holds COMMA-SEPARATED WEEKDAY NUMBERS (0 = Sunday), not the day
 * names the column comment in `20_merchant.sql:507` suggests. The live umi-cash
 * reader parses them with `Number`, so the stored data is numeric and the comment
 * is wrong. Port the behaviour, not the comment.
 */
function activePromo(h: PassHeadRow): string | null {
  if (!h.promo_message) return null;
  const now = new Date();
  if (h.promo_starts_at && now < h.promo_starts_at) return null;
  if (h.promo_ends_at && now > h.promo_ends_at) return null;
  if (h.promo_days) {
    const allowed = h.promo_days.split(',').map(Number);
    if (!allowed.includes(weekdayInZone(h.timezone, now))) return null;
  }
  return h.promo_message;
}
