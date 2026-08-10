import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CatalogQuery, type CatalogQuery as CatalogQueryType } from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import type { MerchantAccess } from '../auth/auth.types';
import type { PersistedDashboardAdministrativeCommandContext } from '../administrative-commands/administrative-command-context.service';
import { IntegrityService } from '../integrity/integrity.service';
import { PosCatalogRepository } from './pos-catalog.repository';

@Injectable()
export class PosCatalogService {
  constructor(
    private readonly repo: PosCatalogRepository,
    private readonly integrity: IntegrityService,
  ) {}

  parseQuery(raw: Record<string, string | undefined>): CatalogQueryType {
    const parsed = CatalogQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    return parsed.data;
  }

  async categories(user: AuthUser, merchantId: string, query: CatalogQueryType) {
    await this.authorize(user, merchantId, query.locationId);
    const [items, version] = await Promise.all([
      this.repo.categories(merchantId),
      this.repo.version(merchantId),
    ]);
    return { items, catalogVersion: version.version, updatedAt: version.updatedAt };
  }

  async products(user: AuthUser, merchantId: string, query: CatalogQueryType) {
    await this.authorize(user, merchantId, query.locationId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const rows = await this.repo.products({
      merchantId,
      locationId: query.locationId,
      categoryId: query.categoryId,
      search: query.search,
      barcode: query.barcode,
      afterName: cursor?.name,
      afterId: cursor?.id,
      limit: query.limit + 1,
    });
    const more = rows.length > query.limit;
    const items = rows.slice(0, query.limit);
    const last = more ? items.at(-1) : null;
    const version = await this.repo.version(merchantId);
    return {
      items,
      nextCursor: last ? this.encodeCursor(last.name, last.id) : null,
      catalogVersion: version.version,
      updatedAt: version.updatedAt,
    };
  }

  async detail(user: AuthUser, merchantId: string, productId: string, query: CatalogQueryType) {
    await this.authorize(user, merchantId, query.locationId);
    const item = await this.repo.detail(merchantId, query.locationId, productId);
    if (!item) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return item;
  }

  async executeAdministrative(
    user: AuthUser,
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
    operation: 'catalog.create' | 'catalog.update' | 'catalog.archive',
    parameters: Record<string, unknown>,
  ) {
    const command = await this.integrity.execute(
      {
        merchantId: access.merchantId,
        locationId: context.locationId,
        commandId: context.commandId,
        idempotencyKey: context.idempotencyKey,
        commandType: `dashboard.${operation}`,
        payload: { productId: context.targetAggregateId, parameters },
        expectedVersion: context.targetVersion ?? undefined,
      },
      async (transaction) => {
        const value =
          operation === 'catalog.create'
            ? await this.repo.createAdministrative(
                transaction.client,
                access.merchantId,
                context.targetAggregateId,
                parameters,
              )
            : operation === 'catalog.update'
              ? await this.repo.updateAdministrative(
                  transaction.client,
                  access.merchantId,
                  context.targetAggregateId,
                  requiredVersion(context.targetVersion),
                  parameters,
                )
              : await this.repo.archiveAdministrative(
                  transaction.client,
                  access.merchantId,
                  context.targetAggregateId,
                  requiredVersion(context.targetVersion),
                );
        await transaction.appendAudit({
          eventType: `catalog_${operation.split('.')[1]}`,
          entityType: 'product',
          entityId: context.targetAggregateId,
          outcome: 'success',
          publicData: { actorUserId: user.id },
        });
        return { ok: true, value };
      },
    );
    if (command.status === 'succeeded' && command.result) return command.result;
    throw new ConflictException({
      code: command.failureCode ?? 'CATALOG_COMMAND_FAILED',
      correlationId: command.correlationId,
    });
  }

  async detailAdministrative(
    access: MerchantAccess,
    context: PersistedDashboardAdministrativeCommandContext,
  ) {
    const item = await this.repo.administrativeDetail(access.merchantId, context.targetAggregateId);
    if (!item) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return item;
  }

  private async authorize(user: AuthUser, merchantId: string, locationId: string) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    if (
      !(await this.repo.authorize(user.id, user.sessionId, user.deviceId, merchantId, locationId))
    ) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
  }

  private encodeCursor(name: string, id: string): string {
    return Buffer.from(JSON.stringify({ name, id })).toString('base64url');
  }

  private decodeCursor(cursor: string): { name: string; id: string } {
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
      if (
        !value ||
        typeof value !== 'object' ||
        !('name' in value) ||
        !('id' in value) ||
        typeof value.name !== 'string' ||
        typeof value.id !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(value.id)
      ) {
        throw new Error('invalid');
      }
      return { name: value.name, id: value.id };
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    }
  }
}

function requiredVersion(value: number | null): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new BadRequestException({ code: 'CATALOG_VERSION_REQUIRED' });
  }
  return Number(value);
}
