import { create } from 'zustand'

interface TraceState {
  activeRequestId: string | null
  activeSpanId: string | null
  setActiveRequest: (id: string | null) => void
  setActiveSpan: (id: string | null) => void
  clear: () => void
}

export const useTraceStore = create<TraceState>((set) => ({
  activeRequestId: null,
  activeSpanId: null,
  setActiveRequest: (activeRequestId) => set({ activeRequestId }),
  setActiveSpan: (activeSpanId) => set({ activeSpanId }),
  clear: () => set({ activeRequestId: null, activeSpanId: null }),
}))
