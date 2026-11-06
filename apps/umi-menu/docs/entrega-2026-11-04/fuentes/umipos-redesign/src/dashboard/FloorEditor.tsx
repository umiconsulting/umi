import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react'
import { RiAddLine, RiArrowGoBackLine, RiArrowGoForwardLine, RiDragMove2Line, RiFocus3Line, RiSubtractLine, RiEyeLine, RiFileCopyLine, RiDeleteBinLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { cx } from '@/utils/cx'
import { sampleTables, type FloorTable } from '../FloorPlan'
import './floor-editor.css'

type Kind = 'table' | 'wall' | 'counter' | 'door' | 'label'
type Shape = 'square' | 'round' | 'rectangle'
type Element = {
  id: string; kind: Kind; shape: Shape; label: string; capacity: number
  x: number; y: number; width: number; height: number; rotation: number
}
type Area = { id: string; name: string; width: number; height: number; elements: Element[] }
type Plan = { areas: Area[] }
type Room = Record<string, { state: FloorTable['state']; account: string | null; people: number }>
type History = { past: Plan[]; present: Plan; future: Plan[] }
type Pending = { plan: Plan; tableIds: string[] } | null
type Stored = { draft: Plan; published: Plan; room: Room; pending: Pending }
const storageKey = 'umi-dashboard-floor-editor-v2'
const shapes: Record<Shape, string> = { square: 'Cuadrada', round: 'Redonda', rectangle: 'Rectangular' }
const kinds: Record<Kind, string> = { table: 'Mesa', wall: 'Muro', counter: 'Barra', door: 'Puerta', label: 'Texto' }
const states = { free: 'Disponible', busy: 'En servicio', pay: 'Por cobrar', dirty: 'Por limpiar' }
const numberLabels = { width: 'Ancho', height: 'Alto', x: 'Posición X', y: 'Posición Y', rotation: 'Rotación', capacity: 'Lugares' }
const palette: { id: string; label: string; kind: Kind; shape: Shape }[] = [
  { id: 'square', label: 'Mesa cuadrada', kind: 'table', shape: 'square' },
  { id: 'round', label: 'Mesa redonda', kind: 'table', shape: 'round' },
  { id: 'rectangle', label: 'Mesa rectangular', kind: 'table', shape: 'rectangle' },
  { id: 'wall', label: 'Muro', kind: 'wall', shape: 'rectangle' },
  { id: 'counter', label: 'Barra', kind: 'counter', shape: 'rectangle' },
  { id: 'door', label: 'Puerta', kind: 'door', shape: 'rectangle' },
  { id: 'label', label: 'Texto', kind: 'label', shape: 'rectangle' },
]
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const countTables = (plan: Plan) => plan.areas.reduce((sum, area) => sum + area.elements.filter(item => item.kind === 'table').length, 0)
const isNumber = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const validLabel = (label: string) => label.trim().length > 0 && label.trim().length <= 80 && !/[<>\u0000-\u001f]/.test(label)

function initialPlan(): Plan {
  const tables: Element[] = sampleTables.map(table => ({
    id: 'table-' + table.number, kind: 'table', shape: table.shape === 'long' ? 'rectangle' : table.shape,
    label: 'Mesa ' + String(table.number).padStart(2, '0'), capacity: table.seats,
    x: table.x + table.width / 2, y: table.y + table.height / 2,
    width: table.width, height: table.height, rotation: 0,
  }))
  const fixture = (id: string, kind: Kind, label: string, x: number, y: number, width: number, height: number, rotation = 0): Element =>
    ({ id, kind, label, x, y, width, height, rotation, shape: 'rectangle', capacity: 0 })
  return { areas: [{ id: 'main', name: 'Salón principal', width: 640, height: 452, elements: [
    fixture('wall-top', 'wall', 'Muro norte', 320, 24, 592, 8),
    fixture('wall-left', 'wall', 'Muro poniente', 24, 220, 8, 392),
    fixture('wall-right', 'wall', 'Muro oriente', 616, 220, 8, 392),
    fixture('wall-bottom', 'wall', 'Muro sur', 410, 416, 412, 8),
    fixture('window-label', 'label', 'Ventanal', 240, 46, 120, 24),
    fixture('door-entry', 'door', 'Entrada', 110, 410, 68, 28),
    fixture('counter-main', 'counter', 'Barra', 520, 396, 192, 32),
    ...tables,
  ] }] }
}

function initialRoom(): Room {
  return Object.fromEntries(sampleTables.map(table => ['table-' + table.number, {
    state: table.state, account: table.state === 'free' ? null : '04' + (table.number === 5 ? '1' : table.number === 3 ? '2' : '0'),
    people: table.state === 'free' ? 0 : table.number === 5 ? 2 : 4,
  }]))
}

function bounds(element: Element) {
  const angle = element.rotation * Math.PI / 180
  return {
    x: (Math.abs(Math.cos(angle)) * element.width + Math.abs(Math.sin(angle)) * element.height) / 2,
    y: (Math.abs(Math.sin(angle)) * element.width + Math.abs(Math.cos(angle)) * element.height) / 2,
  }
}

function fit(element: Element, area: Area, snap = false): Element {
  let resized = element
  for (let pass = 0; pass < 4; pass++) {
    const extent = bounds(resized)
    const ratio = Math.min(1, area.width / (extent.x * 2), area.height / (extent.y * 2))
    if (ratio === 1) break
    resized = { ...resized, width: Math.max(8, Math.floor(resized.width * ratio)), height: Math.max(8, Math.floor(resized.height * ratio)) }
  }
  const half = bounds(resized), step = snap ? 20 : 1
  return { ...resized,
    x: Math.min(Math.floor(area.width - half.x), Math.max(Math.ceil(half.x), Math.round(element.x / step) * step)),
    y: Math.min(Math.floor(area.height - half.y), Math.max(Math.ceil(half.y), Math.round(element.y / step) * step)),
  }
}

function planErrors(plan: Plan): string[] {
  const errors: string[] = [], names = new Set<string>(), ids = new Set<string>()
  let total = 0
  for (const area of plan.areas) {
    const areaName = area.name.trim().toLocaleLowerCase()
    if (!validLabel(area.name) || names.has(areaName)) errors.push('Cada área necesita un nombre único de hasta 80 caracteres.')
    names.add(areaName)
    if (!isNumber(area.width, 200, 5000) || !isNumber(area.height, 200, 5000)) errors.push('Las áreas deben medir entre 200 y 5000 unidades.')
    const labels = new Set<string>()
    if (ids.has(area.id)) errors.push('Hay elementos repetidos.')
    ids.add(area.id)
    for (const element of area.elements) {
      total++
      if (ids.has(element.id)) errors.push('Hay elementos repetidos.')
      ids.add(element.id)
      if (!validLabel(element.label)) errors.push('Todos los elementos necesitan un nombre de hasta 80 caracteres.')
      if (element.kind === 'table') {
        const label = element.label.trim().toLocaleLowerCase()
        if (labels.has(label)) errors.push('Cada mesa necesita un nombre único dentro de su área.')
        labels.add(label)
        if (!Number.isInteger(element.capacity) || !isNumber(element.capacity, 1, 100)) errors.push('La capacidad debe estar entre 1 y 100.')
      }
      const half = bounds(element)
      if (element.x < half.x - 0.01 || element.y < half.y - 0.01 || element.x + half.x > area.width + 0.01 || element.y + half.y > area.height + 0.01) errors.push('Los elementos deben quedar dentro del área.')
    }
  }
  if (total > 1000) errors.push('El plano admite hasta 1000 elementos.')
  return [...new Set(errors)]
}

function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object' || !('areas' in value) || !Array.isArray(value.areas) || !value.areas.length || value.areas.length > 20) return false
  return value.areas.every((area: unknown) => {
    if (!area || typeof area !== 'object') return false
    const a = area as Area
    return typeof a.id === 'string' && typeof a.name === 'string' && isNumber(a.width, 200, 5000) && isNumber(a.height, 200, 5000) && Array.isArray(a.elements) && a.elements.length <= 500 && a.elements.every((element: Element) =>
      element && typeof element.id === 'string' && typeof element.label === 'string' && Object.hasOwn(kinds, element.kind) && Object.hasOwn(shapes, element.shape) &&
      isNumber(element.capacity, 0, 100) && isNumber(element.width, 8, 5000) && isNumber(element.height, 8, 5000) &&
      isNumber(element.x, 0, 5000) && isNumber(element.y, 0, 5000) && isNumber(element.rotation, 0, 359))
  }) && planErrors(value as Plan).length === 0
}

