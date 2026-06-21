'use client'

import type { ReactNode } from 'react'
import { useDepth, type DepthLevel } from './DepthProvider'

interface DepthGateProps {
  level: DepthLevel | DepthLevel[]
  children: ReactNode
}

export function DepthGate({ level, children }: DepthGateProps) {
  const { depth } = useDepth()
  const levels = Array.isArray(level) ? level : [level]

  if (!levels.includes(depth)) return null

  return <div className="depth-content-enter">{children}</div>
}
