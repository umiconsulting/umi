'use client'

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export type DepthLevel = 'surface' | 'system' | 'trace'

interface DepthContextValue {
  depth: DepthLevel
  setDepth: (level: DepthLevel) => void
}

const DepthContext = createContext<DepthContextValue>({
  depth: 'surface',
  setDepth: () => {},
})

export function DepthProvider({
  children,
  defaultDepth = 'surface',
}: {
  children: ReactNode
  defaultDepth?: DepthLevel
}) {
  const [depth, setDepthState] = useState<DepthLevel>(defaultDepth)

  const setDepth = useCallback((level: DepthLevel) => {
    setDepthState(level)
  }, [])

  useEffect(() => {
    const html = document.documentElement
    if (depth === 'trace') {
      html.setAttribute('data-depth', 'trace')
    } else {
      html.removeAttribute('data-depth')
    }
  }, [depth])

  return (
    <DepthContext.Provider value={{ depth, setDepth }}>
      {children}
    </DepthContext.Provider>
  )
}

export function useDepth() {
  return useContext(DepthContext)
}