function readStored(): Stored {
  const plan = initialPlan(), fallback = { draft: plan, published: plan, room: initialRoom(), pending: null }
  try {
    const stored = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
    if (!stored || !isPlan(stored.draft) || !isPlan(stored.published)) return fallback
    const room: Room = initialRoom()
    if (stored.room && typeof stored.room === 'object') for (const [id, entry] of Object.entries(stored.room) as [string, Room[string]][]) {
      if (entry && Object.hasOwn(states, entry.state) && (entry.account === null || typeof entry.account === 'string') && isNumber(entry.people, 0, 100)) room[id] = entry
    }
    const pending = stored.pending && isPlan(stored.pending.plan) && Array.isArray(stored.pending.tableIds) && stored.pending.tableIds.every((id: unknown) => typeof id === 'string') && same(stored.pending.plan, stored.draft) ? stored.pending : null
    return { draft: stored.draft, published: stored.published, room, pending }
  } catch { return fallback }
}

function tableIndex(plan: Plan) {
  return new Map(plan.areas.flatMap(area => area.elements.filter(item => item.kind === 'table').map(item => [item.id, { ...item, areaId: area.id }] as const)))
}

function blockingTables(before: Plan, after: Plan, room: Room) {
  const prior = tableIndex(before), next = tableIndex(after)
  return Object.entries(room).filter(([, state]) => state.state !== 'free' || state.account).flatMap(([id, entry]) => {
    const was = prior.get(id), now = next.get(id)
    const changed = !was || !now || (['areaId', 'label', 'capacity', 'x', 'y', 'width', 'height', 'rotation'] as const).some(field => was[field] !== now[field])
    return changed ? [{ id, label: was?.label || now?.label || 'Mesa', account: entry.account }] : []
  })
}

