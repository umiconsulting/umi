import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { MerchantBrandingLogo, MerchantBrandingLogoUpload } from '@umi/contract';
import type { AppConfig } from '../../shared/config/config.schema';
import { MerchantBrandingLogoRepository } from './merchant-branding.repository';

/**
 * The most we will ever store, matching `merchant_branding_logo`'s CHECK. The
 * contract's base64 cap is the same number, rounded up to a 4-character group.
 */
const MAX_STORED_BYTES = 262_144;
/** What we resize every upload into. A receipt logo is never wider than the paper. */
const MAX_EDGE = 768;
/**
 * A 4 000 × 4 000 phone photo is 16 Mpx — fine. A decompression bomb is not, and
 * sharp would happily try. Pinned BELOW the per-image default so a hostile file is
 * refused rather than swapped.
 */
const MAX_INPUT_PIXELS = 4_096 * 4_096;

/** The first bytes of a PNG, and of a JPEG. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/** The public path prefix the asset route serves from. */
const ASSET_PREFIX = '/logos/';

/**
 * A refusal the owner can act on. Everything here is the caller's file, so the
 * answer is a 400 with a sentence — not a 500.
 */
function refused(message: string): BadRequestException {
  return new BadRequestException({
    code: 'VALIDATION_FAILED',
    message,
    fieldErrors: { dataBase64: [message] },
  });
}

/**
 * The café's logo: take whatever the dashboard picked, normalise it, keep the
 * normalised bytes.
 *
 * NORMALISE, ALWAYS. The owner's worry about "storing so much in the database" is
 * answered here rather than with a promise: a 4 MB phone photo never lands as-is.
 * Every upload is re-encoded to fit inside 768 × 768 — a logo drawn on a 203 dpi
 * receipt is 384 dots wide, so 768 is already twice what the paper can show — and
 * the stored row is capped at 256 KiB by a CHECK constraint the database enforces
 * whether or not this code remembers to. One café's logo therefore costs tens of
 * kilobytes: a thousand cafés are ~50 MB in a database that also holds every
 * receipt, and Postgres TOASTs the column anyway so a logo never slows a scan of
 * the other columns.
 *
 * Content-addressed. The asset name carries the SHA-256 of the STORED bytes, so a
 * new upload is a new URL and no cache anywhere — phone, dashboard, CDN — needs
 * busting; the old one simply stops resolving.
 */
