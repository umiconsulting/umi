/**
 * Message vocabulary bridge.
 *
 * The DB (`tenant.message.sender` CHECK) speaks the café DOMAIN vocabulary —
 * `customer | bot | staff | system` — while the LLM / turn engine speaks the
 * Anthropic API vocabulary — `user | assistant | system | tool`. They are NOT the
 * same word set: writing `'user'`/`'assistant'` straight into the DB violates the
 * CHECK (the silent-bot-death bug). Translate at the repository boundary.
 *
 * On READ, use the inline SQL CASE (kept literal, so sql-preflight still covers the
 * query): bot/staff both map to `assistant` (outbound), customer -> user.
 */
export type DbSender = 'customer' | 'bot' | 'staff' | 'system';

/** LLM role -> DB sender. Anything not a person/bot/staff falls to `system`. */
export function roleToSender(role: string): DbSender {
  switch (role) {
    case 'user':
      return 'customer';
    case 'assistant':
      return 'bot';
    case 'staff':
      return 'staff';
    default:
      return 'system'; // system, tool, or unknown
  }
}
