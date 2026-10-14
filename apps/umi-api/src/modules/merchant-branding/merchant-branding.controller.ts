import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MerchantBrandingLogoUpload, type MerchantBrandingLogo } from '@umi/contract';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { RequirePermission } from '../auth/roles.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { MerchantBrandingLogoService } from './merchant-branding.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `{merchantId}-{16 hex}.png|jpg` — the shape `MerchantBrandingLogoService` mints. */
const ASSET_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{16})\.(png|jpe?g)$/i;

/**
 * The café's logo: the dashboard puts one there, and everyone else reads it.
 *
 * Two controllers, because they are two different publics. The upload is the
 * dashboard's own write — same guard chain as every other merchant-settings write.
 * The asset is PUBLIC and unauthenticated on purpose: the Apple and Google pass
 * builders fetch it over a plain `fetch` with no cookies (`loadAsset` in
 * stamp-strip.ts), the POS draws it, and a logo is by definition a public thing.
 */
@UseGuards(AuthGuard)
@Controller('api')
export class MerchantBrandingLogoController {
  constructor(private readonly branding: MerchantBrandingLogoService) {}

  @Put('merchants/:merchantId/branding/logo')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  async upload(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MerchantBrandingLogoUpload))
    body: MerchantBrandingLogoUpload,
    @Req() request: FastifyRequest,
  ): Promise<MerchantBrandingLogo> {
    return this.branding.upload(merchant.merchantId, user.id, body, requestOrigin(request));
  }

  @Delete('merchants/:merchantId/branding/logo')
  @UseGuards(MerchantAccessGuard, EntitlementGuard, RolesGuard)
  @RequireProduct('dashboard')
  @RequirePermission('merchant.manage')
  async clear(
    @Merchant() merchant: MerchantAccess,
    @CurrentUser() user: AuthUser,
  ): Promise<{ ok: true }> {
    await this.branding.clear(merchant.merchantId, user.id);
    return { ok: true };
  }
}

/**
 * `/logos/:asset` — the bytes, with the caching headers an immutable,
 * content-addressed image deserves. No guards: this is the route the wallet
 * builders and the till read.
 *
 * The merchant id travels INSIDE the asset name, so the read opens the same
 * RLS-scoped transaction the upload wrote under instead of asking for a bypass.
 * A name that is not one of ours, or one whose digest no longer matches the stored
 * bytes, is a 404 — the caller asked for an image, so the answer is "that image is
 * not here", in the only language a browser or an image loader understands.
 */
@Controller('logos')
export class MerchantBrandingLogoAssetController {
  constructor(private readonly branding: MerchantBrandingLogoService) {}

  @Get(':asset')
  async asset(@Param('asset') asset: string, @Res() reply: FastifyReply): Promise<void> {
    const match = ASSET_RE.exec(asset);
    if (!match || !UUID_RE.test(match[1])) throw new NotFoundException();

    const logo = await this.branding.asset(match[1], match[2].toLowerCase());
    if (!logo) throw new NotFoundException();

    reply
      .header('Content-Type', logo.contentType)
      // The bytes behind this name can never change: a new upload is a new name.
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('ETag', `"${logo.sha256.toString('hex')}"`)
      .header('Content-Length', String(logo.bytes.length))
      .send(logo.bytes);
  }
}

/**
 * The origin the upload arrived on, or null when there is nothing usable. Behind
 * Caddy the forwarded headers are the truth; directly on :4013 the Host header is.
 */
function requestOrigin(request: FastifyRequest): string | null {
  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  if (!host) return null;
  const raw = Array.isArray(host) ? host[0] : host;
  const forwardedProto = request.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) ?? 'http';
  return `${proto}://${raw}`;
}
