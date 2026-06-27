/**
 * WhatsApp text + TwiML helpers. Ported from `whatsapp-handler/twiml.ts`.
 * `toWhatsAppMarkdown` (the **bold**→*bold* conversion) was dropped in the
 * Phase-1 TwilioAdapter port — it lives here and is applied by the outbound
 * processor + the webhook TwiML so replies render correctly (preflight §8).
 */

/** WhatsApp uses single asterisks for bold: `**bold**` → `*bold*`. */
export function toWhatsAppMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/** A TwiML `<Message>` reply (used for synchronous webhook errors/limits). */
export function twimlMessage(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(toWhatsAppMarkdown(message))}</Message>
</Response>`;
}

/** Empty TwiML — the real reply arrives async via the Twilio REST API. */
export function emptyTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
}
