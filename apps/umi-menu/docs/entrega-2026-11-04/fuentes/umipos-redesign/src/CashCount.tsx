import { useState } from 'react'
import { RiAddLine, RiSubtractLine, RiArrowLeftLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'

// Same MXN fallback and policy fields as the native denomination counter.
export type CashPolicy = { blindCountRequired: boolean; countMethod: 'denominations' | 'total_only'; denominations: number[] }
export const blindCashPolicy: CashPolicy = { blindCountRequired: true, countMethod: 'denominations', denominations: [100000,50000,20000,10000,5000,2000,1000,500,200,100,50] }
export const visibleCashPolicy: CashPolicy = { ...blindCashPolicy, blindCountRequired: false, countMethod: 'total_only' }
const money = (minor: number) => (minor/100).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
const quantityLabel = (minor: number) => `${minor >= 2000 ? 'Billetes' : 'Monedas'} de $${minor/100}`

export function CashCount({ policy, opening, recount, expected, onBack, onSubmit, design = '1' }: {
  design?:'1'|'2'|'3';
  policy: CashPolicy; opening: boolean; recount: boolean; expected: number;
  onBack: () => void; onSubmit: (total: number) => void;
}) {
  const [counts, setCounts] = useState<Record<number,string>>({})
  const [amount, setAmount] = useState('')
  const fade = useScrollFade()
  const totalOnly = !opening && policy.countMethod === 'total_only'
  const total = totalOnly ? Math.round(Number(amount)*100) : policy.denominations.reduce((sum, minor) => sum + minor*Number(counts[minor]||0), 0)
  const setQuantity = (minor: number, value: string) => setCounts(c => ({...c, [minor]: value.replace(/\D/g,'').slice(0,3)}))
  return <form className="u-cash-counter" onSubmit={event => {event.preventDefault(); if(Number.isFinite(total)&&total>0)onSubmit(total/100)}}>
    <header className="u-count-head">
      <Button variant="ghost" className="min-h-11 self-start" leadingIcon={RiArrowLeftLine} onClick={onBack}>Volver al turno</Button>
      <h2>{opening?'Fondo inicial':recount?'Recontar el efectivo':policy.blindCountRequired?'Conteo ciego':'Contar el cajón'}</h2>
      <p>{opening?'Caja principal · Cuenta el efectivo de apertura':recount?'Este conteo reemplaza al anterior':policy.blindCountRequired?'El esperado se mostrará después de enviar el conteo':`Efectivo esperado: ${money(expected*100)}`}</p>
    </header>
    <div className="u-count-scroll-wrap">
      <div className="u-count-scroll" onScroll={fade.onScroll}>
        {totalOnly?<Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Efectivo contado" leadingAddon={<span>$</span>} placeholder="0.00" inputMode="decimal" value={amount} onChange={value=>{if(/^\d{0,7}(\.\d{0,2})?$/.test(value))setAmount(value)}}/>:
          <div className="u-denomination-groups">{[{name:'Billetes',values:policy.denominations.filter(minor=>minor>=2000)},{name:'Monedas',values:policy.denominations.filter(minor=>minor<2000)}].map(group=><fieldset key={group.name}>
            <legend>{group.name}</legend>{design==='3'&&<div className="u-denomination-register-head text-caption-1-medium"><span>Valor</span><span>Cantidad</span><span>Subtotal</span></div>}
            {group.values.map(minor=>{
              const quantity=Number(counts[minor]||0)
              return <div className="u-denomination-row" key={minor}>
                <div className="u-denomination-value"><b>{money(minor)}</b>{design==='1'&&quantity>0&&<small>{money(minor*quantity)}</small>}</div>
                <Button variant="secondary" className="u-denomination-step min-h-12 min-w-12 p-0" leadingIcon={RiSubtractLine} aria-label={`Quitar ${quantityLabel(minor).toLowerCase()}`} disabled={quantity===0} onClick={()=>setQuantity(minor,String(quantity-1))}/>
                <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} className="u-denomination-quantity" aria-label={quantityLabel(minor)} placeholder="0" inputMode="numeric" maxLength={3} value={counts[minor]||''} onFocus={event=>event.target.select()} onChange={value=>setQuantity(minor,value)}/>
                <Button variant="secondary" className="u-denomination-step min-h-12 min-w-12 p-0" leadingIcon={RiAddLine} aria-label={`Agregar ${quantityLabel(minor).toLowerCase()}`} disabled={quantity>=999} onClick={()=>setQuantity(minor,String(quantity+1))}/>
                {design!=='1'&&<span className="u-denomination-subtotal text-body-2-medium">{money(minor*quantity)}</span>}
              </div>
            })}
          </fieldset>)}</div>}
      </div>
      <ScrollFade progress={fade.progress} surfaceClassName="from-background-full"/>
    </div>
    <footer className="u-count-footer">
      <div className="u-count-total" aria-live="polite"><span>{opening?'Fondo inicial':'Total contado'}</span><strong>{money(Number.isFinite(total)?total:0)}</strong></div>
      <Button type="submit" className="min-h-12 w-full" disabled={!Number.isFinite(total)||total<=0}>{opening?'Abrir turno de caja':policy.blindCountRequired?'Enviar conteo ciego':'Guardar conteo'}</Button>
    </footer>
  </form>
}
