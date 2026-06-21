import { NextRequest, NextResponse } from 'next/server'
import { fetchTraceByRequestId } from '@/lib/queries/trace'
import { assembleTrace } from '@/lib/parsers/traceAssembler'

interface RouteParams {
  params: Promise<{ requestId: string }>
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { requestId } = await params

  try {
    const rows = await fetchTraceByRequestId(requestId)
    const tree = assembleTrace(requestId, rows)
    return NextResponse.json(tree)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
