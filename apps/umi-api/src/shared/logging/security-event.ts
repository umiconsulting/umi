import { hashPhone } from './hash-phone';

/**
 * The maximum number of characters of user input that a security log line keeps.
 *
 * The input is the message a person sent. An attacker controls it, and controls
 * its length. Without a limit, one request can write a log line of any size.
 */
export const SECURITY_INPUT_MAX = 500;

export interface SecurityEventInput {
  phone: string;
  eventType: string;
  inputText: string;
  details?: string;
  requestId?: string;
}

/**
 * The payload of a security log line, with the two redaction rules applied.
 *
 * A security event must record WHO and WHAT, because a rate limit or an
 * injection attempt is only useful if you can group the events of one sender.
 * Neither rule can be left to the call site:
 *
 *   - The phone number becomes a hash. A log line goes to stdout, and the
 *     collector keeps it far longer than the request. A hash groups the events
 *     of one sender and holds no number. See [hashPhone].
 *   - The input text gets a limit. See [SECURITY_INPUT_MAX].
 *
 * This function exists because both rules were lost once. `TraceService` applied
 * them on the way to a database table. That service is deleted, and the two call
 * sites in `whatsapp.controller.ts` then wrote the raw number and the whole
 * message to stdout.
 */
export function securityEvent(input: SecurityEventInput): Record<string, unknown> {
  return {
    phone: hashPhone(input.phone),
    eventType: input.eventType,
    inputText: input.inputText.slice(0, SECURITY_INPUT_MAX),
    ...(input.details === undefined ? {} : { details: input.details }),
    ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
  };
}
