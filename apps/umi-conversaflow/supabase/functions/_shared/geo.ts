/**
 * Derives the IANA timezone from a free-form address string.
 *
 * Strategy (2-step, Google Maps APIs):
 *  1. Google Geocoding API converts the address to lat/lon.
 *     If the full address isn't found we progressively drop leading
 *     comma-separated parts (street → neighborhood → city → state).
 *  2. Google Time Zone API returns the IANA timezone for those coordinates.
 *
 * Requires: GOOGLE_MAPS_API_KEY env var.
 */

const GOOGLE_MAPS_API_KEY = Deno.env.get('GOOGLE_MAPS_API_KEY') ?? ''

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 'OK' || !data.results?.length) return null
  const { lat, lng } = data.results[0].geometry.location
  return { lat, lon: lng }
}

async function timezoneFromCoords(lat: number, lon: number): Promise<string | null> {
  const timestamp = Math.floor(Date.now() / 1000)
  const url =
    `https://maps.googleapis.com/maps/api/timezone/json?location=${lat},${lon}&timestamp=${timestamp}&key=${GOOGLE_MAPS_API_KEY}`
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== 'OK' || !data.timeZoneId) return null
  Intl.DateTimeFormat(undefined, { timeZone: data.timeZoneId }) // validate IANA
  return data.timeZoneId
}

export async function deriveTimezoneFromAddress(address: string): Promise<string | null> {
  if (!address?.trim()) return null
  if (!GOOGLE_MAPS_API_KEY) return null

  try {
    // Try the full address, then drop leading comma-parts one by one
    // e.g. "Av X 1355, Chapultepec, 80040 Culiacán, Sin." →
    //      "Chapultepec, 80040 Culiacán, Sin." → "80040 Culiacán, Sin." → …
    const parts = address.split(',').map((p) => p.trim()).filter(Boolean)

    for (let i = 0; i < parts.length; i++) {
      const query = parts.slice(i).join(', ')
      const coords = await geocodeAddress(query)
      if (coords) {
        return await timezoneFromCoords(coords.lat, coords.lon)
      }
    }
    return null
  } catch {
    return null
  }
}
