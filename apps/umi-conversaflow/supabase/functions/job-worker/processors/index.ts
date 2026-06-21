import { processMessageEmbed } from "./message-embed.ts";
import { processConversationSummarize } from "./conversation-summarize.ts";
import { processCustomerExtractFacts } from "./customer-extract-facts.ts";
import { processEmbedBackfill } from "./embed-backfill.ts";
import { processProductEmbed } from "./product-embed.ts";
import { processZettleSync } from "./zettle-sync.ts";
import { processTurnIntegrity } from "./turn-integrity.ts";
import { processTurnProcess } from "./turn-process.ts";
import {
  processBirthdayRewards,
  processExpireBirthdayRewards,
  processGoalProximity,
  processRewardExpiring,
  processStreakRecognition,
  processWelcomeNoVisit,
  processWinbackInactive,
} from "./cash-cron.ts";

export type JobProcessor = (supabase: any, payload: any) => Promise<void>;

/**
 * Registry of job type → processor function.
 * Add new processors here as they are implemented.
 */
export const PROCESSORS: Record<string, JobProcessor> = {
  "message.embed": processMessageEmbed,
  "conversation.summarize": processConversationSummarize,
  "customer.extract_facts": processCustomerExtractFacts,
  "turn.integrity": processTurnIntegrity,
  "turn.process": processTurnProcess,
  "embed.backfill": processEmbedBackfill,
  "product.embed": processProductEmbed,
  "zettle.sync": processZettleSync,

  // Cash cron job processors (S4.4)
  "birthday_rewards": processBirthdayRewards,
  "expire_birthday_rewards": processExpireBirthdayRewards,
  "goal_proximity": processGoalProximity,
  "reward_expiring": processRewardExpiring,
  "streak_recognition": processStreakRecognition,
  "welcome_no_visit": processWelcomeNoVisit,
  "winback_inactive": processWinbackInactive,
};
