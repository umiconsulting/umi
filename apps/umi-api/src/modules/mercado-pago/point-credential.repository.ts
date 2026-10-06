import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../shared/config/config.schema';
import { PgService } from '../../shared/database/pg.service';

/**
 * THE PER-MERCHANT CREDENTIAL, AT REST — plan §3 decisions D7 and D8, the storage half of
 * Phase 5 step 1. `merchant.mp_point_credential` is the table (72_mp_point.sql), and this is
 * the only code that reads or writes it.
 *
 * WHAT CHANGES WHEN THIS FILE HAS A CALLER. Today the transport asks the vendor with ONE
 * deployment token read at boot (`tender.module.ts`), which serves the "own account" mode of
 * phases 0 to 4. Umi's clients are other sellers, so their money can only reach their books
 * if the token is the MERCHANT'S — the vendor's own quality checklist makes centralized
 * credentials a requirement rather than advice (D7). This repository is where that
 * per-merchant token is held, and the reason it is a file of its own is that everything in
 * it is about how a bearer token is kept rather than about what is done with one.
 *
 * FOUR PROPERTIES, EACH ONE LOAD-BEARING.
 *
 * 1. THE TOKEN IS NEVER STORED IN THE CLEAR. Both tokens are AES-256-GCM sealed before they
 *    reach SQL, and the migration deliberately has no plaintext column for them to land in.
 *    An access token is a bearer credential for somebody else's bank account: a database
 *    dump, a backup, or a `select *` by an analytics role that finds one is the whole loss.
 * 2. THE CIPHER IS SELF-DESCRIBING. Each value carries its own version prefix inside one
 *    `text` column, so a second key can be introduced later without guessing which format a
 *    row was written in — see the note on `encrypt` below for why that beats three columns.
 * 3. THE KEY IS PURPOSE-DERIVED. The same deployment secret backs customer-value gift cards,
 *    the QR app, and this table; deriving `sha256('umi-mp-point-credential:' || secret)`
 *    means the three never share a key, so a compromise in one is not a compromise in the
 *    others. The purpose prefix is DATA — it is part of the derivation and must not be
 *    reformatted.
 * 4. A MISSING KEY IS A REFUSAL, NEVER A PLAINTEXT FALLBACK. This is the one thing here that
 *    must not degrade gracefully: an unconfigured deployment stores no credential at all and
 *    says so (`MP_POINT_CREDENTIAL_KEY_UNAVAILABLE`), because "stored it anyway" would mean
 *    a merchant's token sitting readable in the table the whole design exists to keep it out
 *    of.
 *
 * WHAT THIS FILE IS NOT. It is not the OAuth flow (the code exchange lives in Phase 5 step
 * 1's controller) and not the renewal job (D8, step 2). Both call `store`/`recordRefreshed`
 * and neither needs anything else: this layer decides how a token is held, and the flow
 * decides when there is a token to hold.
 */

export interface PointCredentialInput {
  readonly merchantId: string;
  /** The `user_id` the OAuth answer carried: the account that receives the money. */
  readonly mpUserId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
}

/** The credential in the clear. NEVER returned to a client — see `meta`. */
export interface PointCredential {
  readonly merchantId: string;
  readonly mpUserId: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
}

/** What a screen may see: the account and the health of the token, never the token. */
export interface PointCredentialMeta {
  readonly mpUserId: string;
  readonly expiresAt: Date | null;
  readonly refreshFailedAt: Date | null;
  readonly refreshAttempts: number;
  readonly updatedAt: Date;
}

/**
 * The envelope's own version. It is the reason a rotation is possible: a future key writes
 * `v2.` and a reader can tell the two apart from the value alone, without a migration having
 * to guess, and without a second key being applied to a row written under the first.
 */
const ENVELOPE_VERSION = 'v1';

/** GCM's 96-bit nonce and 128-bit tag, the sizes the cipher is specified for. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * The purpose the key is derived under. Changing this string is a key rotation, not a
 * refactor: every stored credential becomes unreadable, which is exactly why it carries the
 * feature name.
 */
