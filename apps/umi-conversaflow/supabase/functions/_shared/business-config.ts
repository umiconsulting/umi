export interface VoiceConfig {
  assistant_name: string
  locale: string
  tone: string
  style_notes?: string[]
}

export interface BusinessConfig {
  address?: string
  whatsapp?: string
  payment_methods?: string[]
  timezone?: string
  accepts_whatsapp_orders?: boolean
  special_notice?: string | null
  order_cutoff_time?: string | null
  hours?: Record<string, { open?: string; close?: string; closed?: boolean }>
  bypass_phones?: string[]
  voice?: Partial<VoiceConfig> | null
}

export interface BusinessConfigRow {
  id: string
  name?: string | null
  config?: BusinessConfig | null
}

export function normalizeVoiceConfig(config: Partial<VoiceConfig> | null | undefined): VoiceConfig | null {
  if (!config) return null

  const assistantName = typeof config.assistant_name === 'string' ? config.assistant_name.trim() : ''
  const locale = typeof config.locale === 'string' ? config.locale.trim() : ''
  const tone = typeof config.tone === 'string' ? config.tone.trim() : ''
  const styleNotes = Array.isArray(config.style_notes)
    ? config.style_notes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

  if (!assistantName || !locale || !tone) return null

  return {
    assistant_name: assistantName,
    locale,
    tone,
    style_notes: styleNotes.length > 0 ? styleNotes : undefined,
  }
}

export function requireVoiceConfig(
  config: BusinessConfig | null | undefined,
  businessId: string,
): VoiceConfig {
  const voice = normalizeVoiceConfig(config?.voice)
  if (!voice) {
    throw new Error(`Missing businesses.config.voice for business ${businessId}`)
  }
  return voice
}

export async function fetchBusinessConfigRow(
  supabase: any,
  businessId: string,
): Promise<BusinessConfigRow | null> {
  const { data } = await supabase
    .from('businesses')
    .select('id, name, config')
    .eq('id', businessId)
    .maybeSingle()

  return (data as BusinessConfigRow | null) ?? null
}
