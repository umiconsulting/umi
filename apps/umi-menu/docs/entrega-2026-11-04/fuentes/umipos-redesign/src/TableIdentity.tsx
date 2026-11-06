export function TableIdentity({ number }: { number: number }) {
  return <span className="u-table-identity">Mesa {String(number).padStart(2, '0')}</span>
}
