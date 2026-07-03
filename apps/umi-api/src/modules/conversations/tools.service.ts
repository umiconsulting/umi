import { Injectable } from '@nestjs/common';
import { ToolsService } from './tools.contract';
import { sanitizeInput } from './security.service';
import type { ToolContext, ToolDefinitions, ToolResult } from './turn.types';
import { TOOL_DEFINITIONS } from './tools/tool-definitions';
import { CatalogTools } from './tools/catalog.tools';
import { CartTools } from './tools/cart.tools';
import { CheckoutTools } from './tools/checkout.tools';
import { CustomerTools } from './tools/customer.tools';
import { BranchTools } from './tools/branch.tools';
import { terminalToolError } from './tools/tool-errors';

/**
 * The real agent-tools implementation (Phase 3c) — replaces StubToolsService.
 * Advertises the frozen TOOL_DEFINITIONS and dispatches `execute(name,input,ctx)`
 * to the per-concern tool classes, mirroring the legacy `executeTool` (incl.
 * input sanitization at the boundary).
 */
@Injectable()
export class RealToolsService extends ToolsService {
  constructor(
    private readonly catalog: CatalogTools,
    private readonly cart: CartTools,
    private readonly checkout: CheckoutTools,
    private readonly customer: CustomerTools,
    private readonly branch: BranchTools,
  ) {
    super();
  }

  definitions(): ToolDefinitions {
    return TOOL_DEFINITIONS;
  }

  execute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const str = (v: unknown): string => sanitizeInput(typeof v === 'string' ? v : '');
    switch (name) {
      case 'set_branch':
        return this.branch.setBranch(ctx, { branch: str(input.branch) });
      case 'get_business_info':
        return this.catalog.getBusinessInfo(ctx);
      case 'get_business_hours':
        return this.catalog.getBusinessHours(ctx);
      case 'search_menu':
      case 'search_products':
        return this.catalog.searchMenu(ctx, {
          query: str(input.query),
          size: input.size as string | undefined,
          temp: input.temp as string | undefined,
          milk: input.milk as string | undefined,
        });
      case 'add_to_cart':
        return this.cart.addToCart(ctx, {
          query: str(input.query),
          quantity: input.quantity as number | undefined,
          size: input.size as string | undefined,
          temp: input.temp as string | undefined,
          milk: input.milk as string | undefined,
          replace_cart: input.replace_cart as boolean | undefined,
          customer_note: input.customer_note as string | undefined,
        });
      case 'edit_cart':
        return this.cart.editCart(ctx, {
          action: str(input.action),
          remove_query: str(input.remove_query),
          keep_query: str(input.keep_query),
          target_query: str(input.target_query),
          size: input.size as string | undefined,
          temp: input.temp as string | undefined,
          milk: input.milk as string | undefined,
        });
      case 'confirm_order':
        return this.checkout.confirmOrder(ctx, {
          pickup_person: input.pickup_person as string | undefined,
          personal_message: input.personal_message as string | undefined,
          customer_note: input.customer_note as string | undefined,
        });
      case 'confirm_order_changes':
        return this.checkout.confirmOrderChanges();
      case 'cancel_order':
        return this.checkout.cancelOrder(ctx, str(input.reason));
      case 'get_recent_customer_orders':
        return this.customer.getRecentCustomerOrders(ctx, input.limit as number | undefined);
      case 'reorder_last_order':
        return this.checkout.reorderLastOrder(ctx, {
          customer_note: input.customer_note as string | undefined,
        });
      default:
        return Promise.resolve(terminalToolError(`Unknown tool: ${name}`));
    }
  }
}
