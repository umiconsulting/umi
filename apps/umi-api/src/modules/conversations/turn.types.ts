import type Anthropic from '@anthropic-ai/sdk';

/**
 * Shared types for the turn engine (mini-harness). Ported from the
 * conversaflow turn processors + tool loop.
 */

/** Per-turn context handed to every tool. Canonical ids (tenant/person). */
export interface ToolContext {
  tenantId: string;
  personId: string;
  conversationId: string;
  /** The turn id — used as the deterministic checkout idempotency key (3c). */
  turnId?: string;
  locationId?: string | null;
  requestId?: string;
  customerPhone?: string;
}

/** Loose tool result — tools return ad-hoc shapes; known keys are typed. */
export interface ToolResult {
  success?: boolean;
  needs_clarification?: string;
  error?: string;
  error_type?: string;
  found?: number;
  cart_empty?: boolean;
  [key: string]: unknown;
}

/** Anthropic tool definitions array (the frozen `TOOL_DEFINITIONS`). */
export type ToolDefinitions = Anthropic.MessageCreateParams['tools'];

export interface ToolChainEntry {
  name: string;
  input: Record<string, unknown>;
  success: boolean;
  error_type?: string;
  needs_clarification?: string | null;
  error_msg?: string | null;
  data_summary?: Record<string, unknown> | null;
}

export interface MiniHarnessToolLoopResult {
  finalText: string;
  inputTokens: number;
  outputTokens: number;
  llmCallCount: number;
  toolCallCount: number;
  toolResultBytes: number;
  toolChain: ToolChainEntry[];
  pendingClarification: Record<string, unknown> | null;
  stopReason: string;
}

/** A trailing user-run message (turn integrity input). */
export interface MessageRunItem {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface TurnIntegrityDecision {
  decision: 'hold' | 'merge' | 'clarify' | 'replace' | 'cancel' | 'release';
  reason: string;
  holdUntil: string | null;
  mergedText: string;
  sourceMessageIds: string[];
  firstMessageAt: string;
  lastMessageAt: string;
}
