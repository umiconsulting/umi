import { NextRequest, NextResponse } from 'next/server';

const ALLOWED_ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  'http://localhost:3000',
  'http://localhost:3001',
].filter(Boolean).map((o) => (o as string).replace(/\/$/, '')) as string[];

// State-changing methods that require origin validation
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method;

  // CORS / origin check for API mutation endpoints
  if (pathname.startsWith('/api/') && MUTATING_METHODS.has(method ?? '')) {
    const origin = req.headers.get('origin');
    // Allow requests with no Origin (server-to-server, Postman in dev)
    if (origin && !ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) {
      return new NextResponse(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