function nextTableName(area: Area) {
  let number = 1
  const names = new Set(area.elements.filter(item => item.kind === 'table').map(item => item.label.toLocaleLowerCase()))
  while (names.has('mesa ' + String(number).padStart(2, '0'))) number++
  return 'Mesa ' + String(number).padStart(2, '0')
}

function NumericField({ label, value, min = 0, max = 5000, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => setRaw(String(value)), [value])
  const invalid = raw.trim() === '' || !Number.isFinite(Number(raw)) || Number(raw) < min || Number(raw) > max || !Number.isInteger(Number(raw))
  return <Input label={label} type="number" inputMode="numeric" min={min} max={max} step={1} value={raw}
    onChange={next => { setRaw(next); const number = Number(next); if (next.trim() && Number.isInteger(number) && number >= min && number <= max) onChange(number) }}
    onBlur={() => setRaw(String(value))} isInvalid={invalid}
    errorMessage={'Usa un entero entre ' + min + ' y ' + max + '.'} validationBehavior="aria"/>
}

function PlanCanvas({ area, room, selected, editing, grid, pan, zoom, reset, onSelect, onMove, onDelete }: {
  area: Area; room: Room; selected: string | null; editing: boolean; grid: boolean; pan: boolean; zoom: number; reset: number
  onSelect: (id: string | null) => void; onMove: (element: Element) => void; onDelete: (id: string) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(640)
  const [moving, setMoving] = useState<Element | null>(null)
  const drag = useRef<{ element: Element; x: number; y: number; scale: number } | null>(null)
  const lastMoved = useRef<Element | null>(null)
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const fade = useScrollFade()
  const fitScale = Math.min(1, viewportWidth / area.width, 520 / area.height)
  const scale = fitScale * zoom
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const measure = () => setViewportWidth(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { viewport.current?.scrollTo(0, 0); fade.reset() }, [reset, area.id])
  function startDrag(event: PointerEvent<HTMLButtonElement>, element: Element) {
    if (pan || event.button !== 0) return
    onSelect(element.id)
    if (!editing) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const renderedWidth = event.currentTarget.closest('.d-floor-canvas')?.getBoundingClientRect().width
    drag.current = { element, x: event.clientX, y: event.clientY, scale: renderedWidth ? renderedWidth / area.width : scale }
    lastMoved.current = element
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || drag.current.element.id !== event.currentTarget.dataset.elementId) return
    const source = drag.current
    const next = fit({ ...source.element, x: source.element.x + (event.clientX - source.x) / source.scale, y: source.element.y + (event.clientY - source.y) / source.scale }, area, grid)
    lastMoved.current = next
    setMoving(next)
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    if (!drag.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!cancel && lastMoved.current && !same(lastMoved.current, drag.current.element)) onMove(lastMoved.current)
    drag.current = null
    lastMoved.current = null
    setMoving(null)
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, element: Element) {
    if (!editing) return
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onDelete(element.id); return }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
    if (!direction) return
    event.preventDefault()
    const step = event.shiftKey ? 20 : 1
    onMove(fit({ ...element, x: element.x + direction[0] * step, y: element.y + direction[1] * step }, area))
  }
  return <div className="d-floor-map-wrap">
    <ScrollFade progress={fade.progress} surfaceClassName="from-background-secondary-default"/>
    <div ref={viewport} className="d-floor-map" data-pan={pan} role="region" aria-label={'Plano de ' + area.name} tabIndex={0}
      style={{ height: Math.max(224, Math.min(540, area.height * fitScale)) }} onScroll={fade.onScroll}
      onPointerDown={event => {
        if (!pan || event.button !== 0) return
        event.preventDefault()
        const node = event.currentTarget
        node.setPointerCapture(event.pointerId)
        panning.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop }
      }}
      onPointerMove={event => {
        if (!panning.current) return
        event.currentTarget.scrollLeft = panning.current.left - (event.clientX - panning.current.x)
        event.currentTarget.scrollTop = panning.current.top - (event.clientY - panning.current.y)
      }}
      onPointerUp={() => { panning.current = null }} onPointerCancel={() => { panning.current = null }}>
      <div className="d-floor-canvas-space" style={{ width: area.width * scale, height: area.height * scale }}>
        <div className="d-floor-canvas" data-grid={editing && grid} style={{ width: area.width, height: area.height, transform: 'scale(' + scale + ')' }}
          onClick={event => { if (event.target === event.currentTarget) onSelect(null) }}>
          {area.elements.map(original => {
            const element = moving?.id === original.id ? moving : original
            const state = room[element.id]?.state || 'free'
            return <Button key={element.id} variant="ghost" className={cx('d-floor-object', element.kind === 'table' && 'd-floor-table')}
              data-element-id={element.id} data-kind={element.kind} data-shape={element.shape} data-state={state} data-selected={selected === element.id}
              aria-label={element.label || kinds[element.kind]} aria-pressed={selected === element.id}
              style={{ left: element.x - element.width / 2, top: element.y - element.height / 2, width: element.width, height: element.height, transform: 'rotate(' + element.rotation + 'deg)' }}
              onPointerDown={event => startDrag(event, element)} onPointerMove={moveDrag} onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)}
              onFocus={() => onSelect(element.id)} onKeyDown={event => keyboard(event, element)} onClick={() => { if (!pan) onSelect(element.id) }}>
              <span className="d-floor-object-content">
                <b>{element.label || kinds[element.kind]}</b>
                {element.kind === 'table' && <><span className="d-floor-table-state">{states[state]}</span><span className="d-floor-seat-dots" aria-label={element.capacity + ' lugares'}>{Array.from({ length: Math.min(element.capacity, 12) }, (_, index) => <i key={index}/>)}{element.capacity > 12 && <small>+{element.capacity - 12}</small>}</span></>}
              </span>
            </Button>
          })}
        </div>
      </div>
    </div>
    <div className="d-floor-map-caption"><span>{area.width} × {area.height} · {area.elements.filter(item => item.kind === 'table').length} mesas</span><span>{pan ? 'Arrastra para recorrer' : editing ? 'Arrastra un elemento para moverlo' : 'Selecciona una mesa'}</span></div>
  </div>
}

