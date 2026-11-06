import { useState } from 'react'
import { Check, ChefHat, Plus, Printer } from 'lucide-react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { ServiceTag } from './Kitchen'
import { accountId, cancelSentItem, kitchenCopy, orderIdentity, orderTotal, tipsPaid, voidNeedsApproval, type Scene, type Item } from './order'

const money = (value: number) => '$' + value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const voidReasons: Record<string, string> = { customer_changed: 'El cliente cambió de opinión', operator_mistake: 'Error de captura', duplicate: 'Producto duplicado', other: 'Otro motivo' }
export function SentLineCancellation({ s, item, set, onClose }: { s: Scene; item: Item; set: (s: Scene) => void; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const approval = voidNeedsApproval(s, item)
  return <div className="u-sent-cancellation u-boardui">
    <b className="text-body-2-medium">Cancelar {item.qty} × {item.name} · {money(item.price * item.qty)}</b>
    <p className="u-pos-muted text-caption-1-regular">Elige el motivo. La cancelación permanece en la cuenta.</p>
    <div className="u-void-reasons">{Object.entries(voidReasons).map(([value, label]) => <Button variant="secondary" size="small" key={value} aria-pressed={reason === value} onClick={() => setReason(value)}>{label}</Button>)}</div>
    {approval && <Input type="password" label="PIN gerencial" value={pin} inputMode="numeric" maxLength={8} onChange={setPin} hint="La preparación comenzó. PIN de ejemplo: 4826."/>}
    {error && <p className="u-pos-error text-caption-1-regular" role="alert">{error}</p>}
    <Button className="u-primary u-wide" disabled={!reason || approval && !pin} onClick={() => { try { set(cancelSentItem(s, item.id, reason, pin)); onClose() } catch (e) { setError((e as Error).message) } }}>Confirmar cancelación</Button>
    <Button variant="ghost" onClick={onClose}>Conservar producto</Button>
  </div>
}

export function PosReceipt({ s, set, onNew, business='ONCA', design='1' }: { design?:'1'|'2'|'3'; business?:string; s: Scene; set: (patch: Partial<Scene>) => void; onNew: () => void }) {
  const total = orderTotal(s), tip = tipsPaid(s), last = s.payments?.at(-1)
  const change = last?.change ?? (s.method === 'Efectivo' ? Math.max(0, Number(s.received) - total) : 0)
  const methods = s.payments ? [...new Set(s.payments.map(p => p.method))].join(' + ') : s.method
  const actions = <div className="u-done-actions"><Button variant="secondary" className="u-secondary" data-target="print" onClick={() => set({ printed: true })}><Printer size={18}/>{s.printed ? 'Ticket listo' : 'Imprimir ticket'}</Button><Button className="u-primary" onClick={onNew}>Nuevo pedido <Plus size={18}/></Button></div>
  return <section className="u-done u-boardui"><div className="u-done-main"><div className="u-success-icon"><Check size={34}/></div><span className="u-overline">Cuenta {accountId(s)} · {orderIdentity(s)}</span><div className="u-done-title">Cuenta pagada</div><p className="u-done-method">{methods}</p><div className="u-done-change"><span>{s.method === 'Efectivo' ? 'Cambio a entregar' : 'Importe cobrado'}</span><strong>{money(s.method === 'Efectivo' ? change : total + tip)}</strong></div><div className="u-done-summary"><div><span>Total cobrado</span><b>{money(total + tip)}</b></div><div><span>{s.method === 'Efectivo' ? 'Efectivo recibido' : 'Método de pago'}</span><b>{s.method === 'Efectivo' ? money(Number(s.received)) : methods}</b></div></div>
    {(Boolean(s.payments && s.payments.length > 1) || tip > 0) && <div className="u-payment-ledger u-done-ledger">{s.payments?.map((p, index) => <div key={p.id}><span>Pago {index + 1} · {p.method}</span><b>{money(p.principal + p.tip)}</b></div>)}{tip > 0 && <div><span>Propina incluida</span><b>{money(tip)}</b></div>}<div><span>Saldo pendiente</span><b>$0.00</b></div></div>}
    {design==='1'&&actions}<span className="u-done-state"><ChefHat size={16}/>{kitchenCopy[s.kitchen].title}</span></div>
    <aside className="u-receipt"><div className="u-receipt-brand">{business}</div><span>Resumen de la cuenta {accountId(s)}</span><div className="u-receipt-service"><ServiceTag service={s.service}/></div><div className="u-receipt-divider"/>{s.items.filter(i => !i.voidReason).map(i => <div className="u-receipt-row" key={i.id}><span>{i.qty} × {i.name}</span><b>{money(i.price * i.qty)}</b></div>)}<div className="u-receipt-divider"/><div className="u-receipt-row"><b>Consumo</b><strong>{money(total)}</strong></div>{tip > 0 && <div className="u-receipt-row"><span>Propina</span><span>{money(tip)}</span></div>}<div className="u-receipt-row"><b>Total</b><strong>{money(total + tip)}</strong></div>{s.payments?.map((p, index) => <div className="u-receipt-row" key={p.id}><span>Pago {index + 1} · {p.method}</span><span>{money(p.principal + p.tip)}</span></div>)}<div className="u-receipt-row"><span>Cambio</span><span>{money(change)}</span></div><div className="u-receipt-divider"/><span>Gracias por visitarnos.</span></aside>
    {design!=='1'&&<footer className="u-receipt-action-bank">{actions}</footer>}
  </section>
}
