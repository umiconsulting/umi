import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { hasDashboardPermission } from '../dashboard-operations/dashboard-operations.policy';
import { DashboardCatalogRepository } from './dashboard-catalog.repository';

@Injectable()
export class DashboardCatalogService {
  constructor(private readonly repo: DashboardCatalogRepository) {}

  async listCategories(access: MerchantAccess) {
    this.authorize(access, ['catalog.read', 'catalog.manage']);
    return { items: await this.repo.listCategories(access.merchantId) };
  }

  async createCategory(user: AuthUser, access: MerchantAccess, input: { name: string }) {
    this.authorize(access, ['catalog.manage']);
    const created = await this.repo.createCategory(access.merchantId, user.id, input);
    if (!created) throw new ConflictException({ code: 'CATEGORY_NAME_TAKEN' });
    return created;
  }

  async updateCategory(
    user: AuthUser,
    access: MerchantAccess,
    categoryId: string,
    input: { name?: string; color?: string },
  ) {
    this.authorize(access, ['catalog.manage']);
    const updated = await this.repo.updateCategory(access.merchantId, user.id, categoryId, input);
    if (!updated) throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND' });
    return updated;
  }

  private authorize(access: MerchantAccess, required: string[]) {
    if (!hasDashboardPermission(access.permissions, required)) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
  }
}
