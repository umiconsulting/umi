import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { PgService } from '../../shared/database/pg.service';

/**
 * The logo as it is stored (migration 014). `sha256` travels as the raw 32 bytes
 * `bytea` holds; the hex form is a rendering decision, made where it is rendered.
 */
export interface StoredBrandingLogo {
  merchantId: string;
  contentType: 'image/png' | 'image/jpeg';
  bytes: Buffer;
  sha256: Buffer;
  width: number;
  height: number;
}

/** What a save replaces the row AND `merchant.logo_url` with. */
export interface BrandingLogoWrite {
  contentType: 'image/png' | 'image/jpeg';
  bytes: Buffer;
  sha256: Buffer;
  width: number;
  height: number;
  /** What `merchant.merchant.logo_url` becomes — the URL every reader already uses. */
  url: string;
  /** The path half of `url`, which is what the public asset route is keyed on. */
  assetName: string;
}

/**
 * The café's own logo. One row per merchant, written and read on the REQUEST path
 * under merchant context — there is no BYPASSRLS anywhere in this flow:
 *
 *  * the upload writes inside `runWithMerchant` (the dashboard's merchant), and
 *  * the public asset read parses the merchant id back OUT of the asset name and
 *    opens the same scoped transaction for it, so the RLS policy is the thing that
 *    decides whether the bytes are reachable rather than a bypass. A logo is public
 *    by nature; the row still belongs to exactly one café.
 */
@Injectable()
export class MerchantBrandingLogoRepository {
  constructor(private readonly pg: PgService) {}

  /**
   * Replace the café's logo and point `logo_url` at it, in ONE transaction: a
   * stored image nothing references, or a URL pointing at nothing, are both states
   * the readers would trip over.
   */
  async save(merchantId: string, userId: string | null, logo: BrandingLogoWrite): Promise<void> {
    await this.pg.runWithMerchant(merchantId, userId, async (client) => {
      await client.query(
        `INSERT INTO merchant.merchant_branding_logo
           (merchant_id,content_type,bytes,sha256,width,height,updated_by)
         VALUES ($1::uuid,$2::text,$3::bytea,$4::bytea,$5,$6,$7::uuid)
         ON CONFLICT (merchant_id) DO UPDATE
           SET content_type=EXCLUDED.content_type,
               bytes=EXCLUDED.bytes,
               sha256=EXCLUDED.sha256,
               width=EXCLUDED.width,
               height=EXCLUDED.height,
               updated_by=EXCLUDED.updated_by,
               updated_at=now()`,
        [merchantId, logo.contentType, logo.bytes, logo.sha256, logo.width, logo.height, userId],
      );
      await this.pointLogoUrl(client, merchantId, logo.url);
    });
  }

  /**
   * Forget the logo: the bytes go, and `logo_url` stops pointing at them. Same
   * transaction, same reason as `save`.
   */
  async clear(merchantId: string, userId: string | null): Promise<void> {
    await this.pg.runWithMerchant(merchantId, userId, async (client) => {
      await client.query(`DELETE FROM merchant.merchant_branding_logo WHERE merchant_id=$1::uuid`, [
        merchantId,
      ]);
      await this.pointLogoUrl(client, merchantId, null);
    });
  }

  /** The stored row for one café. Null when the café has never uploaded one. */
  async find(merchantId: string): Promise<StoredBrandingLogo | null> {
    return this.pg.runWithMerchant(merchantId, null, async (client) => {
      const { rows } = await client.query<StoredBrandingLogo>(
        `SELECT merchant_id::text AS "merchantId",content_type AS "contentType",
                bytes,sha256,width,height
           FROM merchant.merchant_branding_logo
          WHERE merchant_id=$1::uuid`,
        [merchantId],
      );
      return rows[0] ?? null;
    });
  }

  private async pointLogoUrl(
    client: PoolClient,
    merchantId: string,
    url: string | null,
  ): Promise<void> {
    await client.query(`UPDATE merchant.merchant SET logo_url=$2 WHERE id=$1::uuid`, [
      merchantId,
      url,
    ]);
  }
}
