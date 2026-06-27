import { Injectable, Logger } from '@nestjs/common';
import type { ToolContext, ToolDefinitions, ToolResult } from './turn.types';

/**
 * The seam between the turn engine (3b) and the agent tools (3c). The tool loop
 * depends only on this contract: the Anthropic tool definitions it advertises to
 * the model, and an `execute(name, input, ctx)` dispatcher. The real
 * implementation (search_menu / add_to_cart / confirm_order / …) lands in Phase
 * 3c and is bound via `{ provide: ToolsService, useClass: ... }`.
 *
 * Abstract class doubles as the DI token.
 */
@Injectable()
export abstract class ToolsService {
  /** Tool definitions advertised to the model (the frozen `TOOL_DEFINITIONS`). */
  abstract definitions(): ToolDefinitions;
  /** Dispatch a tool call. Never throws — tools return `{ success:false, … }`. */
  abstract execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult>;
}

/**
 * Placeholder until Phase 3c. Advertises NO tools (so the loop runs text-only)
 * and reports any forced/dispatched tool call as unavailable. The loop's safety
 * gates, dedup, budget, and recovery paths are fully exercised against it.
 */
@Injectable()
export class StubToolsService extends ToolsService {
  private readonly logger = new Logger(StubToolsService.name);

  definitions(): ToolDefinitions {
    return [];
  }

  execute(
    name: string,
    _input: Record<string, unknown>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    this.logger.warn(`tool "${name}" called but tools are not implemented yet (Phase 3c)`);
    return Promise.resolve({
      success: false,
      error: 'tool_unavailable',
      error_type: 'not_implemented',
    });
  }
}