@Injectable()
export class MerchantBrandingLogoService {
  private readonly logger = new Logger(MerchantBrandingLogoService.name);
  /** Where public asset URLs point, when the deployment says. */
  private readonly configuredOrigin: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly repo: MerchantBrandingLogoRepository,
  ) {
    const publicApi = config.get('PUBLIC_API_URL', { infer: true });
    const wallet = config.get('WALLET_PUBLIC_ORIGIN', { infer: true });
    // `PUBLIC_API_URL` is the API's own public origin and the right first answer.
    // `WALLET_PUBLIC_ORIGIN` is the second because it is already the base the Apple
    // and Google pass builders fetch brand assets from — same host, same `/logos/*`.
    this.configuredOrigin = (publicApi ?? wallet ?? '').trim().replace(/\/+$/, '');
  }

  async upload(
    merchantId: string,
    userId: string | null,
    upload: MerchantBrandingLogoUpload,
    /**
     * The origin the upload itself arrived on. Used only when the deployment
     * configured neither origin above — which is exactly the local case, where the
     * URL has to be reachable from a till on the LAN. An authenticated
     * `merchant.manage` operator is the only caller, and in production both config
     * values are set, so the header is never what this reads.
     */
    fallbackOrigin: string | null,
  ): Promise<MerchantBrandingLogo> {
    const source = Buffer.from(upload.dataBase64, 'base64');
    if (source.length === 0) throw refused('El archivo llegó vacío.');
    if (source.length > MAX_STORED_BYTES) {
      throw refused('La imagen pesa más de 256 KB. Elige una más ligera.');
    }
    if (!matchesDeclaredType(source, upload.contentType)) {
      throw refused(
        upload.contentType === 'image/png'
          ? 'El archivo no es un PNG válido.'
          : 'El archivo no es un JPG válido.',
      );
    }

    const normalised = await this.normalise(source);
    const sha = createHash('sha256').update(normalised.bytes).digest();
    // 16 hex characters = 64 bits of the digest. Enough that two logos of the same
    // café never collide, short enough to stay readable in a URL.
    const assetName = `${merchantId}-${sha.toString('hex').slice(0, 16)}.${normalised.extension}`;
    const url = `${this.originFor(fallbackOrigin)}${ASSET_PREFIX}${assetName}`;

    await this.repo.save(merchantId, userId, {
      contentType: normalised.contentType,
      bytes: normalised.bytes,
      sha256: sha,
      width: normalised.width,
      height: normalised.height,
      url,
      assetName,
    });

    return {
      url,
      sha256: sha.toString('hex'),
      contentType: normalised.contentType,
      width: normalised.width,
      height: normalised.height,
    };
  }

  async clear(merchantId: string, userId: string | null): Promise<void> {
    await this.repo.clear(merchantId, userId);
  }

  /**
   * One stored logo, by the merchant the asset name names. The caller has already
   * checked the name's shape; a miss here is a 404, not an error.
   */
  async asset(merchantId: string, shaPrefix: string) {
    const row = await this.repo.find(merchantId);
    if (!row) return null;
    // The name is content-addressed: bytes that no longer match the name they are
    // served under are gone, exactly as a replaced logo should be.
    if (!row.sha256.toString('hex').startsWith(shaPrefix)) return null;
    return row;
  }

  private originFor(fallbackOrigin: string | null): string {
    if (this.configuredOrigin) return this.configuredOrigin;
    if (!this.configuredOrigin && !fallbackOrigin) {
      this.logger.warn(
        'No PUBLIC_API_URL or WALLET_PUBLIC_ORIGIN is set and the request had no origin: ' +
          'the logo URL is relative and only same-origin readers (the dashboard) will resolve it.',
      );
    }
    return fallbackOrigin ?? '';
  }

  /**
   * Fit inside 768 × 768, honour the EXIF rotation, and land under the byte cap.
   *
   * PNG first, because a logo is flat art and PNG keeps its edges and any
   * transparency. A PHOTOGRAPHIC logo — someone's uploaded JPEG — can still exceed
   * 256 KiB at 768 px even as a palette PNG, so the fallback re-encodes as JPEG,
   * which is what it came from. Both are content types the table and the contract
   * accept; the stored pair always agrees with itself.
   */
  private async normalise(source: Buffer): Promise<{
    bytes: Buffer;
    contentType: 'image/png' | 'image/jpeg';
    extension: 'png' | 'jpg';
    width: number;
    height: number;
  }> {
    const fitted = sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true });

    let png: { data: Buffer; info: sharp.OutputInfo };
    try {
      png = await fitted
        .clone()
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw refused('No pudimos leer la imagen. Prueba con otro archivo PNG o JPG.');
    }

    if (png.data.length <= MAX_STORED_BYTES) {
      return {
        bytes: png.data,
        contentType: 'image/png',
        extension: 'png',
        width: png.info.width,
        height: png.info.height,
      };
    }

    const jpeg = await fitted
      .clone()
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (jpeg.data.length > MAX_STORED_BYTES) {
      throw refused('La imagen sigue pesando más de 256 KB después de reducirla.');
    }
    return {
      bytes: jpeg.data,
      contentType: 'image/jpeg',
      extension: 'jpg',
      width: jpeg.info.width,
      height: jpeg.info.height,
    };
  }
}

/** The bytes must be what the caller says they are, before sharp is asked anything. */
function matchesDeclaredType(bytes: Buffer, declared: 'image/png' | 'image/jpeg'): boolean {
  if (bytes.length < PNG_MAGIC.length) return false;
  return declared === 'image/png'
    ? bytes.subarray(0, 8).equals(PNG_MAGIC)
    : bytes.subarray(0, 3).equals(JPEG_MAGIC);
}
