import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../shared/config/config.schema';
import type {
  BrandingLogoWrite,
  MerchantBrandingLogoRepository,
  StoredBrandingLogo,
} from './merchant-branding.repository';
import { MerchantBrandingLogoService } from './merchant-branding.service';

const MERCHANT = '10000000-0000-4000-8000-000000000101';
const USER = '30000000-0000-4000-8000-000000000001';

function config(values: Record<string, unknown>): ConfigService<AppConfig, true> {
  return { get: (key: string) => values[key] } as unknown as ConfigService<AppConfig, true>;
}

/** A repository that records what it was asked to store, and answers nothing. */
function repository() {
  const save = vi.fn(async (_m: string, _u: string | null, _logo: BrandingLogoWrite) => {});
  const clear = vi.fn(async () => {});
  const find = vi.fn(async (_merchantId: string): Promise<StoredBrandingLogo | null> => null);
  return { save, clear, find } satisfies Pick<
    MerchantBrandingLogoRepository,
    'save' | 'clear' | 'find'
  >;
}

async function pngBytes(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 120, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

describe('MerchantBrandingLogoService', () => {
  it('normalises the upload, names it by its digest and points the URL at the configured origin', async () => {
    const repo = repository();
    const service = new MerchantBrandingLogoService(
      config({ PUBLIC_API_URL: 'https://api.umiconsulting.co/' }),
      repo as unknown as MerchantBrandingLogoRepository,
    );

    // 1536 wide: over the 768 cap, so the stored image must come back smaller.
    const logo = await service.upload(
      MERCHANT,
      USER,
      {
        contentType: 'image/png',
        dataBase64: (await pngBytes(1536, 512)).toString('base64'),
      },
      null,
    );

    expect(logo.width).toBe(768);
    expect(logo.height).toBe(256);
    expect(logo.contentType).toBe('image/png');
    expect(logo.url).toBe(
      `https://api.umiconsulting.co/logos/${MERCHANT}-${logo.sha256.slice(0, 16)}.png`,
    );
    expect(logo.sha256).toMatch(/^[a-f0-9]{64}$/);

    const stored = repo.save.mock.calls[0][2];
    expect(stored.assetName).toBe(`${MERCHANT}-${logo.sha256.slice(0, 16)}.png`);
    // The digest is of the STORED bytes, not of what arrived: a re-encode must
    // change the URL, or a cache somewhere serves the old picture forever.
    expect(stored.sha256.toString('hex')).toBe(logo.sha256);
    expect(stored.bytes.length).toBeLessThanOrEqual(262_144);
  });

  it('falls back to the origin the upload arrived on when the deployment sets neither', async () => {
    const repo = repository();
    const service = new MerchantBrandingLogoService(
      config({}),
      repo as unknown as MerchantBrandingLogoRepository,
    );

    const logo = await service.upload(
      MERCHANT,
      USER,
      { contentType: 'image/png', dataBase64: (await pngBytes(64, 64)).toString('base64') },
      'http://localhost:4013',
    );

    expect(logo.url.startsWith('http://localhost:4013/logos/')).toBe(true);
  });

  it('refuses bytes that are not the type the caller declared', async () => {
    const repo = repository();
    const service = new MerchantBrandingLogoService(
      config({}),
      repo as unknown as MerchantBrandingLogoRepository,
    );
    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ffffff' },
    })
      .jpeg()
      .toBuffer();

    await expect(
      service.upload(
        MERCHANT,
        USER,
        { contentType: 'image/png', dataBase64: jpeg.toString('base64') },
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('refuses an image that is over the cap before it is ever decoded', async () => {
    const repo = repository();
    const service = new MerchantBrandingLogoService(
      config({}),
      repo as unknown as MerchantBrandingLogoRepository,
    );
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(262_144),
    ]);

    await expect(
      service.upload(
        MERCHANT,
        USER,
        { contentType: 'image/png', dataBase64: oversized.toString('base64') },
        null,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('answers a stale content-addressed name with nothing', async () => {
    const repo = repository();
    repo.find.mockResolvedValue({
      merchantId: MERCHANT,
      contentType: 'image/png',
      bytes: Buffer.from('bytes'),
      sha256: Buffer.from('a'.repeat(64), 'hex'),
      width: 10,
      height: 10,
    });
    const service = new MerchantBrandingLogoService(
      config({}),
      repo as unknown as MerchantBrandingLogoRepository,
    );

    await expect(service.asset(MERCHANT, 'a'.repeat(16))).resolves.not.toBeNull();
    // The URL named 16 hex characters of a digest; bytes behind a DIFFERENT name
    // are the previous logo, and that URL is dead on purpose.
    await expect(service.asset(MERCHANT, 'b'.repeat(16))).resolves.toBeNull();
  });
});
