import { ArrowLeft, Check } from 'lucide-react'
import type { Scene } from './order'
import { Button } from '@/components/base/buttons/button'
import { ScrollFade, useScrollFade } from '@/components/foundations/scroll-fade/scroll-fade'
import { Input } from '@/components/base/input/input'

export function ProductOptions({ s, set, save, photos, design = '1' }: {
  design?: '1' | '2' | '3';
  s: Scene; set: (patch: Partial<Scene>) => void; save: () => void; photos: boolean
}) {
  const fade = useScrollFade()
  const Choice = design === '1' ? 'button' : Button
  return <section className="u-product-editor u-modifier-overlay" data-open={s.editing} aria-hidden={!s.editing} aria-label="Opciones del Latte" ref={el => {
    if (!el) return
    if (s.editing) el.removeAttribute('inert')
    else el.setAttribute('inert', '')
  }}>
    <button className="u-editor-back" aria-label="Cerrar opciones" onClick={() => set({ editing: false })}><ArrowLeft size={18}/> {s.ticket?'Volver a la cuenta':'Volver a la carta'}</button>
    <div className="u-editor-heading">
      {photos && <img src="/products/latte.jpg" alt=""/>}
      <div><span className="u-overline">Personalizar bebida</span><h2>Latte</h2></div>
    </div>
    <div className="u-editor-options-wrap"><div className="u-editor-options" onScroll={fade.onScroll}>
      <fieldset><legend>Presentación <span>Elige una</span></legend>
        <div className="u-editor-choices" data-columns="2">{['Clásico', 'Nube'].map(name => <Choice {...(design==='1'?{}:{variant:'secondary' as const})} key={name} data-target={name === 'Nube' ? 'size-nube' : undefined} aria-pressed={s.size === name} onClick={() => set({ size: name })}>
          <span>{name}</span><small>{name === 'Nube' ? '+ $10.00' : 'Incluido'}</small><Check size={18} className="u-choice-check" data-visible={s.size === name}/>
        </Choice>)}</div>
      </fieldset>
      <fieldset><legend>Leche <span>Elige una</span></legend>
        <div className="u-editor-choices" data-columns="3">{['Entera', 'Deslactosada', 'Avena'].map(name => <Choice {...(design==='1'?{}:{variant:'secondary' as const})} key={name} data-target={name === 'Deslactosada' ? 'milk' : undefined} aria-pressed={s.milk === name} onClick={() => set({ milk: name })}>
          <span>{name}</span><Check size={18} className="u-choice-check" data-visible={s.milk === name}/>
        </Choice>)}</div>
      </fieldset>
      <div className="u-product-extra-options u-boardui">
        <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Cantidad" inputMode="numeric" value={String(s.productQuantity ?? 1)} onChange={value => { if (/^\d{0,3}$/.test(value)) set({ productQuantity: Number(value) }) }}/>
        <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Tiempo de servicio" inputMode="numeric" value={String(s.productCourse ?? 1)} onChange={value => { if (/^[1-9]?$/.test(value)) set({ productCourse: Number(value) }) }}/>
        <Input fieldClassName={design==='1'?undefined:'min-h-12 py-0'} label="Nota para preparación" value={s.productNote ?? ''} maxLength={280} onChange={productNote => set({ productNote })}/>
      </div>
    </div>
    {design !== '1' && <ScrollFade progress={fade.progress}/>}</div>
    <div className="u-editor-footer u-boardui"><Button className="u-primary u-wide" data-target="add-product" disabled={(s.productQuantity ?? 1) < 1 || (s.productCourse ?? 1) < 1} onClick={save}><span>{s.editLineId ? 'Guardar cambios' : 'Agregar al pedido'}</span><b>{((s.size === 'Nube' ? 90 : 80) * (s.productQuantity ?? 1)).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</b></Button></div>
  </section>
}
