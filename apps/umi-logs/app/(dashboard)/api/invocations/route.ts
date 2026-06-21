import { NextRequest, NextResponse } from 'next/server'
import { fetchInvocationsPage } from '@/lib/queries/invocations'
import type { InvocationFilters } from '@/lib/queries/invocations'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const cursor = searchParams.get('cursor') ?? undefined
  const limit = Number(searchParams.get('limit') ?? 50)
  const filters: InvocationFilters = {
    fnFilter: searchParams.get('fn') ?? null,
    statusFilter: searchParams.get('status') ?? null,
    timeRange: (searchParams.get('range') as InvocationFilters['timeRange']) ?? '24h',
  }

  try {
    const page = await fetchInvocationsPage({ cursor, limit }, filters)
    return NextResponse.json(page)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
