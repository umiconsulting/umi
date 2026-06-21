import { corsHeaders } from '../_shared/cors.ts'

export const BUSINESS_LOCATION = {
  lat: 24.819387481202355,
  lng: -107.39123573887188,
  label: 'Café Kalala Chapule',
  address: 'Chapule, Culiacán, Sinaloa',
}

export function createTwimlResponse(message: string): Response {
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(toWhatsAppMarkdown(message))}</Message>
</Response>`

  return new Response(twiml, {
    headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
  })
}

export function createEmptyTwimlResponse(): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response/>`, {
    headers: { ...corsHeaders, 'Content-Type': 'text/xml' },
  })
}

function toWhatsAppMarkdown(text: string): string {
  // Convert **bold** → *bold* (WhatsApp uses single asterisks)
  return text.replace(/\*\*(.+?)\*\*/g, '*$1*')
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':  return '&lt;'
      case '>':  return '&gt;'
      case '&':  return '&amp;'
      case "'":  return '&apos;'
      case '"':  return '&quot;'
      default:   return c
    }
  })
}
