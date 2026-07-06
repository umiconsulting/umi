import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Liveness + DB-connectivity probe. Confirms the serverless runtime can reach the
// platform DB through the pooled `DATABASE_URL` (i.e. the credentials are valid).
// Node runtime (Prisma can't run on Edge); never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'up', latencyMs: Date.now() - startedAt });
  } catch (err) {
    // Never leak the connection string / driver internals to a public probe.
    console.error('[health] db check failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ status: 'error', db: 'down' }, { status: 503 });
  }
}
