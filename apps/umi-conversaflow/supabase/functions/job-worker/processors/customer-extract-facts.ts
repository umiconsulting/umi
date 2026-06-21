import { extractCustomerFacts } from "../../_shared/memory.ts";
import { getAnthropicClient } from "../../_shared/adapters/anthropic.ts";
import { slog } from "../../_shared/logger.ts";

const RECENT_FACT_MESSAGE_LIMIT = 12;

/**
 * Process a customer.extract_facts job: extract customer preferences, dislikes,
 * allergies, and typical order from recent conversation via Claude Haiku.
 */
export async function processCustomerExtractFacts(
  supabase: any,
  payload: {
    customer_id: string;
    conversation_id?: string;
    recent_messages?: Array<{ role: string; content: string }>;
    existing_facts?: any;
    request_id?: string;
  },
): Promise<void> {
  if (!payload.customer_id) {
    throw new Error("customer.extract_facts requires customer_id");
  }

  let recentMessages = payload.recent_messages;
  let existingFacts = payload.existing_facts;

  if (!recentMessages?.length && payload.conversation_id) {
    const { data, error } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", payload.conversation_id)
      .order("created_at", { ascending: false })
      .limit(RECENT_FACT_MESSAGE_LIMIT);

    if (error) {
      throw new Error(
        `customer.extract_facts messages fetch failed: ${error.message}`,
      );
    }

    recentMessages = (data ?? []).reverse();
  }

  if (existingFacts === undefined) {
    const { data, error } = await supabase
      .from("customer_preferences")
      .select("facts")
      .eq("customer_id", payload.customer_id)
      .maybeSingle();

    if (error) {
      throw new Error(
        `customer.extract_facts preference fetch failed: ${error.message}`,
      );
    }

    existingFacts = data?.facts ?? null;
  }

  if (!recentMessages?.length) {
    slog("info", "customer_extract_facts_no_messages", {
      customer_id: payload.customer_id,
      conversation_id: payload.conversation_id,
      request_id: payload.request_id,
    });
    return;
  }

  const anthropic = getAnthropicClient();
  const newFacts = await extractCustomerFacts(
    recentMessages,
    existingFacts,
    anthropic,
  );

  if (!newFacts) return;

  await supabase
    .from("customer_preferences")
    .upsert(
      {
        customer_id: payload.customer_id,
        facts: newFacts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "customer_id" },
    );

  slog("info", "customer_facts_extracted", {
    customer_id: payload.customer_id,
    request_id: payload.request_id,
  });
}
