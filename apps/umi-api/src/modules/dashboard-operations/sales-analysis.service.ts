import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  BASKETS_TOO_COMPLEX_CODE,
  SalesAnalysis,
  SalesAnalysisOptions,
  type SalesAnalysisBasketState,
  type SalesAnalysisGroupWrite,
  type SalesAnalysisQuery,
} from '@umi/contract';
import type { AuthUser, MerchantAccess } from '../auth/auth.types';
import { canSwitchLocations, resolveLocationAuthority } from '../auth/location-authority';
import { hasDashboardPermission } from './dashboard-operations.policy';
import { SalesAnalysisRepository } from './sales-analysis.repository';
import { analyzeSummary, type AnalysisGroup } from './sales-analysis';
import { analyzeBaskets } from './purchase-baskets';
import { analyzeCategorySales } from './category-sales';

@Injectable()
export class SalesAnalysisService {
  constructor(private readonly repository: SalesAnalysisRepository) {}

  async options(user: AuthUser, access: MerchantAccess, requestedLocation?: string) {
    const locationId = this.readScope(access, requestedLocation);
    const context = await this.repository.options(user.id, access.merchantId, locationId);
    return SalesAnalysisOptions.parse({
      timezone: context.timezone,
      today: context.today,
      firstSaleDate: context.firstSaleDate,
      products: context.products.map(({ id, name, categoryId, category }) => ({
        id,
        name,
        categoryId,
        category,
      })),
      groups: context.groups,
      canManageGroups: this.canManageGroups(access),
      canCompareLocations: canSwitchLocations(access) && !access.locationId,
      locations: context.locations,
    });
  }

  async read(user: AuthUser, access: MerchantAccess, query: SalesAnalysisQuery) {
    const locationId = this.readScope(access, query.locationId);
    const { context, sales } = await this.repository.read(
      user.id,
      access.merchantId,
      locationId,
      query,
    );
    const groups = this.analysisGroups(context.products, context.groups);
    for (const key of [query.groupA, query.groupB]) {
      if (key && !groups.some((group) => group.key === key)) {
        throw new UnprocessableEntityException({ code: 'REPORT_GROUP_INVALID' });
      }
    }
    try {
      const summary = analyzeSummary(sales, query);
      let baskets: ReturnType<typeof analyzeBaskets> | null = null;
      let basketState: SalesAnalysisBasketState = { state: 'complete', code: null };
      try {
        baskets = analyzeBaskets(sales, query, groups);
      } catch (error) {
        if (error instanceof RangeError && error.message === BASKETS_TOO_COMPLEX_CODE) {
          basketState = { state: 'unavailable', code: BASKETS_TOO_COMPLEX_CODE };
        } else {
          throw error;
        }
      }
      return SalesAnalysis.parse({
        merchantId: access.merchantId,
        locationId,
        from: query.from,
        to: query.to,
        timezone: context.timezone,
        currency: context.currency,
        refundView: query.refundView,
        basketUnit: query.basketUnit,
        capturedAt: context.capturedAt,
        firstSaleDate: context.firstSaleDate,
        ...summary,
        ...(baskets ?? {}),
        basketState,
        byCategory: analyzeCategorySales(sales, query, context.products),
      });
    } catch (error) {
      if (error instanceof RangeError)
        throw new UnprocessableEntityException({ code: error.message });
      throw error;
    }
  }

  saveGroup(user: AuthUser, access: MerchantAccess, id: string, input: SalesAnalysisGroupWrite) {
    this.requireGroupManagement(access);
    return this.repository.saveGroup(user.id, access.merchantId, id, input);
  }

  deleteGroup(user: AuthUser, access: MerchantAccess, id: string, version: number) {
    this.requireGroupManagement(access);
    return this.repository.deleteGroup(user.id, access.merchantId, id, version);
  }

  private readScope(access: MerchantAccess, requested?: string) {
    if (!hasDashboardPermission(access.permissions, ['sale.lifecycle'])) {
      throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
    }
    return resolveLocationAuthority(access, requested);
  }

  private canManageGroups(access: MerchantAccess) {
    return (
      !access.locationId &&
      hasDashboardPermission(access.permissions, ['sale.lifecycle']) &&
      hasDashboardPermission(access.permissions, ['merchant.manage'])
    );
  }

  private requireGroupManagement(access: MerchantAccess) {
    if (!this.canManageGroups(access)) throw new ForbiddenException({ code: 'PERMISSION_DENIED' });
  }

  private analysisGroups(
    products: { id: string; categoryId: string | null; category: string | null }[],
    saved: { id: string; name: string; productIds: string[] }[],
  ): AnalysisGroup[] {
    const categories = new Map<string, AnalysisGroup>();
    for (const product of products) {
      if (!product.categoryId) continue;
      const key = `category:${product.categoryId}`;
      const category = categories.get(key) ?? {
        key,
        name: product.category ?? key,
        productIds: [],
      };
      category.productIds.push(product.id);
      categories.set(key, category);
    }
    return [
      ...categories.values(),
      ...saved.map((group) => ({ ...group, key: `group:${group.id}` })),
    ];
  }
}
