import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant';
import { generateStampStrip } from '@/lib/strip-generator';

// sharp needs the Node runtime (not edge).
export const runtime = 'nodejs';

// Upper bound on visits-per-cycle — guards against someone requesting a giant
// image. No real reward program uses more than this.
const MAX_REQUIRED = 20;

/**
 * Public, content-addressed stamp-card image used as the Google Wallet heroImage.
 *
 * The URL encodes the exact stamp state — `/api/{slug}/stamp-strip/{filled}-{required}.png`
 * — so the bytes for a given state never change. That makes it safe to cache
 * forever (immutable): when a customer advances a stamp, the object's heroImage
 * points at a *different* URL and Google fetches it fresh. No cache-busting needed.
 *
 * Anonymous on purpose — Google fetches this server-side with no credentials, and
 * the URL carries no PII (just tenant slug + counts), so every customer at the same
 * state shares one CDN-cached image.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string; state: string } },
) {
  const match = params.state.replace(/\.png$/i, '').match(/^(\d+)-(\d+)$/);
  if (!match) return new NextResponse('Invalid state', { status: 400 });

  const required = parseInt(match[2], 10);
  if (!Number.isInteger(required) || required < 1 || required > MAX_REQUIRED) {
    return new NextResponse('Invalid required', { status: 400 });
  }
  const filled = Math.max(0, Math.min(parseInt(match[1], 10), required));

  // Background color, in priority order: explicit ?bg= override → the tenant's secondary
  // color (best-effort; skipped when there's no DB, e.g. a Vercel preview) → transparent,
  // which inherits the card's background. This route is a pure image and must not depend
  // on the database being reachable.
  const bgParam = req.nextUrl.searchParams.get('bg');
  let bgColor: string | null = bgParam ? (bgParam.startsWith('#') ? bgParam : `#${bgParam}`) : null;
  if (!bgColor) {
    try {
      const tenant = await getTenant(params.slug);
      bgColor = tenant?.secondaryColor ?? null;
    } catch {
      // No DB available (preview/offline) — fall through to transparent.
    }
  }

  // Tenant stamp art lives at /public/logos/{slug}-stamp-{filled,empty,welcome}.png —
  // same convention the Apple strip uses (see pass-apple.ts).
  const filledUrl = `/logos/${params.slug}-stamp-filled.png`;
  const emptyUrl = `/logos/${params.slug}-stamp-empty.png`;
  const welcomeUrl = `/logos/${params.slug}-stamp-welcome.png`;

  try {
    const png = await generateStampStrip(
      filled,
      required,
      filledUrl,
      emptyUrl,
      bgColor,
      welcomeUrl,
    );
    return new NextResponse(png as unknown as BodyInit, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch (err) {
    console.error('[StampStrip]', err instanceof Error ? err.message : String(err));
    return new NextResponse('Error generating strip', { status: 500 });
  }
}
