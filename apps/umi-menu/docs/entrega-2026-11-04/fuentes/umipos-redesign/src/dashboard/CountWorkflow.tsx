import { useState } from 'react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { RiArrowLeftLine } from '@remixicon/react'
import type { Entry } from './data'

export default function CountWorkflow({entries,scope,onSave,onBack}:{entries:Entry[];scope:string;onSave:(entries:Entry[])=>void;onBack:()=>void}) {
 const storageKey=`umi-demo-count:${scope}`
 const [step,setStep]=useState('areas'),[areas,setAreas]=useState(['Almacén seco','Refrigeración','Vitrina']),[reason,setReason]=useState(''),[error,setError]=useState('')
 const [counts,setCounts]=useState<Record<string,string>>(()=>{try{return JSON.parse(sessionStorage.getItem(storageKey)||'{}')}catch{return {}}})
 const selected=entries.filter(e=>areas.some(a=>(e.values?.Área||e.detail||'').includes(a)))
 const counted=selected.filter(e=>counts[e.name]?.trim()!==' '&&counts[e.name]?.trim())
 const number=(value:string)=>Number(value.replace(',','.'))
 const valid=counted.length>0&&counted.every(e=>/^\d+(?:[.,]\d+)?$/.test(counts[e.name])&&Number.isFinite(number(counts[e.name]))&&number(counts[e.name])>=0&&(counts[e.name].split(/[.,]/)[1]?.length||0)<=Number(e.values?.Decimales||3))
 const changed=counted.some(e=>number(counts[e.name])!==parseFloat(e.cells[0]))
 const update=(name:string,value:string)=>setCounts(old=>{const next={...old,[name]:value};try{sessionStorage.setItem(storageKey,JSON.stringify(next))}catch{setError('No se pudo guardar el borrador del conteo.')}return next})
 const confirm=()=>{onSave(counted.map(e=>({...e,cells:[`${number(counts[e.name])} ${e.cells[0].split(' ').at(-1)}`,...e.cells.slice(1)],values:{...e.values,lastMovement:`Conteo de ejemplo · ${reason||'Sin diferencia'}`}})));sessionStorage.removeItem(storageKey);setStep('done')}
 return <section className="d-detail"><Button variant="ghost" className="d-back" data-target="d-back" leadingIcon={RiArrowLeftLine} onClick={onBack}>Volver a artículos</Button><div className="d-detail-heading"><span className="d-eyebrow">Inventario</span><h1>Conteo de existencias</h1><p>{step==='count'?'Cuenta la existencia física. Deja vacíos los artículos que no contaste.':'Selecciona áreas, cuenta y revisa las diferencias.'}</p></div>
 {step==='done'?<div className="d-result"><h2>Conteo registrado en el ejemplo</h2><p>{counted.length} artículos contados. {selected.length-counted.length} sin contar conservaron su existencia.</p><Button onClick={onBack}>Volver al inventario</Button></div>:<>
 <div className="d-step-label"><span data-active={step==='areas'}>1 · Áreas</span><span data-active={step==='count'}>2 · Contar</span><span data-active={step==='review'}>3 · Revisar</span></div>
 {step==='areas'?<div className="d-domain-editor">{['Almacén seco','Refrigeración','Vitrina','Barra'].map(area=><Checkbox key={area} isSelected={areas.includes(area)} onChange={checked=>setAreas(old=>checked?[...old,area]:old.filter(a=>a!==area))}>{area}</Checkbox>)}<p>{selected.length} artículos en las áreas seleccionadas. El borrador se conserva en este navegador.</p></div>:step==='count'?<div className="d-count-items">{selected.map(e=><div key={e.name}><span><b>{e.name}</b><small>{e.detail?.split(' · ').at(-1)} · {e.cells[0].split(' ').at(-1)}</small></span><Input label={`Cantidad de ${e.name}`} inputMode="decimal" value={counts[e.name]||''} onChange={value=>update(e.name,value)}/></div>)}</div>:<><div className="d-count-review-head"><span>Artículo</span><span>Sistema</span><span>Contado</span><span>Diferencia</span></div>{selected.map(e=><div className="d-count-review" key={e.name}><b>{e.name}</b><span>{e.cells[0]}</span><span>{counts[e.name]?.trim()?counts[e.name]:'Sin contar'}</span><span>{counts[e.name]?.trim()?`${(number(counts[e.name])-parseFloat(e.cells[0])).toLocaleString('es-MX',{maximumFractionDigits:3})} ${e.cells[0].split(' ').at(-1)}`:'Sin cambio'}</span></div>)}{changed&&<Input label="Motivo de las diferencias" value={reason} onChange={setReason} isRequired/>}<p>El conteo local solo ajusta los artículos contados. La autorización del servidor se conserva al integrar.</p></>}
 {error&&<p className="d-error" role="alert">{error}</p>}<div className="d-form-actions"><Button variant="secondary" onClick={()=>step==='areas'?onBack():setStep(step==='review'?'count':'areas')}>Volver</Button><Button disabled={step==='areas'&&!selected.length||step==='count'&&!valid||step==='review'&&changed&&!reason.trim()} onClick={()=>step==='areas'?setStep('count'):step==='count'?setStep('review'):confirm()}>{step==='areas'?'Comenzar conteo':step==='count'?'Revisar diferencias':'Confirmar conteo de ejemplo'}</Button></div>
 </>}
 </section>
}
