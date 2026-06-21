import { retryDeadJob } from '@/lib/queries/workflow'
import { NextResponse } from 'next/server'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const success = await retryDeadJob(id)

  if (!success) {
    return NextResponse.json({ error: 'Job not found or not in dead state' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, jobId: id })
}
