import { NextResponse } from 'next/server'
import { fetchSystemMetrics } from '@/lib/queries/metrics'

export async function GET() {
  try {
    const metrics = await fetchSystemMetrics()
    return NextResponse.json(metrics)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
