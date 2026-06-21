import { create } from 'zustand'

type TimeRange = '1h' | '6h' | '24h' | '7d'

interface FilterState {
  timeRange: TimeRange
  fnFilter: string | null
  statusFilter: string | null
  setTimeRange: (range: TimeRange) => void
  setFnFilter: (fn: string | null) => void
  setStatusFilter: (status: string | null) => void
  reset: () => void
}

export const useFilterStore = create<FilterState>((set) => ({
  timeRange: '24h',
  fnFilter: null,
  statusFilter: null,
  setTimeRange: (timeRange) => set({ timeRange }),
  setFnFilter: (fnFilter) => set({ fnFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  reset: () => set({ timeRange: '24h', fnFilter: null, statusFilter: null }),
}))
