import { useState, useEffect, useRef, type CSSProperties } from 'react'

export type FloorTable = {
  number: number
  name?: string
  x: number
  y: number
  width: number
  height: number
  shape: 'square' | 'round' | 'long'
  seats: number
  state: 'free' | 'busy' | 'pay' | 'dirty'
}

// Schematic sample geometry, not the restaurant's published floor plan.
// Coordinates stay fixed at every viewport width; small screens pan the plan.
export const sampleTables: readonly FloorTable[] = [
  { number: 1, x: 72, y: 80, width: 104, height: 88, shape: 'square', seats: 4, state: 'busy' },
  { number: 2, x: 272, y: 80, width: 104, height: 88, shape: 'square', seats: 4, state: 'free' },
  { number: 3, x: 72, y: 240, width: 104, height: 88, shape: 'square', seats: 4, state: 'busy' },
  { number: 4, x: 272, y: 240, width: 104, height: 88, shape: 'square', seats: 4, state: 'free' },
  { number: 5, x: 480, y: 72, width: 104, height: 104, shape: 'round', seats: 4, state: 'pay' },
  { number: 6, x: 460, y: 240, width: 144, height: 88, shape: 'long', seats: 6, state: 'free' },
]

const status = { free: 'Disponible', busy: 'En servicio', pay: 'Por cobrar', dirty: 'Por limpiar' }
const shortStatus = { free: 'Libre', busy: 'Ocupada', pay: 'Cobrar', dirty: 'Limpiar' }

export function FloorPlan({ selected, onSelect, fit = false, layout = sampleTables }: { selected: number; onSelect: (number: number) => void; fit?: boolean; layout?: readonly FloorTable[] }) {
  const [expanded, setExpanded] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const node = viewport.current
    if (!node || !fit) return
    const updateScale = () => setScale(Math.min(1, node.clientWidth / 640))
    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(node)
    return () => observer.disconnect()
  }, [fit])
  return <div className="u-floor-plan" data-expanded={expanded} style={fit ? { width: '100%', minWidth: 0 } : undefined}>
    <div ref={viewport} style={fit ? { height: 452 * scale, flex: 'none', width: '100%', minWidth: 0, overflow: 'hidden' } : undefined} className="u-plan-viewport" tabIndex={0} role="region" aria-label={fit ? 'Plano completo del salón' : 'Plano del salón, desplazable horizontalmente'}>
      <div className="u-plan-canvas" style={fit ? { zoom: scale } : undefined}>
        <svg className="u-plan-walls" viewBox="0 0 640 452" aria-hidden="true">
          <path className="u-plan-wall" d="M24 416V24H616V416H204 M24 416H76"/>
          <path className="u-plan-window" d="M68 24H388 M68 20H388 M68 28H388"/>
          <path className="u-plan-door" d="M76 416V356 M76 356A60 60 0 0 1 136 416"/>
        </svg>
        <span className="u-plan-window-label">Ventanal</span>
        <span className="u-plan-entry">Entrada</span>
        <div className="u-plan-bar">Barra</div>
        {layout.map(table => <button
          key={table.number}
          className="u-table"
          style={{ left: table.x, top: table.y, width: table.width, height: table.height } as CSSProperties}
          data-state={table.state}
          data-shape={table.shape}
          data-number={table.number}
          data-chosen={selected === table.number}
          aria-label={table.name || 'Mesa ' + String(table.number).padStart(2, '0')}
          aria-describedby={'table-status-' + table.number}
          aria-pressed={selected === table.number}
          onClick={() => onSelect(table.number)}
        >
          <span className="u-plan-seats" aria-hidden="true">{Array.from({ length: Math.ceil(table.seats / 2) }, (_, i) => <i key={i}/>)}</span>
          <span className="u-plan-seats bottom" aria-hidden="true">{Array.from({ length: Math.floor(table.seats / 2) }, (_, i) => <i key={i}/>)}</span>
          <b data-custom-name={Boolean(table.name && table.name !== 'Mesa ' + String(table.number).padStart(2, '0'))}>{table.name && table.name !== 'Mesa ' + String(table.number).padStart(2, '0') ? table.name : String(table.number).padStart(2, '0')}</b>
          <span id={'table-status-' + table.number} className="u-table-status"><span className="u-table-status-full">{status[table.state]}</span><span className="u-table-status-short">{shortStatus[table.state]}</span></span>
        </button>)}
      </div>
    </div>
    <div className="u-plan-controls"><span>{expanded ? 'Desliza para recorrer el plano' : 'Salón completo'}</span><button aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Ajustar plano' : 'Ampliar plano'}</button></div>
  </div>
}
