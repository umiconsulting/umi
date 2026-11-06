import type { Entry } from './data'

export type FilterSpec = { label: string; options: string[] }
export type Variant = { name: string; delta: number; active: boolean }
export type OptionGroup = { name: string; required: boolean; min: number; max: number; options: Variant[] }
export type Ingredient = { article: string; quantity: number; unit: string; cost: number | null }
export type ReceiptLine = { article: string; quantity: number; received: number; price: number; sku: string }
export const money = (n: number) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
export const jsonValue = <T,>(value: string | undefined, fallback: T): T => {
  if (!value) return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}
export const safeValues = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([key]) => !/PIN|Código completo|Código de canje/.test(key)))
const giftCodes = new Map([['DEMO-0281','Regalo · 0281'],['DEMO-0280','Regalo · 0280']])
export const registerGiftCode = (code:string,name:string) => { giftCodes.set(code.trim().toUpperCase(),name) }
export const giftFingerprint = async (code:string) => {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code.trim().toUpperCase()))
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('')
}
export const giftCardFor = async (code:string,entries:Entry[]) => {
  const hash=await giftFingerprint(code)
  return entries.find(e=>(e.name===giftCodes.get(code.trim().toUpperCase())||e.values?.codeHash===hash)&&e.cells.at(-1)==='Sin canjear')
}

export function receiptDeltas(lines:ReceiptLine[], previous:ReceiptLine[]):{article:string;quantity:number}[] {
  return lines.map((line,i)=>({article:line.article,quantity:line.received-(previous[i]?.received||0)}))
}

export function filtersFor(view: string, entries: Entry[]): FilterSpec[] {
  const state = { label: 'Estado', options: ['Todos', ...new Set(entries.map(r => r.cells.at(-1) || '').filter(Boolean))] }
  if (view === 'orders') return [{ label: 'Estado', options: ['Todos', 'Activos', 'Nuevos', 'En preparación', 'Listos', 'Completados', 'Cancelados'] }, { label: 'Canal', options: ['Todos', 'POS', 'WhatsApp', 'Web', 'Consola'] }]
  if (view === 'customers') return [{ label: 'Clientes', options: ['Todos', 'WhatsApp', 'Lealtad', 'Notas', 'Revisión'] }]
  if (view === 'team') return [{ label: 'Rol', options: ['Todos', ...new Set(entries.map(r => r.cells[0]))] }, state]
  if (view === 'items') return [{ label: 'Vista', options: ['Todos', 'Bajo mínimo', 'Preparar', 'Revisar costo', 'Archivados'] }, { label: 'Área', options: ['Todas', 'Almacén seco', 'Refrigeración', 'Vitrina', 'Barra'] }]
  if (view === 'recipes') return [{ label: 'Estado', options: ['Todos', 'Vigentes', 'Retiradas', 'Costo incompleto'] }]
  if (view === 'sales') return []
  if (view === 'costs') return [{ label: 'Costo', options: ['Todos', 'Completo', 'Desconocido', 'Cero confirmado'] }]
  if (view === 'loyalty') return [{ label: 'Miembros', options: ['Todos', 'Activos', 'Premio disponible', 'Sin visitas recientes'] }]
  return ['orders','refunds','receipts','shifts','registers','stations','routes','products','categories','preparation','purchases','devices','requests','terminals','giftcards','hours','locations','inbox','permissions','hardware','recovery'].includes(view) ? [state] : []
}

