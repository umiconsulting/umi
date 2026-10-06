import type { SemanticResult, WorkingMemory } from './memory.service';

/**
 * Shapes working memory for the turn + emits observability metadata. Verbatim
 * port of `processors/turn-memory.ts`.
 */

export const DEFAULT_MAX_RECENT_MESSAGES = 8;
export const DEFAULT_MAX_RETRIEVED_MEMORIES = 5;

export interface TurnMemoryMetadata {
  recent_count: number;
  summary_present: boolean;
  facts_present: boolean;
  fact_fields: string[];
  semantic_count: number;
  semantic_source_scope: 'customer' | 'conversation' | null;
  top_similarity: number | null;
  omitted_reasons: string[];
  guardrail: 'memory_is_context_not_operational_truth';
}

function presentFactFields(facts: WorkingMemory['facts']): string[] {
  if (!facts) return [];
  const fields: string[] = [];
  if (facts.preferences?.length) fields.push('preferences');
  if (facts.dislikes?.length) fields.push('dislikes');
  if (facts.typical_order) fields.push('typical_order');
  if (facts.allergies?.length) fields.push('allergies');
  if (facts.notes) fields.push('notes');
  return fields;
}

function semanticScope(
  semanticContext: SemanticResult[] | null,
): 'customer' | 'conversation' | null {
  if (!semanticContext?.length) return null;
  if (semanticContext.some((item) => item.sourceScope === 'customer')) {
    return 'customer';
  }
  if (semanticContext.some((item) => item.sourceScope === 'conversation')) {
    return 'conversation';
  }
  return null;
}

export function shapeTurnMemory(
  workingMemory: WorkingMemory,
  options: { maxRecentMessages?: number; maxRetrievedMemories?: number } = {},
): { workingMemory: WorkingMemory; metadata: TurnMemoryMetadata } {
  const maxRecentMessages = options.maxRecentMessages ?? DEFAULT_MAX_RECENT_MESSAGES;
  const maxRetrievedMemories = options.maxRetrievedMemories ?? DEFAULT_MAX_RETRIEVED_MEMORIES;

  const shaped: WorkingMemory = {
    ...workingMemory,
    recentMessages: workingMemory.recentMessages.slice(-maxRecentMessages),
    semanticContext: workingMemory.semanticContext?.slice(0, maxRetrievedMemories) ?? null,
  };
  const factFields = presentFactFields(shaped.facts);
  const omittedReasons: string[] = [];
  if (!shaped.recentMessages.length) omittedReasons.push('no_recent_messages');
  if (!shaped.summary) omittedReasons.push('no_summary');
  if (!factFields.length) omittedReasons.push('no_customer_facts');
  if (!shaped.semanticContext?.length) omittedReasons.push('no_semantic_recall');

  return {
    workingMemory: shaped,
    metadata: {
      recent_count: shaped.recentMessages.length,
      summary_present: !!shaped.summary,
      facts_present: factFields.length > 0,
      fact_fields: factFields,
      semantic_count: shaped.semanticContext?.length ?? 0,
      semantic_source_scope: semanticScope(shaped.semanticContext),
      top_similarity: shaped.semanticContext?.[0]?.similarity ?? null,
      omitted_reasons: omittedReasons,
      guardrail: 'memory_is_context_not_operational_truth',
    },
  };
}
