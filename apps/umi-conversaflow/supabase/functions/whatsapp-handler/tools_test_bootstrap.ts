/**
 * Loaded before `tools.ts` so `_shared/cors.ts` can read DEFAULT_BUSINESS_ID at module init.
 * Requires env permission (see deno.json).
 */
const TEST_BUSINESS_ID = '00000000-0000-0000-0000-000000000001'
if (!Deno.env.get('DEFAULT_BUSINESS_ID')) {
  Deno.env.set('DEFAULT_BUSINESS_ID', TEST_BUSINESS_ID)
}
