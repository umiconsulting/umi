import { useEffect, useRef, useState } from 'react'
import { RiArrowLeftLine, RiCheckLine, RiArrowRightLine, RiAddLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Input } from '@/components/base/input/input'
import { Select, SelectItem } from '@/components/base/select/select'
import { Tabs, TabList, Tab } from '@/components/base/tabs/tabs'
import type { Entry, Field, View } from './data'
import type { TourDetail } from './tour-model'
import { applyLocalAction, giftCardFor, giftFingerprint, registerGiftCode, jsonValue, money, safeValues, validateChoices, validatePin, validateReceiptLines, type Ingredient, type OptionGroup, type Variant } from './parity-model'
import { ProductCollections, RecipeIngredients, PermissionEditor, defaultVariants, defaultOptions, defaultIngredients } from './CollectionEditors'
import { CashDetail, CatalogDetail, RecipeDetail, PurchaseEditor, defaultReceiptLines, CustomerIdentity } from './DomainPanels'
import ImportWorkflow from './ImportWorkflow'

export type DetailState={view:View;entry?:Entry;action?:string;savedValues?:Record<string,string>}
export function Fields({fields,values,onChange}:{fields:Field[];values:Record<string,string>;onChange:(label:string,value:string)=>void}){
 return <div className="d-fields">{fields.map(field=>field.options?<Select key={field.label} label={field.label} selectedKey={values[field.label]??field.value??field.options[0]} onSelectionChange={key=>onChange(field.label,String(key))}>{field.options.map(option=><SelectItem key={option} id={option}>{option}</SelectItem>)}</Select>:<Input key={field.label} label={field.label} value={values[field.label]??field.value??''} type={field.type||'text'} step={field.type==='number'?'any':undefined} isRequired={field.required} onChange={value=>onChange(field.label,value)}/>)}</div>
}
const aliases:Record<string,string>={'Acceso POS':'Acceso al POS','Umbral de demora':'Umbral de demora (minutos)','Monto':'Monto inicial','Propietario':'Nombre del propietario','Alcance':'Descripción','Tiempo objetivo':'Tiempo objetivo (minutos)'}
const fieldForColumn=(fields:Field[],column:string,view:string)=>fields.find(f=>f.label===(column==='Estado'&&view==='products'?'Disponibilidad':aliases[column]||column))
const displayValue=(column:string,value:string)=>column==='Precio'||column==='Monto'?Number(value).toLocaleString('es-MX',{style:'currency',currency:'MXN'}):column==='Acceso POS'?(value==='Sí'?'Habilitado':'Deshabilitado'):column==='Umbral de demora'?value+' min':value
const statusFor=(cells:string[])=>/Por revisar|Bajo|Pendiente|Agotado/.test(cells.at(-1)||'')?'pending':/Inactiv|No disponible|Cerrad/.test(cells.at(-1)||'')?'neutral':'ready'
const fieldsFor=(state:DetailState):Field[]=>{
 const {view,action}=state
 if(action==='Recargar saldo')return [{label:'Importe',type:'number',required:true},{label:'Referencia del pago',required:true}]
 if(action==='Agregar sellos')return [{label:'Sellos',type:'number',value:'1',required:true},{label:'Referencia del recibo',required:true}]
 if(action==='Registrar visita')return [{label:'Referencia del recibo',required:true}]
 if(action==='Canjear recompensa')return [{label:'Recompensa',options:['Café de cortesía']},{label:'Referencia del recibo',required:true}]
 if(action==='Agregar nota')return [{label:'Nota',required:true}]
 if(action==='Ajustar existencia'||action==='Registrar merma')return [{label:'Artículo',value:state.entry?.name||'Café de especialidad'},...(action==='Ajustar existencia'?[{label:'Dirección',options:['Aumentar','Reducir']}]:[]),{label:'Cantidad',type:'number',required:true},{label:'Motivo',required:true}]
 if(action==='Asignar PIN')return [{label:'Nuevo PIN',type:'password',required:true},{label:'Confirmar el PIN',type:'password',required:true}]
 if(action==='Canjear tarjeta')return [{label:'Código de canje',required:true},{label:'Canal del cliente',options:['Correo','Teléfono']},{label:'Contacto del cliente',required:true}]
 if(action==='Reasignar equipo')return [{label:'Rol de reemplazo',options:['Encargada','Cajero','Mesero','Barra','Cocina'],required:true}]
 if(action==='Archivar rol'||action==='Quitar PIN'||action==='Restaurar persona'||action==='Retirar receta'||action==='Desactivar ruta')return [{label:'Motivo',required:true}]
 if(action==='Solicitar copia')return [{label:'Impresora',options:['Caja principal']},{label:'Motivo de la copia',required:true}]
 if(action==='Aprobar solicitud')return [{label:'Estación',options:['Cocina','Barra']}]
 if(action==='Denegar solicitud'||action==='Revocar dispositivo'||action==='Archivar'||action==='Desactivar persona')return [{label:'Motivo',required:true}]
 if(action==='Nueva preparación')return [{label:'Artículo',options:['Masa para pizza','Focaccia','Salsa de tomate','Jarabe de vainilla','Concha']},{label:'Almacén',options:['Refrigeración','Almacén seco','Barra','Vitrina']},{label:'Cantidad',type:'number',required:true}]
 if(action==='Guardar horario')return [{label:'Día abierto',value:'Sí',options:['Sí','No']},{label:'Apertura',value:state.entry?.cells[0]||'08:00',type:'time',required:true},{label:'Cierre',value:state.entry?.cells[1]||'20:00',type:'time',required:true},{label:'Corte antes del cierre (minutos)',value:'30',type:'number'},{label:'Copiar a',options:['Solo este día','Lunes a viernes','Todos los días']}]
 if(action==='Pausar pedidos')return [{label:'Motivo visible para clientes',required:true}]
 if(action==='Reanudar pedidos')return [{label:'Confirmar alcance global',value:'Todo el negocio',options:['Todo el negocio']}]
 if(action==='Conectar Mercado Pago'||action==='Reconectar Mercado Pago'||action==='Desconectar Mercado Pago')return [{label:'Cuenta del proveedor',value:'ONCA Centro'},{label:'Confirmar solicitud',value:'Simular la solicitud',options:['Simular la solicitud']}]
 if(action==='Crear tienda')return [{label:'Nombre de tienda',required:true},{label:'Identificador externo',required:true},{label:'Dirección de la tienda',required:true}]
 if(action==='Revisar recepción'||action==='Cargar CFDI'||action==='Cargar CFDI XML')return []
 if(action==='Configurar terminal'||action==='Editar terminal')return view.fields||[]
 if(action==='Registrar daño')return [{label:'Artículo',value:state.entry?.name},{label:'Cantidad',type:'number',required:true},{label:'Motivo',required:true}]
 if(action==='Importar artículos'||action==='Importar recetas'||action==='Cargar CFDI XML')return []
 if(action==='Reintentar operación')return []
 if(view.fields?.length)return view.fields.filter(f=>view.id==='products'?!['Variante','Grupo de opciones','Opciones y modificadores'].includes(f.label):view.id==='recipes'?!['Ingrediente','Cantidad del ingrediente','Unidad del ingrediente'].includes(f.label):view.id==='permissions'?!f.options: true).map(f=>{
  if(!state.entry)return f
  if(/^Nombre/.test(f.label))return {...f,value:state.entry.name}
  const column=view.columns.findIndex(col=>fieldForColumn([f],col,view.id))
  if(column>0){const raw=state.entry.cells[column-1],cell=f.label==='Acceso al POS'?(raw==='Habilitado'?'Sí':'No'):raw;if(!f.options||f.options.includes(cell))return {...f,value:f.type==='number'?f.label==='Rendimiento'?String(parseFloat(cell)):cell.replace(/[^0-9.-]/g,''):cell}}
  if(f.label==='Producto o artículo')return {...f,value:state.entry.name}
  if(state.entry.values?.[f.label]!==undefined)return {...f,value:f.type==='password'?'':state.entry.values[f.label]}
  if(f.label==='Correo')return {...f,value:state.entry.detail?.split(' · ')[0]||''}
  if(view.id==='routes'&&f.label==='Tipo de ruta')return {...f,value:state.entry.name==='Ruta predeterminada'?'Predeterminada':state.entry.detail?.includes('categoría')?'Categoría':'Producto'}
  if(view.id==='devices'&&f.label==='Producto')return {...f,value:/KDS|Cocina/.test(state.entry.cells[1])?'KDS':'POS'}
  if(view.id==='devices'&&f.label==='Plataforma')return {...f,value:state.entry.cells[1].split(' · ').at(-1)?.replace('iPadOS','iOS')||f.value}
  if(view.id==='devices'&&f.label==='Estación'){const station=state.entry.detail?.replace(/^Estación /,'');return {...f,value:station&&f.options?.includes(station)?station:f.value}}
  if(view.id==='routes'&&f.label==='Categoría o producto')return {...f,value:state.entry.name}
  if(view.id==='routes'&&f.label==='Estación de destino')return {...f,value:state.entry.cells[0]}
  if(view.id==='items'&&f.label==='Referencia')return {...f,value:state.entry.detail?.split(' · ')[0]||''}
  return f
 })
 return [{label:'Nombre',value:state.entry?.name||'',required:true}]
}
export function Detail({state,onBack,onSave,tour,records={},scope='ONCA:Centro',readOnly=false,onBatchSave=()=>{}}:{state:DetailState;tour?:TourDetail;onBack:()=>void;onSave:(entry?:Entry,values?:Record<string,string>,action?:string)=>void;records?:Record<string,Entry[]>;scope?:string;readOnly?:boolean;onBatchSave?:(view:string,entries:Entry[])=>void}){
 const {view,entry}=state
 const [localAction,setAction]=useState(state.action||'')
 const [values,setValues]=useState<Record<string,string>>({...entry?.values,...state.savedValues})
 const [localStep,setStep]=useState<'edit'|'review'|'result'>('edit')
 const [localTab,setTab]=useState('Resumen')
 const [error,setError]=useState('')
 const [file,setFile]=useState('')
 const [scenario,setScenario]=useState('Normal')
 const [giftCode]=useState(()=>`DEMO-${crypto.randomUUID().slice(0,8).toUpperCase()}`)
 const [giftHash,setGiftHash]=useState(''),[redeeming,setRedeeming]=useState<Entry|null>(null)
 useEffect(()=>{void giftFingerprint(giftCode).then(setGiftHash)},[giftCode])
 const [showCode,setShowCode]=useState(true)
 const [operationId,setOperationId]=useState(()=>crypto.randomUUID().slice(0,8))
 const confirmed=useRef(false)
 const action=tour?.action??localAction,step=tour?.step??localStep,tab=tour?.tab??localTab
 useEffect(()=>{if(tour){setAction(tour.action||'');setStep(tour.step||'edit');setTab(tour.tab||'Resumen')}},[tour])
 const fields=fieldsFor({...state,action}).map(f=>{if(f.label!=='Rol'&&f.label!=='Rol de reemplazo')return f;const options=(records.permissions||[]).filter(r=>r.name!=='Owner'&&r.cells.at(-1)!=='Archivado'&&(f.label!=='Rol de reemplazo'||r.name!==entry?.name)).map(r=>r.name);return {...f,options,value:f.value&&options.includes(f.value)?f.value:options[0]}})
 const importing=action.startsWith('Importar')||!!tour&&action==='Cargar CFDI XML'
 const change=(label:string,value:string)=>setValues(v=>({...v,[label]:value}))
 const start=(next:string)=>{setAction(next);setValues(next.startsWith('Editar')||next==='Revisar recepción'?{...entry?.values,...state.savedValues}:{});setStep('edit');setError('');setScenario('Normal');setOperationId(crypto.randomUUID().slice(0,8));confirmed.current=false}
 const submit=async()=>{
  if(importing&&!file){setError('Selecciona un archivo para continuar.');return}
  const missing=fields.find(f=>f.required&&!String(values[f.label]??f.value??f.options?.[0]??'').trim())
  if(missing){setError(`Completa ${missing.label.toLowerCase()}.`);return}
  const invalid=fields.find(f=>f.type==='number'&&String(values[f.label]??f.value??'').trim()&&(!Number.isFinite(Number(values[f.label]??f.value))||(!['Latitud','Longitud'].includes(f.label)&&Number(values[f.label]??f.value)<0)||(['Cantidad','Importe','Sellos'].includes(f.label)&&Number(values[f.label]??f.value)===0)))
  if(invalid){setError(`${invalid.label} debe tener un importe válido.`);return}
  if(action==='Asignar PIN'||view.id==='team'&&values['Asignar nuevo PIN']){const pinError=validatePin(values['Nuevo PIN']||values['Asignar nuevo PIN']||'',values['Confirmar el PIN']||'');if(pinError){setError(pinError);return}}
  if(view.id==='products'&&(action==='Nuevo producto'||action==='Editar producto')){const choiceError=validateChoices(jsonValue<Variant[]>(values.variants,defaultVariants(entry?.name)),jsonValue<OptionGroup[]>(values.optionGroups,defaultOptions(entry?.name)),Number(values.Precio??fields.find(f=>f.label==='Precio')?.value));if(choiceError){setError(choiceError);return}}
  if(view.id==='recipes'&&(action==='Nueva receta'||action==='Editar receta')){const ingredients=jsonValue<Ingredient[]>(values.ingredients,defaultIngredients(entry?.name));if(!ingredients.length||ingredients.some(i=>!i.article||!Number.isFinite(i.quantity)||i.quantity<=0)){setError('Agrega ingredientes con una cantidad mayor que cero.');return}if(new Set(ingredients.map(i=>i.article)).size!==ingredients.length){setError('Cada ingrediente debe aparecer una sola vez.');return}}
  if(['Revisar recepción','Cargar CFDI','Cargar CFDI XML'].includes(action)){if(!entry&&!values['Archivo CFDI XML']){setError('Selecciona una factura XML.');return}const issue=validateReceiptLines(jsonValue(values.invoiceLines,defaultReceiptLines(entry)));if(issue){setError(issue);return}}
  if(action==='Canjear tarjeta'){const target=await giftCardFor(values['Código de canje']||'',records.giftcards||[]);if(!target||entry&&entry.name!==target.name){setError('El código no coincide con esta tarjeta de ejemplo disponible.');return}setRedeeming(target)}
  if(action==='Canjear recompensa'&&Number(entry?.values?.stamps||5)<8){setError('El cliente todavía no tiene una recompensa disponible.');return}
  if(action==='Configurar cobro'&&values['Transferencia bancaria']==='Sí'&&(!values.Banco?.trim()||!values['Titular de la cuenta']?.trim()||!/^\d{18}$/.test(values.CLABE||''))){setError('Completa titular, banco y una CLABE de 18 dígitos.');return}
  setError('');setStep('review')
 }
 const protectedEntry=entry&&(entry.name==='Owner'||view.id==='team'&&entry.cells[0]==='Owner')
 const actions=entry&&!protectedEntry&&!readOnly?view.id==='customers'?['Agregar sellos','Registrar visita','Canjear recompensa','Recargar saldo']:view.id==='items'?['Ajustar existencia','Registrar merma','Registrar daño','Editar artículo','Archivar']:view.id==='team'?/Inactiv/.test(entry.cells.at(-1)||'')?['Restaurar persona']:['Editar persona','Asignar PIN','Quitar PIN','Desactivar persona']:view.id==='permissions'?['Editar rol','Reasignar equipo','Archivar rol']:view.id==='requests'?entry.cells.at(-1)==='Pendiente'?['Aprobar solicitud','Denegar solicitud']:[]:view.id==='devices'?entry.cells.at(-1)==='Revocado'?[]:['Editar dispositivo','Revocar dispositivo']:view.id==='receipts'?['Solicitar copia']:view.id==='recovery'?['Reintentar operación']:view.id==='products'?['Editar producto','Archivar']:view.id==='recipes'?['Editar receta','Retirar receta']:view.id==='hours'?['Guardar horario']:view.id==='giftcards'?entry.cells.at(-1)==='Sin canjear'?['Canjear tarjeta']:[]:view.id==='routes'?['Editar ruta','Desactivar ruta']:view.id==='stations'?['Editar estación','Archivar']:view.id==='terminals'?['Editar terminal']:view.id==='purchases'?entry.cells.at(-1)==='Recibida'?[]:['Revisar recepción']:view.fields?['Editar']:[]:[]
 const beginFields=()=>fields.map(f=>({label:f.label,value:values[f.label]??f.value??f.options?.[0]??''}))
 const formValues=()=>safeValues({...Object.fromEntries(beginFields().map(f=>[f.label,f.value])),...values})
 const confirmedEntry=():Entry|undefined=>{
  const form=formValues()
  if(view.id==='purchases'&&['Revisar recepción','Cargar CFDI','Cargar CFDI XML'].includes(action)){
   const lines=jsonValue(values.invoiceLines,defaultReceiptLines(entry)),partial=lines.some(l=>l.received<l.quantity)
   return {name:entry?.name||form.Factura||'Factura de ejemplo',detail:`${form['Pedido de compra']||'Sin pedido vinculado'} · Recepción local`,cells:[entry?.cells[0]||form.Proveedor||'Proveedor del CFDI','Hoy',money(lines.reduce((sum,l)=>sum+l.quantity*l.price,0)),partial?'Recepción parcial':'Recibida'],status:partial?'working':'ready',values:{...entry?.values,...form,invoiceLines:JSON.stringify(lines)}}
  }
  if(view.id==='hours'&&entry&&action==='Guardar horario'){
   const [hour,minute]=(form.Cierre||'20:00').split(':').map(Number),cutoff=hour*60+minute-Number(form['Corte antes del cierre (minutos)']||0)
   return {...entry,cells:[form.Apertura,form.Cierre,`${String(Math.floor(cutoff/60)).padStart(2,'0')}:${String(cutoff%60).padStart(2,'0')}`,form['Día abierto']==='No'?'Cerrado':'Abierto'],values:{...entry.values,...form}}
  }
  if(view.id==='routes'&&(action==='Configurar ruta'||action==='Editar ruta'))return {name:form['Tipo de ruta']==='Predeterminada'?'Ruta predeterminada':form['Categoría o producto'],detail:`Ruta por ${form['Tipo de ruta']?.toLocaleLowerCase()}`,cells:[form['Estación de destino'],form.Prioridad,`${form['Tiempo objetivo (minutos)']} min`,form['Estación de destino']==='Sin destino'?'Sin destino':'Activa'],status:form['Estación de destino']==='Sin destino'?'pending':'ready',values:form}
  if(view.id==='terminals'&&action==='Configurar terminal')return {name:form.Terminal,detail:'Asignación local · Proveedor sin verificar',cells:[form.Tienda,form.Registro,form.Modo,'Sin verificar'],status:'pending',values:form}
  if(view.id==='sounds'&&action==='Configurar avisos')return {name:form.Estación,cells:[form['Al llegar'],form['Al vencer'],form['Artículo listo para el mesero']],values:form}
  if(view.id==='devices'&&action==='Añadir equipo')return {name:form['Nombre del equipo'],detail:'Código de configuración de ejemplo · Pendiente de registro',cells:[form.Sucursal,`${form.Producto} · ${form.Plataforma}`,'Nunca','Código creado'],status:'pending',values:{...form,setupCode:'DEMO-'+operationId.toUpperCase(),expires:new Date(Date.now()+15*60*1000).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}}
  if(view.id==='giftcards'&&action==='Emitir tarjeta')return {name:'Regalo · '+operationId.slice(0,4).toUpperCase(),detail:'Código oculto · Emitida en esta demostración',cells:[form.Destinatario||'Sin destinatario',money(Number(form['Monto inicial'])),'Hoy','Sin canjear'],status:'pending',values:{...form,codeHash:giftHash}}
  if(view.id==='giftcards'&&action==='Canjear tarjeta'&&!entry){return redeeming?applyLocalAction(view.id,redeeming,action,values):undefined}
  if(view.id==='preparation'&&action==='Nueva preparación')return {name:'Lote PREP-'+operationId.slice(0,4).toUpperCase(),detail:`${form.Artículo} · ${form.Almacén} · Preparación local`,cells:[`${form.Cantidad} pzas`,`${form.Cantidad} pzas`,'0 pzas','Lote registrado'],status:'ready',values:{...form,batch:operationId,labels:form.Cantidad}}
  if(entry){
   if(!action.startsWith('Editar'))return applyLocalAction(view.id,entry,action,values)
   const nameField=fields.find(f=>/^Nombre/.test(f.label))
   const cells=entry.cells.map((old,i)=>{const col=view.columns[i+1],f=fieldForColumn(fields,col,view.id),value=f&&values[f.label];return value!==undefined?displayValue(col,value):old})
   let next={...entry,name:nameField?values[nameField.label]||entry.name:entry.name,cells,status:statusFor(cells),values:{...entry.values,...form}}
   if(view.id==='devices')next={...next,cells:[form.Sucursal,`${form.Producto} · ${form.Plataforma}`,entry.cells[2],entry.cells[3]]}
   if(view.id==='recipes'){
    const ingredients=jsonValue<Ingredient[]>(values.ingredients,defaultIngredients(entry.name)),version=Number(entry.cells.at(-1)?.match(/v(\d+)/)?.[1]||1)+1
    next={...next,cells:[`${form.Rendimiento} ${form['Unidad de rendimiento']}`,String(ingredients.length),ingredients.some(i=>i.cost===null)?'Incompleto':money(ingredients.reduce((sum,i)=>sum+i.quantity*(i.cost||0),0)),`v${version} · Vigente`],values:{...next.values,ingredients:JSON.stringify(ingredients),versions:JSON.stringify([...jsonValue<unknown[]>(entry.values?.versions,[]),{version:entry.cells.at(-1),date:'Hoy · Demo',ingredients:jsonValue(entry.values?.ingredients,defaultIngredients(entry.name))}])}}
   }
   if(view.id==='team'&&values['Asignar nuevo PIN'])next.values.hasPin='Sí'
   return next
  }
  if(!view.action||action!==view.action||! /^(Nuevo |Nueva |Añadir |Registrar miembro$|Emitir tarjeta$|Crear rol$|Cargar CFDI$)/.test(action))return undefined
  const nameField=fields.find(f=>/^Nombre/.test(f.label))
  const name=nameField?form[nameField.label]:view.id==='preparation'?'PREP · '+form['Artículo']:view.id==='giftcards'?'Regalo · '+(form['Destinatario']||'Sin destinatario'):form['Producto o artículo']||form[fields[0]?.label]||view.label
  const defaults:Record<string,string>={Estado:'Por revisar',Productos:'0',Personas:'0',Dispositivo:'Sin asignar','Última conexión':'Sin conexión',Existencia:'0',Sucursales:form['Primera sucursal']?'1':'0'}
  const cells=view.columns.slice(1).map(col=>{
   const field=fieldForColumn(fields,col,view.id),value=field?form[field.label]:undefined
   if(value===undefined||value==='')return defaults[col]||'—'
   return displayValue(col,value)
  })
  if(view.id==='team'){cells[cells.length-1]='Activa';form.hasPin=values['Asignar nuevo PIN']?'Sí':'No'}
  if(view.id==='permissions')cells[cells.length-1]='Activo'
  if(view.id==='products'){form.variants=values.variants||'[]';form.optionGroups=values.optionGroups||'[]'}
  if(view.id==='recipes'){const ingredients=jsonValue<Ingredient[]>(values.ingredients,defaultIngredients());form.ingredients=JSON.stringify(ingredients);cells[0]=`${form.Rendimiento} ${form['Unidad de rendimiento']}`;cells[1]=String(ingredients.length);cells[2]=ingredients.some(i=>i.cost===null)?'Incompleto':money(ingredients.reduce((sum,i)=>sum+i.quantity*(i.cost||0),0));cells[3]='v1 · Vigente'}
  return {name,detail:form.Correo?`${form.Correo} · Añadido en esta demostración`:'Añadido en esta demostración',cells,status:statusFor(cells),values:form}
 }
 const confirm=()=>{
  if(confirmed.current)return
  if(scenario!=='Normal'){setError(scenario==='Resultado desconocido'?`Resultado pendiente de la operación ${operationId}. Reintenta la misma operación.`:`Error temporal en la operación ${operationId}. Puedes reintentar.`);setScenario('Normal');return}
  if(action==='Canjear tarjeta'&&!entry&&!confirmedEntry()){setError('No se encontró una tarjeta de ejemplo sin canjear con ese código.');return}
  confirmed.current=true
  if(action==='Emitir tarjeta'){const issued=confirmedEntry();if(issued)registerGiftCode(giftCode,issued.name)}
  onSave(confirmedEntry(),formValues(),action);setValues(v=>safeValues(v));setStep('result');setError('')
 }
 if(!tour&&action.startsWith('Importar'))return <ImportWorkflow kind={action==='Importar recetas'?'recipes':'items'} scope={scope} records={records} onBack={onBack} onSave={onBatchSave}/>
 return <section className="d-detail">
  <Button variant="ghost" leadingIcon={RiArrowLeftLine} onClick={onBack} className="d-back" data-target="d-back">Volver a {view.label.toLowerCase()}</Button>
  <div className="d-detail-heading"><span className="d-eyebrow">{view.label}</span><h1>{action||entry?.name||view.action}</h1><p>{entry?.detail||view.description}</p></div>
  {!action&&entry?<>
   {view.id==='customers'&&<Tabs selectedKey={tab} onSelectionChange={key=>setTab(String(key))}><TabList aria-label="Secciones del cliente">{['Resumen','WhatsApp','Pedidos','Lealtad','Notas','Datos'].map(label=><Tab data-target={`d-customer-${label}`} key={label} id={label}>{label}</Tab>)}</TabList></Tabs>}
   <div className="d-detail-columns"><div>
    {view.id==='customers'?<CustomerPanel tab={tab} entry={entry}/>:view.id==='inbox'?<CustomerPanel tab="WhatsApp" entry={entry}/>:<><dl className="d-facts">{view.columns.slice(1).map((label,i)=><div key={label}><dt>{label}</dt><dd>{entry.cells[i]}</dd></div>)}</dl>
     {['orders','receipts'].includes(view.id)&&<TransactionDetail entry={entry} view={view}/>}
     {view.id==='shifts'&&<CashDetail entry={entry}/>} 
     {view.id==='products'&&<CatalogDetail entry={entry}/>}
     {view.id==='recipes'&&<RecipeDetail entry={entry}/>}
     {view.id==='team'&&<p>PIN del POS: {entry.values?.hasPin==='No'?'Sin PIN':'Configurado · No se muestra el PIN guardado'}</p>}
     {view.id==='devices'&&<dl className="d-facts"><div><dt>Modalidad</dt><dd>{entry.values?.Modalidad||'Fijo'}</dd></div><div><dt>Estación</dt><dd>{entry.values?.Estación||entry.detail}</dd></div></dl>}
     {view.id==='permissions'&&<p>{jsonValue<string[]>(entry.values?.permissions,[]).length||'Consulta'} permisos · Owner permanece protegido.</p>}
     {view.id==='giftcards'&&<p>Código completo oculto. El canje abona el monto al monedero del cliente.</p>}
     {view.id==='preparation'&&entry.values?.batch&&<><h2>Lote y etiquetas</h2><p>PREP-{entry.values.batch} · {entry.values.Artículo} · {entry.values.Almacén}</p><p>{entry.values.labels} etiquetas de ejemplo · Caducidad según la receta.</p><Button variant="secondary" onClick={()=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([`PREP-${entry.values?.batch}\n${entry.values?.Artículo}\nCantidad: ${entry.values?.labels}\nEtiqueta de demostración`],{type:'text/plain'}));a.href=url;a.download='etiquetas-demo.txt';a.click();URL.revokeObjectURL(url)}}>Descargar etiquetas de ejemplo</Button></>}
     {view.id==='items'&&<><h2>Movimientos</h2><div className="d-detail-line"><span>Compra 0028<small>Hoy, 08:00</small></span><b>Entrada registrada</b></div><div className="d-detail-line"><span>Consumo por ventas</span><b>Según recetas vigentes</b></div>{entry.values?.lastMovement&&<p>{entry.values.lastMovement}</p>}<p>Las compras registradas tienen prioridad sobre el costo inicial.</p><p>Stock negativo: {entry.values?.['Política de stock negativo']||'Bloquear'}</p></>}
    </>}
   </div><aside><h2>Acciones</h2>{protectedEntry&&<p>Rol Owner protegido</p>}{readOnly&&<p>Acceso de consulta. Las acciones requieren autorización.</p>}{actions.length?actions.filter(a=>a!=='Quitar PIN'||entry.values?.hasPin!=='No').map(a=><Button data-target={`d-action-${a}`} variant="secondary" key={a} disabled={a==='Archivar rol'&&Number(entry.cells[0])>0||a==='Canjear recompensa'&&Number(entry.values?.stamps||5)<8} onClick={()=>start(a)}>{a}</Button>):<p>Consulta del registro</p>}{view.id==='permissions'&&Number(entry.cells[0])>0&&<p>Reasigna a las personas antes de archivar el rol.</p>}{['shifts','refunds','wallet','billing'].includes(view.id)&&<p className="d-note">Consulta del registro. Las operaciones mantienen los permisos del producto.</p>}</aside></div>
  </>:step==='result'?<div className="d-result"><RiCheckLine size={32}/><h2>{importing?'Revisión completada':confirmedEntry()?'Cambio guardado en la demo':'Simulación completada'}</h2><p>{action==='Añadir equipo'?'El código de ejemplo espera el registro. No representa un equipo conectado.':action==='Solicitar copia'?'Solicitud simulada: resultado físico desconocido. Ningún ticket se ha enviado a una impresora.':action==='Nueva preparación'?'Lote registrado en el ejemplo. Consulta el lote y sus etiquetas en Preparación.':action.includes('Mercado Pago')?'Solicitud simulada. El resultado del proveedor no se ha verificado.':confirmedEntry()?'El cambio permanece durante esta sesión del prototipo.':'Configuración guardada en esta demostración.'}</p>{action==='Añadir equipo'&&<p className="d-preview-code">DEMO-{operationId.toUpperCase()} · Caduca a las {new Date(Date.now()+15*60*1000).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</p>}{action==='Emitir tarjeta'&&<>{showCode?<><p>Guarda este código. Solo se muestra una vez.</p><code className="d-preview-code">{giftCode}</code><Button variant="secondary" onClick={()=>setShowCode(false)}>Ya guardé el código</Button></>:<p>Código oculto</p>}</>}<Button onClick={onBack}>Volver a {view.label.toLowerCase()}</Button></div>:<form className="d-edit-form" onSubmit={event=>{event.preventDefault();submit()}}>
   <div className="d-step-label"><span data-active={step==='edit'}>1 · Datos</span><span data-active={step==='review'}>2 · Revisar</span><span>3 · Confirmar</span></div>
   {step==='edit'?<>
    {importing?<div className="d-upload"><label htmlFor="dashboard-import">{action==='Cargar CFDI XML'?'Factura XML':'Archivo CSV'}</label><input id="dashboard-import" type="file" accept={action==='Cargar CFDI XML'?'.xml':'.csv'} onChange={event=>{const selected=event.target.files?.[0];if(selected&&selected.size>2*1024*1024){setError('El archivo supera 2 MiB.');setFile('')}else{setFile(selected?.name||'');setError('')}}}/><p>{action==='Cargar CFDI XML'?'Revisa los artículos y cantidades antes de registrar la entrada.':'El prototipo muestra la revisión de ejemplo. La importación no registra entradas de inventario.'}</p></div>:<><Fields fields={fields} values={values} onChange={change}/>{view.id==='products'&&action!=='Archivar'&&<ProductCollections entry={entry} values={values} onChange={change}/>} {view.id==='recipes'&&action!=='Retirar receta'&&<RecipeIngredients entry={entry} values={values} onChange={change}/>} {view.id==='permissions'&&action!=='Reasignar equipo'&&action!=='Archivar rol'&&<PermissionEditor entry={entry} values={values} onChange={change}/>} {view.id==='purchases'&&<PurchaseEditor entry={entry} values={values} onChange={change} items={records.items||[]}/>} {action==='Canjear tarjeta'&&<p>Código del ejemplo existente: DEMO-{entry?.name.split(' · ')[1]||'0281'}. Las nuevas tarjetas usan su código emitido.</p>}</>}
   </>:<div className="d-review"><h2>Revisa antes de confirmar</h2>{importing?<><p>{file}</p><div className="d-detail-line"><span>Registros del ejemplo</span><b>3 válidos</b></div><p>Esta revisión es ilustrativa; no analiza ni importa el contenido del archivo.</p></>:<dl className="d-facts">{beginFields().map(f=><div key={f.label}><dt>{f.label}</dt><dd>{fields.find(field=>field.label===f.label)?.type==='password'?'••••':f.value}</dd></div>)}</dl>}
    {action==='Nueva preparación'&&<><h2>Ingredientes a consumir</h2><div className="d-detail-line"><span>Harina de trigo</span><b>{(Number(values['Cantidad']||1)*.7).toFixed(2)} kg</b></div><div className="d-detail-line"><span>Agua</span><b>{(Number(values['Cantidad']||1)*.25).toFixed(2)} L</b></div><div className="d-detail-line"><span>Fermento</span><b>{(Number(values['Cantidad']||1)*.05).toFixed(2)} kg</b></div></>}
    {view.id==='products'&&<CatalogDetail entry={{...(entry||{name:values['Nombre del producto']||'',cells:['',String(values.Precio||80),'','Disponible']}),values:{...entry?.values,...values}}}/>} {view.id==='recipes'&&<RecipeDetail entry={{...(entry||{name:values['Producto o artículo']||'',cells:['','','','Nueva versión']}),values:{...entry?.values,...values}}}/>} {view.id==='purchases'&&<>{jsonValue(values.invoiceLines,defaultReceiptLines(entry)).map((line,i)=><div className="d-detail-line" key={i}><span>{line.article}<small>SKU {line.sku}</small></span><b>{line.received} de {line.quantity}</b></div>)}</>}<p className="d-note">Simulación local · No modifica el negocio real</p>{!tour&&<Select label="Resultado de prueba" selectedKey={scenario} onSelectionChange={key=>setScenario(String(key))}>{['Normal','Error temporal','Resultado desconocido'].map(s=><SelectItem key={s} id={s}>{s}</SelectItem>)}</Select>}
   </div>}
   {error&&<p role="alert" className="d-error">{error}</p>}
   <div className="d-form-actions"><Button variant="secondary" onClick={()=>step==='review'?setStep('edit'):onBack()}>{step==='review'?'Volver a editar':'Cancelar'}</Button>{step==='review'?<Button trailingIcon={RiCheckLine} onClick={confirm}>{error?'Reintentar la misma operación':'Confirmar en la demo'}</Button>:<Button data-target="d-review" type="submit" trailingIcon={RiArrowRightLine}>Revisar</Button>}</div>
  </form>}
 </section>
}
function CustomerPanel({tab,entry}:{tab:string;entry:Entry}){
 if(tab==='WhatsApp')return <><h2>WhatsApp</h2><div className="d-message"><span>{entry.name} · 14:50</span><p>¿A qué hora puedo pasar por mi pedido?</p></div><div className="d-message" data-outgoing><span>ONCA · 14:51</span><p>Tu pedido está en preparación. Te avisamos cuando esté listo.</p></div><p className="d-note">Historial de la conversación</p></>
 if(tab==='Pedidos')return <><h2>Últimos pedidos</h2><div className="d-detail-line"><span>Cuenta 043<small>Hoy · Para llevar</small></span><b>$135.00</b></div><div className="d-detail-line"><span>Cuenta 021<small>31 oct · Mesa 02</small></span><b>$180.00</b></div></>
 if(tab==='Lealtad'){const stamps=Number(entry.values?.stamps||5);return <><h2>Café frecuente</h2><div className="d-stamps" aria-label={`${stamps} de 8 sellos`}>{Array.from({length:8},(_,i)=><span key={i} data-filled={i<stamps}>{i<stamps?<RiCheckLine size={20}/>:i+1}</span>)}</div><p>{stamps>=8?'Recompensa disponible':`${8-stamps} visitas para un café de cortesía`}</p><div className="d-detail-line"><span>Saldo del monedero</span><b>{money(Number(entry.values?.balance||220))}</b></div>{entry.values?.lastOperation&&<p>{entry.values.lastOperation}</p>}</>}
 if(tab==='Notas')return <><h2>Notas del equipo</h2><div className="d-message"><span>Ana · 28 oct</span><p>Prefiere leche deslactosada.</p></div><p>Historial de notas del cliente conservado por el servicio de memoria.</p></>
 if(tab==='Datos')return <CustomerIdentity entry={entry}/>
 return <><h2>Relación con ONCA</h2><dl className="d-facts"><div><dt>Visitas</dt><dd>{entry.cells[1]||'12'}</dd></div><div><dt>Consumo acumulado</dt><dd>{entry.cells[2]||'$1,480.00'}</dd></div><div><dt>Última visita</dt><dd>Hoy</dd></div><div><dt>Saldo del monedero</dt><dd>{money(Number(entry.values?.balance||220))}</dd></div></dl><h2>Resumen generado por IA</h2><p className="d-note">Ejemplo de resumen automático: suele pedir bebidas con leche. Confirma las preferencias con el cliente.</p><h2>Pedido reciente</h2><div className="d-detail-line"><span>Cuenta 043<small>Latte · Concha</small></span><b>$135.00</b></div></>
}

