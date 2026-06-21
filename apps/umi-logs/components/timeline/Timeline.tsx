'use client'

import type { ReactNode } from 'react'

interface TimelineProps {
  children: ReactNode
}

export function Timeline({ children }: TimelineProps) {
  return <div className="timeline-container">{children}</div>
}