export default function FloorEditor({tourEditing, demonstration=false}:{tourEditing?:boolean;demonstration?:boolean}) {
  const [initial] = useState(() => demonstration ? {draft:initialPlan(),published:initialPlan(),room:initialRoom(),pending:null} : readStored())
  const [isolated] = useState(demonstration)
  const [history, setHistory] = useState<History>({ past: [], present: initial.draft, future: [] })
  const [published, setPublished] = useState(initial.published)
  const [room, setRoom] = useState(initial.room)
  const [pending, setPending] = useState<Pending>(initial.pending)
  const [selectedArea, setSelectedArea] = useState(initial.draft.areas[0].id)
  const [selected, setSelected] = useState<string | null>('table-3')
  const [localEditing, setEditing] = useState(false)
  const editing=tourEditing??localEditing
  useEffect(()=>{if(tourEditing!==undefined)setEditing(tourEditing)},[tourEditing])
  const [preview, setPreview] = useState(false)
  const [grid, setGrid] = useState(true)
  const [pan, setPan] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [newElement, setNewElement] = useState(palette[0].id)
  const [reset, setReset] = useState(0)
  const [review, setReview] = useState<Plan | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(JSON.stringify(initial.draft))
  const [storageAvailable, setStorageAvailable] = useState(true)
  const draft = history.present, shown = preview ? published : draft
  const area = shown.areas.find(item => item.id === selectedArea) || shown.areas[0]
  const element = area.elements.find(item => item.id === selected)
  const errors = planErrors(draft), valid = errors.length === 0
  const dirty = saved !== JSON.stringify(draft)
  const locked = !editing || preview || Boolean(pending)
  const blockers = review ? blockingTables(published, review, room) : []
  const pendingBlockers = pending ? blockingTables(published, pending.plan, room) : []
  const totalElements = draft.areas.reduce((sum, item) => sum + item.elements.length, 0)

  function persist(data: Stored) {
    if (isolated) { setSaved(JSON.stringify(data.draft)); return }
    try { sessionStorage.setItem(storageKey, JSON.stringify(data)); setStorageAvailable(true) }
    catch { setStorageAvailable(false) }
    setSaved(JSON.stringify(data.draft))
  }
  useEffect(() => {
    if (!valid) return
    const timer = window.setTimeout(() => persist({ draft, published, room, pending }), 600)
    return () => window.clearTimeout(timer)
  }, [draft, published, room, pending, valid])

  function edit(next: Plan) {
    if (locked) return
    setHistory(current => same(current.present, next) ? current : { past: [...current.past, current.present].slice(-60), present: next, future: [] })
    setReview(null); setConfirmClose(false); setMessage('')
  }
  function editArea(patch: Partial<Area>) {
    edit({ areas: draft.areas.map(item => item.id === area.id ? { ...item, ...patch } : item) })
  }
  function editElement(next: Element) {
    editArea({ elements: area.elements.map(item => item.id === next.id ? fit(next, area) : item) })
  }
  function historyStep(direction: 'undo' | 'redo') {
    if (locked) return
    setHistory(current => {
      if (direction === 'undo' && current.past.length) return { past: current.past.slice(0, -1), present: current.past.at(-1)!, future: [current.present, ...current.future] }
      if (direction === 'redo' && current.future.length) return { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) }
      return current
    })
    setReview(null); setConfirmClose(false); setMessage('')
  }
  function addArea() {
    if (locked || draft.areas.length >= 20) return
    let number = draft.areas.length + 1
    while (draft.areas.some(item => item.name.toLocaleLowerCase() === 'área ' + number)) number++
    const next: Area = { id: crypto.randomUUID(), name: 'Área ' + number, width: 640, height: 452, elements: [] }
    edit({ areas: [...draft.areas, next] }); setSelectedArea(next.id); setSelected(null); setZoom(1)
  }
  function addElement(option: typeof palette[number]) {
    if (locked || area.elements.length >= 500 || totalElements >= 1000) return
    const size = option.kind === 'wall' ? [200, 12] : option.kind === 'counter' ? [180, 60] : option.kind === 'door' ? [70, 24] : option.kind === 'label' ? [140, 36] : [104, option.shape === 'rectangle' ? 72 : 104]
    const next = fit({ id: crypto.randomUUID(), kind: option.kind, shape: option.shape, label: option.kind === 'table' ? nextTableName(area) : option.label,
      capacity: option.kind === 'table' ? 4 : 0, x: area.width / 2, y: area.height / 2, width: size[0], height: size[1], rotation: 0 }, area, grid)
    editArea({ elements: [...area.elements, next] }); setSelected(next.id)
  }
  function duplicate() {
    if (locked || !element || area.elements.length >= 500 || totalElements >= 1000) return
    const next = fit({ ...element, id: crypto.randomUUID(), x: element.x + 40, y: element.y + 40, label: element.kind === 'table' ? nextTableName(area) : element.label }, area)
    editArea({ elements: [...area.elements, next] }); setSelected(next.id)
  }
  function removeElement(id = element?.id) {
    if (locked || !id) return
    editArea({ elements: area.elements.filter(item => item.id !== id) }); setSelected(null)
  }
  function saveDraft() {
    if (!valid) return
    persist({ draft, published, room, pending })
    setMessage('Borrador guardado en esta demostración.')
  }
  function applyPublished(plan: Plan, nextRoom = room) {
    if (blockingTables(published, plan, nextRoom).length > 0) return
    setPublished(plan); setRoom(nextRoom); setPending(null); setReview(null); setConfirmClose(false)
    persist({ draft: plan, published: plan, room: nextRoom, pending: null })
    setMessage('Plano publicado en esta demostración.')
  }
  function queuePublish() {
    if (!review || !valid) return
    const next = { plan: review, tableIds: blockers.map(item => item.id) }
    setPending(next); setReview(null); setConfirmClose(false)
    persist({ draft, published, room, pending: next })
    setMessage('Publicación pendiente en la demo.')
  }
  function releaseAndPublish(plan: Plan, ids: string[]) {
    const nextRoom = { ...room }
    for (const id of ids) nextRoom[id] = { state: 'free', account: null, people: 0 }
    applyPublished(plan, nextRoom)
  }
  function cancelPending() {
    setPending(null); persist({ draft, published, room, pending: null }); setMessage('Espera cancelada. El borrador se conserva.')
  }

  return <div className="d-floor-editor">
    <header className="d-page-head">
      <div><span className="d-eyebrow">Negocio</span><h1>Plano de mesas</h1><p>{shown.areas.length} {shown.areas.length === 1 ? 'área' : 'áreas'} · {countTables(shown)} mesas · {preview ? 'Versión publicada' : 'Borrador del salón'}</p></div>
      <div className="d-floor-header-actions">
        <Button variant="secondary" leadingIcon={RiEyeLine} onClick={() => { setPreview(current => !current); setSelected(null); setZoom(1); setReview(null) }}>{preview ? 'Volver al borrador' : 'Ver publicado'}</Button>
        {!preview && <Button data-target="d-floor-edit" onClick={() => setEditing(current => !current)}>{editing ? 'Terminar edición' : 'Editar plano'}</Button>}
      </div>
    </header>

    {message && <p className="d-note" role="status">{message}</p>}
    {!storageAvailable && <p className="d-note" role="status">El navegador no permite guardar para después. Los cambios se conservan mientras esta pantalla esté abierta.</p>}
    {pending && <section className="d-floor-review" aria-label="Publicación pendiente" data-state="pending">
      <div><h2>Publicación pendiente</h2><p>Estas mesas deben quedar libres. La versión publicada se conserva mientras esperas.</p></div>
      <ul>{pendingBlockers.map(item => <li key={item.id}><strong>{item.label}</strong><span>{item.account ? 'Cuenta ' + item.account : 'Mesa ocupada'}</span></li>)}</ul>
      <div className="d-floor-review-actions"><Button variant="secondary" onClick={cancelPending}>Cancelar espera</Button><Button onClick={() => releaseAndPublish(pending.plan, pending.tableIds)}>Simular liberación de mesas</Button></div>
      <p className="d-note">La simulación libera las mesas del ejemplo y aplica el plano pendiente. No modifica cuentas reales.</p>
    </section>}

    <div className="d-floor-area-row">
      <Select label="Área" selectedKey={area.id} onSelectionChange={key => { setSelectedArea(String(key)); setSelected(null); setZoom(1); setReset(current => current + 1) }}>
        {shown.areas.map(item => <SelectItem id={item.id} key={item.id}>{item.name || 'Área sin nombre'}</SelectItem>)}
      </Select>
      {!locked && <><Button variant="secondary" leadingIcon={RiAddLine} disabled={draft.areas.length >= 20} onClick={addArea}>Agregar área</Button><Button variant="ghost" onClick={() => setSelected(null)}>Editar área</Button></>}
      <span className="d-floor-save-state">{preview ? 'Vista publicada' : pending ? 'En espera' : !valid ? 'Revisa el borrador' : dirty ? 'Guardando borrador…' : 'Borrador guardado'}</span>
    </div>

    <div className="d-floor-tools" aria-label="Herramientas del plano">
      <div className="d-floor-history">
        <Button variant="secondary" iconOnly leadingIcon={RiArrowGoBackLine} aria-label="Deshacer" disabled={locked || !history.past.length} onClick={() => historyStep('undo')}/>
        <Button variant="secondary" iconOnly leadingIcon={RiArrowGoForwardLine} aria-label="Rehacer" disabled={locked || !history.future.length} onClick={() => historyStep('redo')}/>
        {!locked && <Checkbox isSelected={grid} onChange={setGrid}>Ajustar a cuadrícula</Checkbox>}
      </div>
      <div className="d-floor-view-tools">
        <Button variant={pan ? 'primary' : 'secondary'} iconOnly leadingIcon={RiDragMove2Line} aria-label="Mover vista" aria-pressed={pan} onClick={() => setPan(current => !current)}/>
        <Button variant="secondary" iconOnly leadingIcon={RiSubtractLine} aria-label="Alejar plano" disabled={zoom <= 0.5} onClick={() => setZoom(current => Math.max(0.5, current - 0.25))}/>
        <Select aria-label="Zoom del plano" selectedKey={String(zoom)} onSelectionChange={key => setZoom(Number(key))}>
          {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <SelectItem key={String(value)} id={String(value)}>{value * 100}%</SelectItem>)}
        </Select>
        <Button variant="secondary" iconOnly leadingIcon={RiAddLine} aria-label="Acercar plano" disabled={zoom >= 2} onClick={() => setZoom(current => Math.min(2, current + 0.25))}/>
        <Button variant="secondary" leadingIcon={RiFocus3Line} onClick={() => { setZoom(1); setPan(false); setReset(current => current + 1) }}>Ajustar plano</Button>
      </div>
    </div>

    {!locked && <>
      <div className="d-floor-palette" role="group" aria-label="Agregar elementos al plano">
        {palette.map(option => <Button key={option.id} variant="secondary" leadingIcon={RiAddLine} disabled={area.elements.length >= 500 || totalElements >= 1000} onClick={() => addElement(option)}>{option.label}</Button>)}
      </div>
      <div className="d-floor-palette-compact">
        <Select label="Agregar al plano" selectedKey={newElement} onSelectionChange={key => setNewElement(String(key))}>
          {palette.map(option => <SelectItem key={option.id} id={option.id}>{option.label}</SelectItem>)}
        </Select>
        <Button variant="secondary" leadingIcon={RiAddLine} disabled={area.elements.length >= 500 || totalElements >= 1000} onClick={() => addElement(palette.find(option => option.id === newElement)!)}>Agregar</Button>
      </div>
    </>}

    <div className="d-floor-workspace">
      <div className="d-floor-map-column">
        <PlanCanvas area={area} room={room} selected={selected} editing={!locked} grid={grid} pan={pan} zoom={zoom} reset={reset}
          onSelect={setSelected} onMove={editElement} onDelete={removeElement}/>
        <div className="d-floor-legend" aria-label="Estados de las mesas"><span data-state="free">Disponible</span><span data-state="busy">En servicio</span><span data-state="pay">Por cobrar</span></div>
        <Select label="Seleccionar elemento" selectedKey={element?.id || 'area'} onSelectionChange={key => setSelected(key === 'area' ? null : String(key))}>
          <SelectItem id="area">Editar área</SelectItem>
          {area.elements.map(item => <SelectItem id={item.id} key={item.id} textValue={item.label}>{item.label || kinds[item.kind]}{item.kind === 'table' ? ' · ' + states[room[item.id]?.state || 'free'] : ''}</SelectItem>)}
        </Select>
      </div>
      <section className="d-floor-properties" aria-label="Propiedades del plano" key={area.id + ':' + (element?.id || 'area')}>
        <div className="d-floor-properties-heading"><span className="d-eyebrow">{element ? kinds[element.kind] : 'Área'}</span><h2>{element?.label || area.name || 'Sin nombre'}</h2></div>
        {element?.kind === 'table' && <div className="d-floor-room-state">
          <span className="d-status" data-status={(room[element.id]?.state || 'free') === 'free' ? 'ready' : room[element.id]?.state === 'pay' ? 'pending' : 'working'}>{states[room[element.id]?.state || 'free']}</span>
          <span>{element.capacity} lugares{room[element.id]?.people ? ' · ' + room[element.id].people + ' personas' : ''}</span>
          {room[element.id]?.account && <small>Cuenta {room[element.id].account}</small>}
        </div>}
        {locked ? <dl className="d-facts">
          {element?.kind === 'table' && <div><dt>Forma</dt><dd>{shapes[element.shape]}</dd></div>}
          <div><dt>Dimensiones</dt><dd>{element?.width || area.width} × {element?.height || area.height}</dd></div>
          {element && <><div><dt>Posición</dt><dd>{element.x}, {element.y}</dd></div><div><dt>Rotación</dt><dd>{element.rotation}°</dd></div></>}
          <div><dt>Área</dt><dd>{area.name}</dd></div>
        </dl> : <div className="d-floor-property-fields">
          <Input label={element ? element.kind === 'table' ? 'Nombre de la mesa' : 'Nombre del elemento' : 'Nombre del área'} maxLength={80}
            value={element?.label ?? area.name} onChange={value => element ? editElement({ ...element, label: value }) : editArea({ name: value })}
            isRequired isInvalid={!validLabel(element?.label ?? area.name)} errorMessage="Escribe un nombre de hasta 80 caracteres." validationBehavior="aria"/>
          {element?.kind === 'table' && <><Select label="Forma" selectedKey={element.shape} onSelectionChange={key => {
            if (key && Object.hasOwn(shapes, String(key))) editElement({ ...element, shape: String(key) as Shape, height: key === 'rectangle' ? element.height : element.width })
          }}>{Object.entries(shapes).map(([key, name]) => <SelectItem key={key} id={key}>{name}</SelectItem>)}</Select>
            <NumericField label="Lugares" value={element.capacity} min={1} max={100} onChange={value => editElement({ ...element, capacity: value })}/></>}
          <div className="d-floor-numbers">
            {(element ? ['width', 'height', 'x', 'y', 'rotation'] as const : ['width', 'height'] as const).map(field => <NumericField key={field} label={numberLabels[field]} value={(element || area)[field as 'width' | 'height']}
              min={field === 'x' || field === 'y' || field === 'rotation' ? 0 : element ? 8 : 200} max={field === 'rotation' ? 359 : 5000}
              onChange={value => {
                if (element) {
                  const patch = { ...element, [field]: value }
                  if (element.shape !== 'rectangle' && (field === 'width' || field === 'height')) patch.width = patch.height = value
                  editElement(patch)
                } else {
                  const nextArea = { ...area, [field]: value }
                  editArea({ [field]: value, elements: area.elements.map(item => fit(item, nextArea)) })
                }
              }}/>)}
          </div>
          {element && <div className="d-floor-element-actions"><Button variant="secondary" leadingIcon={RiFileCopyLine} disabled={area.elements.length >= 500 || totalElements >= 1000} onClick={duplicate}>Duplicar</Button><Button variant="ghost" leadingIcon={RiDeleteBinLine} onClick={() => removeElement()}>Eliminar elemento</Button></div>}
          {element && <Button variant="ghost" onClick={() => setSelected(null)}>Editar área</Button>}
        </div>}
        <p className="d-note">{preview ? 'Versión publicada de esta demo.' : pending ? 'Cancela la espera para seguir editando.' : editing ? 'Las flechas mueven el elemento. Mayús + flecha mueve 20 unidades.' : 'Activa la edición para modificar el plano.'}</p>
      </section>
    </div>

    {!valid && <div className="d-floor-validation" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
    {!preview && <div className="d-publish">
      <span>{pending ? 'Publicación en espera' : 'El borrador se guarda en esta sesión del navegador.'}</span>
      <div className="d-floor-review-actions"><Button variant="secondary" disabled={!valid} onClick={saveDraft}>Guardar borrador</Button><Button disabled={!valid || Boolean(pending) || same(draft, published)} onClick={() => { saveDraft(); setReview(draft); setConfirmClose(false); setMessage('') }}>Revisar publicación</Button></div>
    </div>}

    {review && <section className="d-floor-review" aria-label="Revisión del plano" data-state={blockers.length ? 'blocked' : 'ready'}>
      <h2>{confirmClose ? 'Confirmar cierre de cuentas' : blockers.length ? 'Hay mesas que impiden publicar' : 'Revisar publicación'}</h2>
      <p>{review.areas.length} áreas · {countTables(review)} mesas · {review.areas.reduce((sum, item) => sum + item.elements.reduce((seats, entry) => seats + entry.capacity, 0), 0)} lugares</p>
      {blockers.length > 0 && <><p>{confirmClose ? 'Se cerrarán las cuentas del ejemplo indicadas y se aplicará este plano. Esta acción no registra cobros.' : 'Estas mesas ocupadas cambiarían en el nuevo plano. Elige cómo continuar.'}</p>
        <ul>{blockers.map(item => <li key={item.id}><strong>{item.label}</strong><span>{item.account ? 'Cuenta ' + item.account : 'Sin cuenta abierta'}</span></li>)}</ul></>}
      <div className="d-floor-review-actions">
        <Button variant="secondary" onClick={() => { setReview(null); setConfirmClose(false); setEditing(true) }}>Volver a editar</Button>
        {blockers.length > 0 ? confirmClose
          ? <Button variant="danger" onClick={() => releaseAndPublish(review, blockers.map(item => item.id))}>Confirmar cierre en la demo</Button>
          : <><Button onClick={queuePublish}>Esperar a que se liberen</Button>{blockers.every(item => item.account) && <Button variant="secondary" onClick={() => setConfirmClose(true)}>Cerrar cuentas y publicar</Button>}</>
          : <Button onClick={() => applyPublished(review)}>Publicar en la demo</Button>}
      </div>
      <p className="d-note">Las acciones de esta demostración solo modifican datos locales.</p>
    </section>}
  </div>
}