function TransactionDetail({entry,view}:{entry:Entry;view:View}){
 const code=entry.name.replace('ONC-','').replace(/^0+/,'')
 const lines:Record<string,{name:string;quantity:number;price:number;detail?:string}[]>={
  '43':[{name:'Latte',quantity:1,price:90,detail:'Nube · Deslactosada'},{name:'Concha',quantity:1,price:45,detail:'Vainilla'}],
  '42':[{name:'Latte',quantity:1,price:90,detail:'Nube · Deslactosada'},{name:'Concha',quantity:1,price:45,detail:'Vainilla'}],
  '41':[{name:'Latte',quantity:2,price:90,detail:'Nube'}],
  '40':[{name:'Latte',quantity:1,price:90,detail:'Nube'}],
  '39':[{name:'Focaccia',quantity:1,price:85},{name:'Americano',quantity:1,price:50}],
  '46':[{name:'Pizza margarita',quantity:1,price:190},{name:'Capuccino',quantity:1,price:60}],
  '45':[{name:'Pizza margarita',quantity:1,price:190}],
  '1031':[{name:'Focaccia',quantity:1,price:85}],
 }
 const items=lines[code==='48'?'40':code==='47'?'39':code]||[]
 const amount=(n:number)=>n.toLocaleString('es-MX',{style:'currency',currency:'MXN'})
 const total=items.reduce((sum,i)=>sum+i.quantity*i.price,0)
 const displayed=entry.cells[view.columns.findIndex(c=>/Importe neto|Total/.test(c))-1]
 const refund=entry.cells.at(-1)==='Reembolsado'?total:0
 const method=entry.cells[1]
 const subtotal=Math.round(total/1.16*100)/100
 return <><h2>Conceptos</h2>{items.length?items.map(i=><div className="d-detail-line" key={i.name}><span>{i.quantity} × {i.name}{i.detail&&<small>{i.detail}</small>}</span><b>{amount(i.price*i.quantity)}</b></div>):<p>La cuenta está cancelada y no tiene importe pendiente.</p>}<div className="d-detail-line"><span>{view.id==='orders'?'Importe neto':'Total del recibo'}</span><b>{displayed||amount(total)}</b></div><h2>Importes</h2><dl className="d-facts"><div><dt>Subtotal</dt><dd>{amount(subtotal)}</dd></div><div><dt>Descuento</dt><dd>$0.00</dd></div><div><dt>IVA incluido · 16%</dt><dd>{amount(total-subtotal)}</dd></div><div><dt>Reembolsos</dt><dd>{amount(refund)}</dd></div><div><dt>Neto de la venta</dt><dd>{amount(total-refund)}</dd></div><div><dt>Operador</dt><dd>Ana López · Ejemplo</dd></div></dl>{view.id==='receipts'&&<><h2>Desglose del pago</h2>{method==='Mixto'?<><div className="d-detail-line"><span>Efectivo</span><b>$100.00</b></div><div className="d-detail-line"><span>Tarjeta</span><b>{amount(total-100)}</b></div></>:<div className="d-detail-line"><span>{method}</span><b>{amount(total)}</b></div>}{entry.values?.lastCopy&&<p>{entry.values.lastCopy}</p>}</>}<h2>Cronología</h2><ol className="d-timeline"><li><span>{entry.detail}</span></li><li><span>Estado actual<small>{entry.cells.at(-1)}</small></span></li></ol></>
}
