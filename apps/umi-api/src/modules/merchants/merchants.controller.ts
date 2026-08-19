import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MerchantAccessGuard } from '../auth/merchant-access.guard';
import { EntitlementGuard } from '../auth/entitlement.guard';
import { RequireProduct } from '../auth/require-product.decorator';
import { CurrentUser, Merchant } from '../auth/current-user.decorator';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import type { MeMerchantsResponse } from '@umi/contract';
import { MerchantsService } from './merchants.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { CreateLocationDto } from './dto/create-location.dto';
import { GeocodeAdapter } from '../../shared/adapters/geocode.adapter';
import { ProvisionMerchantDto } from './dto/provision-merchant.dto';
import { PlatformAdminGuard } from '../auth/platform-admin.guard';
import { MissingRoleCatalogError, UnknownPlanError } from './merchants.repository';

/**
 * Merchant shell routes. All require a valid session (AuthGuard); the
 * `/merchants/:merchantId/*` routes additionally resolve + authorize membership
 * (MerchantAccessGuard) and gate on the `dashboard` entitlement.
 */
@UseGuards(AuthGuard)
@Controller('api')
export class MerchantsController {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly geocoder: GeocodeAdapter,
  ) {}

  @Get('me/merchants')
  async myMerchants(@CurrentUser() user: AuthUser): Promise<MeMerchantsResponse> {
    return { merchants: await this.merchants.listUserMerchants(user.id) };
  }

  /**
   * Open a café. Platform administrators only — see `PlatformAdminGuard`.
   *
   * Replaces umi-cash `POST /api/umi/tenants` and the `/umi/admin` panel around
   * it (AB#108, AB#112). The panel's own login goes with it: this route reuses
   * the existing superadmin session, so `UMI_ADMIN_PASSWORD` and
   * `UMI_ADMIN_JWT_SECRET` have nothing left to protect.
   */
  @Post('merchants')
  @HttpCode(201)
  @UseGuards(PlatformAdminGuard)
  async provision(@Body() dto: ProvisionMerchantDto) {
    try {
      return await this.merchants.provision(dto);
    } catch (err) {
      // ⚠️ EVERY ONE OF THESE CARRIES A `message`, and it is not decoration. The
      // filter wraps a thrown payload as `{ statusCode, error: <payload> }`, and
      // the dashboard's `errMessage()` reads `error.message` — so a payload with
      // only a machine code renders as the fallback, which is the literal string
      // "409 /api/merchants". A café owner would have read that.
      //
      // The code stays for the client to branch on; the message is what a person
      // sees when nothing branches.
      //
      // A duplicate admin address is the one collision a caller can fix, and the
      // only unique constraint this route can trip. `umi.user.email` is UNIQUE.
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException({
          error: 'email_taken',
          message: 'Ya existe una cuenta con ese correo.',
          email: dto.adminEmail,
        });
      }
      if (err instanceof UnknownPlanError) {
        throw new BadRequestException({
          error: 'unknown_plan',
          message: `El plan '${dto.plan}' no existe.`,
          plan: dto.plan,
        });
      }
      if (err instanceof MissingRoleCatalogError) {
        throw new BadRequestException({
          error: 'role_catalog_missing',
          message: 'La plataforma no tiene catálogo de roles. Ejecuta seed_rbac.sql.',
        });
      }
      throw err;
    }
  }

  @Get('merchants/:merchantId/capabilities')
  @UseGuards(MerchantAccessGuard)
  async capabilities(
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    return this.merchants.buildCapabilities(merchant, locationId ?? null);
  }

  @Get('merchants/:merchantId/settings')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getSettings(
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const caps = await this.merchants.buildCapabilities(merchant, locationId ?? null);
    return this.merchants.buildSettings(caps);
  }

  @Patch('merchants/:merchantId/settings')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async updateSettings(@Merchant() merchant: MerchantAccess, @Body() dto: UpdateSettingsDto) {
    await this.merchants.updateSettings(merchant.merchantId, dto);
    return { ok: true };
  }

  @Get('merchants/:merchantId/locations')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getLocations(
    @Merchant() merchant: MerchantAccess,
    @Query('locationId') locationId?: string,
  ) {
    const caps = await this.merchants.buildCapabilities(merchant, locationId ?? null);
    return { locations: caps.locations };
  }

  @Get('merchants/:merchantId/locations/profiles')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async getLocationProfiles(@Merchant() merchant: MerchantAccess) {
    return { locations: await this.merchants.listLocationProfiles(merchant.merchantId) };
  }

  /**
   * Open a branch. Same guards as every other location write on this controller —
   * membership plus the dashboard product — because a branch is the café's own data
   * and the screen that edits it is the café's own settings screen.
   */
  @Post('merchants/:merchantId/locations')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async createLocation(@Merchant() merchant: MerchantAccess, @Body() dto: CreateLocationDto) {
    const location = await this.merchants.createLocation(merchant.merchantId, dto);
    return { location };
  }

  /**
   * Address → coordinates, for the branch editor's "find it" button.
   *
   * NOT merchant-scoped and deliberately so: it reads nothing and writes nothing,
   * so there is no café to scope it to. `AuthGuard` at the class level is the whole
   * gate — a signed-in operator may look up an address. It is not a search over our
   * data; it is a proxy to a public gazetteer, and the proxy exists only so the
   * browser is not the one identifying itself to Nominatim.
   *
   * 200 with `{location: null}` when nothing matched. A 404 would say "this endpoint
   * is not here", which is a different and less useful thing to tell an operator
   * mid-form.
   */
  @Get('geocode')
  async geocode(@Query('address') address?: string) {
    if (!address || address.trim().length < 3) {
      throw new BadRequestException({
        error: 'address_too_short',
        message: 'Escribe una dirección de al menos 3 caracteres.',
      });
    }
    return { location: await this.geocoder.lookup(address) };
  }

  @Patch('merchants/:merchantId/locations/:locationId')
  @UseGuards(MerchantAccessGuard, EntitlementGuard)
  @RequireProduct('dashboard')
  async updateLocation(
    @Merchant() merchant: MerchantAccess,
    @Param('locationId') locationId: string,
    @Body() dto: UpdateLocationDto,
  ) {
    const location = await this.merchants.updateLocation(merchant.merchantId, locationId, dto);
    return { location };
  }
}
