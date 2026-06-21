import { NextRequest, NextResponse } from 'next/server';
import { verifyUmiSession } from '@/lib/umi-auth';

/**
 * GET /api/umi/geocode?address=...
 * Geocode an address using OpenStreetMap Nominatim (free, no API key).
 * Returns { latitude, longitude, formattedAddress }.
 */
export async function GET(req: NextRequest) {
  if (!await verifyUmiSession(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const address = req.nextUrl.searchParams.get('address');
  if (!address || address.length < 3) {
    return NextResponse.json({ error: 'Address is required' }, { status: 400 });
  }

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', address);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'mx');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'UmiCash/1.0 (contact@umiconsulting.co)' },
  });
  const data = await res.json();

  if (!data?.length) {
    return NextResponse.json({ error: 'No se encontró la dirección' }, { status: 404 });
  }

  const result = data[0];
  return NextResponse.json({
    latitude: parseFloat(result.lat),
    longitude: parseFloat(result.lon),
    formattedAddress: result.display_name,
  });
}
