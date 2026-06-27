import { Injectable, Logger } from '@nestjs/common';
import { ProductsRepository } from '../products.repository';
import { ConversationsRepository } from '../conversations.repository';
import { validateCartItems } from '../security.service';
import type { DraftCart } from '../conversation.types';
import type { ToolContext, ToolResult } from '../turn.types';
import {
  buildDraftCart,
  buildStrippedSearchQuery,
  cartItemLabel,
  cartItemMatchesQuery,
  chooseBestProductMatch,
  chooseVariantByQuery,
  editDraftCartItems,
  filtersFromVariantName,
  formatCartSummary,
  inferVariantFiltersFromText,
  resolveVariant,
  summarizeAmbiguousProducts,
  toNumber,
} from './product-search';
import { needsInputToolError, retryableToolError, terminalToolError } from './tool-errors';

/**
 * Cart tools: add_to_cart + edit_cart. Ported from `tools.ts`; product reads
 * rebound to ProductsRepository, draft cart to ConversationsRepository
 * (`comms.conversations.draft_cart` + CAS on `draft_cart_version`). The legacy
 * partial-order seed (kds.tickets) is deferred to Phase 4 → no seed here.
 * Money is PESOS (tool unit).
 */
@Injectable()
export class CartTools {
  private readonly logger = new Logger(CartTools.name);

  constructor(
    private readonly products: ProductsRepository,
    private readonly conversations: ConversationsRepository,
  ) {}

  /** Read + validate the draft cart (empty cart on invalid blob). */
  private async readDraftCart(
    conversationId: string,
  ): Promise<{ cart: DraftCart | null; version: number }> {
    const conv = await this.conversations.loadById(conversationId);
    const cart = (conv?.draftCart as DraftCart | null) ?? null;
    const version = conv?.draftCartVersion ?? 0;
    if (!validateCartItems(cart).valid) {
      return { cart: { items: [], updated_at: new Date().toISOString() }, version };
    }
    return { cart, version };
  }

  /** CAS write (returns true if this writer won the version race). */
  private async writeDraftCart(
    conversationId: string,
    cart: DraftCart | null,
    expectedVersion: number,
  ): Promise<boolean> {
    const next = await this.conversations.updateDraftCartCas(conversationId, expectedVersion, cart);
    return next !== null;
  }

