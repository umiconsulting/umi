import type { CashState } from './Cash'

export type Screen = 'login' | 'settings' | 'sale' | 'tables' | 'incoming' | 'kitchen' | 'cash' | 'payment' | 'done'
export type Service = 'here' | 'takeaway'
export type OrderFlow = 'digital' | 'here' | 'takeaway'
export type Role = 'cashier' | 'bar' | 'kitchen'
export type Station = 'bar' | 'kitchen'
export type StationState = 'sent' | 'received' | 'preparing' | 'ready'
export type KitchenState = 'draft' | 'sent' | 'received' | 'preparing' | 'ready' | 'delivered'
export type Item = { id: string; name: string; price: number; qty: number; detail?: string; category: string; productId?: string; round?: number; note?: string; course?: number; voidReason?: string }
export type OrderRound = { number: number; lineIds: string[]; stations: Record<Station, StationState>; delivered: boolean }
export type PaymentRecord = { id: string; method: string; channel: 'cash' | 'manual' | 'integrated' | 'bank'; principal: number; tip: number; received: number; change?: number; reference?: string }
export type TerminalAttempt = PaymentRecord & { status: 'waiting' | 'unknown' | 'failed' | 'approved' }
export type TableStatus = 'open' | 'seated' | 'ordered' | 'served' | 'awaiting_payment' | 'dirty'
export type RoomTable = { number: number; seats: number; state: TableStatus; guests: number; seatedAt?: number; group?: string }
export type PaymentPolicy = { mixed: boolean; cash: boolean; manual: boolean; integrated: boolean; transfer: boolean; tips: boolean; maxTip: number }
export type Scene = {
  customerName?:string; customerNote?:string; pickupTime?:string; menuOrderNumber?:string; hideMenuOrigin?:boolean;
  account: string;
  screen: Screen; items: Item[]; editing: boolean; milk: string; size: string;
  kitchen: KitchenState; readyItems: string[]; service: Service; paid: boolean;
  role: Role; stations: Record<Station, StationState>;
  received: string; incoming: boolean; ticket: boolean; source: 'counter' | 'menu';
  method: string; printed: boolean;
  pin: string; pinError: boolean; resumeScreen: Screen;
  tableNumber?: number | null; guests?: number; rounds?: OrderRound[]; editLineId?: string;
  productNote?: string; productCourse?: number; productQuantity?: number;
  payments?: PaymentRecord[]; terminalAttempt?: TerminalAttempt; splitPayment?: boolean;
  savedAccounts?: Record<string, AccountSnapshot>; room?: Record<number, RoomTable>;
  cashSession?: CashState; cashPostedIds?: string[];
}
export type AccountSnapshot = Pick<Scene, 'customerName' | 'customerNote' | 'pickupTime' | 'menuOrderNumber' | 'hideMenuOrigin' | 'account' | 'items' | 'milk' | 'size' | 'kitchen' | 'readyItems' | 'service' | 'paid' | 'stations' | 'received' | 'source' | 'method' | 'printed' | 'tableNumber' | 'guests' | 'rounds' | 'payments' | 'terminalAttempt' | 'splitPayment'>
export const concha: Item = { id: 'concha', name: 'Concha', price: 45, qty: 1, detail: 'Vainilla', category: 'Pan' }
export const latte: Item = { id: 'latte', name: 'Latte', price: 90, qty: 1, detail: 'Nube · Deslactosada', category: 'Bebidas' }
export const initial: Scene = {
  account: '042', tableNumber: 3, guests: 2,
  screen: 'sale', items: [latte, concha], editing: false, milk: 'Deslactosada', size: 'Nube',
  kitchen: 'draft', readyItems: [], service: 'here', paid: false, received: '',
  role: 'cashier', stations: { bar: 'sent', kitchen: 'sent' },
  incoming: true, ticket: false, source: 'counter', method: 'Efectivo', printed: false,
  pin: '', pinError: false, resumeScreen: 'sale',
}
export const incomingScene: Scene = { ...initial, account: '043', screen: 'incoming', source: 'menu', service: 'takeaway', tableNumber: null, guests: 1 }
export const completedScene: Scene = { ...incomingScene, screen: 'done', kitchen: 'delivered', stations: { bar: 'ready', kitchen: 'ready' }, readyItems: ['latte', 'concha'], incoming: false, received: '200', paid: true, printed: true }
export const kitchenCopy: Record<KitchenState, { title: string; detail: string }> = {
  draft: { title: 'Por enviar a cocina', detail: 'El pedido sigue abierto.' },
  sent: { title: 'Esperando recepción', detail: 'Comanda enviada a sus estaciones.' },
  received: { title: 'Recibida en estación', detail: 'Las estaciones confirman la recepción.' },
  preparing: { title: 'En preparación', detail: 'Consulta el avance de cada estación.' },
  ready: { title: 'Lista para entregar', detail: 'Todos los productos están listos.' },
  delivered: { title: 'Pedido entregado', detail: 'El servicio de esta comanda terminó.' },
}
export const accountId = (s: Scene) => s.account
export const orderIdentity = (s: Scene | AccountSnapshot) => s.source === 'menu' ? s.customerName || 'Lucía Hernández' : s.service === 'here' && s.tableNumber != null ? 'Mesa ' + String(s.tableNumber).padStart(2, '0') : 'Mostrador'
export const customerNote = 'El café sin azúcar, por favor.'
export const roleName: Record<Role, string> = { cashier: 'Caja', bar: 'Barra', kitchen: 'Cocina' }
export const staffName: Record<Role, string> = { cashier: 'Ana', bar: 'Luis', kitchen: 'Marta' }
export const demoPin: Record<Role, string> = { cashier: '2580', bar: '3690', kitchen: '1470' }
export const lockScene = (s: Scene): Scene => ({ ...s, screen: 'login', resumeScreen: s.screen === 'settings' || s.screen === 'login' ? s.resumeScreen : s.screen, pin: '', pinError: false, editing: false })
export const flowName: Record<OrderFlow, string> = { digital: 'Menú digital', here: 'Comer aquí', takeaway: 'Para llevar' }
export function sceneForFlow(flow: OrderFlow, animated = false): Scene {
  if (flow === 'digital') return incomingScene
  return { ...initial, account: flow === 'here' ? '042' : '044', service: flow, tableNumber: flow === 'here' ? 3 : null, incoming: false, ...(animated ? { items: [concha], milk: 'Entera', size: 'Clásico' } : {}) }
}
export const resultForFlow = (flow: OrderFlow): Scene => ({ ...completedScene, ...sceneForFlow(flow), screen: 'done', kitchen: 'delivered', stations: { bar: 'ready', kitchen: 'ready' }, readyItems: ['latte', 'concha'], incoming: false, received: '200', paid: true, printed: true })
export const stationFor = (item: Item): Station => item.category === 'Bebidas' ? 'bar' : 'kitchen'
export const stationItems = (s: Scene, station: Station, round?: number) => s.items.filter(i => !i.voidReason && stationFor(i) === station && (round === undefined ? (!s.rounds || i.round !== undefined) : i.round === round || !s.rounds && round === 1))
export function stationPatch(s: Scene, station: Station, state: StationState, round?: number): Partial<Scene> {
  if (s.rounds) {
    const number = round ?? s.rounds.find(r => !r.delivered && stationItems(s, station, r.number).length > 0)?.number
    const rounds = s.rounds.map(r => r.number === number ? { ...r, stations: { ...r.stations, [station]: state } } : r)
    return { rounds, ...roundProgress({ ...s, rounds }) }
  }
  const stations = { ...s.stations, [station]: state }
  const active = (['bar', 'kitchen'] as Station[]).filter(name => stationItems(s, name).length > 0)
  const states = active.map(name => stations[name])
  const kitchen: KitchenState = states.every(value => value === 'ready') ? 'ready' : states.some(value => value === 'preparing' || value === 'ready') ? 'preparing' : states.some(value => value === 'received') ? 'received' : 'sent'
  return { stations, kitchen }
}

