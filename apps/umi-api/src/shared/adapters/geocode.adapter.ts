import { Injectable, Logger } from '@nestjs/common';

/**
 * Address → coordinates, over OpenStreetMap Nominatim.
 *
 * Ported from umi-cash `/api/umi/geocode`, which existed only to serve the legacy
 * `/umi/*` panel's branch editor. Nothing else ever called it, and it read no
 * database — so it moves here as the last piece that surface owned, and the panel
 * can go.
 *
 * ⚠️ NOMINATIM IS A DONATED SERVICE with a published usage policy: at most one
 * request per second, and a real User-Agent identifying the caller. Both are
 * honoured below. This is a TYPE-AHEAD-HOSTILE endpoint by design — the dashboard
 * calls it when an operator presses the button, never as they type.
 *
 * A geocode is a CONVENIENCE, not a source of truth. The operator can always type
 * coordinates, and a failure here must never stop them saving a branch — so every
 * failure returns null and the caller reports "we could not find it", not an error.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/** Long enough for a slow donated service, short enough not to hold a worker. */
const TIMEOUT_MS = 5_000;

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
}

interface NominatimHit {
  lat?: string;
  lon?: string;
  display_name?: string;
}

@Injectable()
export class GeocodeAdapter {
  private readonly logger = new Logger(GeocodeAdapter.name);

  /**
   * The best match for `address`, or null when there is none, the lookup fails, or
   * it takes too long. `countryCode` narrows the search; every café is in Mexico
   * today, and the parameter is here so that stops being an assumption baked into
   * a URL.
   */
  async lookup(address: string, countryCode = 'mx'): Promise<GeocodeResult | null> {
    const q = address.trim();
    if (q.length < 3) return null;

    const url = new URL(NOMINATIM);
    url.searchParams.set('q', q);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', countryCode);

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UmiConsulting/1.0 (contacto@umiconsulting.co)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`nominatim ${res.status} for a ${q.length}-character query`);
        return null;
      }
      const hits = (await res.json()) as NominatimHit[];
      const hit = Array.isArray(hits) ? hits[0] : undefined;
      if (!hit?.lat || !hit?.lon) return null;

      const latitude = Number(hit.lat);
      const longitude = Number(hit.lon);
      // Nominatim returns strings. A pin the schema would reject as `numeric(9,6)`
      // out of range, or that parsed to NaN, is no answer at all.
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

      return { latitude, longitude, formattedAddress: hit.display_name ?? q };
    } catch (err) {
      // Includes the timeout. Never logs the address itself: it is a customer-facing
      // café's location, and this line goes to an aggregator.
      this.logger.warn(`geocode lookup failed: ${(err as Error).name}`);
      return null;
    }
  }
}
