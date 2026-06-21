import { create } from 'zustand'

interface TableState {
  selectedRowId: string | null
  expandedRows: Set<string>
  selectRow: (id: string | null) => void
  toggleExpanded: (id: string) => void
  clearSelection: () => void
}

export const useTableStore = create<TableState>((set) => ({
  selectedRowId: null,
  expandedRows: new Set(),
  selectRow: (id) => set({ selectedRowId: id }),
  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedRows)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return { expandedRows: next }
    }),
  clearSelection: () => set({ selectedRowId: null }),
}))