// Local transaction rules mirror the existing POS contracts; no API or hardware is called.
const amount = (value: number) => Math.round(value * 100) / 100
export const orderTotal = (s: Pick<Scene, 'items'>) => amount(s.items.filter(i => !i.voidReason).reduce((sum, i) => sum + i.price * i.qty, 0))
export const paidPrincipal = (s: Pick<Scene, 'payments' | 'paid' | 'items'>) => s.payments ? amount(s.payments.reduce((sum, p) => sum + p.principal, 0)) : s.paid ? orderTotal(s) : 0
export const balanceDue = (s: Pick<Scene, 'payments' | 'paid' | 'items'>) => amount(Math.max(0, orderTotal(s) - paidPrincipal(s)))
export const tipsPaid = (s: Pick<Scene, 'payments'>) => amount((s.payments ?? []).reduce((sum, p) => sum + p.tip, 0))
export const paymentPending = (s: Pick<Scene, 'terminalAttempt'>) => ['waiting', 'unknown'].includes(s.terminalAttempt?.status ?? '')
export const lineIsSent = (s: Scene, item: Item) => item.round !== undefined || !s.rounds && s.kitchen !== 'draft'
export const pendingItems = (s: Scene) => s.items.filter(i => !i.voidReason && !lineIsSent(s, i))

