interface AbsenceCellProps {
  /** Label shown in dim text — defaults to "---" */
  label?: string
}

export function AbsenceCell({ label = '---' }: AbsenceCellProps) {
  return (
    <span className="absence-cell">{label}</span>
  )
}