  async addToCart(
    ctx: ToolContext,
    input: {
      query: string;
      quantity?: number;
      size?: string;
      temp?: string;
      milk?: string;
      replace_cart?: boolean;
      customer_note?: string;
    },
  ): Promise<ToolResult> {
    // Reject non-integer quantities rather than silently truncating 1.5 → 1.
    if (input.quantity !== undefined && (!Number.isInteger(input.quantity) || input.quantity < 1)) {
      return needsInputToolError('Indica la cantidad en números enteros (por ejemplo, 2).');
    }
    const quantity = Math.max(1, Math.min(input.quantity ?? 1, 20));
    const variantFilters = inferVariantFiltersFromText(input.query, {
      size: input.size,
      temp: input.temp,
      milk: input.milk,
    });
    const searchResults = await this.products.searchByQuery(ctx.tenantId, input.query, 10);
    let products = chooseBestProductMatch(searchResults, input.query);
    let effectiveQuery = input.query;

    if (!products.length && (variantFilters.size || variantFilters.temp || variantFilters.milk)) {
      const strippedQuery = buildStrippedSearchQuery(
        input.query,
        variantFilters.size,
        variantFilters.temp,
        variantFilters.milk,
      );
      if (strippedQuery) {
        const strippedResults = await this.products.searchByQuery(ctx.tenantId, strippedQuery, 10);
        const strippedProducts = chooseBestProductMatch(strippedResults, strippedQuery);
        if (strippedProducts.length) {
          products = strippedProducts;
          effectiveQuery = strippedQuery;
        }
      }
    }

    if (!products.length) {
      const suggestions = await this.products.categorySuggestions(ctx.tenantId);
      return {
        ...retryableToolError(
          `No encontré "${effectiveQuery}" en el menú.`,
          { tool: 'search_menu', input: { query: effectiveQuery } },
          'Prueba con otro nombre de producto o una categoría.',
        ),
        suggestions,
      };
    }

    if (products.length > 1) {
      return {
        ...needsInputToolError(summarizeAmbiguousProducts(products)),
        needs_clarification: summarizeAmbiguousProducts(products),
      };
    }

    const product = products[0];
    const variantByName = chooseVariantByQuery(product.variants ?? [], input.query, product.name);
    const resolvedVariant = variantByName
      ? { success: true as const, variant: variantByName, unitPrice: toNumber(variantByName.price) }
      : resolveVariant(product, variantFilters);

    if (!resolvedVariant.success) {
      return {
        ...needsInputToolError(
          resolvedVariant.needs_clarification ??
            'Necesito más detalle para encontrar la variante correcta.',
        ),
        needs_clarification: resolvedVariant.needs_clarification,
      };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const { cart: storedCart, version } = await this.readDraftCart(ctx.conversationId);
      const seedCart = storedCart; // partial-order seed = Phase 4 (KDS)
      const items = input.replace_cart ? [] : [...(seedCart?.items ?? [])];
      const variantName = resolvedVariant.variant?.name ?? null;
      const existingIndex = items.findIndex(
        (item) => item.product_id === product.id && item.variant_name === variantName,
      );
      if (existingIndex >= 0) {
        items[existingIndex] = {
          ...items[existingIndex],
          quantity: items[existingIndex].quantity + quantity,
          unit_price: resolvedVariant.unitPrice,
        };
      } else {
        items.push({
          product_id: product.id,
          product_name: product.name,
          variant_name: variantName,
          quantity,
          unit_price: resolvedVariant.unitPrice,
        });
      }
      const cart = buildDraftCart(items, input.customer_note ?? seedCart?.customer_note ?? null);
      const wrote = await this.writeDraftCart(ctx.conversationId, cart, version);
      if (!wrote) continue;
      return {
        success: true,
        summary_text: formatCartSummary(cart),
        customer_reply: formatCartSummary(cart),
        total: items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0),
        item_count: items.reduce((sum, item) => sum + item.quantity, 0),
        cart_version: version + 1,
      };
    }
    return retryableToolError('No pude actualizar el carrito en este momento. Intenta de nuevo.');
  }

  async editCart(
    ctx: ToolContext,
    input: {
      action?: string;
      remove_query?: string;
      keep_query?: string;
      target_query?: string;
      size?: string;
      temp?: string;
      milk?: string;
    },
  ): Promise<ToolResult> {
    if (!input.action && !input.remove_query && !input.keep_query && !input.target_query) {
      return needsInputToolError('¿Qué producto quieres quitar o dejar en el carrito?');
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const { cart: storedCart, version } = await this.readDraftCart(ctx.conversationId);
      const cart = storedCart ?? buildDraftCart([]);
      if (cart.items.length === 0) {
        return terminalToolError('No hay productos en el carrito para editar.');
      }

      if (input.action === 'clear') {
        const wrote = await this.writeDraftCart(ctx.conversationId, null, version);
        if (!wrote) continue;
        return {
          success: true,
          cart_empty: true,
          removed_count: cart.items.length,
          item_count: 0,
          customer_reply: 'Listo, dejé tu carrito vacío. ¿Qué te gustaría pedir?',
        };
      }

      if (input.action === 'update_options') {
        const targetQuery = input.target_query || input.remove_query || input.keep_query || '';
        const matches = targetQuery
          ? cart.items.filter((item) => cartItemMatchesQuery(item, targetQuery))
          : cart.items.length === 1
            ? cart.items
            : [];
        if (matches.length === 0) {
          return needsInputToolError(
            `No encontré "${targetQuery || 'ese producto'}" en el carrito. Tienes: ${cart.items
              .map(cartItemLabel)
              .join(', ')}.`,
          );
        }
        if (matches.length > 1) {
          return needsInputToolError(
            `Tengo más de una línea que coincide con "${targetQuery}". ¿Cuál quieres cambiar? ${matches
              .map(cartItemLabel)
              .join(', ')}.`,
          );
        }
        const target = matches[0];
        const product = await this.products.getById(ctx.tenantId, target.product_id);
        if (!product || product.available === false) {
          return retryableToolError(`El producto ${target.product_name} ya no está disponible.`, {
            tool: 'search_menu',
            input: { query: target.product_name },
          });
        }
        const existingFilters = filtersFromVariantName(target.variant_name);
        const resolvedVariant = resolveVariant(product, {
          size: input.size ?? existingFilters.size,
          temp: input.temp ?? existingFilters.temp,
          milk: input.milk ?? existingFilters.milk,
        });
        if (!resolvedVariant.success) {
          return {
            ...needsInputToolError(
              resolvedVariant.needs_clarification ?? 'Necesito más detalle para cambiar esa opción.',
            ),
            needs_clarification: resolvedVariant.needs_clarification,
          };
        }
        const nextVariantName = resolvedVariant.variant?.name ?? null;
        const items = cart.items.map((item) =>
          item === target
            ? { ...item, variant_name: nextVariantName, unit_price: resolvedVariant.unitPrice }
            : item,
        );
        const nextCart = buildDraftCart(items, cart.customer_note ?? null);
        const wrote = await this.writeDraftCart(ctx.conversationId, nextCart, version);
        if (!wrote) continue;
        return {
          success: true,
          cart_empty: false,
          removed_count: 0,
          summary_text: formatCartSummary(nextCart),
          customer_reply: formatCartSummary(nextCart),
          item_count: nextCart.items.reduce((sum, item) => sum + item.quantity, 0),
        };
      }

      const edit = editDraftCartItems(cart, input);
      if (edit.notFound) {
        return needsInputToolError(
          `No encontré "${edit.notFound}" en el carrito. Tienes: ${cart.items
            .map(cartItemLabel)
            .join(', ')}.`,
        );
      }
      const nextCart = edit.cart.items.length > 0 ? edit.cart : null;
      const wrote = await this.writeDraftCart(ctx.conversationId, nextCart, version);
      if (!wrote) continue;

      const removedText =
        edit.removed.length > 0 ? `Quité ${edit.removed.map(cartItemLabel).join(', ')}. ` : '';
      if (edit.keptMissing) {
        const reply = `${removedText}Para dejar sólo ${edit.keptMissing}, dime cuál presentación o variante quieres.`;
        return {
          success: true,
          cart_empty: edit.cart.items.length === 0,
          removed_count: edit.removed.length,
          item_count: edit.cart.items.reduce((sum, item) => sum + item.quantity, 0),
          needs_clarification: reply,
          customer_reply: reply,
        };
      }
      if (edit.cart.items.length === 0) {
        return {
          success: true,
          cart_empty: true,
          removed_count: edit.removed.length,
          item_count: 0,
          customer_reply: `${removedText}Tu carrito quedó vacío.`,
        };
      }
      return {
        success: true,
        cart_empty: false,
        removed_count: edit.removed.length,
        summary_text: `${removedText}${formatCartSummary(edit.cart)}`,
        customer_reply: `${removedText}${formatCartSummary(edit.cart)}`,
        item_count: edit.cart.items.reduce((sum, item) => sum + item.quantity, 0),
      };
    }
    return retryableToolError('No pude actualizar el carrito en este momento. Intenta de nuevo.');
  }
}