const KEY_PURPOSE = 'umi-mp-point-credential';

type Row = {
  mpUserId: string;
  expiresAt: Date | null;
  refreshFailedAt: Date | null;
  refreshAttempts: number;
  updatedAt: Date;
};

@Injectable()
export class PointCredentialRepository {
  private readonly logger = new Logger(PointCredentialRepository.name);

  constructor(
    private readonly pg: PgService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Create or replace the merchant's credential, encrypted, in one statement.
   *
   * ONE STATEMENT, AND THAT IS THE POINT. The migration says a credential is replaced, never
   * deleted, and re-authorization is the common path (a merchant who unlinks and links again,
   * or whose seller changes account), so a read-then-write pair would have a window in which
   * the merchant has no credential at all. `ON CONFLICT (merchant_id) DO UPDATE` makes the
   * replacement atomic: a concurrent charge either sees the old token or the new one, and
   * never a row that is mid-swap.
   *
   * THE FAILURE TRAIL IS CLEARED, and that is not tidiness. `refresh_failed_at` and
   * `refresh_attempts` are read by the owner-visible alert of §7 item 4; carrying a
   * three-failures-old count onto a freshly authorized token would fire an alert about a
   * token that is brand new, and — worse — would hide a genuine failure while the stale count
   * was still being explained away. A new authorization is a clean slate.
   */
  async store(input: PointCredentialInput): Promise<void> {
    // Encrypt BEFORE opening the transaction: the key check is a refusal that must not have
    // written anything, and there is no reason to hold a pooled client while hashing.
    const accessTokenCipher = this.encrypt(input.accessToken);
    const refreshTokenCipher =
      input.refreshToken === null ? null : this.encrypt(input.refreshToken);
    try {
      await this.pg.runWithMerchant(input.merchantId, null, async (client) => {
        await client.query(
          `INSERT INTO merchant.mp_point_credential
             (merchant_id, mp_user_id, access_token_cipher, refresh_token_cipher,
              access_token_expires_at, refresh_attempts, refresh_failed_at, updated_at)
           VALUES ($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,0,NULL,clock_timestamp())
           ON CONFLICT (merchant_id) DO UPDATE SET
             mp_user_id=excluded.mp_user_id,
             access_token_cipher=excluded.access_token_cipher,
             refresh_token_cipher=excluded.refresh_token_cipher,
             access_token_expires_at=excluded.access_token_expires_at,
             refresh_attempts=0,
             refresh_failed_at=NULL,
             updated_at=clock_timestamp()`,
          [
            input.merchantId,
            input.mpUserId,
            accessTokenCipher,
            refreshTokenCipher,
            input.expiresAt,
          ],
        );
      });
    } catch (error) {
      throw this.translateUniqueViolation(error, input.merchantId);
    }
  }

  /**
   * The tokens, decrypted, for asking the vendor as this merchant. Null when unbound.
   *
   * A ROW WITH NO CIPHER IS NULL, NOT AN ERROR. Phases 1 to 4 charge through the deployment
   * token and leave both `_cipher` columns NULL (72_mp_point.sql says so); a merchant in that
   * state has no credential of its own, which is precisely what "unbound" means, and the
   * caller falls back to the deployment token. Returning a token-shaped object with an empty
   * string in it would instead invite a request to the vendor with no credential at all.
   */
  async readForMerchant(merchantId: string): Promise<PointCredential | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<{
        mpUserId: string;
        accessTokenCipher: string | null;
        refreshTokenCipher: string | null;
        expiresAt: Date | null;
      }>(
        `SELECT mp_user_id AS "mpUserId",
                access_token_cipher AS "accessTokenCipher",
                refresh_token_cipher AS "refreshTokenCipher",
                access_token_expires_at AS "expiresAt"
           FROM merchant.mp_point_credential
          WHERE merchant_id=$1::uuid`,
        [merchantId],
      );
      const row = rows[0];
      if (!row?.accessTokenCipher) return null;
      return {
        merchantId,
        mpUserId: row.mpUserId,
        accessToken: this.decrypt(row.accessTokenCipher, 'access'),
        refreshToken:
          row.refreshTokenCipher === null ? null : this.decrypt(row.refreshTokenCipher, 'refresh'),
        expiresAt: row.expiresAt,
      };
    });
  }

  /**
   * The account and the token's health. Never a token.
   *
   * THE QUERY NAMES ITS COLUMNS, and that is the guarantee rather than a style choice. The
   * migration grants `readonly` the identity and health columns and revokes the two
   * `_cipher` ones BY NAME; the same discipline here means this method cannot hand a token
   * to a screen, a log line, or a JSON serializer even by accident — there is no code path
   * through which the cipher is selected, so there is nothing to remember to strip before
   * returning.
   */
  async meta(merchantId: string): Promise<PointCredentialMeta | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT mp_user_id AS "mpUserId",
                access_token_expires_at AS "expiresAt",
                refresh_failed_at AS "refreshFailedAt",
                refresh_attempts AS "refreshAttempts",
                updated_at AS "updatedAt"
           FROM merchant.mp_point_credential
          WHERE merchant_id=$1::uuid`,
        [merchantId],
      );
      const row = rows[0];
      if (!row) return null;
      // Built field by field rather than spread: the returned object's keys are this
      // method's own statement of what a screen may see, and a column added to the query
      // later cannot ride along into a response.
      return {
        mpUserId: row.mpUserId,
        expiresAt: row.expiresAt,
        refreshFailedAt: row.refreshFailedAt,
        refreshAttempts: row.refreshAttempts,
        updatedAt: row.updatedAt,
      };
    });
  }

  /**
   * A successful renewal: new tokens, expiry, and the failure trail cleared.
   *
   * THE BINDING IS NOT TOUCHED. `mp_user_id` says which Mercado Pago account this row is
   * bound to, and the vendor answers a refresh with the same account it was issued to; a
   * renewal that appeared to name a different account would be a re-authorization, which is
   * `store`'s job (and the reason `mp_user_id` is UNIQUE — one account, one merchant). Leaving
   * the column alone keeps the row's own claim about whose money this is independent of what
   * an answer happens to echo back.
   *
   * A MISSING ROW IS A REFUSAL. The job reads this merchant's credential before it has a
   * refresh token to fail with, so zero rows here means the row moved out from under a
   * renewal in flight; reporting success would tell the job it had recorded a renewal that
   * does not exist, and the token it just obtained would be lost without a trace.
   */
  async recordRefreshed(input: PointCredentialInput): Promise<void> {
    const accessTokenCipher = this.encrypt(input.accessToken);
    const refreshTokenCipher =
      input.refreshToken === null ? null : this.encrypt(input.refreshToken);
    const updated = await this.pg.runWithMerchant(input.merchantId, null, async (client) => {
      const result = await client.query(
        `UPDATE merchant.mp_point_credential
            SET access_token_cipher=$2::text,
                refresh_token_cipher=$3::text,
                access_token_expires_at=$4::timestamptz,
                refresh_attempts=0,
                refresh_failed_at=NULL,
                updated_at=clock_timestamp()
          WHERE merchant_id=$1::uuid`,
        [input.merchantId, accessTokenCipher, refreshTokenCipher, input.expiresAt],
      );
      return result.rowCount ?? 0;
    });
    if (updated === 0) throw new ConflictException({ code: 'MP_POINT_CREDENTIAL_UNBOUND' });
  }

  /**
   * A failed renewal: the attempt counter up, the moment recorded, nothing else touched.
   *
   * THE TOKENS STAY. An access token that the vendor rejected for refresh may still be
   * accepted for a charge — the two are different grants with different lifetimes — so a
   * failed renewal is not a reason to destroy the credential that is still taking money.
   * What to DO about a failed refresh (how many attempts before a charge is refused) is D8's
   * job; this method only records the fact, which is why it writes nothing but the pair the
   * alert reads.
   *
   * THE REASON GOES TO THE LOG AND NOWHERE ELSE. There is no column for it, deliberately: a
   * free-text vendor message kept forever next to a credential is a string nobody audits and
   * that could one day carry something that looks like a token. The log line is where a
   * human reads it, once.
   */
  async recordRefreshFailure(merchantId: string, reason: string): Promise<void> {
    const recorded = await this.pg.runWithMerchant(merchantId, null, async (client) => {
      const result = await client.query(
        `UPDATE merchant.mp_point_credential
            SET refresh_attempts=refresh_attempts+1,
                refresh_failed_at=clock_timestamp()
          WHERE merchant_id=$1::uuid`,
        [merchantId],
      );
      return result.rowCount ?? 0;
    });
    this.logger.warn(
      recorded === 0
        ? `Point credential refresh failed for merchant ${merchantId} (no credential stored): ${reason}`
        : `Point credential refresh failed for merchant ${merchantId}: ${reason}`,
    );
  }

  /**
   * UNLINK — the end of one authorization, written as an UPDATE and never as a DELETE.
   *
   * THE MIGRATION GRANTS NO DELETE, ON PURPOSE, and this method is why that is not a
   * limitation to work around. `merchant.mp_point_credential`'s only delete path is its
   * `on delete cascade` from the merchant, because the row is the café's RELATIONSHIP with
   * the vendor rather than a token with a customer attached: unlinking ends an
   * AUTHORIZATION, not the relationship, and the café that links again is the same café.
   *
   * SO "UNLINKED" MEANS THE MATERIAL IS GONE AND THE ROW IS NOT. Erasing both ciphers and
   * the expiry is the whole fact: `readForMerchant` already answers `null` when there is no
   * access token, so the transport falls back to the deployment's own-account mode or
   * refuses as a CONFIGURATION error, and there is no code path left in the process that
   * can reach a token for this café. The failure trail is cleared with it, because a
   * `refresh_attempts` count that outlived the credential it describes would fire the D8
   * alert about a token nobody holds.
   *
   * `mp_user_id` IS DELIBERATELY LEFT ALONE, and its consequence is worth stating rather
   * than discovering: the table's unique index on it means one Mercado Pago account is
   * bound to one merchant row for as long as that row exists, so an unlinked account cannot
   * be linked to a DIFFERENT café without an operator's intervention. Re-linking the same
   * account to the same café — the case that actually happens — is an `on conflict` update
   * and works. Handing an account from one café to another is a support operation, not a
   * screen, and it is named in the plan rather than guessed at here.
   *
   * Idempotent: unlinking a café that never linked, or unlinking twice, erases nothing and
   * answers the same way.
   */
  async revoke(merchantId: string): Promise<void> {
    await this.pg.runWithMerchant(merchantId, null, async (client) => {
      await client.query(
        `UPDATE merchant.mp_point_credential
            SET access_token_cipher=NULL,
                refresh_token_cipher=NULL,
                access_token_expires_at=NULL,
                refresh_failed_at=NULL,
                refresh_attempts=0
          WHERE merchant_id=$1::uuid`,
        [merchantId],
      );
    });
  }

  /**
   * Is THIS café's account still connected? The one question the row's existence cannot
   * answer after an unlink, because an unlinked credential is a row with no material.
   *
   * IT SELECTS A BOOLEAN DERIVED FROM THE CIPHER AND NEVER THE CIPHER. That keeps the rule
   * `meta` documents — the console path has no code path through which a token can be
   * selected, so there is nothing to remember to strip — while telling a screen the one
   * thing it needs. `meta` could not answer this: it names the identity and health columns
   * on purpose, and its key set is asserted by an integration case, so growing it would
   * have weakened a guarantee to avoid one query.
   */
  async bound(merchantId: string): Promise<boolean> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<{ bound: boolean }>(
        `SELECT (access_token_cipher IS NOT NULL) AS "bound"
           FROM merchant.mp_point_credential
          WHERE merchant_id=$1::uuid`,
        [merchantId],
      );
      return rows[0]?.bound ?? false;
    });
  }

  /**
   * EVERY CREDENTIAL INSIDE THE RENEWAL MARGIN — the scan the D8 job runs (phase 5 step 2).
   *
   * IT IS THE ONE READ IN THIS FILE THAT IS NOT SCOPED TO A MERCHANT, and that is what makes it
   * the background job's rather than a request's: a renewal walks every café's token, so there is
   * no membership to narrow by, and it runs on the WORKER pool — the role that exists for exactly
   * this. No request path may call it: a route that could would be a route that reads other
   * merchants' credentials.
   *
   * A ROW WITH NO REFRESH TOKEN IS INCLUDED, DELIBERATELY. It cannot be renewed, and the honest
   * outcome is a RECORDED failure the owner can see (`refresh_failed_at`, which the console's
   * status route already renders) rather than silence until the token expires and the card method
   * disappears at the counter. The caller decides what to do with `refreshToken: null`; this
   * method's job is not to hide it.
   *
   * The margin is a PARAMETER rather than a constant because it is a policy — 14 days, D8 — and
   * the job states it, so the number lives in one place instead of in a query and in a comment
   * that can drift apart.
   */
  async dueForRenewal(marginDays: number, limit: number): Promise<PointCredential[]> {
    const { rows } = await this.pg.query<{
      merchantId: string;
      mpUserId: string;
      accessTokenCipher: string | null;
      refreshTokenCipher: string | null;
      expiresAt: Date | null;
    }>(
      `SELECT merchant_id AS "merchantId",
              mp_user_id AS "mpUserId",
              access_token_cipher AS "accessTokenCipher",
              refresh_token_cipher AS "refreshTokenCipher",
              access_token_expires_at AS "expiresAt"
         FROM merchant.mp_point_credential
        WHERE access_token_cipher IS NOT NULL
          AND access_token_expires_at IS NOT NULL
          AND access_token_expires_at <= clock_timestamp() + make_interval(days => $1::int)
        ORDER BY access_token_expires_at ASC
        LIMIT $2::int`,
      [marginDays, limit],
    );
    return rows.map((row) => ({
      merchantId: row.merchantId,
      mpUserId: row.mpUserId,
      accessToken: this.decrypt(row.accessTokenCipher as string, 'access'),
      refreshToken:
        row.refreshTokenCipher === null ? null : this.decrypt(row.refreshTokenCipher, 'refresh'),
      expiresAt: row.expiresAt,
    }));
  }

  /**
   * Seal one value into its own envelope: `v1.<nonce>.<ciphertext>.<tag>`, base64url.
   *
   * WHY AN ENVELOPE AND NOT THREE COLUMNS. The migration gives each token ONE `text` column,
   * and the version prefix is what buys back what splitting the value into nonce/ciphertext/
   * tag columns would have cost: a row states the format it was written in. When the key has
   * to be rotated (a leak, a vendor requirement, a merchant asking for their own key), a
   * `v2.` reader can be added and both formats read side by side during the changeover
   * instead of the deployment having to know, out of band, which rows predate the rotation.
   * A nonce is not secret and a tag is not secret, so nothing is lost by keeping them in one
   * value — and one column per token is one thing to grant, revoke, and audit.
   *
   * A FRESH NONCE PER VALUE, ALWAYS. GCM's security collapses if a nonce is ever reused
   * under the same key, and a `store` writes two values, so nothing here is derived from the
   * merchant, the token, or a counter.
   */
  private encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.credentialKey(), nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_VERSION,
      nonce.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  /**
   * Open one envelope, or refuse. There is no third outcome.
   *
   * EVERYTHING THAT IS NOT A `v1` ENVELOPE OF THE RIGHT SHAPE IS REFUSED WITH
   * `MP_POINT_CREDENTIAL_UNREADABLE` — a wrong number of parts, an unknown version, a nonce or
   * tag of the wrong length, and (below) a tag that does not verify. The tag is the part that
   * matters: GCM verifies integrity before it hands back a single byte, so a value edited in
   * the database fails `final()` rather than decrypting to garbage. A caller that received
   * half a token here would send it to the vendor as this merchant, so a refusal is the only
   * safe answer — the failure names the problem instead of impersonating an empty credential.
   */
  private decrypt(envelope: string, which: 'access' | 'refresh'): string {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
      throw this.unreadable(which, 'not a v1 envelope');
    }
    const [, noncePart, ciphertextPart, tagPart] = parts;
    const nonce = Buffer.from(noncePart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
      throw this.unreadable(which, 'nonce or tag is not the size the cipher uses');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.credentialKey(), nonce);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // The tag did not verify: the row was edited, or it was written under a different key.
      throw this.unreadable(which, 'the authentication tag did not verify');
    }
  }

  /**
   * The AES-256-GCM key, derived for THIS purpose from whichever secret the deployment has.
   *
   * THE FALLBACK ORDER mirrors `PosCustomerValueRepository.customerValueKey()`: a purpose-
   * specific key when one is configured, then the two secrets already trusted to hold this
   * class of material. The purpose prefix is what keeps them from being the same key — two
   * features deriving from one secret must not be able to decrypt each other's rows, and a
   * prefix makes that a property of the derivation rather than of the deployment's choices.
   *
   * WHEN NONE IS CONFIGURED, THIS THROWS, on the write path and the read path alike. A
   * deployment that has not been given a key cannot hold a credential, and the alternative —
   * storing one under a default, an empty string, or the plaintext — is the failure this
   * whole file exists to prevent. It is deliberately NOT a warning-and-continue: the one
   * thing that must not degrade gracefully is the key.
   */
  private credentialKey(): Buffer {
    const secret =
      this.config.get('MERCADO_PAGO_POINT_CREDENTIAL_KEY', { infer: true }) ??
      this.config.get('CUSTOMER_VALUE_SECRET', { infer: true }) ??
      this.config.get('APP_QR_SECRET', { infer: true });
    if (!secret) throw new ConflictException({ code: 'MP_POINT_CREDENTIAL_KEY_UNAVAILABLE' });
    return createHash('sha256').update(`${KEY_PURPOSE}:${secret}`).digest();
  }

  /** One shape for the refusals above, so the code and the reason travel together. */
  private unreadable(which: 'access' | 'refresh', why: string): ConflictException {
    return new ConflictException({
      code: 'MP_POINT_CREDENTIAL_UNREADABLE',
      token: which,
      reason: why,
    });
  }

  /**
   * A raw unique-violation becomes a named conflict.
   *
   * `mp_point_credential_user_uq` is UNIQUE on `mp_user_id`, and the migration is explicit
   * about what a collision means: "One Mercado Pago account maps to one merchant. Two
   * merchants bound to the same collector id would mean one of them is charging into the
   * other's account." That is a setup mistake the OAuth callback has to report to a person
   * — so it is translated here rather than surfacing as a driver-level 500 with a constraint
   * name in it. Every other failure keeps its original error.
   */
  private translateUniqueViolation(error: unknown, merchantId: string): unknown {
    const isUniqueViolation =
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === '23505' &&
      String((error as { constraint?: string }).constraint ?? '') === 'mp_point_credential_user_uq';
    if (!isUniqueViolation) return error;
    this.logger.warn(
      `Point credential refused for merchant ${merchantId}: this Mercado Pago account is already bound to another merchant`,
    );
    return new ConflictException({ code: 'MP_POINT_CREDENTIAL_ACCOUNT_TAKEN' });
  }
}
