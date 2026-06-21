export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function getRequiredBusinessId(): string {
  const businessId = Deno.env.get('DEFAULT_BUSINESS_ID')
  if (!businessId) {
    throw new Error('DEFAULT_BUSINESS_ID env var is required for tenant-scoped functions')
  }
  return businessId
}

export const BUSINESS_ID = getRequiredBusinessId()