export function filterEntries(view: string, entries: Entry[], query: string, filters: Record<string, string>): Entry[] {
  const normal = (v: string) => v.toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return entries.filter(r => {
    const text = [r.name, r.detail, ...r.cells, ...Object.values(r.values || {})].join(' ')
    if (!normal(text).includes(normal(query))) return false
    const state = r.cells.at(-1) || ''
    return Object.entries(filters).every(([label, value]) => {
      if (!value || ['Todos','Todas'].includes(value)) return true
      if (label === 'Canal') return value === 'Web' ? /Web|Menú digital/.test(r.cells[1]) : r.cells[1] === value
      if (label === 'Rol') return r.cells[0] === value
      if (label === 'Área') return (r.values?.Área || r.detail || '').includes(value)
      if (label === 'Clientes') {
        const flags = r.values?.filtros || (r.name === 'Lucía Hernández' ? 'WhatsApp Lealtad Notas Revisión' : r.name === 'Elena Díaz' ? 'WhatsApp Lealtad Revisión' : text)
        return flags.includes(value)
      }
      if (label === 'Costo') return value === 'Desconocido' ? /Desconocido|Incompleto/.test(text) : value === 'Cero confirmado' ? text.includes('Cero confirmado') : !/Desconocido|Incompleto/.test(text)
      if (label === 'Miembros') return value === 'Activos' ? state === 'Activa' : text.includes(value)
      if (view === 'orders') {
        if (value === 'Activos') return !/Completado|Cancelado/.test(state)
        const aliases: Record<string,string[]> = { Nuevos: ['Nuevo','Por revisar'], Listos: ['Listo','Por cobrar'], Completados: ['Completado'], Cancelados: ['Cancelado'] }
        return (aliases[value] || [value]).includes(state)
      }
      if (view === 'recipes') return value === 'Retiradas' ? state.includes('Retirada') : value === 'Vigentes' ? state.includes('Vigente') : /Incompleto|Desconocido/.test(text)
      if (value === 'Archivados') return state === 'Archivado'
      return state === value
    })
  })
}

export function validatePin(pin: string, confirmation: string, optional = false): string {
  if (!pin && !confirmation && optional) return ''
  if (!/^\d{4,8}$/.test(pin)) return 'El PIN debe tener de 4 a 8 dígitos.'
  if (pin !== confirmation) return 'El PIN y su confirmación deben coincidir.'
  return ''
}

export function effectiveRoute(product: string, category: string, routes: Entry[]): Entry | null {
  const kind = (r: Entry) => r.values?.['Tipo de ruta'] || (r.name === 'Ruta predeterminada' ? 'Predeterminada' : r.name === category ? 'Categoría' : 'Producto')
  return routes.filter(r => !/Inactiva|Archivada/.test(r.cells.at(-1) || '') && (kind(r) === 'Predeterminada' || kind(r) === 'Categoría' && r.name === category || kind(r) === 'Producto' && r.name === product))
    .sort((a, b) => ['Producto','Categoría','Predeterminada'].indexOf(kind(a)) - ['Producto','Categoría','Predeterminada'].indexOf(kind(b)) || Number(a.cells[1]) - Number(b.cells[1]) || a.name.localeCompare(b.name))[0] || null
}

export function validateChoices(variants: Variant[], groups: OptionGroup[], price: number): string {
  if (variants.some(v => !v.name.trim() || !Number.isFinite(v.delta) || price + v.delta < 0)) return 'Cada variante necesita nombre y un precio final válido.'
  if (new Set(variants.map(v => v.name.trim())).size !== variants.length) return 'Los nombres de las variantes deben ser distintos.'
  for (const g of groups) {
    if (!g.name.trim() || !g.options.length || g.options.some(o => !o.name.trim() || !Number.isFinite(o.delta))) return 'Completa el nombre del grupo y sus opciones.'
    if (!Number.isInteger(g.min) || !Number.isInteger(g.max) || g.min < 0 || g.max < 1 || g.min > g.max || g.required && g.min < 1 || g.min > g.options.filter(o => o.active).length) return 'Revisa el mínimo y máximo de selecciones de cada grupo.'
  }
  return ''
}

export function validateReceiptLines(lines: ReceiptLine[]): string {
  if (!lines.length || lines.some(l => !l.article)) return 'Vincula cada línea con un artículo.'
  if (lines.some(l => !Number.isFinite(l.received) || l.received < 0 || l.received > l.quantity)) return 'La cantidad recibida debe estar entre cero y la cantidad facturada.'
  if (lines.every(l => l.received === 0)) return 'Registra al menos una cantidad recibida.'
  return ''
}

