import { NextRequest, NextResponse } from 'next/server';
import { deleteSessionByToken } from '@/lib/identity';

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const refreshToken = req.cookies.get('refreshToken')?.value;
  if (refreshToken) {
    await deleteSessionByToken(refreshToken).catch(() => null);
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set('refreshToken', '', { path: '/', maxAge: 0 });
  response.cookies.set('refreshToken', '', { path: `/${params.slug}`, maxAge: 0 });
  return response;
}