export function roundState(s: Scene): Scene {
  if (s.rounds) return s
  if (s.kitchen === 'draft') return { ...s, rounds: [] }
  return { ...s, items: s.items.map(i => ({ ...i, round: 1 })), rounds: [{ number: 1, lineIds: s.items.map(i => i.id), stations: s.stations, delivered: s.kitchen === 'delivered' }] }
}
function roundProgress(s: Scene): Pick<Scene, 'kitchen' | 'stations'> {
  const active = (s.rounds ?? []).filter(r => !r.delivered)
  const ranking: StationState[] = ['sent', 'received', 'preparing', 'ready']
  const stations = { ...s.stations }
  const states: StationState[] = []
  for (const station of ['bar', 'kitchen'] as Station[]) {
    const own = active.filter(r => stationItems(s, station, r.number).length).map(r => r.stations[station])
    stations[station] = own.length ? ranking[Math.min(...own.map(value => ranking.indexOf(value)))] : 'ready'
    states.push(...own)
  }
  const kitchen = !states.length ? s.rounds?.length ? 'delivered' : 'draft' : states.every(value => value === 'ready') ? 'ready' : states.some(value => value === 'preparing' || value === 'ready') ? 'preparing' : states.some(value => value === 'received') ? 'received' : 'sent'
  return { kitchen, stations }
}
function assertWritable(s: Scene) {
  if (s.paid) throw new Error('La cuenta ya está pagada. Abre una nueva cuenta.')
  if (paymentPending(s)) throw new Error('Hay un cobro pendiente de resolver. Revisa la terminal antes de modificar la cuenta.')
  if (s.payments?.length) throw new Error('La cuenta tiene pagos recibidos. Completa el cobro antes de modificar sus productos.')
}
export function addOrderItem(scene: Scene, item: Item, editLineId?: string): Scene {
  assertWritable(scene)
  const s = roundState(scene)
  const productId = item.productId ?? item.id
  const existing = editLineId ? s.items.find(i => i.id === editLineId) : s.items.find(i => !i.voidReason && i.round === undefined && (i.productId ?? i.id) === productId && i.detail === item.detail && i.note === item.note && (i.course ?? 1) === (item.course ?? 1))
  if (existing && existing.round !== undefined) throw new Error('La línea enviada no se edita. Repite el producto para una nueva ronda.')
  let id = productId
  let suffix = 2
  while (s.items.some(i => i.id === id)) id = `${productId}-${suffix++}`
  const next = { ...item, id: existing?.id ?? id, productId, round: undefined, voidReason: undefined, qty: editLineId ? item.qty : Math.min(999, (existing?.qty ?? 0) + item.qty) }
  return { ...s, items: existing ? s.items.map(i => i.id === existing.id ? next : i) : [...s.items, next], editing: false, editLineId: undefined }
}
export function adjustItem(s: Scene, id: string, delta: number): Scene {
  assertWritable(s)
  const item = s.items.find(i => i.id === id)
  if (!item || lineIsSent(s, item)) return s
  return { ...s, items: s.items.map(i => i.id === id ? { ...i, qty: Math.min(999, i.qty + delta) } : i).filter(i => i.qty > 0) }
}
export function sendRound(scene: Scene): Scene {
  assertWritable(scene)
  const s = roundState(scene)
  const pending = pendingItems(s)
  if (!pending.length) return s
  const number = Math.max(0, ...(s.rounds ?? []).map(r => r.number)) + 1
  const rounds = [...(s.rounds ?? []), { number, lineIds: pending.map(i => i.id), stations: { bar: 'sent', kitchen: 'sent' } as Record<Station, StationState>, delivered: false }]
  const next = { ...s, rounds, items: s.items.map(i => pending.some(p => p.id === i.id) ? { ...i, round: number } : i) }
  return { ...next, ...roundProgress(next) }
}
export function deliverRounds(scene: Scene): Scene {
  const s = roundState(scene)
  const rounds = s.rounds!.map(r => (['bar', 'kitchen'] as Station[]).every(station => !stationItems(s, station, r.number).length || r.stations[station] === 'ready') ? { ...r, delivered: true } : r)
  return { ...s, rounds, ...roundProgress({ ...s, rounds }) }
}
export const voidNeedsApproval = (s: Scene, item: Item) => ['preparing', 'ready'].includes(s.rounds?.find(r => r.number === item.round)?.stations[stationFor(item)] ?? s.stations[stationFor(item)]) || s.kitchen === 'delivered'
export function cancelSentItem(s: Scene, id: string, reason: string, pin: string): Scene {
  assertWritable(s)
  const item = s.items.find(i => i.id === id)
  if (!item || !lineIsSent(s, item)) throw new Error('Selecciona un producto enviado.')
  if (!['customer_changed', 'operator_mistake', 'duplicate', 'other'].includes(reason)) throw new Error('Selecciona el motivo de cancelación.')
  if (voidNeedsApproval(s, item) && pin !== '4826') throw new Error('Se requiere autorización gerencial. PIN de ejemplo: 4826.')
  const items = s.items.map(i => i.id === id ? { ...i, voidReason: reason } : i)
  if (orderTotal({ items }) < paidPrincipal(s)) throw new Error('El consumo quedaría por debajo de los pagos recibidos. Revisa el reembolso de la cuenta.')
  const next = roundState({ ...s, items })
  return { ...next, ...roundProgress(next) }
}

