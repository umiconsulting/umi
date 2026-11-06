import { useState } from 'react'
import { RiAddLine, RiDeleteBinLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { Checkbox } from '@/components/base/checkbox/checkbox'
import { permissionCatalog } from './permission-catalog'
import { jsonValue, money, type Variant, type OptionGroup, type Ingredient } from './parity-model'
import type { Entry } from './data'

type EditorProps = { values: Record<string,string>; onChange: (label:string,value:string)=>void; entry?:Entry }
export const defaultVariants = (name?: string): Variant[] => name === 'Latte' ? [{name:'Clásico',delta:0,active:true},{name:'Nube',delta:10,active:true}] : []
export const defaultOptions = (name?: string): OptionGroup[] => /Latte|Capuccino/.test(name || '') ? [{name:'Tipo de leche',required:true,min:1,max:1,options:[{name:'Entera',delta:0,active:true},{name:'Deslactosada',delta:0,active:true},{name:'Avena',delta:15,active:true}]}] : []
export const defaultIngredients = (name?: string): Ingredient[] => /Latte|Capuccino/.test(name || '') ? [{article:'Café de la casa',quantity:.018,unit:'kg',cost:380},{article:'Leche deslactosada',quantity:.25,unit:'L',cost:28},{article:'Agua',quantity:.03,unit:'L',cost:0}] : [{article:'Harina de fuerza',quantity:.7,unit:'kg',cost:24},{article:'Agua',quantity:.25,unit:'L',cost:0}]

export function ProductCollections({values,onChange,entry}:EditorProps) {
 const variants=jsonValue<Variant[]>(values.variants,defaultVariants(entry?.name))
 const groups=jsonValue<OptionGroup[]>(values.optionGroups,defaultOptions(entry?.name))
 const saveVariants=(next:Variant[])=>onChange('variants',JSON.stringify(next))
 const saveGroups=(next:OptionGroup[])=>onChange('optionGroups',JSON.stringify(next))
 const updateVariant=(i:number,patch:Partial<Variant>)=>saveVariants(variants.map((v,j)=>i===j?{...v,...patch}:v))
 const updateGroup=(i:number,patch:Partial<OptionGroup>)=>saveGroups(groups.map((g,j)=>i===j?{...g,...patch}:g))
 const base=Number(values.Precio ?? entry?.cells[1]?.replace(/[^0-9.]/g,'') ?? 80)
 return <div className="d-domain-editor">
  <section><h2>Variantes</h2><p>El ajuste se suma al precio base del producto.</p>{variants.map((v,i)=><div className="d-collection-row" key={i}>
   <Input label={`Nombre de variante ${i+1}`} value={v.name} onChange={name=>updateVariant(i,{name})}/>
   <Input label={`Ajuste de variante ${i+1} (MXN)`} type="number" step="0.01" value={String(v.delta)} onChange={delta=>updateVariant(i,{delta:Number(delta)})}/>
   <span className="d-calculated">Precio final<b>{money(base+v.delta)}</b></span>
   <Checkbox isSelected={v.active} onChange={active=>updateVariant(i,{active})}>Activa</Checkbox>
   <Button variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Quitar variante ${i+1}`} onClick={()=>saveVariants(variants.filter((_,j)=>j!==i))}/>
  </div>)}<Button variant="secondary" leadingIcon={RiAddLine} onClick={()=>saveVariants([...variants,{name:'',delta:0,active:true}])}>Agregar variante</Button></section>
  <section><h2>Grupos de opciones</h2>{groups.map((g,i)=><fieldset className="d-collection-group" key={i}><legend>Grupo {i+1}</legend><div className="d-fields">
   <Input label={`Nombre del grupo ${i+1}`} value={g.name} onChange={name=>updateGroup(i,{name})}/>
   <Checkbox isSelected={g.required} onChange={required=>updateGroup(i,{required,min:required?Math.max(1,g.min):0})}>Selección obligatoria</Checkbox>
   <Input label={`Mínimo de selecciones ${i+1}`} type="number" min={0} value={String(g.min)} onChange={min=>updateGroup(i,{min:Number(min)})}/>
   <Input label={`Máximo de selecciones ${i+1}`} type="number" min={1} value={String(g.max)} onChange={max=>updateGroup(i,{max:Number(max)})}/>
  </div>{g.options.map((option,j)=><div className="d-collection-row" key={j}><Input label={`Opción ${i+1}.${j+1}`} value={option.name} onChange={name=>updateGroup(i,{options:g.options.map((o,k)=>j===k?{...o,name}:o)})}/><Input label={`Ajuste ${i+1}.${j+1} (MXN)`} type="number" step="0.01" value={String(option.delta)} onChange={delta=>updateGroup(i,{options:g.options.map((o,k)=>j===k?{...o,delta:Number(delta)}:o)})}/><Checkbox isSelected={option.active} onChange={active=>updateGroup(i,{options:g.options.map((o,k)=>j===k?{...o,active}:o)})}>Activa</Checkbox><Button variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Quitar opción ${i+1}.${j+1}`} onClick={()=>updateGroup(i,{options:g.options.filter((_,k)=>j!==k)})}/></div>)}<div className="d-inline-actions"><Button variant="secondary" onClick={()=>updateGroup(i,{options:[...g.options,{name:'',delta:0,active:true}]})}>Agregar opción</Button><Button variant="ghost" onClick={()=>saveGroups(groups.filter((_,j)=>i!==j))}>Quitar grupo</Button></div></fieldset>)}<Button variant="secondary" leadingIcon={RiAddLine} onClick={()=>saveGroups([...groups,{name:'',required:false,min:0,max:1,options:[]}])}>Agregar grupo</Button></section>
  <section><h2>Disponibilidad por sucursal</h2><Select label="Estado en Malecón" selectedKey={values['Disponibilidad Malecón']||'Disponible'} onSelectionChange={key=>onChange('Disponibilidad Malecón',String(key))}>{['Disponible','No disponible','Fuera de surtido','Descontinuado','Programado'].map(s=><SelectItem id={s} key={s}>{s}</SelectItem>)}</Select>{values['Disponibilidad Malecón']==='Programado'&&<Input label="Disponible desde" value={values['Disponible desde']||''} onChange={value=>onChange('Disponible desde',value)} placeholder="2026-11-03 08:00"/>}</section>
 </div>
}

