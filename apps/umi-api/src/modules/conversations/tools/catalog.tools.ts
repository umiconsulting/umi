import { Injectable } from '@nestjs/common';
import { ProductsRepository } from '../products.repository';
import { BusinessHoursService } from '../business-hours.service';
import type { ToolContext, ToolResult } from '../turn.types';
import {
  formatProductDisplay,
  getRepresentativeVariants,
  priceRangeForProduct,
  resolveBrowseIntent,
  toNumber,
  type ProductRecord,
} from './product-search';

/**
 * Catalog tools: search_menu (browse / exact / near-miss) + get_business_info /
 * get_business_hours. Ported from `tools.ts`; product reads rebound to
 * ProductsRepository (tenant.product), hours/info to BusinessHoursService.
 */
@Injectable()
export class CatalogTools {
  constructor(
    private readonly products: ProductsRepository,
    private readonly hours: BusinessHoursService,
  ) {}

  async getBusinessInfo(ctx: ToolContext): Promise<ToolResult> {
    const info = await this.hours.getBusinessInfo(ctx.tenantId, ctx.locationId ?? null);
    return {
      ...info,
      message: `Dirección: ${info.address ?? 'consulta directamente con el local'}. Métodos de pago: ${
        info.paymentMethods.length > 0 ? info.paymentMethods.join(', ') : 'no especificados'
      }.`,
    };
  }

  async getBusinessHours(ctx: ToolContext): Promise<ToolResult> {
    return this.hours.getBusinessHours(
      ctx.tenantId,
      ctx.locationId ?? null,
      new Date(),
      ctx.customerPhone,
    ) as unknown as ToolResult;
  }

  async searchMenu(
    ctx: ToolContext,
    input: { query: string; size?: string; temp?: string; milk?: string },
  ): Promise<ToolResult> {
    const browseIntent = resolveBrowseIntent(input.query);

    if (browseIntent.isBrowse) {
      const rows = await this.products.browse(ctx.tenantId, browseIntent.categoryFilter ?? null);

      const byCategory = new Map<string, ProductRecord[]>();
      for (const product of rows) {
        const category = product.category || 'Sin categoría';
        const bucket = byCategory.get(category) ?? [];
        bucket.push(product);
        byCategory.set(category, bucket);
      }
      const categories = [...byCategory.entries()].map(([category, items]) => ({
        category,
        examples: items.slice(0, 4).map((product) => product.name),
        count: items.length,
      }));
      const flatProducts = rows.map((product) => ({
        product_id: product.id,
        name: product.name,
        category: product.category ?? 'Sin categoría',
        display_text: formatProductDisplay(product, input.size, input.temp, input.milk),
        price_range: priceRangeForProduct(product),
        representative_variants: getRepresentativeVariants(product.variants ?? []).map((v) => ({
          name: v.name,
          price: toNumber(v.price),
        })),
      }));

      return {
        found: flatProducts.length,
        match_type: 'browse',
        category_filter: browseIntent.categoryFilter ?? null,
        categories,
        products: flatProducts.slice(0, 15),
        message: categories.length
          ? categories.map((c) => `${c.category}: ${c.examples.join(', ')}`).join('; ')
          : 'Sin productos disponibles en esa categoría.',
      };
    }

    const products = await this.products.searchByQuery(ctx.tenantId, input.query, 5);

    if (!products.length) {
      const [candidates, suggestions] = await Promise.all([
        this.products.findNearestCandidates(ctx.tenantId, input.query, 6),
        this.products.categorySuggestions(ctx.tenantId),
      ]);
      const formattedCandidates = candidates.map((product) => ({
        product_id: product.id,
        name: product.name,
        category: product.category ?? 'Sin categoría',
        display_text: formatProductDisplay(product, input.size, input.temp, input.milk),
        price_range: priceRangeForProduct(product),
      }));
      const messageParts = [`Sin match exacto para "${input.query}".`];
      if (formattedCandidates.length) {
        messageParts.push(
          `Opciones cercanas: ${formattedCandidates
            .slice(0, 5)
            .map((p) => `${p.name} (${p.category})`)
            .join(', ')}.`,
        );
      } else if (suggestions.length) {
        messageParts.push(`Categorías con inventario: ${suggestions.join(', ')}.`);
      }
      return {
        found: 0,
        match_type: formattedCandidates.length ? 'near' : 'none',
        products: [],
        candidates: formattedCandidates,
        suggestions,
        message: messageParts.join(' '),
      };
    }

    const formattedProducts = products.map((product) => ({
      product_id: product.id,
      name: product.name,
      category: product.category ?? 'Sin categoría',
      display_text: formatProductDisplay(product, input.size, input.temp, input.milk),
      price_range: priceRangeForProduct(product),
      representative_variants: getRepresentativeVariants(product.variants ?? []).map((v) => ({
        name: v.name,
        price: toNumber(v.price),
      })),
    }));

    return {
      found: formattedProducts.length,
      match_type: 'exact',
      products: formattedProducts,
      message: formattedProducts.map((product) => product.display_text).join('\n\n'),
    };
  }
}