export const demoPaymentPolicy: PaymentPolicy = { mixed: true, cash: true, manual: true, integrated: true, transfer: true, tips: true, maxTip: 1000 }
export function recordPayment(s: Scene, p: PaymentRecord, policy = demoPaymentPolicy): Scene {
  if (s.payments?.some(existing => existing.id === p.id)) return s
  if (paymentPending(s)) throw new Error('Hay un cobro pendiente de resolver antes de otro pago.')
  const principal = amount(p.principal), tip = amount(p.tip)
  if (!Number.isFinite(principal) || principal <= 0 || principal > balanceDue(s)) throw new Error('El importe debe ser mayor que cero y no superar el saldo pendiente.')
  if (!Number.isFinite(tip) || tip < 0 || tip > policy.maxTip || tip > 0 && !policy.tips) throw new Error('La propina supera la política de esta sucursal.')
  if (!policy[p.channel === 'bank' ? 'transfer' : p.channel]) throw new Error('Método no disponible por política o turno de caja.')
  if (!policy.mixed && s.payments?.length && s.payments[0].channel !== p.channel) throw new Error('Esta cuenta debe conservar el mismo método de pago.')
  if (p.channel === 'integrated' && (s.splitPayment || s.payments?.length)) throw new Error('Los pagos parciales usan efectivo, terminal externa o transferencia.')
  const charge = amount(principal + tip)
  if (p.channel === 'cash' && (!Number.isFinite(p.received) || p.received < charge)) throw new Error('El efectivo recibido no cubre este cobro.')
  if (p.channel === 'bank' && !p.reference?.trim()) throw new Error('Ingresa el folio del comprobante de transferencia.')
  const payment = { ...p, principal, tip, received: p.channel === 'cash' ? amount(p.received) : charge, change: p.channel === 'cash' ? amount(p.received - charge) : 0 }
  const payments = [...(s.payments ?? []), payment]
  const covered = amount(payments.reduce((sum, payment) => sum + payment.principal, 0)) === orderTotal(s)
  const paid = covered && !s.splitPayment && !s.payments?.length
  return { ...s, payments, paid, method: p.method, received: String(payment.received), screen: paid ? 'done' : 'payment', printed: false }
}
export function finalizePayments(s: Scene): Scene {
  if (paymentPending(s) || orderTotal(s) !== paidPrincipal(s) || !s.payments?.length) throw new Error('Resuelve los pagos y cubre el saldo exacto antes de finalizar la cuenta.')
  return { ...s, paid: true, screen: 'done' }
}
export function startTerminal(s: Scene, principal: number, tip: number): Scene {
  if (paymentPending(s)) throw new Error('Ya hay un intento pendiente en la terminal.')
  if (s.splitPayment || s.payments?.length) throw new Error('Usa la terminal externa para un pago parcial.')
  const payment: PaymentRecord = { id: `${s.account}-terminal-${(s.terminalAttempt?.id.split('-').at(-1) ? Number(s.terminalAttempt.id.split('-').at(-1)) : 0) + 1}`, method: 'Tarjeta', channel: 'integrated', principal, tip, received: amount(principal + tip) }
  recordPayment(s, payment)
  return { ...s, terminalAttempt: { ...payment, status: 'waiting' } }
}
export function terminalOutcome(s: Scene, status: 'approved' | 'failed' | 'unknown', reference?: string): Scene {
  const attempt = s.terminalAttempt
  if (!attempt || attempt.status === 'approved') return s
  const next = { ...s, terminalAttempt: { ...attempt, status, reference } }
  return status === 'approved' ? recordPayment(next, { ...attempt, reference: reference ?? 'SIMULATED-PROVIDER-APPROVED' }) : next
}
export const cashPostings = (s: Scene) => s.payments ? s.payments.filter(p => p.channel === 'cash').map(p => ({ id: `${s.account}:${p.id}`, amount: amount(p.principal + p.tip) })) : s.paid && s.method === 'Efectivo' ? [{ id: s.account, amount: orderTotal(s) }] : []
export function applyCashPostings(s: Scene, cash: CashState): Scene {
  const consumed = new Set(s.cashPostedIds ?? cash.postedAccounts)
  const postings = accountList(s).flatMap(account => cashPostings({ ...s, ...account })).filter(posting => !consumed.has(posting.id))
  if (!postings.length) return s
  return { ...s, cashPostedIds: [...consumed, ...postings.map(p => p.id)], cashSession: { ...cash, sales: amount(cash.sales + postings.reduce((sum, p) => sum + p.amount, 0)), postedAccounts: [...cash.postedAccounts, ...postings.map(p => p.id)] } }
}