export function RecipeIngredients({values,onChange,entry}:EditorProps) {
 const ingredients=jsonValue<Ingredient[]>(values.ingredients,defaultIngredients(entry?.name))
 const save=(next:Ingredient[])=>onChange('ingredients',JSON.stringify(next))
 const update=(i:number,patch:Partial<Ingredient>)=>save(ingredients.map((v,j)=>i===j?{...v,...patch}:v))
 const options=[{name:'Café de la casa',unit:'kg',cost:380},{name:'Leche deslactosada',unit:'L',cost:28},{name:'Leche de avena',unit:'L',cost:null},{name:'Harina de fuerza',unit:'kg',cost:24},{name:'Agua',unit:'L',cost:0},{name:'Masa para pizza',unit:'pza',cost:12.4}]
 const complete=ingredients.every(i=>i.cost!==null)
 return <section className="d-domain-editor"><h2>Ingredientes</h2>{ingredients.map((item,i)=><div className="d-collection-row" key={i}><Select label={`Ingrediente ${i+1}`} selectedKey={item.article} onSelectionChange={key=>{const found=options.find(o=>o.name===key);if(found)update(i,{article:found.name,unit:found.unit,cost:found.cost})}}>{options.map(o=><SelectItem id={o.name} key={o.name}>{o.name}</SelectItem>)}</Select><Input label={`Cantidad de ingrediente ${i+1}`} type="number" min={0} step="any" value={String(item.quantity)} onChange={quantity=>update(i,{quantity:Number(quantity)})}/><span className="d-calculated">{item.unit}<b>{item.cost===null?'Costo desconocido':money(item.quantity*item.cost)}</b></span><Button variant="ghost" iconOnly leadingIcon={RiDeleteBinLine} aria-label={`Quitar ingrediente ${i+1}`} onClick={()=>save(ingredients.filter((_,j)=>i!==j))}/></div>)}<Button variant="secondary" leadingIcon={RiAddLine} onClick={()=>save([...ingredients,{article:'Café de la casa',quantity:0,unit:'kg',cost:380}])}>Agregar ingrediente</Button><div className="d-detail-line"><span>Costo del rendimiento</span><b>{complete?money(ingredients.reduce((sum,i)=>sum+i.quantity*(i.cost||0),0)):'Incompleto · Falta costo'}</b></div><p>Una compra registrada tiene prioridad sobre el costo inicial. El costo cero permanece visible.</p></section>
}

export function PermissionEditor({values,onChange,entry}:EditorProps) {
 const [group,setGroup]=useState('Todos'),[search,setSearch]=useState('')
 const selected=jsonValue<string[]>(values.permissions,entry?.name==='Cajero'?['catalog.read','checkout.commit','cash.shift.read','cash.register.use']:['catalog.read','kitchen.read'])
 const visible=permissionCatalog.filter(p=>(group==='Todos'||p.group===group)&&p.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
 return <section className="d-domain-editor"><h2>Permisos</h2><div className="d-fields"><Input label="Buscar permiso" value={search} onChange={setSearch}/><Select label="Dominio de permisos" selectedKey={group} onSelectionChange={key=>setGroup(String(key))}>{['Todos',...new Set(permissionCatalog.map(p=>p.group))].map(g=><SelectItem id={g} key={g}>{g}</SelectItem>)}</Select></div><p>{selected.length} permisos seleccionados. La asignación efectiva depende del producto contratado y de la autorización del servidor.</p><div className="d-permission-list">{visible.map(p=><Checkbox key={p.key} isSelected={selected.includes(p.key)} onChange={checked=>onChange('permissions',JSON.stringify(checked?[...selected,p.key]:selected.filter(key=>key!==p.key)))}>{p.label}</Checkbox>)}</div></section>
}
