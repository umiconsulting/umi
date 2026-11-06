import { useState } from 'react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { RiArrowLeftLine, RiCheckLine } from '@remixicon/react'

const stock=[{name:'Café de la casa',unit:'kg',expected:8.4,area:'Almacén seco'},{name:'Harina de fuerza',unit:'kg',expected:18,area:'Almacén seco'},{name:'Leche deslactosada',unit:'L',expected:3,area:'Refrigeración'},{name:'Leche entera',unit:'L',expected:12,area:'Refrigeración'}]
export default function InventoryCount({onBack}:{onBack:()=>void}){
 const [step,setStep]=useState('area'),[area,setArea]=useState('Todas las áreas'),[counts,setCounts]=useState<Record<string,string>>({}),[reason,setReason]=useState('')
 const items=stock.filter(i=>area==='Todas las áreas'||i.area===area)
 const valid=items.every(i=>counts[i.name]!==undefined&&counts[i.name]!==''&&Number.isFinite(Number(counts[i.name]))&&Number(counts[i.name])>=0)
 const difference=items.some(i=>Number(counts[i.name])!==i.expected)
 return <section className="d-detail"><Button variant="ghost" className="d-back" leadingIcon={RiArrowLeftLine} onClick={onBack}>Volver a artículos</Button><div className="d-detail-heading"><span className="d-eyebrow">Inventario · Centro</span><h1>Conteo de existencias</h1><p>{step==='area'?'Selecciona el área que vas a contar.':step==='count'?'Captura la existencia física de cada artículo.':step==='review'?'Revisa las diferencias antes de terminar.':'Conteo registrado en esta demostración.'}</p></div>
 {step==='done'?<div className="d-result"><RiCheckLine size={32}/><h2>Conteo revisado</h2><p>{items.length} artículos · {area}</p><p>El inventario real no se modificó.</p><Button onClick={onBack}>Volver al inventario</Button></div>:<form className="d-edit-form" onSubmit={e=>{e.preventDefault();setStep(step==='area'?'count':step==='count'?'review':'done')}}>
 <div className="d-step-label"><span data-active={step==='area'}>1 · Área</span><span data-active={step==='count'}>2 · Contar</span><span data-active={step==='review'}>3 · Revisar</span></div>
 {step==='area'?<Select label="Área del conteo" selectedKey={area} onSelectionChange={key=>setArea(String(key))}>{['Todas las áreas','Almacén seco','Refrigeración'].map(a=><SelectItem key={a} id={a}>{a}</SelectItem>)}</Select>:step==='count'?<div className="d-inventory-count">{items.map(item=><div className="d-count-line" key={item.name}><span><b>{item.name}</b><small>{item.area} · {item.unit}</small></span><Input label={`Cantidad de ${item.name}`} type="number" step="any" min={0} value={counts[item.name]??''} onChange={value=>setCounts(old=>({...old,[item.name]:value}))}/></div>)}</div>:<><div className="d-count-review-head"><span>Artículo</span><span>Sistema</span><span>Contado</span><span>Diferencia</span></div>{items.map(item=><div className="d-count-review" key={item.name}><b>{item.name}</b><span>{item.expected} {item.unit}</span><span>{counts[item.name]} {item.unit}</span><span>{(Number(counts[item.name])-item.expected).toFixed(2)} {item.unit}</span></div>)}{difference&&<Input label="Motivo de las diferencias" value={reason} onChange={setReason} isRequired/>}</>}
 <div className="d-form-actions">{step!=='area'&&<Button variant="secondary" onClick={()=>setStep(step==='review'?'count':'area')}>Volver</Button>}<Button type="submit" disabled={step==='count'&&!valid||step==='review'&&difference&&!reason.trim()}>{step==='area'?'Comenzar conteo':step==='count'?'Revisar diferencias':'Confirmar conteo de ejemplo'}</Button></div>
 </form>}
 </section>
}
