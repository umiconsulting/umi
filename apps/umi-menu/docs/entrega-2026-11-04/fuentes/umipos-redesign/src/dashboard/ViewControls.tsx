import { useState } from 'react'
import { Button } from '@/components/base/buttons/button'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { Select, SelectItem } from '@/components/base/select/select'
import type { Entry } from './data'
import { money } from './parity-model'

export function InventorySelection({entries,onSave}:{entries:Entry[];onSave:(entries:Entry[])=>void}) {
 const [selected,setSelected]=useState<string[]>([]),[review,setReview]=useState(false)
 return <details className="d-local-context"><summary>Seleccionar artículos</summary><div className="d-multi-select">{entries.map(e=><Checkbox key={e.name} isSelected={selected.includes(e.name)} onChange={checked=>{setSelected(old=>checked?[...old,e.name]:old.filter(n=>n!==e.name));setReview(false)}}>{e.name}</Checkbox>)}</div><p>{selected.length} seleccionados</p>{review?<><p>Bloquear el stock negativo para {selected.length} artículos. Solo cambia la política del ejemplo.</p><div className="d-inline-actions"><Button variant="secondary" onClick={()=>setReview(false)}>Cancelar</Button><Button onClick={()=>{onSave(entries.filter(e=>selected.includes(e.name)).map(e=>({...e,values:{...e.values,'Política de stock negativo':'Bloquear'}})));setSelected([]);setReview(false)}}>Confirmar bloqueo local</Button></div></>:<Button variant="secondary" disabled={!selected.length} onClick={()=>setReview(true)}>Bloquear stock negativo</Button>}</details>
}

export const salesDimensions=['Producto','Categoría','Operador','Hora','Canal','Método de pago']
export const salesPeriodFactor=(period:string)=>period==='Ayer'?2:period==='7 días'?7:period==='30 días'?30:1
export function reportRows(dimension:string,period:string,products:Entry[]):Entry[] {
 if(!products.length)return []
 const factor=salesPeriodFactor(period)
 const map:Record<string,[string,number,number][]>= {
  Categoría:[['Bebidas',52,3590],['Pan',32,1920],['Pizzas',7,1330]],
  Operador:[['Ana López',60,4480],['Sofía Martínez',31,2360]],
  Hora:[['08:00–09:00',5,360],['09:00–10:00',7,480],['10:00–11:00',11,840],['11:00–12:00',17,1280],['12:00–13:00',22,1640],['13:00–15:00',29,2240]],
  Canal:[['POS',72,5500],['WhatsApp',13,920],['Web',6,420]],
  'Método de pago':[['Efectivo',25,1860],['Tarjeta',52,4070],['Transferencia',11,660],['Mixto',3,250]],
 }
 return dimension==='Producto'?products.map(r=>({...r,cells:r.cells.map((c,i)=>i===0?String(Number(c)*factor):i===1?money(Number(c.replace(/[^0-9.]/g,''))*factor):c)})):(map[dimension]||[]).map(([name,count,total])=>({name,cells:[String(count*factor),money(total*factor),`${(total/6840*100).toFixed(1)}%`],detail:'Desglose de ejemplo del periodo'}))
}

export function ProfileAccess({role,products,onRole,onProducts}:{role:string;products:string;onRole:(role:string)=>void;onProducts:(products:string)=>void}) {
 return <details className="d-local-context"><summary>Acceso de esta demostración</summary><p>Estos escenarios cambian la interfaz del ejemplo. No conceden permisos en el negocio real ni acceso de plataforma.</p><div className="d-fields"><Select label="Rol de la demostración" selectedKey={role} onSelectionChange={key=>onRole(String(key))}>{['Owner','Consulta','Cajero'].map(r=><SelectItem id={r} key={r}>{r}</SelectItem>)}</Select><Select label="Productos de la demostración" selectedKey={products} onSelectionChange={key=>onProducts(String(key))}>{['Todos','Dashboard','Dashboard y Umi Cash'].map(r=><SelectItem id={r} key={r}>{r}</SelectItem>)}</Select></div></details>
}