export function applyLocalAction(view: string, entry: Entry, action: string, values: Record<string, string>): Entry {
  const cells = [...entry.cells]
  const attrs = { ...entry.values, ...safeValues(values) }
  const setState = (next: string) => { cells[cells.length - 1] = next }
  if (action === 'Archivar' || action === 'Archivar rol') setState('Archivado')
  if (action === 'Desactivar persona') { setState('Inactiva'); cells[2] = 'Deshabilitado' }
  if (action === 'Restaurar persona') setState('Activa')
  if (action === 'Asignar PIN') attrs.hasPin = 'Sí'
  if (action === 'Quitar PIN') attrs.hasPin = 'No'
  if (action === 'Revocar dispositivo') setState('Revocado')
  if (action === 'Aprobar solicitud') setState('Aprobada')
  if (action === 'Denegar solicitud') setState('Denegada')
  if (action === 'Solicitar copia') attrs.lastCopy='Resultado físico desconocido · Solicitud simulada'
  if (action === 'Desactivar ruta') setState('Inactiva')
  if (action === 'Retirar receta') setState((cells.at(-1) || '').replace('Vigente', 'Retirada'))
  if (action === 'Canjear tarjeta') { setState('Canjeada'); attrs.canje = values['Contacto del cliente']; attrs.balanceAdded = cells[1] }
  if (view === 'customers') {
    if (action === 'Agregar sellos') attrs.stamps = String(Number(entry.values?.stamps || 5) + Number(values.Sellos || 1))
    if (action === 'Registrar visita') { cells[1] = String(Number(cells[1]) + 1); cells[0] = 'Hoy · Demo'; attrs.stamps = String(Number(entry.values?.stamps || 5) + 1) }
    if (action === 'Canjear recompensa') attrs.stamps = String(Math.max(0, Number(entry.values?.stamps || 5) - 8))
    if (action === 'Recargar saldo') attrs.balance = String(Number(entry.values?.balance || 220) + Number(values.Importe))
    if (action === 'Agregar nota') attrs.notes = [entry.values?.notes, values.Nota].filter(Boolean).join('\n')
    if (action !== 'Editar datos') attrs.lastOperation = `${action} · ${values['Referencia del recibo'] || values['Referencia del pago'] || 'Demostración'}`
  }
  if (view === 'items' && ['Ajustar existencia','Registrar merma','Registrar daño'].includes(action)) {
    const unit = cells[0].replace(/[\d.,\s]+/, '')
    const count = parseFloat(cells[0]) + Number(values.Cantidad) * (action === 'Ajustar existencia' && values.Dirección !== 'Reducir' ? 1 : -1)
    cells[0] = `${count.toLocaleString('es-MX')} ${unit}`
    attrs.lastMovement = `${action} · ${values.Cantidad} ${unit} · ${values.Motivo}`
  }
  return { ...entry, cells, values: attrs, status: /Inactiv|Archiv|Revocado|Deneg|Retirada/.test(cells.at(-1) || '') ? 'neutral' : /Pendiente|Por revisar/.test(cells.at(-1) || '') ? 'pending' : 'ready' }
}

export type AccessContext = { role: 'Owner' | 'Consulta' | 'Cajero'; products: string[]; platform: boolean }
export function canView(view: string, context: AccessContext): boolean {
  if (view === 'cafes') return context.platform
  if (view === 'billing') return context.platform && context.products.includes('dashboard')
  if (view === 'profile') return true
  if (!context.products.includes('dashboard')) return false
  if (['inbox','hours'].includes(view) && !context.products.includes('conversaflow')) return false
  if (['loyalty','rewards','giftcards','wallet'].includes(view) && !context.products.includes('cash')) return false
  if (context.role === 'Owner') return true
  const read = ['overview','orders','sales','refunds','receipts','shifts','customers','products','items','recipes','preparation','costs','loyalty','rewards','giftcards','wallet']
  return context.role === 'Consulta' ? read.includes(view) : ['overview','orders','receipts','shifts','customers','products'].includes(view)
}
