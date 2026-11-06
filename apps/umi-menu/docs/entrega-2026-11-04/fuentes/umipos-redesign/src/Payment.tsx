import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Check, ChefHat, CreditCard, Delete } from 'lucide-react'
import { RiBankLine, RiCashLine, RiBankCardLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { Roll } from '../kit'
import { accountId, balanceDue, demoPaymentPolicy, finalizePayments, kitchenCopy, paymentPending, recordPayment, startTerminal, terminalOutcome, type Scene, type PaymentPolicy } from './order'
import { ServiceTag } from './Kitchen'

const money = (amount: number) => '$' + amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const decimal = (value: string) => /^\d{0,7}(\.\d{0,2})?$/.test(value)

export function Payment({ s, set, identity, items, summary, onBack, cashOpen = true, design = '1' }: {
  design?: '1' | '2' | '3';
  s: Scene; set: (patch: Partial<Scene>) => void;
  identity: ReactNode; items: ReactNode; summary: ReactNode;
  onBack: () => void; cashOpen?: boolean;
}) {
  const due = balanceDue(s)
  const [principal, setPrincipal] = useState('')
  const [tip, setTip] = useState('0')
  const [tipOpen, setTipOpen] = useState(false)
  const [reference, setReference] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [cardMode, setCardMode] = useState<'manual' | 'integrated'>('manual')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const fade = useScrollFade()
  const single = new URLSearchParams(location.search).get('tenderPolicy') === 'single'
  const policy: PaymentPolicy = { ...demoPaymentPolicy, mixed: !single, cash: cashOpen }
  const locked = single ? s.payments?.[0]?.method : undefined
  const cash = s.method === 'Efectivo', bank = s.method === 'Transferencia'
  const pending = paymentPending(s)
  const split = Boolean(s.splitPayment || s.payments?.length)
  const portion = split && principal !== '' ? Number(principal) : due
  const tipValue = Number(tip)
  const charge = Math.round((portion + tipValue) * 100) / 100
  useEffect(() => { setConfirmed(false) }, [charge])
  const short = Number(s.received) < charge
  const valid = portion > 0 && portion <= due && tipValue >= 0 && tipValue <= policy.maxTip
  const input = (value: string) => { if (decimal(value)) set({ received: value }) }
  const chooseMethod = (method: string) => { set({ method, received: '' }); setError(''); setReference(''); setConfirmed(false) }
  const run = (operation: () => Scene) => { try { set(operation()); setError('') } catch (e) { setError((e as Error).message) } }
  const collect = () => {
    if (!valid || pending) return
    if (!cash && !bank && cardMode === 'integrated') { run(() => startTerminal(s, portion, tipValue)); return }
    const id = `${s.account}-payment-${(s.payments?.length ?? 0) + 1}`
    try {
      const next = recordPayment(s, { id, method: s.method, channel: cash ? 'cash' : bank ? 'bank' : 'manual', principal: portion, tip: tipValue, received: cash ? Number(s.received) : charge, reference: bank ? reference : confirmed ? 'operator_confirmed_terminal_screen' : undefined }, policy)
      set(next.paid ? next : { ...next, received: '' })
      setNotice(`Pago registrado: ${money(portion)} de consumo${tipValue ? ` + ${money(tipValue)} de propina` : ''}. Saldo ${money(balanceDue(next))}.`)
      setPrincipal(''); setTip('0'); setReference(''); setConfirmed(false); setError('')
    } catch (e) { setError((e as Error).message) }
  }
  const terminal = s.terminalAttempt
  const terminalResult = (status: 'approved' | 'failed' | 'unknown') => run(() => terminalOutcome(s, status, status === 'unknown' ? undefined : 'SIMULATED-PROVIDER-' + status.toUpperCase()))
  const methods = <div className="u-methods" aria-label="Método de pago">{[{ name: 'Efectivo', icon: RiCashLine, available: cashOpen }, { name: 'Tarjeta', icon: RiBankCardLine, available: true }, { name: 'Transferencia', icon: RiBankLine, available: true }].map(method => <Button variant="secondary" key={method.name} leadingIcon={method.icon} aria-pressed={s.method === method.name} data-active={s.method === method.name} disabled={!method.available || Boolean(locked && locked !== method.name)} onClick={() => chooseMethod(method.name)}>{method.name}<Check size={16} className="u-method-check" data-visible={s.method === method.name}/></Button>)}</div>
  const back = <Button variant="ghost" className="u-back" onClick={onBack}><ArrowLeft size={16}/> Volver a la cuenta</Button>
  const heading = <>
      <div className="u-payment-heading"><div><span className="u-overline">Cuenta {accountId(s)}</span><div className="u-page-title">Cobrar</div></div><div className="u-charge-amount"><span>Por cobrar</span><strong>{money(due)}</strong></div></div></>
  const record = <aside className="u-payment-left">
      {identity}<div className="u-payment-service"><ServiceTag service={s.service}/></div>
      <div className="u-payment-order">{items}</div>{summary}
      {!!s.payments?.length && <div className="u-payment-ledger" aria-label="Pagos registrados">{s.payments.map((p, index) => <div key={p.id}><span>Pago {index + 1} · {p.method}{p.tip > 0 && <small>Propina {money(p.tip)}</small>}</span><b>{money(p.principal)}</b></div>)}</div>}
      <div className="u-payment-context"><ChefHat size={16}/>{kitchenCopy[s.kitchen].title}</div>
      <Button variant="secondary" className="u-split" disabled={pending} onClick={() => { set({ splitPayment: !split }); setPrincipal(''); setCardMode('manual') }}>{split ? 'Pagos parciales' : 'Dividir el cobro'} <ArrowRight size={16}/></Button>
    </aside>
  return <section className="u-payment u-boardui" data-partial={split} data-layout={design}>
    {design === '3' && <header className="u-checkout-document-head">{heading}</header>}
    {design !== '1' && !pending && due > 0 && <nav className="u-payment-method-bank" aria-label="Selección de pago">{methods}</nav>}
    {record}
    <div className="u-payment-editor"><div className="u-payment-right" onScroll={fade.onScroll}><div className="u-payment-form">
      {back}{design !== '3' && heading}
      {notice && <p className="u-pos-feedback text-body-2-regular" role="status">{notice}</p>}
      {error && <p className="u-pos-error text-body-2-regular" role="alert">{error}</p>}
      {!pending && due > 0 && <>
        {split && <div className="u-payment-parts">
          <div className="u-pos-inline"><b className="text-body-2-medium">Importe de este pago</b><span className="text-caption-1-regular">Saldo {money(due)}</span></div>
          <div className="u-pos-inline">{[2, 3, 4].map(parts => <Button key={parts} variant="secondary" size="small" onClick={() => setPrincipal((Math.round(due * 100 / parts) / 100).toFixed(2))}>1 de {parts}</Button>)}<Button variant="ghost" size="small" onClick={() => setPrincipal('')}>Todo el saldo</Button></div>
          <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} aria-label="Importe parcial" inputMode="decimal" value={principal || String(due)} onChange={value => { if (decimal(value)) setPrincipal(value) }} leadingAddon="$"/>
        </div>}
        {design === '1' && methods}
        {!cashOpen && <p className="u-pos-muted text-caption-1-regular">Abre o reanuda un turno de caja para recibir efectivo.</p>}
        {locked && <p className="u-pos-muted text-caption-1-regular">Esta sucursal conserva el mismo método en todos los pagos: {locked}.</p>}
        <Button variant="ghost" size="small" className="u-tip-toggle" aria-expanded={tipOpen} onClick={() => setTipOpen(!tipOpen)}>{tipValue ? `Propina ${money(tipValue)}` : 'Agregar propina'}</Button>
        {tipOpen && <div className="u-payment-tip">
          <div className="u-pos-inline">{[0, 10, 15, 20].map(percent => <Button variant="secondary" size="small" key={percent} onClick={() => setTip((Math.round(portion / 1.16 * percent) / 100).toFixed(2))}>{percent ? `${percent}%` : 'Sin propina'}</Button>)}</div>
          <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Propina de este pago" inputMode="decimal" value={tip} onChange={value => { if (decimal(value)) setTip(value) }} leadingAddon="$"/>
          <span className="u-pos-muted text-caption-1-regular">Base sin IVA: {money(portion / 1.16)} · Para Ana, dueña de la cuenta.</span>
        </div>}
        {cash ? <>
          <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} id="cash-input" className="u-pos-cash-field" label="Efectivo recibido" aria-label="Efectivo recibido" inputMode="decimal" placeholder="0.00" value={s.received} onChange={input} leadingAddon="$"/>
          <div className="u-quick">{[charge, 200, 500].filter((value, index, values) => values.indexOf(value) === index).map(value => <Button variant="secondary" key={value} data-target={value === 200 ? 'cash-200' : undefined} onClick={() => set({ received: String(value) })}>{value === charge ? 'Exacto' : money(value)}</Button>)}</div>
          <div className="u-keypad">{['1','2','3','4','5','6','7','8','9','.','0','⌫'].map(key => <Button variant="secondary" key={key} aria-label={key === '⌫' ? 'Borrar cifra' : key} onClick={() => input(key === '⌫' ? s.received.slice(0, -1) : s.received + key)}>{key === '⌫' ? <Delete size={22}/> : key}</Button>)}</div>
        </> : bank ? <div className="u-transfer-form">
          <div className="u-pos-callout text-body-2-regular"><b>Cuenta bancaria de ejemplo</b><span>Banco de prueba · ONCA</span><span>CLABE de prueba: 000 000 000000000000</span></div>
          <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Folio del comprobante" value={reference} onChange={setReference}/>
          <Checkbox isSelected={confirmed} onChange={setConfirmed}>Confirmo que el banco recibió {money(charge)}</Checkbox>
        </div> : <div className="u-terminal-controls">
          <div className="u-pos-inline">{(['manual', 'integrated'] as const).map(mode => <Button variant="secondary" size="small" key={mode} aria-pressed={cardMode === mode} disabled={mode === 'integrated' && split} onClick={() => { setCardMode(mode); setConfirmed(false) }}>{mode === 'manual' ? 'Terminal externa' : 'Terminal integrada'}</Button>)}</div>
          {split && <p className="u-pos-muted text-caption-1-regular">Los pagos parciales con tarjeta se confirman en una terminal externa.</p>}
          <div className="u-card-state"><CreditCard size={36}/><strong>{money(charge)}</strong><p>{cardMode === 'manual' ? 'Verifica que la terminal indique “Aprobado”.' : 'El cobro se envía a la terminal asignada.'}</p></div>
          {terminal?.status === 'failed' && <p role="status" className="u-pos-error text-body-2-regular">Pago rechazado. El saldo continúa pendiente; puedes volver a intentar.</p>}
          {cardMode === 'manual' && <Checkbox isSelected={confirmed} onChange={setConfirmed}>La terminal externa confirmó este importe</Checkbox>}
        </div>}
      </>}
      {!pending && due === 0 && <div className="u-terminal-pending"><Check size={42}/><h2 className="text-title-3-semibold">Saldo cubierto</h2><p className="text-body-regular">Los pagos están registrados. Finaliza la cuenta para generar su comprobante.</p><Button className="u-primary u-wide" data-target="finalize-payment" onClick={() => run(() => finalizePayments(s))}>Finalizar cuenta</Button></div>}
      {pending && terminal && <div className="u-terminal-pending" data-terminal-state={terminal.status}>
        <CreditCard size={42}/><h2 className="text-title-3-semibold">{terminal.status === 'waiting' ? 'Esperando a la terminal' : 'Resultado desconocido'}</h2><strong className="text-title-2-medium">{money(terminal.principal + terminal.tip)}</strong>
        <p className="text-body-regular">{terminal.status === 'waiting' ? 'La terminal está procesando el cobro.' : 'El intento puede haberse cobrado. Consulta el mismo intento antes de registrar otro pago.'}</p>
        <span className="u-pos-muted text-caption-1-regular">Intento {terminal.id}</span>
        {terminal.status === 'waiting' && <Button variant="secondary" onClick={() => terminalResult('unknown')}>Dejar de esperar</Button>}
        <div className="u-terminal-simulation"><b className="text-caption-1-medium">Respuesta de terminal · Simulación local</b><div className="u-pos-inline"><Button variant="secondary" onClick={() => terminalResult('approved')}>{terminal.status === 'unknown' ? 'Consultar: aprobado' : 'Simular aprobación'}</Button><Button variant="secondary" onClick={() => terminalResult('failed')}>{terminal.status === 'unknown' ? 'Consultar: rechazado' : 'Simular rechazo'}</Button>{terminal.status === 'waiting' && <Button variant="secondary" onClick={() => terminalResult('unknown')}>Sin respuesta</Button>}</div></div>
      </div>}
    </div></div><ScrollFade progress={fade.progress}/>
      {!pending && due > 0 && <footer className="u-payment-fixed-footer"><div className="u-payment-form">
        {(split || tipValue > 0) && <p className="u-exact-charge text-body-2-medium">Consumo {money(portion)} + propina {money(tipValue)} = {money(charge)}</p>}
        {cash && <div className="u-change" data-insufficient={short}><span><Roll>{short ? 'Faltan' : 'Cambio'}</Roll></span><strong><Roll align="end">{money(Math.abs(Number(s.received) - charge))}</Roll></strong></div>}
        <Button className="u-primary u-confirm" data-target="confirm" disabled={!valid || (cash ? short || !cashOpen : bank ? !reference.trim() || !confirmed : cardMode === 'manual' && !confirmed)} onClick={collect}><span>{cash ? `Cobrar ${money(charge)}` : bank ? 'Confirmar transferencia' : cardMode === 'integrated' ? 'Enviar a terminal' : 'Registrar pago aprobado'}</span><ArrowRight size={18}/></Button>
      </div></footer>}
    </div>
  </section>
}