export const tableStatusLabel: Record<TableStatus, string> = { open: 'Disponible', seated: 'Tomando pedido', ordered: 'Pedido enviado', served: 'Servida', awaiting_payment: 'Por cobrar', dirty: 'Por limpiar' }
export const tableIsFree = (table: RoomTable) => table.state === 'open' || table.state === 'dirty'
export function roomOf(s: Scene): Record<number, RoomTable> {
  return s.room ?? Object.fromEntries([1, 2, 3, 4, 5, 6].map(number => [number, { number, seats: number === 6 ? 6 : 4, state: number === 1 ? 'seated' : number === 3 ? 'ordered' : number === 5 ? 'awaiting_payment' : 'open', guests: number === 1 ? 3 : [3, 5].includes(number) ? 2 : 0, seatedAt: [1, 3, 5].includes(number) ? 480 : undefined }]))
}
export function snapshot(s: Scene): AccountSnapshot {
  return { account: s.account, items: s.items, milk: s.milk, size: s.size, kitchen: s.kitchen, readyItems: s.readyItems, service: s.service, paid: s.paid, stations: s.stations, received: s.received, source: s.source, method: s.method, printed: s.printed, tableNumber: s.tableNumber, guests: s.guests, rounds: s.rounds, payments: s.payments, terminalAttempt: s.terminalAttempt, splitPayment: s.splitPayment }
}
const seedAccounts = () => ({
  '039': snapshot({ ...initial, account: '039', tableNumber: 1, guests: 3, items: [{ ...latte, qty: 2 }, { id: 'capuccino', name: 'Capuccino', qty: 1, price: 60, category: 'Bebidas' }], kitchen: 'preparing', stations: { bar: 'preparing', kitchen: 'ready' } }),
  '041': snapshot({ ...initial, account: '041', tableNumber: 5, items: [{ ...latte, qty: 2 }], kitchen: 'ready', stations: { bar: 'ready', kitchen: 'ready' } }),
  '042': snapshot(initial),
})
export const accountList = (s: Scene): AccountSnapshot[] => Object.values({ ...seedAccounts(), ...s.savedAccounts, [s.account]: snapshot(s) })
export function resumeAccount(s: Scene, id: string): Scene {
  const account = accountList(s).find(a => a.account === id)
  if (!account) throw new Error('No se encontró la cuenta.')
  return { ...s, ...account, savedAccounts: { ...s.savedAccounts, [s.account]: snapshot(s) }, screen: 'sale', editing: false, ticket: true, editLineId: undefined }
}
export function acceptIncoming(s: Scene): Scene {
  return { ...s, ...snapshot(incomingScene), screen: 'sale', incoming: false, editing: false, ticket: false, savedAccounts: { ...s.savedAccounts, [s.account]: snapshot(s) } }
}
export function newAccount(s: Scene, service: Service, tableNumber: number | null = null, guests = 1): Scene {
  if (!s.items.length && s.tableNumber == null && !s.rounds?.length && !s.paid && tableNumber == null) return { ...s, service, screen: 'sale' }
  const account = String(Math.max(44, ...accountList(s).map(a => Number(a.account))) + 1).padStart(3, '0')
  return { ...s, ...snapshot({ ...initial, account, service, tableNumber, guests, items: [], rounds: [], payments: [] }), savedAccounts: { ...s.savedAccounts, [s.account]: snapshot(s) }, screen: 'sale', ticket: false, editing: false, editLineId: undefined }
}
export function seatTable(s: Scene, number: number, guests: number): Scene {
  const room = roomOf(s), table = room[number]
  const existing = accountList(s).find(a => a.tableNumber === number && !a.paid)
  if (existing) return resumeAccount(s, existing.account)
  if (!Number.isInteger(guests) || guests < 1 || guests > (table.group ? Object.values(room).filter(t => t.group === table.group).reduce((n, t) => n + t.seats, 0) : table.seats)) throw new Error('El número de personas supera la capacidad de la mesa.')
  const next = newAccount(s, 'here', number, guests)
  return { ...next, room: { ...room, [number]: { ...table, state: tableIsFree(table) ? 'seated' : table.state, guests, seatedAt: table.seatedAt ?? 0 } } }
}
export function moveTable(s: Scene, from: number, to: number): Scene {
  const room = roomOf(s), source = room[from], target = room[to]
  if (tableIsFree(source)) throw new Error('La mesa de origen no tiene personas.')
  if (!tableIsFree(target)) throw new Error('La mesa destino está ocupada.')
  if (source.guests > target.seats) throw new Error('La capacidad de la mesa destino es insuficiente.')
  const members = Object.values(room).filter(t => t.number === from || source.group && t.group === source.group)
  const memberIds = members.map(t => t.number)
  const accounts = accountList(s).filter(a => !a.paid && a.tableNumber != null && memberIds.includes(a.tableNumber))
  if (accounts.length > 1) throw new Error('El grupo tiene más de una cuenta; conserva las mesas hasta resolver las cuentas.')
  if (accounts.some(a => a.payments?.length)) throw new Error('La cuenta tiene pagos recibidos. Completa el cobro antes de moverla.')
  if (accounts.some(paymentPending)) throw new Error('Hay un cobro pendiente de resolver antes de mover la cuenta.')
  const savedAccounts = { ...s.savedAccounts }
  for (const account of accounts) savedAccounts[account.account] = { ...account, tableNumber: to }
  const nextRoom = { ...room, [to]: { ...target, state: source.state, guests: source.guests, seatedAt: source.seatedAt } }
  for (const table of members) nextRoom[table.number] = { ...table, state: 'dirty', guests: 0, seatedAt: undefined, group: undefined }
  return { ...s, savedAccounts, tableNumber: accounts.some(a => a.account === s.account) ? to : s.tableNumber, room: nextRoom }
}
export function mergeTables(s: Scene, numbers: number[], guests: number): Scene {
  const room = roomOf(s), selected = [...new Set(numbers)].map(n => room[n])
  if (selected.length < 2) throw new Error('Selecciona al menos dos mesas.')
  if (selected.some(t => !tableIsFree(t))) throw new Error('Una mesa seleccionada está ocupada.')
  if (!Number.isInteger(guests) || guests < 1 || guests > selected.reduce((sum, t) => sum + t.seats, 0)) throw new Error('El número de personas supera la capacidad del grupo.')
  const group = `grupo-${selected.map(t => t.number).join('-')}`
  const nextRoom = { ...room }
  selected.forEach(t => { nextRoom[t.number] = { ...t, state: 'seated', guests, seatedAt: 0, group } })
  return { ...s, room: nextRoom }
}
export function splitTables(s: Scene, number: number): Scene {
  const room = roomOf(s), source = room[number]
  if (!source.group) throw new Error('La mesa no pertenece a un grupo.')
  const members = Object.values(room).filter(t => t.group === source.group).sort((a, b) => a.number === number ? -1 : b.number === number ? 1 : a.number - b.number)
  let remaining = source.guests
  const nextRoom = { ...room }
  for (const table of members) {
    const guests = Math.min(remaining, table.seats)
    remaining -= guests
    nextRoom[table.number] = { ...table, guests, group: undefined, state: guests ? table.state : 'dirty', seatedAt: guests ? table.seatedAt : undefined }
  }
  return { ...s, room: nextRoom }
}
export function changeTableState(s: Scene, number: number, state: TableStatus): Scene {
  const room = roomOf(s), source = room[number]
  if (state === 'open' ? !tableIsFree(source) : tableIsFree(source)) throw new Error(state === 'open' ? 'La mesa todavía está ocupada.' : 'La mesa no tiene personas.')
  const nextRoom = { ...room }
  for (const table of Object.values(room).filter(t => t.number === number || source.group && t.group === source.group)) {
    nextRoom[table.number] = { ...table, state, ...(state === 'dirty' || state === 'open' ? { guests: 0, group: undefined, seatedAt: undefined } : {}) }
  }
  return { ...s, room: nextRoom }
}
