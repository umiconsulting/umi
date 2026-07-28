import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CatalogQuery, type CatalogQuery as CatalogQueryType } from '@umi/contract';
import type { AuthUser } from '../auth/auth.types';
import { PosCatalogRepository } from './pos-catalog.repository';

@Injectable()
export class PosCatalogService {
  constructor(private readonly repo: PosCatalogRepository) {}

  parseQuery(raw: Record<string, string | undefined>): CatalogQueryType {
    const parsed = CatalogQuery.safeParse(raw);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_FAILED' });
    return parsed.data;
  }

  async categories(user: AuthUser, tenantId: string, query: CatalogQueryType) {
    await this.authorize(user, tenantId, query.branchId);
    const [items, version] = await Promise.all([
      this.repo.categories(tenantId),
      this.repo.version(tenantId),
    ]);
    return { items, catalogVersion: version.version, updatedAt: version.updatedAt };
  }

  async products(user: AuthUser, tenantId: string, query: CatalogQueryType) {
    await this.authorize(user, tenantId, query.branchId);
    const cursor = query.cursor ? this.decodeCursor(query.cursor) : null;
    const rows = await this.repo.products({
      tenantId,
      branchId: query.branchId,
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
    const version = await this.repo.version(tenantId);
    return {
      items,
      nextCursor: last ? this.encodeCursor(last.name, last.id) : null,
      catalogVersion: version.version,
      updatedAt: version.updatedAt,
    };
  }

  async detail(user: AuthUser, tenantId: string, productId: string, query: CatalogQueryType) {
    await this.authorize(user, tenantId, query.branchId);
    const item = await this.repo.detail(tenantId, query.branchId, productId);
    if (!item) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return item;
  }

  private async authorize(user: AuthUser, tenantId: string, branchId: string) {
    if (!user.deviceId) throw new UnauthorizedException({ code: 'DEVICE_NOT_ENROLLED' });
    if (!(await this.repo.authorize(user.id, user.sessionId, user.deviceId, tenantId, branchId))) {
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
