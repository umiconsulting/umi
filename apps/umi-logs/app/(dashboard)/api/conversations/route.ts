import { NextRequest, NextResponse } from 'next/server'
import { fetchConversationsPage } from '@/lib/queries/conversations'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const cursor = searchParams.get('cursor') ?? undefined
  const limit = Number(searchParams.get('limit') ?? 50)
  const statusFilter = searchParams.get('status') ?? null

  try {
    const page = await fetchConversationsPage({ cursor, limit }, { statusFilter })
    return NextResponse.json(page)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
