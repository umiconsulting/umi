import { BUSINESS_ID } from '../_shared/cors.ts'

export interface Customer {
  id: string
  phone: string
  name: string | null
  business_id: string
}

export interface Conversation {
  id: string
  customer_id: string
  business_id: string
  status: string
  current_state: string
  state_version: number
  summary: string | null
  draft_cart: DraftCart | null
  draft_cart_version: number
  pending_clarification: Record<string, unknown> | null
}

export interface DraftCartItem {
  product_id: string
  product_name: string
  variant_name: string | null
  quantity: number
  unit_price: number
}

export interface DraftCart {
  items: DraftCartItem[]
  updated_at: string
  customer_note?: string | null
}

export interface ConversationContext {
  conversation: Conversation
  messageCount: number
}

export interface PartialCancelledItemContext {
  id: string
  name: string
  quantity: number
  variantName: string | null
  isCancelled: boolean
}

export interface PartialCancelledOrderContext {
  ticketID: string
  sourceTransactionID: string
  reason: string
  cancelledItems: PartialCancelledItemContext[]
  remainingItems: PartialCancelledItemContext[]
}

/**
 * FT-05: Get or create a customer using an atomic upsert to eliminate the
 * TOCTOU race condition between the existence check and insert.
 * Requires the UNIQUE(phone, business_id) constraint added in migration.
 *
 * Also maintains platform.people via resolve_person for identity resolution.
 * The resolve_person call is fire-and-forget — webhook latency is not gated on it.
 */
export async function getOrCreateCustomer(
  supabase: any,
  phone: string,
  profileName: string | null,
): Promise<Customer> {
  // Upsert: if the (phone, business_id) row exists, return it unchanged.
  // If it doesn't exist, insert it. No race condition.
  const { data, error } = await supabase
    .from('customers')
    .upsert(
      { phone, name: profileName, business_id: BUSINESS_ID },
      {
        onConflict: 'phone,business_id',
        ignoreDuplicates: true, // don't overwrite existing name with profileName
      },
    )
    .select('*')
    .single()

  if (error || !data) {
    // Fallback: a concurrent insert won the race — fetch the existing row
    const { data: existing, error: fallbackError } = await supabase
      .from('customers')
      .select('*')
      .eq('phone', phone)
      .eq('business_id', BUSINESS_ID)
      .single()
    if (!existing) {
      throw new Error(`Customer lookup failed: ${fallbackError?.message ?? 'no data returned'}`)
    }
    // Still resolve to platform.people on fallback path
    resolvePersonAsync(supabase, phone, profileName).catch((e) =>
      console.error('[resolve_person] async error:', e.message),
    )
    return existing
  }

  // Fire-and-forget: maintain platform.people identity anchor
  resolvePersonAsync(supabase, phone, profileName).catch((e) =>
    console.error('[resolve_person] async error:', e.message),
  )

  return data
}

/**
 * Resolve or create a platform.people row for this customer.
 * Fire-and-forget — failures are logged but never block the webhook response.
 */
async function resolvePersonAsync(
  supabase: any,
  phone: string,
  profileName: string | null,
): Promise<void> {
  try {
    // Get tenant_id from the businesses table
    const { data: biz } = await supabase
      .from('businesses')
      .select('tenant_id')
      .eq('id', BUSINESS_ID)
      .maybeSingle()

    if (!biz?.tenant_id) {
      console.warn('[resolve_person] No tenant_id for business', BUSINESS_ID)
      return
    }

    const { error: rpcError } = await supabase.rpc('resolve_person', {
      _tenant_id: biz.tenant_id,
      _identity: { phone, name: profileName },
      _source: 'whatsapp',
    })

    if (rpcError) {
      console.error('[resolve_person] RPC error:', rpcError.message)
    }
  } catch (err: any) {
    console.error('[resolve_person] Unexpected error:', err?.message ?? err)
  }
}

export async function getOrCreateConversation(
  supabase: any,
  customerId: string,
): Promise<ConversationContext> {
  const { data: conversations } = await supabase
    .from('conversations')
    .select('*')
    .eq('customer_id', customerId)
    .eq('business_id', BUSINESS_ID)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)

  if (conversations?.[0]) {
    const conversation = conversations[0]
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)

    return { conversation, messageCount: count ?? 0 }
  }

  const { data: created, error: createError } = await supabase
    .from('conversations')
    .insert({
      customer_id: customerId,
      business_id: BUSINESS_ID,
      current_state: 'initial',
      status: 'active',
      state_version: 0,
      draft_cart_version: 0,
    })
    .select()
    .single()

  if (!created) {
    throw new Error(`Failed to create conversation: ${createError?.message ?? 'no data returned'}`)
  }

  return { conversation: created, messageCount: 0 }
}

export async function getActivePartialCancelledOrder(
  supabase: any,
  customerId: string,
): Promise<PartialCancelledOrderContext | null> {
  const { data: ticket, error: ticketError } = await (supabase as any)
    .schema('kds')
    .from('tickets')
    .select('ticket_id, source_transaction_id, partial_cancellation_reason, customer_id, status, updated_at')
    .eq('customer_id', customerId)
    .eq('status', 'partial_cancelled')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (ticketError || !ticket?.ticket_id || !ticket?.partial_cancellation_reason) {
    return null
  }

  const { data: items, error: itemsError } = await (supabase as any)
    .schema('kds')
    .from('ticket_items')
    .select('ticket_item_id, name, quantity, variant_name, is_cancelled, display_order')
    .eq('ticket_id', ticket.ticket_id)
    .order('display_order', { ascending: true })

  if (itemsError || !items?.length) {
    return null
  }

  const normalizedItems: PartialCancelledItemContext[] = items.map((item: any) => ({
    id: String(item.ticket_item_id),
    name: String(item.name ?? 'Producto'),
    quantity: Number(item.quantity ?? 1),
    variantName: item.variant_name ? String(item.variant_name) : null,
    isCancelled: Boolean(item.is_cancelled),
  }))

  return {
    ticketID: String(ticket.ticket_id),
    sourceTransactionID: String(ticket.source_transaction_id),
    reason: String(ticket.partial_cancellation_reason),
    cancelledItems: normalizedItems.filter((item) => item.isCancelled),
    remainingItems: normalizedItems.filter((item) => !item.isCancelled),
  }
}
