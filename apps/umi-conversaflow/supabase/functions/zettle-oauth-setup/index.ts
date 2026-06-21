import { corsHeaders, BUSINESS_ID } from '../_shared/cors.ts'
import { getSupabaseClient } from '../_shared/supabase.ts'
import { logEdgeFunction } from '../_shared/logger.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const start = Date.now()

  try {
    const supabase = getSupabaseClient()
    const zettleClientId = Deno.env.get('ZETTLE_CLIENT_ID')
    const zettleApiKey = Deno.env.get('ZETTLE_API_KEY')

    if (!zettleClientId || !zettleApiKey) {
      throw new Error('ZETTLE_CLIENT_ID and ZETTLE_API_KEY must be configured')
    }

    console.log('🔑 Exchanging API key for access token (assertion grant)...')

    const tokenResponse = await fetch('https://oauth.zettle.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        client_id: zettleClientId,
        assertion: zettleApiKey,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`)
    }

    const tokenData = await tokenResponse.json()
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000)

    const { error: upsertError } = await supabase
      .from('zettle_oauth_tokens')
      .upsert(
        {
          business_id: BUSINESS_ID,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token ?? null,
          token_type: tokenData.token_type || 'Bearer',
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: 'business_id' },
      )

    if (upsertError) throw new Error(`Failed to store tokens: ${upsertError.message}`)

    console.log('✅ OAuth tokens stored successfully')

    EdgeRuntime.waitUntil(
      logEdgeFunction({
        function_name: 'zettle-oauth-setup',
        status: 'success',
        duration_ms: Date.now() - start,
      }),
    )

    return new Response(
      JSON.stringify({
        success: true,
        message: 'OAuth tokens stored successfully',
        expires_at: expiresAt.toISOString(),
        expires_in_hours: Math.round(tokenData.expires_in / 3600),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error: any) {
    console.error('💥 OAuth setup failed:', error)

    EdgeRuntime.waitUntil(
      logEdgeFunction({
        function_name: 'zettle-oauth-setup',
        status: 'error',
        duration_ms: Date.now() - start,
        error_message: error.message,
        error_stack: error.stack,
      }),
    )

    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
